//! End-to-end tests: type into cells, read values back.
//!
//! These are written the way a user would describe the behaviour, and the
//! expected values are Excel's.

use cellmoa_core::edit::Actor;
use cellmoa_core::model::CellAddr;
use cellmoa_core::value::{CellError, Value};
use cellmoa_engine::Engine;

/// A one-sheet workbook to type into.
fn sheet() -> Engine {
    let mut engine = Engine::new();
    engine.add_sheet("Sheet1");
    engine
}

fn at(a1: &str) -> CellAddr {
    let cell = cellmoa_core::reference::CellRef::parse_a1(a1)
        .unwrap_or_else(|| panic!("bad address `{a1}`"));
    CellAddr::new(0, cell.col, cell.row)
}

/// Types `input` into `a1`, as a person would.
fn type_in(engine: &mut Engine, a1: &str, input: &str) {
    engine.set(Actor::human("tester"), at(a1), input).expect("edit rejected");
}

fn value(engine: &Engine, a1: &str) -> Value {
    engine.value(at(a1))
}

fn number(engine: &Engine, a1: &str) -> f64 {
    match value(engine, a1) {
        Value::Number(n) => n,
        other => panic!("{a1} is {other:?}, not a number"),
    }
}

/// Evaluates a formula on its own and returns the result.
fn calc(formula: &str) -> Value {
    let mut engine = sheet();
    type_in(&mut engine, "A1", formula);
    value(&engine, "A1")
}

fn calc_num(formula: &str) -> f64 {
    match calc(formula) {
        Value::Number(n) => n,
        other => panic!("`{formula}` gave {other:?}, not a number"),
    }
}

// ---------------------------------------------------------------------------
// Typing and recalculation
// ---------------------------------------------------------------------------

#[test]
fn typing_a_number_a_string_and_a_formula() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "10");
    type_in(&mut engine, "A2", "hello");
    type_in(&mut engine, "A3", "=A1*2");

    assert_eq!(value(&engine, "A1"), Value::Number(10.0));
    assert_eq!(value(&engine, "A2"), Value::Text("hello".into()));
    assert_eq!(value(&engine, "A3"), Value::Number(20.0));
    assert_eq!(engine.formula(at("A3")).as_deref(), Some("A1*2"));
}

#[test]
fn an_apostrophe_forces_a_number_to_stay_text() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "'007");
    assert_eq!(value(&engine, "A1"), Value::Text("007".into()));
}

#[test]
fn changing_an_input_updates_everything_downstream() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "10");
    type_in(&mut engine, "B1", "=A1*2");
    type_in(&mut engine, "C1", "=B1+1");
    assert_eq!(number(&engine, "C1"), 21.0);

    type_in(&mut engine, "A1", "100");
    assert_eq!(number(&engine, "B1"), 200.0);
    assert_eq!(number(&engine, "C1"), 201.0);
}

#[test]
fn a_formula_entered_after_its_inputs_still_computes() {
    let mut engine = sheet();
    type_in(&mut engine, "B1", "=A1+1");
    assert_eq!(number(&engine, "B1"), 1.0);
    type_in(&mut engine, "A1", "41");
    assert_eq!(number(&engine, "B1"), 42.0);
}

#[test]
fn a_range_formula_reacts_to_any_cell_inside_the_range() {
    let mut engine = sheet();
    type_in(&mut engine, "D1", "=SUM(A1:A100)");
    assert_eq!(number(&engine, "D1"), 0.0);
    type_in(&mut engine, "A50", "7");
    assert_eq!(number(&engine, "D1"), 7.0);
    type_in(&mut engine, "A99", "3");
    assert_eq!(number(&engine, "D1"), 10.0);
}

#[test]
fn a_whole_column_sum_only_visits_the_cells_that_exist() {
    let mut engine = sheet();
    type_in(&mut engine, "C1", "=SUM(A:A)");
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "A1000", "2");
    assert_eq!(number(&engine, "C1"), 3.0);
}

#[test]
fn a_batch_edit_never_publishes_a_half_updated_value() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "B1", "=A1*10");

    engine.apply(Actor::human("tester"), vec![(at("A1"), "5"), (at("C1"), "=B1+1")], None).unwrap();

    assert_eq!(number(&engine, "B1"), 50.0);
    assert_eq!(number(&engine, "C1"), 51.0);
    // One commit, so the revision moved by exactly one.
    assert_eq!(engine.revision(), 3);
}

#[test]
fn clearing_a_cell_recalculates_what_read_it() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "5");
    type_in(&mut engine, "B1", "=A1+1");
    type_in(&mut engine, "A1", "");
    assert_eq!(number(&engine, "B1"), 1.0);
}

#[test]
fn replacing_a_formula_with_a_literal_unhooks_it() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "B1", "=A1+1");
    type_in(&mut engine, "B1", "99");
    type_in(&mut engine, "A1", "1000");
    assert_eq!(number(&engine, "B1"), 99.0);
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

#[test]
fn a_circular_reference_reports_cycle_rather_than_hanging() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "=B1");
    type_in(&mut engine, "B1", "=A1");
    assert_eq!(value(&engine, "A1"), Value::Error(CellError::Cycle));
    assert_eq!(value(&engine, "B1"), Value::Error(CellError::Cycle));
}

#[test]
fn a_cell_reading_a_cycle_still_gets_a_useful_answer() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "=B1");
    type_in(&mut engine, "B1", "=A1");
    type_in(&mut engine, "C1", "=ISERROR(A1)");
    assert_eq!(value(&engine, "C1"), Value::Bool(true));
}

#[test]
fn breaking_a_cycle_restores_the_values() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "=B1");
    type_in(&mut engine, "B1", "=A1");
    type_in(&mut engine, "B1", "7");
    assert_eq!(number(&engine, "A1"), 7.0);
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

#[test]
fn arithmetic_follows_excels_precedence() {
    assert_eq!(calc_num("=1+2*3"), 7.0);
    assert_eq!(calc_num("=(1+2)*3"), 9.0);
    // Excel's own quirk: unary minus binds tighter than the power operator.
    assert_eq!(calc_num("=-2^2"), 4.0);
    assert_eq!(calc_num("=0-2^2"), -4.0);
    // ^ is left-associative.
    assert_eq!(calc_num("=2^3^2"), 64.0);
    assert_eq!(calc_num("=50%"), 0.5);
    assert_eq!(calc_num("=200*5%"), 10.0);
}

#[test]
fn division_by_zero_is_an_error_value_not_a_crash() {
    assert_eq!(calc("=1/0"), Value::Error(CellError::Div0));
    assert_eq!(calc("=1/0+1"), Value::Error(CellError::Div0));
}

#[test]
fn comparison_and_concatenation() {
    assert_eq!(calc("=1<2"), Value::Bool(true));
    assert_eq!(calc("=\"a\"<\"b\""), Value::Bool(true));
    // Numbers sort before text whatever their magnitude.
    assert_eq!(calc("=999<\"a\""), Value::Bool(true));
    assert_eq!(calc("=\"a\"&\"b\""), Value::Text("ab".into()));
    assert_eq!(calc("=1&2"), Value::Text("12".into()));
}

#[test]
fn an_empty_cell_reads_as_zero_and_as_an_empty_string() {
    let mut engine = sheet();
    type_in(&mut engine, "B1", "=A1+1");
    type_in(&mut engine, "B2", "=A1&\"x\"");
    type_in(&mut engine, "B3", "=A1=0");
    assert_eq!(number(&engine, "B1"), 1.0);
    assert_eq!(value(&engine, "B2"), Value::Text("x".into()));
    assert_eq!(value(&engine, "B3"), Value::Bool(true));
}

#[test]
fn the_intersection_operator_finds_the_shared_cell() {
    let mut engine = sheet();
    type_in(&mut engine, "B2", "42");
    type_in(&mut engine, "D1", "=A2:C2 B1:B3");
    assert_eq!(number(&engine, "D1"), 42.0);

    type_in(&mut engine, "D2", "=A1:A2 C1:C2");
    assert_eq!(value(&engine, "D2"), Value::Error(CellError::Null));
}

#[test]
fn the_union_operator_sums_disjoint_areas() {
    let mut engine = sheet();
    for (cell, n) in [("A1", "1"), ("A2", "2"), ("C1", "10"), ("C2", "20")] {
        type_in(&mut engine, cell, n);
    }
    type_in(&mut engine, "E1", "=SUM((A1:A2,C1:C2))");
    assert_eq!(number(&engine, "E1"), 33.0);
}

// ---------------------------------------------------------------------------
// Implicit intersection
// ---------------------------------------------------------------------------

#[test]
fn a_column_reference_intersects_against_the_formulas_own_row() {
    let mut engine = sheet();
    for (row, n) in (1..=4).zip([10, 20, 30, 40]) {
        type_in(&mut engine, &format!("A{row}"), &n.to_string());
    }
    type_in(&mut engine, "C3", "=A1:A4");
    assert_eq!(number(&engine, "C3"), 30.0);

    type_in(&mut engine, "C9", "=A1:A4");
    assert_eq!(value(&engine, "C9"), Value::Error(CellError::Value));
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

#[test]
fn if_does_not_evaluate_the_branch_it_does_not_take() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "0");
    // The false branch would divide by zero if it were evaluated.
    type_in(&mut engine, "B1", "=IF(A1=0,\"safe\",1/A1)");
    assert_eq!(value(&engine, "B1"), Value::Text("safe".into()));
}

#[test]
fn iferror_catches_and_ifna_is_narrower() {
    assert_eq!(calc("=IFERROR(1/0,\"caught\")"), Value::Text("caught".into()));
    assert_eq!(calc("=IFERROR(2,\"caught\")"), Value::Number(2.0));
    // IFNA lets a #DIV/0! through — only #N/A is caught.
    assert_eq!(calc("=IFNA(1/0,\"caught\")"), Value::Error(CellError::Div0));
    assert_eq!(calc("=IFNA(NA(),\"caught\")"), Value::Text("caught".into()));
}

#[test]
fn logical_aggregates_ignore_text_in_ranges() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "TRUE");
    type_in(&mut engine, "A2", "some text");
    type_in(&mut engine, "A3", "TRUE");
    type_in(&mut engine, "B1", "=AND(A1:A3)");
    assert_eq!(value(&engine, "B1"), Value::Bool(true));
}

#[test]
fn sum_coerces_a_typed_boolean_but_not_one_in_a_cell() {
    // This asymmetry is Excel's, and it is visible to users.
    assert_eq!(calc_num("=SUM(TRUE,1)"), 2.0);
    let mut engine = sheet();
    type_in(&mut engine, "A1", "TRUE");
    type_in(&mut engine, "A2", "1");
    type_in(&mut engine, "B1", "=SUM(A1:A2)");
    assert_eq!(number(&engine, "B1"), 1.0);
}

#[test]
fn an_error_inside_a_range_propagates_out_of_an_aggregate() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "A2", "=1/0");
    type_in(&mut engine, "B1", "=SUM(A1:A2)");
    assert_eq!(value(&engine, "B1"), Value::Error(CellError::Div0));
}

#[test]
fn rounding_matches_the_decimal_the_user_typed() {
    // 2.675*100 is 267.49999999999997 in binary floating point; a spreadsheet
    // still rounds it to 2.68.
    assert_eq!(calc_num("=ROUND(2.675,2)"), 2.68);
    assert_eq!(calc_num("=ROUND(2.5,0)"), 3.0);
    assert_eq!(calc_num("=ROUND(-2.5,0)"), -3.0);
    assert_eq!(calc_num("=ROUND(1234.5678,-2)"), 1200.0);
    assert_eq!(calc_num("=ROUNDUP(1.001,2)"), 1.01);
    assert_eq!(calc_num("=ROUNDDOWN(1.999,2)"), 1.99);
}

#[test]
fn mod_takes_the_sign_of_its_divisor() {
    assert_eq!(calc_num("=MOD(-3,2)"), 1.0);
    assert_eq!(calc_num("=MOD(3,-2)"), -1.0);
    assert_eq!(calc("=MOD(1,0)"), Value::Error(CellError::Div0));
}

#[test]
fn text_functions_count_characters_not_bytes() {
    assert_eq!(calc_num("=LEN(\"한국어\")"), 3.0);
    assert_eq!(calc("=LEFT(\"한국어\",2)"), Value::Text("한국".into()));
    assert_eq!(calc("=RIGHT(\"한국어\",1)"), Value::Text("어".into()));
    assert_eq!(calc("=MID(\"한국어\",2,1)"), Value::Text("국".into()));
    assert_eq!(calc_num("=SEARCH(\"국\",\"한국어\")"), 2.0);
}

#[test]
fn find_is_case_sensitive_and_search_is_not() {
    assert_eq!(calc_num("=SEARCH(\"B\",\"abc\")"), 2.0);
    assert_eq!(calc("=FIND(\"B\",\"abc\")"), Value::Error(CellError::Value));
    assert_eq!(calc_num("=FIND(\"b\",\"abc\")"), 2.0);
}

#[test]
fn substitute_can_target_one_occurrence() {
    assert_eq!(calc("=SUBSTITUTE(\"a-a-a\",\"a\",\"X\")"), Value::Text("X-X-X".into()));
    assert_eq!(calc("=SUBSTITUTE(\"a-a-a\",\"a\",\"X\",2)"), Value::Text("a-X-a".into()));
}

#[test]
fn errors_propagate_with_their_own_identity() {
    // The failure a function was handed must survive, not be flattened.
    assert_eq!(calc("=LEFT(1/0,2)"), Value::Error(CellError::Div0));
    assert_eq!(calc("=ROUND(1/0,2)"), Value::Error(CellError::Div0));
    assert_eq!(calc("=NOSUCHFUNC(1)"), Value::Error(CellError::Name));
}

#[test]
fn sumproduct_evaluates_its_arguments_as_arrays() {
    let mut engine = sheet();
    for (row, (a, b)) in (1..=3).zip([(1, 10), (5, 20), (9, 30)]) {
        type_in(&mut engine, &format!("A{row}"), &a.to_string());
        type_in(&mut engine, &format!("B{row}"), &b.to_string());
    }
    // The comparison has to broadcast across the range rather than intersect.
    type_in(&mut engine, "D1", "=SUMPRODUCT((A1:A3>4)*B1:B3)");
    assert_eq!(number(&engine, "D1"), 50.0);
}

#[test]
fn array_literals_evaluate_element_wise() {
    assert_eq!(calc_num("=SUM({1,2;3,4})"), 10.0);
    assert_eq!(calc_num("=SUMPRODUCT({1,2},{10,20})"), 50.0);
}

#[test]
fn row_and_column_report_the_formulas_own_position() {
    let mut engine = sheet();
    type_in(&mut engine, "C5", "=ROW()");
    type_in(&mut engine, "C6", "=COLUMN()");
    type_in(&mut engine, "C7", "=ROWS(A1:A9)");
    assert_eq!(number(&engine, "C5"), 5.0);
    assert_eq!(number(&engine, "C6"), 3.0);
    assert_eq!(number(&engine, "C7"), 9.0);
}

// ---------------------------------------------------------------------------
// Sheets, names, and cross-sheet references
// ---------------------------------------------------------------------------

#[test]
fn a_formula_can_read_another_sheet() {
    let mut engine = Engine::new();
    engine.add_sheet("Sheet1");
    let second = engine.add_sheet("Q1 Sales");
    engine.set(Actor::human("t"), CellAddr::new(second, 0, 0), "5").unwrap();
    engine.set(Actor::human("t"), CellAddr::new(0, 0, 0), "='Q1 Sales'!A1*2").unwrap();
    assert_eq!(engine.value(CellAddr::new(0, 0, 0)), Value::Number(10.0));

    // Editing the other sheet updates this one.
    engine.set(Actor::human("t"), CellAddr::new(second, 0, 0), "50").unwrap();
    assert_eq!(engine.value(CellAddr::new(0, 0, 0)), Value::Number(100.0));
}

#[test]
fn a_3d_reference_sums_the_same_cell_across_sheets() {
    let mut engine = Engine::new();
    for name in ["Jan", "Feb", "Mar"] {
        engine.add_sheet(name);
    }
    for sheet in 0..3 {
        engine.set(Actor::human("t"), CellAddr::new(sheet, 0, 0), "10").unwrap();
    }
    engine.add_sheet("Total");
    engine.set(Actor::human("t"), CellAddr::new(3, 0, 0), "=SUM(Jan:Mar!A1)").unwrap();
    assert_eq!(engine.value(CellAddr::new(3, 0, 0)), Value::Number(30.0));
}

#[test]
fn a_defined_name_resolves_and_tracks_its_target() {
    use cellmoa_core::model::DefinedName;
    let mut engine = sheet();
    engine.doc.workbook.define_name(DefinedName {
        name: "TaxRate".into(),
        refers_to: "Sheet1!$A$1".into(),
        scope: None,
    });
    type_in(&mut engine, "A1", "0.1");
    type_in(&mut engine, "B1", "=1000*TaxRate");
    assert_eq!(number(&engine, "B1"), 100.0);

    type_in(&mut engine, "A1", "0.2");
    assert_eq!(number(&engine, "B1"), 200.0);
}

#[test]
fn an_unknown_name_is_reported_rather_than_guessed() {
    assert_eq!(calc("=NotDefined+1"), Value::Error(CellError::Name));
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[test]
fn undo_restores_both_the_input_and_the_computed_values() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "B1", "=A1*10");
    type_in(&mut engine, "A1", "5");
    assert_eq!(number(&engine, "B1"), 50.0);

    engine.undo(Actor::human("tester"), None).unwrap();
    assert_eq!(number(&engine, "A1"), 1.0);
    assert_eq!(number(&engine, "B1"), 10.0);
}

#[test]
fn an_agents_edits_can_be_rolled_back_on_their_own() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    engine.set(Actor::agent("agent-7"), at("A1"), "999").unwrap();
    engine.set(Actor::human("tester"), at("B1"), "=A1*2").unwrap();
    assert_eq!(number(&engine, "B1"), 1998.0);

    engine.undo(Actor::human("tester"), Some("agent-7")).unwrap();

    // The agent's change is gone, the user's formula is not, and the value it
    // shows has been brought back in step.
    assert_eq!(number(&engine, "A1"), 1.0);
    assert_eq!(number(&engine, "B1"), 2.0);
}

#[test]
fn a_stale_agent_write_is_rejected_instead_of_clobbering() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    let seen_revision = engine.revision();

    // A person edits while the agent was thinking.
    type_in(&mut engine, "A1", "2");

    let result = engine.set_checked(Actor::agent("a1"), at("A1"), "999", seen_revision);
    assert!(result.is_err());
    assert_eq!(number(&engine, "A1"), 2.0);

    // Rebased against the current revision, the same write goes through.
    engine.set_checked(Actor::agent("a1"), at("A1"), "999", engine.revision()).unwrap();
    assert_eq!(number(&engine, "A1"), 999.0);
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

#[test]
fn the_same_edits_always_produce_the_same_workbook() {
    let build = || {
        let mut engine = sheet();
        for row in 1..=50 {
            type_in(&mut engine, &format!("A{row}"), &row.to_string());
            type_in(&mut engine, &format!("B{row}"), &format!("=A{row}*2+SUM($A$1:A{row})"));
        }
        engine
    };
    let (first, second) = (build(), build());
    for row in 1..=50 {
        let cell = format!("B{row}");
        assert_eq!(value(&first, &cell), value(&second, &cell), "{cell}");
    }
}

#[test]
fn random_values_are_reproducible_for_a_given_seed() {
    let build = |seed: u64| {
        let mut engine = Engine::new().with_seed(seed);
        engine.add_sheet("Sheet1");
        type_in(&mut engine, "A1", "=RAND()");
        type_in(&mut engine, "A2", "=RAND()");
        (number(&engine, "A1"), number(&engine, "A2"))
    };
    // A spreadsheet engine that cannot reproduce its own random numbers cannot
    // be replayed or fingerprinted.
    assert_eq!(build(42), build(42));
    assert_ne!(build(42), build(43));
    // Two cells with the same formula still differ from each other.
    let (a, b) = build(42);
    assert_ne!(a, b);
    assert!((0.0..1.0).contains(&a));
}

#[test]
fn a_deep_dependency_chain_evaluates_without_overflowing() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    for row in 2..=5000 {
        type_in(&mut engine, &format!("A{row}"), &format!("=A{}+1", row - 1));
    }
    assert_eq!(number(&engine, "A5000"), 5000.0);
}
