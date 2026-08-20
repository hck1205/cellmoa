//! Builds the example workbook used by the CI pipeline.
//!
//! Kept as code rather than a checked-in binary so the example can be read and
//! changed like anything else in the repository.

use cellmoa_core::edit::Actor;
use cellmoa_core::model::CellAddr;
use cellmoa_engine::Engine;
use cellmoa_xlsx::Package;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "examples/budget.xlsx".to_string());
    let mut engine = Engine::new();
    let sheet = engine.add_sheet("Budget");

    let rows: &[(&str, &str, &str)] = &[
        ("Item", "Q1", "Q2"),
        ("Rent", "12000", "12000"),
        ("Salaries", "84000", "91000"),
        ("Cloud", "6400", "7100"),
        ("Travel", "3200", "1800"),
    ];
    for (row, (item, q1, q2)) in rows.iter().enumerate() {
        for (col, text) in [item, q1, q2].iter().enumerate() {
            engine
                .set(
                    Actor::script("make_budget"),
                    CellAddr::new(sheet, col as u32, row as u32),
                    text,
                )
                .expect("edit should apply");
        }
    }
    // Totals, a growth rate, and the largest line of the quarter.
    let formulas: &[(&str, &str)] = &[
        ("A7", "Total"),
        ("B7", "=SUM(B2:B5)"),
        ("C7", "=SUM(C2:C5)"),
        ("A8", "Growth"),
        ("B8", "=C7/B7-1"),
        ("A9", "Largest line"),
        ("B9", "=INDEX(A2:A5,MATCH(MAX(C2:C5),C2:C5,0))"),
    ];
    for (reference, input) in formulas {
        let cell = cellmoa_core::reference::CellRef::parse_a1(reference).expect("valid address");
        engine
            .set(Actor::script("make_budget"), CellAddr::new(sheet, cell.col, cell.row), input)
            .expect("edit should apply");
    }

    Package::new(engine.workbook().clone()).save(&path).expect("save should succeed");
    println!("wrote {path}");
}
