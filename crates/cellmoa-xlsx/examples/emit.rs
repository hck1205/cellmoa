//! Writes a sample workbook, for checking against other implementations.

use cellmoa_core::model::{Cell, CellContent, DefinedName, Workbook};
use cellmoa_core::value::{CellError, Value};
use cellmoa_xlsx::Package;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "out.xlsx".to_string());
    let mut workbook = Workbook::new();
    let first = workbook.add_sheet("Sheet1");
    let second = workbook.add_sheet("Q1 Sales");

    let sheet = workbook.sheet_mut(first).unwrap();
    sheet.set(0, 0, Cell::literal(Value::Number(10.0)));
    sheet.set(0, 1, Cell::literal(Value::Text("hello".into())));
    sheet.set(0, 2, Cell::literal(Value::Bool(true)));
    sheet.set(0, 3, Cell::literal(Value::Error(CellError::Div0)));
    sheet.set(0, 4, Cell::literal(Value::Text("  padded  ".into())));
    sheet.set(0, 5, Cell::literal(Value::Text("한국어 & <markup>".into())));
    sheet.set(
        1,
        0,
        Cell { content: CellContent::formula("A1*2"), value: Value::Number(20.0), style: None },
    );
    sheet.set(
        1,
        2,
        Cell {
            content: CellContent::formula("SUM($A$1:A3)"),
            value: Value::Number(11.0),
            style: None,
        },
    );
    workbook.sheet_mut(second).unwrap().set(1, 1, Cell::literal(Value::Number(99.0)));
    workbook.define_name(DefinedName {
        name: "TaxRate".into(),
        refers_to: "Sheet1!$A$1".into(),
        scope: None,
    });

    Package::new(workbook).save(&path).expect("save should succeed");
    println!("wrote {path}");
}
