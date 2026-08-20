//! Reading a file this crate did not write.
//!
//! Round-tripping our own output only proves the reader and writer agree with
//! each other. The fixture here was produced by openpyxl, an unrelated
//! implementation, so it exercises the conventions a real file actually uses:
//! a shared string table, a styles part, relationship-indirected sheet paths,
//! and formula cells with no cached value.

use cellmoa_core::model::{CellAddr, CellContent};
use cellmoa_core::value::Value;
use cellmoa_xlsx::{Archive, Package};

const FIXTURE: &[u8] = include_bytes!("fixtures/written-by-openpyxl.xlsx");

fn at(sheet: u32, a1: &str) -> CellAddr {
    let cell = cellmoa_core::reference::CellRef::parse_a1(a1).expect("valid address");
    CellAddr::new(sheet, cell.col, cell.row)
}

fn fixture() -> Package {
    Package::from_bytes(FIXTURE).expect("the fixture should open")
}

#[test]
fn sheets_are_found_through_the_relationship_graph() {
    let package = fixture();
    let names: Vec<&str> = package.workbook.sheets().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["Data", "Q1 Sales"]);
}

#[test]
fn values_of_every_type_read_back() {
    let package = fixture();
    assert_eq!(package.workbook.value(at(0, "A1")), Value::Number(42.0));
    assert_eq!(package.workbook.value(at(0, "A2")), Value::Text("hello".into()));
    assert_eq!(package.workbook.value(at(0, "A3")), Value::Bool(true));
    assert_eq!(package.workbook.value(at(0, "D1")), Value::Number(1234.5));
    assert_eq!(package.workbook.value(at(1, "B2")), Value::Number(99.0));
}

#[test]
fn text_comes_out_of_the_shared_string_table_intact() {
    let package = fixture();
    // Repeated text is stored once and referenced twice.
    assert_eq!(package.workbook.value(at(0, "A4")), Value::Text("repeated".into()));
    assert_eq!(package.workbook.value(at(0, "A5")), Value::Text("repeated".into()));
    assert_eq!(package.workbook.value(at(0, "C1")), Value::Text("  spaces  ".into()));
    assert_eq!(package.workbook.value(at(0, "C2")), Value::Text("한국어 & <markup>".into()));
}

#[test]
fn formulas_keep_their_absolute_markers() {
    let package = fixture();
    assert_eq!(package.workbook.content(at(0, "B1")), CellContent::formula("A1*2"));
    assert_eq!(package.workbook.content(at(0, "B2")), CellContent::formula("SUM($A$1:A3)"));
}

#[test]
fn a_formula_with_no_cached_value_is_not_invented() {
    // openpyxl writes formulas without results. Reading one must leave the
    // value blank rather than guessing at it.
    assert_eq!(fixture().workbook.value(at(0, "B1")), Value::Blank);
}

#[test]
fn defined_names_read_back() {
    let package = fixture();
    assert_eq!(package.workbook.name("TaxRate").unwrap().refers_to, "Data!$A$1");
}

#[test]
fn format_indices_are_kept_so_formatting_can_be_written_back() {
    let package = fixture();
    // A1 is bold and A2 is filled; neither format is modelled, but both cells
    // point at the entry in the styles part that describes them.
    let sheet = package.workbook.sheet(0).unwrap();
    assert!(sheet.get(0, 0).unwrap().style.is_some(), "A1 lost its format index");
    assert!(sheet.get(0, 1).unwrap().style.is_some(), "A2 lost its format index");
    assert!(package.preserved().contains("xl/styles.xml"));
}

#[test]
fn saving_carries_the_unmodelled_parts_through() {
    let saved = Archive::read(&fixture().to_bytes()).expect("the saved file should be an archive");
    for part in ["xl/styles.xml", "xl/theme/theme1.xml", "docProps/core.xml"] {
        assert!(saved.contains(part), "{part} was dropped on save");
    }
    // The styles part comes through byte for byte.
    assert_eq!(saved.get("xl/styles.xml"), Archive::read(FIXTURE).unwrap().get("xl/styles.xml"));
}

#[test]
fn a_foreign_file_survives_a_full_round_trip() {
    let once = fixture().to_bytes();
    let twice = Package::from_bytes(&once).unwrap().to_bytes();
    assert_eq!(once, twice, "re-saving a foreign file kept changing it");

    // And the content is still right after the trip.
    let package = Package::from_bytes(&twice).unwrap();
    assert_eq!(package.workbook.value(at(0, "A1")), Value::Number(42.0));
    assert_eq!(package.workbook.content(at(0, "B2")), CellContent::formula("SUM($A$1:A3)"));
    assert_eq!(package.workbook.name("TaxRate").unwrap().refers_to, "Data!$A$1");
}
