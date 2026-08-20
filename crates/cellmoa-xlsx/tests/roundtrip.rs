//! Round-trip tests: a workbook written and read back must be the same
//! workbook.

use cellmoa_core::model::{Cell, CellAddr, CellContent, DefinedName, Workbook};
use cellmoa_core::value::{CellError, Value};
use cellmoa_xlsx::{Archive, Package};

fn at(sheet: u32, a1: &str) -> CellAddr {
    let cell = cellmoa_core::reference::CellRef::parse_a1(a1).expect("valid address");
    CellAddr::new(sheet, cell.col, cell.row)
}

/// A workbook exercising every kind of cell the format distinguishes.
fn sample() -> Workbook {
    let mut workbook = Workbook::new();
    let first = workbook.add_sheet("Sheet1");
    let second = workbook.add_sheet("Q1 Sales");

    let sheet = workbook.sheet_mut(first).unwrap();
    sheet.set(0, 0, Cell::literal(Value::Number(10.0)));
    sheet.set(0, 1, Cell::literal(Value::Text("hello".into())));
    sheet.set(0, 2, Cell::literal(Value::Bool(true)));
    sheet.set(0, 3, Cell::literal(Value::Error(CellError::Div0)));
    // A formula with a numeric result.
    sheet.set(
        1,
        0,
        Cell { content: CellContent::formula("A1*2"), value: Value::Number(20.0), style: None },
    );
    // A formula with a text result, which the format types differently.
    sheet.set(
        1,
        1,
        Cell {
            content: CellContent::formula(r#"CONCAT(A2," & more")"#),
            value: Value::Text("hello & more".into()),
            style: None,
        },
    );
    // Absolute markers and a quoted sheet name must survive verbatim.
    sheet.set(
        1,
        2,
        Cell {
            content: CellContent::formula("SUM($A$1:A3)+'Q1 Sales'!B2"),
            value: Value::Number(30.0),
            style: None,
        },
    );
    // A cell holding nothing but a format.
    sheet.set(5, 5, Cell::literal(Value::Blank).with_style(Some(7)));

    workbook.sheet_mut(second).unwrap().set(1, 1, Cell::literal(Value::Number(99.0)));

    workbook.define_name(DefinedName {
        name: "TaxRate".into(),
        refers_to: "Sheet1!$A$1".into(),
        scope: None,
    });
    workbook
}

fn round_trip(workbook: Workbook) -> Workbook {
    let bytes = Package::new(workbook).to_bytes();
    Package::from_bytes(&bytes).expect("written package should read back").workbook
}

#[test]
fn values_of_every_type_survive() {
    let after = round_trip(sample());
    assert_eq!(after.value(at(0, "A1")), Value::Number(10.0));
    assert_eq!(after.value(at(0, "A2")), Value::Text("hello".into()));
    assert_eq!(after.value(at(0, "A3")), Value::Bool(true));
    assert_eq!(after.value(at(0, "A4")), Value::Error(CellError::Div0));
}

#[test]
fn formulas_survive_as_written() {
    let after = round_trip(sample());
    assert_eq!(after.content(at(0, "B1")), CellContent::formula("A1*2"));
    // The cached result comes back too, so a file can be read without
    // recalculating it.
    assert_eq!(after.value(at(0, "B1")), Value::Number(20.0));
    assert_eq!(after.content(at(0, "B2")), CellContent::formula(r#"CONCAT(A2," & more")"#));
    assert_eq!(after.value(at(0, "B2")), Value::Text("hello & more".into()));
    // Absolute markers and the quoted sheet name are not reworded.
    assert_eq!(after.content(at(0, "B3")), CellContent::formula("SUM($A$1:A3)+'Q1 Sales'!B2"));
}

#[test]
fn sheets_keep_their_names_and_order() {
    let after = round_trip(sample());
    let names: Vec<&str> = after.sheets().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["Sheet1", "Q1 Sales"]);
    assert_eq!(after.value(at(1, "B2")), Value::Number(99.0));
}

#[test]
fn defined_names_survive() {
    let after = round_trip(sample());
    assert_eq!(after.name("TaxRate").unwrap().refers_to, "Sheet1!$A$1");
}

#[test]
fn a_cell_with_only_a_format_is_not_dropped() {
    let after = round_trip(sample());
    assert_eq!(after.sheet(0).unwrap().get(5, 5).unwrap().style, Some(7));
}

#[test]
fn a_second_round_trip_changes_nothing() {
    // The real test of losslessness: import, export, import, export again and
    // compare the files.
    let once = Package::new(sample()).to_bytes();
    let twice = Package::from_bytes(&once).unwrap().to_bytes();
    assert_eq!(once, twice, "a second round trip changed the file");
}

#[test]
fn saving_the_same_workbook_twice_gives_identical_bytes() {
    assert_eq!(Package::new(sample()).to_bytes(), Package::new(sample()).to_bytes());
}

#[test]
fn text_is_pooled_into_the_shared_string_table() {
    let mut workbook = Workbook::new();
    let id = workbook.add_sheet("Sheet1");
    let sheet = workbook.sheet_mut(id).unwrap();
    for row in 0..100 {
        sheet.set(0, row, Cell::literal(Value::Text("repeated label".into())));
    }
    let bytes = Package::new(workbook).to_bytes();
    let archive = Archive::read(&bytes).unwrap();
    let table = String::from_utf8(archive.get("xl/sharedStrings.xml").unwrap().to_vec()).unwrap();
    // One entry, referenced a hundred times.
    assert_eq!(table.matches("<si>").count(), 1);
    assert!(table.contains(r#"count="1""#));
}

#[test]
fn leading_and_trailing_spaces_in_text_survive() {
    let mut workbook = Workbook::new();
    let id = workbook.add_sheet("Sheet1");
    workbook.sheet_mut(id).unwrap().set(0, 0, Cell::literal(Value::Text("  padded  ".into())));
    let after = round_trip(workbook);
    assert_eq!(after.value(at(0, "A1")), Value::Text("  padded  ".into()));
}

#[test]
fn characters_that_need_escaping_survive() {
    let mut workbook = Workbook::new();
    let id = workbook.add_sheet("Sheet1");
    let sheet = workbook.sheet_mut(id).unwrap();
    sheet.set(0, 0, Cell::literal(Value::Text(r#"a < b & c > d "quoted""#.into())));
    sheet.set(0, 1, Cell::literal(Value::Text("한국어 テキスト 🎉".into())));
    let after = round_trip(workbook);
    assert_eq!(after.value(at(0, "A1")), Value::Text(r#"a < b & c > d "quoted""#.into()));
    assert_eq!(after.value(at(0, "A2")), Value::Text("한국어 テキスト 🎉".into()));
}

#[test]
fn an_unmodelled_part_is_carried_through_untouched() {
    // Build a package that also contains a styles part, then save it and check
    // the styles came along.
    let mut original = Archive::read(&Package::new(sample()).to_bytes()).unwrap();
    original.insert("xl/styles.xml", b"<styleSheet>original</styleSheet>".to_vec());
    original.insert("xl/theme/theme1.xml", b"<theme/>".to_vec());
    let bytes = original.write();

    let package = Package::from_bytes(&bytes).unwrap();
    let saved = Archive::read(&package.to_bytes()).unwrap();
    assert_eq!(saved.get("xl/styles.xml").unwrap(), b"<styleSheet>original</styleSheet>");
    assert!(saved.contains("xl/theme/theme1.xml"));

    // And it is declared, or the file would not open.
    let types = String::from_utf8(saved.get("[Content_Types].xml").unwrap().to_vec()).unwrap();
    assert!(types.contains("/xl/styles.xml"));
    assert!(types.contains("/xl/theme/theme1.xml"));
}

#[test]
fn a_stale_worksheet_part_is_not_carried_over() {
    // A package whose original had three sheets, saved with two.
    let mut original = Archive::read(&Package::new(sample()).to_bytes()).unwrap();
    original.insert("xl/worksheets/sheet3.xml", b"<worksheet/>".to_vec());
    let package = Package::from_bytes(&original.write()).unwrap();
    let saved = Archive::read(&package.to_bytes()).unwrap();
    assert!(!saved.contains("xl/worksheets/sheet3.xml"));
}

#[test]
fn a_shared_formula_expands_into_every_cell_that_uses_it() {
    // Files written by Excel store a column of similar formulas this way.
    let sheet = r#"<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c></row>
    <row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>
    <row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>6</v></c></row>
  </sheetData>
</worksheet>"#;
    let mut archive = Archive::read(&Package::new(sample()).to_bytes()).unwrap();
    archive.insert("xl/worksheets/sheet1.xml", sheet.as_bytes().to_vec());
    let package = Package::from_bytes(&archive.write()).unwrap();

    assert_eq!(package.workbook.content(at(0, "B1")), CellContent::formula("A1*2"));
    // The cells below carry only the index; their formula is the master shifted.
    assert_eq!(package.workbook.content(at(0, "B2")), CellContent::formula("A2*2"));
    assert_eq!(package.workbook.content(at(0, "B3")), CellContent::formula("A3*2"));
    assert_eq!(package.workbook.value(at(0, "B3")), Value::Number(6.0));
}

#[test]
fn an_inline_string_reads_like_a_shared_one() {
    let sheet = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>inline text</t></is></c></row></sheetData>
</worksheet>"#;
    let mut archive = Archive::read(&Package::new(sample()).to_bytes()).unwrap();
    archive.insert("xl/worksheets/sheet1.xml", sheet.as_bytes().to_vec());
    let package = Package::from_bytes(&archive.write()).unwrap();
    assert_eq!(package.workbook.value(at(0, "A1")), Value::Text("inline text".into()));
}

#[test]
fn a_string_split_into_runs_joins_back_up() {
    // Excel splits a string wherever its formatting changes.
    let strings = r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><r><t>bold</t></r><r><t> and plain</t></r></si>
</sst>"#;
    let sheet = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>
</worksheet>"#;
    let mut archive = Archive::read(&Package::new(sample()).to_bytes()).unwrap();
    archive.insert("xl/sharedStrings.xml", strings.as_bytes().to_vec());
    archive.insert("xl/worksheets/sheet1.xml", sheet.as_bytes().to_vec());
    let package = Package::from_bytes(&archive.write()).unwrap();
    assert_eq!(package.workbook.value(at(0, "A1")), Value::Text("bold and plain".into()));
}

#[test]
fn a_file_that_is_not_a_workbook_is_rejected_cleanly() {
    assert!(Package::from_bytes(b"not a zip at all").is_err());
    // A valid zip with no workbook in it.
    let mut archive = Archive::new();
    archive.insert("readme.txt", b"hello".to_vec());
    assert!(Package::from_bytes(&archive.write()).is_err());
}
