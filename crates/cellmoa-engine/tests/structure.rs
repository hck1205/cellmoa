//! Inserting and deleting rows and columns.
//!
//! The rule being checked throughout is that a formula keeps meaning the same
//! thing: whatever it pointed at before, it points at afterwards — unless what
//! it pointed at was deleted, in which case it says so.

use cellmoa_core::edit::Actor;
use cellmoa_core::model::{CellAddr, CellContent, Workbook};
use cellmoa_core::value::{CellError, Value};
use cellmoa_engine::structure::Alter;
use cellmoa_engine::Engine;

fn sheet() -> Engine {
    let mut workbook = Workbook::new();
    workbook.add_sheet("Sheet1");
    Engine::from_workbook(workbook)
}

fn at(a1: &str) -> CellAddr {
    let cell = cellmoa_core::reference::CellRef::parse_a1(a1).expect("bad address");
    CellAddr::new(0, cell.col, cell.row)
}

fn type_in(engine: &mut Engine, a1: &str, input: &str) {
    engine.set(Actor::human("tester"), at(a1), input).expect("edit rejected");
}

fn alter(engine: &mut Engine, change: Alter) {
    engine.alter(Actor::human("tester"), change, None, None).expect("alter rejected");
}

fn value(engine: &Engine, a1: &str) -> Value {
    engine.value(at(a1))
}

fn formula(engine: &Engine, a1: &str) -> String {
    match engine.doc.workbook.content(at(a1)) {
        CellContent::Formula(text) => format!("={text}"),
        CellContent::Literal(v) => v.to_string(),
        CellContent::Empty => String::new(),
    }
}

#[test]
fn inserting_a_row_moves_the_cells_below_it_down() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "top");
    type_in(&mut engine, "A2", "middle");
    type_in(&mut engine, "A3", "bottom");

    alter(&mut engine, Alter::InsertRows { sheet: 0, at: 1, count: 1 });

    assert_eq!(value(&engine, "A1"), Value::Text("top".into()));
    assert_eq!(value(&engine, "A2"), Value::Blank);
    assert_eq!(value(&engine, "A3"), Value::Text("middle".into()));
    assert_eq!(value(&engine, "A4"), Value::Text("bottom".into()));
}

#[test]
fn a_formula_still_points_at_what_it_pointed_at() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "10");
    type_in(&mut engine, "B1", "=A1*2");

    alter(&mut engine, Alter::InsertRows { sheet: 0, at: 0, count: 1 });

    // Both moved down together, so the formula still reads the same cell.
    assert_eq!(formula(&engine, "B2"), "=A2*2");
    assert_eq!(value(&engine, "B2"), Value::Number(20.0));
}

#[test]
fn a_formula_that_stays_put_follows_what_moved() {
    let mut engine = sheet();
    type_in(&mut engine, "A5", "7");
    type_in(&mut engine, "C1", "=A5");

    alter(&mut engine, Alter::InsertRows { sheet: 0, at: 2, count: 2 });

    assert_eq!(formula(&engine, "C1"), "=A7");
    assert_eq!(value(&engine, "C1"), Value::Number(7.0));
}

#[test]
fn a_sum_grows_when_a_row_is_inserted_inside_it() {
    let mut engine = sheet();
    for (cell, n) in [("A1", "1"), ("A2", "2"), ("A3", "3")] {
        type_in(&mut engine, cell, n);
    }
    type_in(&mut engine, "B1", "=SUM(A1:A3)");
    assert_eq!(value(&engine, "B1"), Value::Number(6.0));

    alter(&mut engine, Alter::InsertRows { sheet: 0, at: 1, count: 1 });
    // The new row is inside the block being summed, so the sum covers it.
    assert_eq!(formula(&engine, "B1"), "=SUM(A1:A4)");
    type_in(&mut engine, "A2", "10");
    assert_eq!(value(&engine, "B1"), Value::Number(16.0));
}

#[test]
fn deleting_a_row_removes_it_and_pulls_the_rest_up() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "one");
    type_in(&mut engine, "A2", "two");
    type_in(&mut engine, "A3", "three");

    alter(&mut engine, Alter::RemoveRows { sheet: 0, at: 1, count: 1 });

    assert_eq!(value(&engine, "A1"), Value::Text("one".into()));
    assert_eq!(value(&engine, "A2"), Value::Text("three".into()));
    // The tail is actually gone, not left behind as a copy.
    assert_eq!(value(&engine, "A3"), Value::Blank);
}

#[test]
fn a_reference_to_a_deleted_cell_becomes_a_ref_error() {
    let mut engine = sheet();
    type_in(&mut engine, "A2", "gone");
    type_in(&mut engine, "C1", "=A2");

    alter(&mut engine, Alter::RemoveRows { sheet: 0, at: 1, count: 1 });

    assert_eq!(formula(&engine, "C1"), "=#REF!");
    assert_eq!(value(&engine, "C1"), Value::Error(CellError::Ref));
}

#[test]
fn a_sum_shrinks_when_rows_are_deleted_out_of_it() {
    let mut engine = sheet();
    for (cell, n) in [("A1", "1"), ("A2", "2"), ("A3", "3"), ("A4", "4")] {
        type_in(&mut engine, cell, n);
    }
    type_in(&mut engine, "C1", "=SUM(A1:A4)");

    alter(&mut engine, Alter::RemoveRows { sheet: 0, at: 1, count: 2 });

    assert_eq!(formula(&engine, "C1"), "=SUM(A1:A2)");
    assert_eq!(value(&engine, "C1"), Value::Number(5.0));
}

#[test]
fn columns_work_the_same_way() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "B1", "2");
    type_in(&mut engine, "C1", "=A1+B1");

    alter(&mut engine, Alter::InsertCols { sheet: 0, at: 1, count: 1 });

    assert_eq!(value(&engine, "A1"), Value::Number(1.0));
    assert_eq!(value(&engine, "B1"), Value::Blank);
    assert_eq!(value(&engine, "C1"), Value::Number(2.0));
    assert_eq!(formula(&engine, "D1"), "=A1+C1");
    assert_eq!(value(&engine, "D1"), Value::Number(3.0));
}

#[test]
fn a_formula_on_another_sheet_follows_the_change() {
    let mut workbook = Workbook::new();
    workbook.add_sheet("Data");
    workbook.add_sheet("Summary");
    let mut engine = Engine::from_workbook(workbook);

    engine.set(Actor::human("t"), CellAddr::new(0, 0, 4), "42").unwrap();
    engine.set(Actor::human("t"), CellAddr::new(1, 0, 0), "=Data!A5").unwrap();

    engine
        .alter(Actor::human("t"), Alter::InsertRows { sheet: 0, at: 0, count: 1 }, None, None)
        .unwrap();

    assert_eq!(
        engine.doc.workbook.content(CellAddr::new(1, 0, 0)),
        CellContent::formula("Data!A6")
    );
    assert_eq!(engine.value(CellAddr::new(1, 0, 0)), Value::Number(42.0));
}

#[test]
fn an_unqualified_reference_on_another_sheet_is_left_alone() {
    let mut workbook = Workbook::new();
    workbook.add_sheet("Data");
    workbook.add_sheet("Summary");
    let mut engine = Engine::from_workbook(workbook);

    engine.set(Actor::human("t"), CellAddr::new(1, 0, 4), "99").unwrap();
    // On Summary, `A5` means Summary!A5 — inserting on Data must not touch it.
    engine.set(Actor::human("t"), CellAddr::new(1, 1, 0), "=A5").unwrap();

    engine
        .alter(Actor::human("t"), Alter::InsertRows { sheet: 0, at: 0, count: 1 }, None, None)
        .unwrap();

    assert_eq!(engine.value(CellAddr::new(1, 1, 0)), Value::Number(99.0));
}

#[test]
fn a_structural_edit_can_be_undone() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "A2", "2");
    type_in(&mut engine, "B1", "=SUM(A1:A2)");

    alter(&mut engine, Alter::RemoveRows { sheet: 0, at: 0, count: 1 });
    assert_eq!(formula(&engine, "B1"), "");

    engine.undo(Actor::human("tester"), None).expect("undo failed");
    assert_eq!(formula(&engine, "B1"), "=SUM(A1:A2)");
    assert_eq!(value(&engine, "A1"), Value::Number(1.0));
    assert_eq!(value(&engine, "A2"), Value::Number(2.0));
    assert_eq!(value(&engine, "B1"), Value::Number(3.0));
}

#[test]
fn a_change_that_writes_nothing_is_not_recorded() {
    let mut engine = sheet();
    let before = engine.doc.revision();
    // An empty sheet has nothing to move and no formula to rewrite.
    alter(&mut engine, Alter::InsertRows { sheet: 0, at: 0, count: 3 });
    assert_eq!(engine.doc.revision(), before, "an empty change must not reach the journal");
}
