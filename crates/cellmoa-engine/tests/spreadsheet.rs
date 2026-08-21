//! End-to-end tests: type into cells, read values back.
//!
//! These are written the way a user would describe the behaviour, and the
//! expected values are Excel's.

use cellmoa_core::edit::Actor;
use cellmoa_core::model::CellAddr;
use cellmoa_core::value::{CellError, Value};
use cellmoa_engine::Engine;

/// A one-sheet workbook to type into.
///
/// The sheet is part of the starting workbook rather than an edit, which is how
/// a real document begins — so the revisions counted below are only the edits
/// under test.
fn sheet() -> Engine {
    let mut workbook = cellmoa_core::model::Workbook::new();
    workbook.add_sheet("Sheet1");
    Engine::from_workbook(workbook)
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

// ---------------------------------------------------------------------------
// Statistics and criteria
// ---------------------------------------------------------------------------

/// Fills A1:B7 with a small sales table:
/// column A is a region, column B an amount.
fn sales_table() -> Engine {
    let mut engine = sheet();
    let rows = [
        ("North", "100"),
        ("South", "200"),
        ("North", "300"),
        ("East", "-50"),
        ("North", ""),
        ("South", "400"),
        ("Northwest", "10"),
    ];
    for (i, (region, amount)) in rows.iter().enumerate() {
        let row = i + 1;
        type_in(&mut engine, &format!("A{row}"), region);
        if !amount.is_empty() {
            type_in(&mut engine, &format!("B{row}"), amount);
        }
    }
    engine
}

#[test]
fn counting_distinguishes_numbers_text_and_blanks() {
    let mut engine = sales_table();
    type_in(&mut engine, "D1", "=COUNT(B1:B7)");
    type_in(&mut engine, "D2", "=COUNTA(A1:A7)");
    type_in(&mut engine, "D3", "=COUNTBLANK(B1:B7)");
    assert_eq!(number(&engine, "D1"), 6.0);
    assert_eq!(number(&engine, "D2"), 7.0);
    assert_eq!(number(&engine, "D3"), 1.0);
}

#[test]
fn count_reads_a_typed_literal_but_not_text_in_a_cell() {
    assert_eq!(calc_num("=COUNT(1,\"1\",TRUE)"), 3.0);
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "A2", "not a number");
    type_in(&mut engine, "B1", "=COUNT(A1:A2)");
    assert_eq!(number(&engine, "B1"), 1.0);
}

#[test]
fn count_ignores_an_error_in_the_range() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "1");
    type_in(&mut engine, "A2", "=1/0");
    type_in(&mut engine, "B1", "=COUNT(A1:A2)");
    // Every other aggregate would propagate the #DIV/0!.
    assert_eq!(number(&engine, "B1"), 1.0);
}

#[test]
fn sumif_and_countif_match_on_criteria() {
    let mut engine = sales_table();
    type_in(&mut engine, "D1", "=SUMIF(A1:A7,\"North\",B1:B7)");
    type_in(&mut engine, "D2", "=COUNTIF(A1:A7,\"North\")");
    type_in(&mut engine, "D3", "=SUMIF(B1:B7,\">100\")");
    assert_eq!(number(&engine, "D1"), 400.0);
    // "North" is an equality test, so "Northwest" does not match.
    assert_eq!(number(&engine, "D2"), 3.0);
    assert_eq!(number(&engine, "D3"), 900.0);
}

#[test]
fn criteria_take_wildcards() {
    let mut engine = sales_table();
    type_in(&mut engine, "D1", "=COUNTIF(A1:A7,\"North*\")");
    type_in(&mut engine, "D2", "=SUMIF(A1:A7,\"*outh\",B1:B7)");
    assert_eq!(number(&engine, "D1"), 4.0);
    assert_eq!(number(&engine, "D2"), 600.0);
}

#[test]
fn a_sum_range_is_stretched_to_match_the_criteria_range() {
    let mut engine = sales_table();
    // B1 alone, resized to B1:B7 — Excel's rule.
    type_in(&mut engine, "D1", "=SUMIF(A1:A7,\"North\",B1)");
    assert_eq!(number(&engine, "D1"), 400.0);
}

#[test]
fn sumifs_applies_every_criterion() {
    let mut engine = sales_table();
    type_in(&mut engine, "D1", "=SUMIFS(B1:B7,A1:A7,\"North\",B1:B7,\">150\")");
    type_in(&mut engine, "D2", "=COUNTIFS(A1:A7,\"North\",B1:B7,\">150\")");
    assert_eq!(number(&engine, "D1"), 300.0);
    assert_eq!(number(&engine, "D2"), 1.0);
}

#[test]
fn a_criteria_range_can_be_a_whole_column() {
    let mut engine = sales_table();
    // The engine must not walk a million rows to answer this.
    type_in(&mut engine, "D1", "=COUNTIF(A:A,\"North\")");
    type_in(&mut engine, "D2", "=SUMIF(A:A,\"North\",B:B)");
    assert_eq!(number(&engine, "D1"), 3.0);
    assert_eq!(number(&engine, "D2"), 400.0);
}

#[test]
fn maxifs_handles_an_all_negative_match() {
    let mut engine = sales_table();
    type_in(&mut engine, "D1", "=MAXIFS(B1:B7,A1:A7,\"East\")");
    type_in(&mut engine, "D2", "=MAXIFS(B1:B7,A1:A7,\"Nowhere\")");
    assert_eq!(number(&engine, "D1"), -50.0);
    // Nothing matched, so the answer is zero rather than a negative infinity.
    assert_eq!(number(&engine, "D2"), 0.0);
}

#[test]
fn averages_and_extremes() {
    let mut engine = sales_table();
    type_in(&mut engine, "D1", "=AVERAGE(B1:B7)");
    type_in(&mut engine, "D2", "=MAX(B1:B7)");
    type_in(&mut engine, "D3", "=MIN(B1:B7)");
    type_in(&mut engine, "D4", "=MEDIAN(B1:B7)");
    assert_eq!(number(&engine, "D1"), 960.0 / 6.0);
    assert_eq!(number(&engine, "D2"), 400.0);
    assert_eq!(number(&engine, "D3"), -50.0);
    assert_eq!(number(&engine, "D4"), 150.0);
}

#[test]
fn averaging_nothing_is_a_division_by_zero() {
    let mut engine = sheet();
    // The formula sits outside the range it reads; putting it inside would be
    // a self-reference, and correctly reports a cycle instead.
    type_in(&mut engine, "C1", "=AVERAGE(A1:A9)");
    type_in(&mut engine, "C2", "=MAX(A1:A9)");
    assert_eq!(value(&engine, "C1"), Value::Error(CellError::Div0));
    // MAX of nothing, however, is zero.
    assert_eq!(value(&engine, "C2"), Value::Number(0.0));
}

#[test]
fn an_aggregate_over_its_own_cell_is_a_cycle() {
    assert_eq!(calc("=SUM(A1:A9)"), Value::Error(CellError::Cycle));
}

#[test]
fn sample_and_population_spread_differ_by_their_denominator() {
    let mut engine = sheet();
    for (row, n) in (1..=5).zip([2, 4, 4, 4, 5]) {
        type_in(&mut engine, &format!("A{row}"), &n.to_string());
    }
    type_in(&mut engine, "C1", "=VAR.P(A1:A5)");
    type_in(&mut engine, "C2", "=STDEV.P(A1:A5)");
    type_in(&mut engine, "C3", "=VAR.S(A1:A5)");
    // 2,4,4,4,5 has a mean of 3.8 and a squared-deviation total of 4.8.
    assert_eq!(number(&engine, "C1"), 4.8 / 5.0);
    assert_eq!(number(&engine, "C2"), (4.8f64 / 5.0).sqrt());
    assert_eq!(number(&engine, "C3"), 4.8 / 4.0);
}

#[test]
fn order_statistics() {
    let mut engine = sheet();
    for (row, n) in (1..=5).zip([1, 2, 3, 4, 10]) {
        type_in(&mut engine, &format!("A{row}"), &n.to_string());
    }
    type_in(&mut engine, "C1", "=LARGE(A1:A5,2)");
    type_in(&mut engine, "C2", "=SMALL(A1:A5,2)");
    type_in(&mut engine, "C3", "=MEDIAN(A1:A5)");
    type_in(&mut engine, "C4", "=PERCENTILE.INC(A1:A5,0.5)");
    type_in(&mut engine, "C5", "=QUARTILE.INC(A1:A5,1)");
    type_in(&mut engine, "C6", "=RANK(4,A1:A5)");
    assert_eq!(number(&engine, "C1"), 4.0);
    assert_eq!(number(&engine, "C2"), 2.0);
    assert_eq!(number(&engine, "C3"), 3.0);
    assert_eq!(number(&engine, "C4"), 3.0);
    assert_eq!(number(&engine, "C5"), 2.0);
    assert_eq!(number(&engine, "C6"), 2.0);
}

#[test]
fn correlation_and_regression_on_a_perfect_line() {
    let mut engine = sheet();
    for (row, (x, y)) in (1..=4).zip([(1, 3), (2, 5), (3, 7), (4, 9)]) {
        type_in(&mut engine, &format!("A{row}"), &x.to_string());
        type_in(&mut engine, &format!("B{row}"), &y.to_string());
    }
    // y = 2x + 1 exactly.
    type_in(&mut engine, "D1", "=SLOPE(B1:B4,A1:A4)");
    type_in(&mut engine, "D2", "=INTERCEPT(B1:B4,A1:A4)");
    type_in(&mut engine, "D3", "=CORREL(A1:A4,B1:B4)");
    type_in(&mut engine, "D4", "=FORECAST(10,B1:B4,A1:A4)");
    assert_eq!(number(&engine, "D1"), 2.0);
    assert_eq!(number(&engine, "D2"), 1.0);
    assert!((number(&engine, "D3") - 1.0).abs() < 1e-12);
    assert_eq!(number(&engine, "D4"), 21.0);
}

#[test]
fn mode_reports_nothing_when_nothing_repeats() {
    let mut engine = sheet();
    for (row, n) in (1..=5).zip([1, 2, 2, 3, 3]) {
        type_in(&mut engine, &format!("A{row}"), &n.to_string());
    }
    type_in(&mut engine, "C1", "=MODE.SNGL(A1:A5)");
    assert_eq!(number(&engine, "C1"), 2.0);

    let mut engine = sheet();
    for (row, n) in (1..=3).zip([1, 2, 3]) {
        type_in(&mut engine, &format!("A{row}"), &n.to_string());
    }
    type_in(&mut engine, "C1", "=MODE.SNGL(A1:A3)");
    assert_eq!(value(&engine, "C1"), Value::Error(CellError::NA));
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/// A price list in A1:C4, sorted by the code in column A.
fn price_list() -> Engine {
    let mut engine = sheet();
    let rows = [
        ("10", "apple", "1.5"),
        ("20", "banana", "2.5"),
        ("30", "cherry", "3.5"),
        ("40", "date", "4.5"),
    ];
    for (i, (code, name, price)) in rows.iter().enumerate() {
        let row = i + 1;
        type_in(&mut engine, &format!("A{row}"), code);
        type_in(&mut engine, &format!("B{row}"), name);
        type_in(&mut engine, &format!("C{row}"), price);
    }
    engine
}

#[test]
fn vlookup_exact_and_approximate() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=VLOOKUP(30,A1:C4,2,FALSE)");
    // Approximate matching takes the largest code at or below 25.
    type_in(&mut engine, "E2", "=VLOOKUP(25,A1:C4,2,TRUE)");
    type_in(&mut engine, "E3", "=VLOOKUP(25,A1:C4,2,FALSE)");
    type_in(&mut engine, "E4", "=VLOOKUP(5,A1:C4,2,TRUE)");
    assert_eq!(value(&engine, "E1"), Value::Text("cherry".into()));
    assert_eq!(value(&engine, "E2"), Value::Text("banana".into()));
    assert_eq!(value(&engine, "E3"), Value::Error(CellError::NA));
    // Below every key, so there is nothing to fall back to.
    assert_eq!(value(&engine, "E4"), Value::Error(CellError::NA));
}

#[test]
fn vlookup_defaults_to_approximate_matching() {
    let mut engine = price_list();
    // The omitted fourth argument is TRUE, which is why this finds a row at all.
    type_in(&mut engine, "E1", "=VLOOKUP(25,A1:C4,2)");
    assert_eq!(value(&engine, "E1"), Value::Text("banana".into()));
}

#[test]
fn an_out_of_range_column_index_is_a_ref_error() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=VLOOKUP(10,A1:C4,9,FALSE)");
    assert_eq!(value(&engine, "E1"), Value::Error(CellError::Ref));
}

#[test]
fn exact_lookup_accepts_wildcards() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=MATCH(\"ban*\",B1:B4,0)");
    assert_eq!(number(&engine, "E1"), 2.0);
}

#[test]
fn match_and_index_compose_into_a_lookup() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=INDEX(C1:C4,MATCH(\"cherry\",B1:B4,0))");
    assert_eq!(number(&engine, "E1"), 3.5);
}

#[test]
fn index_returns_a_reference_so_it_can_end_a_range() {
    let mut engine = price_list();
    // A1:INDEX(A1:A4,3) is A1:A3.
    type_in(&mut engine, "E1", "=SUM(A1:INDEX(A1:A4,3))");
    assert_eq!(number(&engine, "E1"), 60.0);
}

#[test]
fn index_with_a_zero_index_yields_a_whole_column() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=SUM(INDEX(A1:C4,0,3))");
    assert_eq!(number(&engine, "E1"), 12.0);
}

#[test]
fn hlookup_searches_the_first_row() {
    let mut engine = sheet();
    for (col, (head, body)) in [("A", ("1", "one")), ("B", ("2", "two")), ("C", ("3", "three"))] {
        type_in(&mut engine, &format!("{col}1"), head);
        type_in(&mut engine, &format!("{col}2"), body);
    }
    type_in(&mut engine, "A4", "=HLOOKUP(2,A1:C2,2,FALSE)");
    assert_eq!(value(&engine, "A4"), Value::Text("two".into()));
}

#[test]
fn xlookup_returns_its_fallback_instead_of_an_error() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=XLOOKUP(99,A1:A4,B1:B4,\"missing\")");
    type_in(&mut engine, "E2", "=XLOOKUP(20,A1:A4,B1:B4,\"missing\")");
    assert_eq!(value(&engine, "E1"), Value::Text("missing".into()));
    assert_eq!(value(&engine, "E2"), Value::Text("banana".into()));
}

#[test]
fn offset_moves_and_resizes_a_reference() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=SUM(OFFSET(A1,0,2,4,1))");
    type_in(&mut engine, "E2", "=OFFSET(A1,2,1)");
    assert_eq!(number(&engine, "E1"), 12.0);
    assert_eq!(value(&engine, "E2"), Value::Text("cherry".into()));
    // Stepping off the top of the sheet is a #REF!.
    type_in(&mut engine, "E3", "=OFFSET(A1,-1,0)");
    assert_eq!(value(&engine, "E3"), Value::Error(CellError::Ref));
}

#[test]
fn indirect_builds_a_reference_from_text() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=INDIRECT(\"B\"&2)");
    assert_eq!(value(&engine, "E1"), Value::Text("banana".into()));
    type_in(&mut engine, "E2", "=INDIRECT(\"not a reference\")");
    assert_eq!(value(&engine, "E2"), Value::Error(CellError::Ref));
}

#[test]
fn address_composes_a_reference_string() {
    assert_eq!(calc("=ADDRESS(2,3)"), Value::Text("$C$2".into()));
    assert_eq!(calc("=ADDRESS(2,3,4)"), Value::Text("C2".into()));
    assert_eq!(calc("=ADDRESS(1,1,1,TRUE,\"My Sheet\")"), Value::Text("'My Sheet'!$A$1".into()));
}

#[test]
fn transpose_and_the_dynamic_array_helpers() {
    let mut engine = price_list();
    type_in(&mut engine, "E1", "=SUM(TRANSPOSE(A1:A4))");
    type_in(&mut engine, "E2", "=SUM(SEQUENCE(4))");
    type_in(&mut engine, "E3", "=COUNT(UNIQUE({1,1,2,3}))");
    type_in(&mut engine, "E4", "=SUM(FILTER(A1:A4,A1:A4>20))");
    assert_eq!(number(&engine, "E1"), 100.0);
    assert_eq!(number(&engine, "E2"), 10.0);
    assert_eq!(number(&engine, "E3"), 3.0);
    assert_eq!(number(&engine, "E4"), 70.0);
}

#[test]
fn formulatext_shows_the_source_of_another_cell() {
    let mut engine = sheet();
    type_in(&mut engine, "A1", "=1+1");
    type_in(&mut engine, "B1", "=FORMULATEXT(A1)");
    type_in(&mut engine, "B2", "=FORMULATEXT(C9)");
    assert_eq!(value(&engine, "B1"), Value::Text("=1+1".into()));
    assert_eq!(value(&engine, "B2"), Value::Error(CellError::NA));
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

#[test]
fn dates_are_serial_numbers() {
    assert_eq!(calc_num("=DATE(2024,1,1)"), 45292.0);
    assert_eq!(calc_num("=YEAR(45292)"), 2024.0);
    assert_eq!(calc_num("=MONTH(45292)"), 1.0);
    assert_eq!(calc_num("=DAY(45292)"), 1.0);
    // Dates subtract to a day count.
    assert_eq!(calc_num("=DATE(2024,3,1)-DATE(2024,2,1)"), 29.0);
}

#[test]
fn the_1900_leap_year_bug_is_reproduced() {
    // Serial 60 is a day that never existed, and every spreadsheet keeps it.
    assert_eq!(calc_num("=DAY(60)"), 29.0);
    assert_eq!(calc_num("=MONTH(60)"), 2.0);
    assert_eq!(calc_num("=DATE(1900,3,1)"), 61.0);
    assert_eq!(calc_num("=DATE(1900,1,1)"), 1.0);
}

#[test]
fn out_of_range_date_parts_roll_over() {
    assert_eq!(calc_num("=DATE(2024,13,1)"), calc_num("=DATE(2025,1,1)"));
    assert_eq!(calc_num("=DATE(2024,3,0)"), calc_num("=DATE(2024,2,29)"));
}

#[test]
fn times_are_fractions_of_a_day() {
    assert_eq!(calc_num("=TIME(12,0,0)"), 0.5);
    assert_eq!(calc_num("=HOUR(0.75)"), 18.0);
    assert_eq!(calc_num("=MINUTE(TIME(1,30,0))"), 30.0);
    // Past midnight, a time wraps.
    assert_eq!(calc_num("=TIME(25,0,0)"), calc_num("=TIME(1,0,0)"));
}

#[test]
fn weekday_numbering_depends_on_the_second_argument() {
    // 2024-01-01 was a Monday.
    assert_eq!(calc_num("=WEEKDAY(DATE(2024,1,1))"), 2.0);
    assert_eq!(calc_num("=WEEKDAY(DATE(2024,1,1),2)"), 1.0);
    assert_eq!(calc_num("=WEEKDAY(DATE(2024,1,1),3)"), 0.0);
}

#[test]
fn month_arithmetic_clamps_to_the_target_month() {
    // One month after 31 January is the end of February, not 3 March.
    assert_eq!(calc_num("=EDATE(DATE(2024,1,31),1)"), calc_num("=DATE(2024,2,29)"));
    assert_eq!(calc_num("=EOMONTH(DATE(2024,2,10),0)"), calc_num("=DATE(2024,2,29)"));
    assert_eq!(calc_num("=EOMONTH(DATE(2023,2,10),0)"), calc_num("=DATE(2023,2,28)"));
}

#[test]
fn datedif_reports_elapsed_units() {
    assert_eq!(calc_num("=DATEDIF(DATE(2020,1,15),DATE(2024,3,10),\"Y\")"), 4.0);
    assert_eq!(calc_num("=DATEDIF(DATE(2020,1,15),DATE(2024,3,10),\"M\")"), 49.0);
    // Whole months past the last whole year.
    assert_eq!(calc_num("=DATEDIF(DATE(2020,1,15),DATE(2024,3,10),\"YM\")"), 1.0);
}

#[test]
fn iso_week_numbers_follow_the_thursday_rule() {
    // 2021-01-01 was a Friday, so it belongs to week 53 of 2020.
    assert_eq!(calc_num("=ISOWEEKNUM(DATE(2021,1,1))"), 53.0);
    assert_eq!(calc_num("=ISOWEEKNUM(DATE(2021,1,4))"), 1.0);
    assert_eq!(calc_num("=ISOWEEKNUM(DATE(2024,1,1))"), 1.0);
}

#[test]
fn working_days_skip_weekends_and_holidays() {
    // 2024-01-01 (Mon) to 2024-01-07 (Sun) is five working days.
    assert_eq!(calc_num("=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))"), 5.0);
    let mut engine = sheet();
    type_in(&mut engine, "A1", "=DATE(2024,1,3)");
    type_in(&mut engine, "B1", "=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7),A1)");
    assert_eq!(number(&engine, "B1"), 4.0);
    // Five working days after Monday is the following Monday.
    assert_eq!(calc_num("=WORKDAY(DATE(2024,1,1),5)"), calc_num("=DATE(2024,1,8)"));
}

#[test]
fn year_fractions_follow_the_requested_basis() {
    // A full year is exactly 1 under the 30/360 basis.
    assert_eq!(calc_num("=YEARFRAC(DATE(2024,1,1),DATE(2025,1,1),0)"), 1.0);
    assert_eq!(calc_num("=YEARFRAC(DATE(2024,1,1),DATE(2024,7,1),0)"), 0.5);
    // 2024 is a leap year, so actual/365 overshoots.
    assert_eq!(calc_num("=YEARFRAC(DATE(2024,1,1),DATE(2025,1,1),3)"), 366.0 / 365.0);
}

#[test]
fn text_dates_and_times_parse() {
    assert_eq!(calc_num("=DATEVALUE(\"2024-01-01\")"), 45292.0);
    assert_eq!(calc_num("=DATEVALUE(\"1/1/2024\")"), 45292.0);
    assert_eq!(calc_num("=TIMEVALUE(\"12:00\")"), 0.5);
    assert_eq!(calc_num("=TIMEVALUE(\"6:00 PM\")"), 0.75);
    assert_eq!(calc("=DATEVALUE(\"not a date\")"), Value::Error(CellError::Value));
}

#[test]
fn the_clock_is_an_input_rather_than_something_the_engine_reads() {
    // Without a clock the engine refuses to invent one, because a workbook that
    // reads the system time cannot be replayed.
    let mut engine = sheet();
    type_in(&mut engine, "A1", "=TODAY()");
    assert_eq!(value(&engine, "A1"), Value::Error(CellError::NA));

    let mut engine = Engine::new().with_now_serial(45292.5);
    engine.add_sheet("Sheet1");
    type_in(&mut engine, "A1", "=TODAY()");
    type_in(&mut engine, "A2", "=NOW()");
    assert_eq!(number(&engine, "A1"), 45292.0);
    assert_eq!(number(&engine, "A2"), 45292.5);
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/// Compares against a reference value to the precision a spreadsheet shows.
fn about(formula: &str, expected: f64) {
    let got = calc_num(formula);
    assert!(
        (got - expected).abs() <= 1e-9 * expected.abs().max(1.0),
        "`{formula}` gave {got}, expected {expected}"
    );
}

#[test]
fn the_normal_distribution() {
    about("=NORM.DIST(0,0,1,TRUE)", 0.5);
    about("=NORM.S.DIST(1.96,TRUE)", 0.9750021048517795);
    about("=NORM.S.INV(0.975)", 1.9599639845400545);
    about("=NORM.INV(0.5,100,15)", 100.0);
    about("=NORM.DIST(0,0,1,FALSE)", 0.3989422804014327);
    // The legacy spellings are the same functions.
    about("=NORMSDIST(1.96)", 0.9750021048517795);
    about("=NORMSINV(0.975)", 1.9599639845400545);
}

#[test]
fn distributions_and_their_inverses_round_trip() {
    for (dist, inv) in [
        ("=CHISQ.DIST(CHISQ.INV(0.3,5),5,TRUE)", 0.3),
        ("=F.DIST(F.INV(0.8,3,7),3,7,TRUE)", 0.8),
        ("=T.DIST(T.INV(0.7,9),9,TRUE)", 0.7),
        ("=GAMMA.DIST(GAMMA.INV(0.45,2,3),2,3,TRUE)", 0.45),
        ("=BETA.DIST(BETA.INV(0.65,2,5),2,5,TRUE)", 0.65),
        ("=LOGNORM.DIST(LOGNORM.INV(0.4,0,1),0,1,TRUE)", 0.4),
    ] {
        let got = calc_num(dist);
        assert!((got - inv).abs() < 1e-7, "`{dist}` gave {got}, expected {inv}");
    }
}

#[test]
fn discrete_distributions() {
    // Ten coin flips, exactly five heads.
    about("=BINOM.DIST(5,10,0.5,FALSE)", 0.24609375);
    about("=BINOM.DIST(5,10,0.5,TRUE)", 0.623046875);
    about("=POISSON.DIST(2,3,FALSE)", 0.22404180765538775);
    about("=POISSON.DIST(2,3,TRUE)", 0.42319008112684353);
    // Exactly C(8,1)*C(12,3)/C(20,4) = 352/969.
    about("=HYPGEOM.DIST(1,4,8,20,FALSE)", 352.0 / 969.0);
    // The smallest count whose cumulative probability reaches 60%.
    about("=BINOM.INV(10,0.5,0.6)", 5.0);
}

#[test]
fn continuous_distributions() {
    about("=EXPON.DIST(1,1,TRUE)", 1.0 - std::f64::consts::E.recip());
    about("=WEIBULL.DIST(1,1,1,TRUE)", 1.0 - std::f64::consts::E.recip());
    about("=CHISQ.DIST.RT(3.84,1)", 0.05004352124870519);
    // 2.262 is just under the two-tailed 5% critical value for 9 degrees of
    // freedom, so the tail is a shade over 0.05. Checked against a
    // high-resolution numerical integration of the t density.
    about("=T.DIST.2T(2.262,9)", 0.05001284550209006);
    about("=GAMMALN(5)", 24.0f64.ln());
    about("=GAMMA(5)", 24.0);
}

#[test]
fn a_two_sample_t_test() {
    let mut engine = sheet();
    for (row, (a, b)) in (1..=5).zip([(1, 2), (2, 4), (3, 5), (4, 4), (5, 7)]) {
        type_in(&mut engine, &format!("A{row}"), &a.to_string());
        type_in(&mut engine, &format!("B{row}"), &b.to_string());
    }
    type_in(&mut engine, "D1", "=T.TEST(A1:A5,B1:B5,2,2)");
    type_in(&mut engine, "D2", "=F.TEST(A1:A5,B1:B5)");
    let p = number(&engine, "D1");
    // Two clearly different samples, but only five points each.
    assert!((0.0..1.0).contains(&p), "p was {p}");
    assert!((0.0..=1.0).contains(&number(&engine, "D2")));
}

#[test]
fn a_chi_square_goodness_of_fit_test() {
    let mut engine = sheet();
    for (row, (o, e)) in (1..=4).zip([(20, 25), (30, 25), (25, 25), (25, 25)]) {
        type_in(&mut engine, &format!("A{row}"), &o.to_string());
        type_in(&mut engine, &format!("B{row}"), &e.to_string());
    }
    type_in(&mut engine, "D1", "=CHISQ.TEST(A1:A4,B1:B4)");
    let p = number(&engine, "D1");
    // The observed counts are close to expectation, so nothing is significant.
    assert!(p > 0.5, "p was {p}");
}

#[test]
fn distributions_reject_impossible_parameters() {
    assert_eq!(calc("=NORM.DIST(1,0,0,TRUE)"), Value::Error(CellError::Num));
    assert_eq!(calc("=NORM.S.INV(1)"), Value::Error(CellError::Num));
    assert_eq!(calc("=BINOM.DIST(11,10,0.5,TRUE)"), Value::Error(CellError::Num));
    assert_eq!(calc("=GAMMALN(0)"), Value::Error(CellError::Num));
    assert_eq!(calc("=CHISQ.DIST(-1,1,TRUE)"), Value::Error(CellError::Num));
}

// ---------------------------------------------------------------------------
// Financial
// ---------------------------------------------------------------------------

#[test]
fn a_loan_payment_is_negative_because_you_pay_it() {
    // A 200,000 loan at 6% a year over 30 years of monthly payments.
    let pmt = calc_num("=PMT(0.06/12,360,200000)");
    assert!((pmt - -1_199.101_050_305_513_8).abs() < 1e-9, "pmt was {pmt}");
    // Interest and principal add back up to the payment.
    let ipmt = calc_num("=IPMT(0.06/12,1,360,200000)");
    let ppmt = calc_num("=PPMT(0.06/12,1,360,200000)");
    assert!((ipmt + ppmt - pmt).abs() < 1e-9);
    // The first month is almost all interest.
    assert!((ipmt - -1000.0).abs() < 1e-9);
}

#[test]
fn the_annuity_functions_invert_each_other() {
    let pv = calc_num("=PV(0.05,10,-1000)");
    let fmt = format!("=PMT(0.05,10,{pv})");
    assert!((calc_num(&fmt) - -1000.0).abs() < 1e-9);
    // 7721.7349 is the present value of ten payments of 1000 at 5%.
    assert!((calc_num("=NPER(0.05,-1000,7721.734929)") - 10.0).abs() < 1e-6);
    assert!((calc_num("=RATE(10,-1000,7721.734929)") - 0.05).abs() < 1e-9);
}

#[test]
fn a_zero_rate_does_not_divide_by_zero() {
    assert_eq!(calc_num("=PMT(0,10,1000)"), -100.0);
    assert_eq!(calc_num("=FV(0,10,-100)"), 1000.0);
    assert_eq!(calc_num("=PV(0,10,-100)"), 1000.0);
}

#[test]
fn net_present_value_and_internal_rate_of_return() {
    let mut engine = sheet();
    for (row, v) in (1..=5).zip([-1000, 300, 400, 400, 300]) {
        type_in(&mut engine, &format!("A{row}"), &v.to_string());
    }
    type_in(&mut engine, "C1", "=IRR(A1:A5)");
    let irr = number(&engine, "C1");
    // The rate that makes the discounted flows sum to zero.
    type_in(&mut engine, "C2", &format!("=A1+NPV({irr},A2:A5)"));
    assert!(number(&engine, "C2").abs() < 1e-9, "NPV at the IRR was not zero");
    assert!((0.1..0.2).contains(&irr), "irr was {irr}");
}

#[test]
fn dated_cash_flows_use_actual_days() {
    let mut engine = sheet();
    let rows = [(-10000, "=DATE(2024,1,1)"), (6000, "=DATE(2024,7,1)"), (6000, "=DATE(2025,1,1)")];
    for (i, (amount, date)) in rows.iter().enumerate() {
        let row = i + 1;
        type_in(&mut engine, &format!("A{row}"), &amount.to_string());
        type_in(&mut engine, &format!("B{row}"), date);
    }
    type_in(&mut engine, "D1", "=XIRR(A1:A3,B1:B3)");
    let rate = number(&engine, "D1");
    type_in(&mut engine, "D2", &format!("=XNPV({rate},A1:A3,B1:B3)"));
    assert!(number(&engine, "D2").abs() < 1e-6, "XNPV at the XIRR was not zero");
}

#[test]
fn depreciation_methods() {
    assert_eq!(calc_num("=SLN(10000,1000,5)"), 1800.0);
    assert_eq!(calc_num("=SYD(10000,1000,5,1)"), 3000.0);
    assert_eq!(calc_num("=SYD(10000,1000,5,5)"), 600.0);
    // Double declining takes 2/5 of the book value in the first year.
    assert_eq!(calc_num("=DDB(10000,1000,5,1)"), 4000.0);
    assert_eq!(calc_num("=DDB(10000,1000,5,2)"), 2400.0);
    // The whole life sums to the depreciable amount.
    let total: f64 = (1..=5).map(|p| calc_num(&format!("=SYD(10000,1000,5,{p})"))).sum();
    assert!((total - 9000.0).abs() < 1e-9);
}

#[test]
fn effective_and_nominal_rates_are_inverses() {
    let effective = calc_num("=EFFECT(0.06,12)");
    assert!((effective - 0.061_677_811_863_589_28).abs() < 1e-12);
    assert!((calc_num(&format!("=NOMINAL({effective},12)")) - 0.06).abs() < 1e-12);
}

// ---------------------------------------------------------------------------
// Engineering
// ---------------------------------------------------------------------------

#[test]
fn number_bases_round_trip() {
    assert_eq!(calc("=DEC2BIN(9)"), Value::Text("1001".into()));
    assert_eq!(calc("=DEC2BIN(9,8)"), Value::Text("00001001".into()));
    assert_eq!(calc_num("=BIN2DEC(\"1001\")"), 9.0);
    // Negative numbers use ten-digit two's complement.
    assert_eq!(calc("=DEC2BIN(-1)"), Value::Text("1111111111".into()));
    assert_eq!(calc_num("=BIN2DEC(\"1111111111\")"), -1.0);
    assert_eq!(calc("=DEC2HEX(255)"), Value::Text("FF".into()));
    assert_eq!(calc_num("=HEX2DEC(\"FFFFFFFFFF\")"), -1.0);
    assert_eq!(calc("=BIN2HEX(\"11111111\")"), Value::Text("FF".into()));
    assert_eq!(calc("=DEC2BIN(512)"), Value::Error(CellError::Num));
}

#[test]
fn bitwise_operations() {
    assert_eq!(calc_num("=BITAND(12,10)"), 8.0);
    assert_eq!(calc_num("=BITOR(12,10)"), 14.0);
    assert_eq!(calc_num("=BITXOR(12,10)"), 6.0);
    assert_eq!(calc_num("=BITLSHIFT(1,4)"), 16.0);
    assert_eq!(calc_num("=BITRSHIFT(16,4)"), 1.0);
    assert_eq!(calc("=BITAND(-1,1)"), Value::Error(CellError::Num));
}

#[test]
fn complex_arithmetic_through_the_text_form() {
    assert_eq!(calc("=COMPLEX(3,4)"), Value::Text("3+4i".into()));
    assert_eq!(calc_num("=IMABS(\"3+4i\")"), 5.0);
    assert_eq!(calc_num("=IMREAL(\"3+4i\")"), 3.0);
    assert_eq!(calc_num("=IMAGINARY(\"3+4i\")"), 4.0);
    assert_eq!(calc("=IMSUM(\"3+4i\",\"1+2i\")"), Value::Text("4+6i".into()));
    assert_eq!(calc("=IMPRODUCT(\"3+4i\",\"1+2i\")"), Value::Text("-5+10i".into()));
    assert_eq!(calc("=IMCONJUGATE(\"3+4i\")"), Value::Text("3-4i".into()));
    // i squared is -1.
    assert_eq!(calc_num("=IMREAL(IMPOWER(\"i\",2))"), -1.0);
}

#[test]
fn unit_conversion_refuses_to_mix_quantities() {
    assert_eq!(calc_num("=CONVERT(1,\"km\",\"m\")"), 1000.0);
    assert_eq!(calc_num("=CONVERT(1,\"kg\",\"g\")"), 1000.0);
    assert_eq!(calc_num("=CONVERT(1,\"hr\",\"min\")"), 60.0);
    assert!((calc_num("=CONVERT(1,\"mi\",\"km\")") - 1.609344).abs() < 1e-12);
    // Length is not time.
    assert_eq!(calc("=CONVERT(1,\"m\",\"sec\")"), Value::Error(CellError::NA));
}

#[test]
fn error_and_step_functions() {
    assert!((calc_num("=ERF(1)") - 0.842_700_792_949_715).abs() < 1e-12);
    assert!((calc_num("=ERFC(1)") - 0.157_299_207_050_285).abs() < 1e-12);
    assert_eq!(calc_num("=DELTA(5,5)"), 1.0);
    assert_eq!(calc_num("=DELTA(5,4)"), 0.0);
    assert_eq!(calc_num("=GESTEP(5,4)"), 1.0);
}

// ---------------------------------------------------------------------------
// Database functions
// ---------------------------------------------------------------------------

/// A table in A1:C6 with headers, and a criteria range in E1:F2.
fn employee_table() -> Engine {
    let mut engine = sheet();
    let rows = [
        ("Name", "Dept", "Salary"),
        ("Ann", "Eng", "100"),
        ("Bob", "Sales", "80"),
        ("Cal", "Eng", "120"),
        ("Dee", "Sales", "90"),
        ("Eve", "Eng", "110"),
    ];
    for (i, (name, dept, salary)) in rows.iter().enumerate() {
        let row = i + 1;
        type_in(&mut engine, &format!("A{row}"), name);
        type_in(&mut engine, &format!("B{row}"), dept);
        type_in(&mut engine, &format!("C{row}"), salary);
    }
    // Criteria: Dept = Eng.
    type_in(&mut engine, "E1", "Dept");
    type_in(&mut engine, "E2", "Eng");
    engine
}

#[test]
fn database_functions_aggregate_matching_records() {
    let mut engine = employee_table();
    type_in(&mut engine, "H1", "=DSUM(A1:C6,\"Salary\",E1:E2)");
    type_in(&mut engine, "H2", "=DAVERAGE(A1:C6,\"Salary\",E1:E2)");
    type_in(&mut engine, "H3", "=DCOUNT(A1:C6,\"Salary\",E1:E2)");
    type_in(&mut engine, "H4", "=DMAX(A1:C6,3,E1:E2)");
    assert_eq!(number(&engine, "H1"), 330.0);
    assert_eq!(number(&engine, "H2"), 110.0);
    assert_eq!(number(&engine, "H3"), 3.0);
    // The field can be given by position as well as by name.
    assert_eq!(number(&engine, "H4"), 120.0);
}

#[test]
fn criteria_columns_are_combined_with_and() {
    let mut engine = employee_table();
    type_in(&mut engine, "F1", "Salary");
    type_in(&mut engine, "F2", ">105");
    type_in(&mut engine, "H1", "=DSUM(A1:C6,\"Salary\",E1:F2)");
    assert_eq!(number(&engine, "H1"), 230.0);
}

#[test]
fn criteria_rows_are_alternatives() {
    let mut engine = employee_table();
    // Dept = Eng on one row, Dept = Sales on the next.
    type_in(&mut engine, "E3", "Sales");
    type_in(&mut engine, "H1", "=DCOUNT(A1:C6,\"Salary\",E1:E3)");
    assert_eq!(number(&engine, "H1"), 5.0);
}

#[test]
fn dget_insists_on_exactly_one_record() {
    let mut engine = employee_table();
    type_in(&mut engine, "F1", "Name");
    type_in(&mut engine, "F2", "Cal");
    type_in(&mut engine, "H1", "=DGET(A1:C6,\"Salary\",E1:F2)");
    assert_eq!(number(&engine, "H1"), 120.0);

    // Three engineers match, which is not one record.
    type_in(&mut engine, "H2", "=DGET(A1:C6,\"Salary\",E1:E2)");
    assert_eq!(value(&engine, "H2"), Value::Error(CellError::Num));
}

#[test]
fn a_criteria_header_naming_no_field_is_an_error() {
    let mut engine = employee_table();
    type_in(&mut engine, "E1", "Nonexistent");
    type_in(&mut engine, "H1", "=DSUM(A1:C6,\"Salary\",E1:E2)");
    assert_eq!(value(&engine, "H1"), Value::Error(CellError::Value));
}

// ---------------------------------------------------------------------------
// Shape statistics
// ---------------------------------------------------------------------------

/// SKEW, SKEW.P and KURT, against Excel's answers.
///
/// The three shared their mean-and-deviation preamble until it was factored
/// out, and nothing here covered them at the time — so the factoring was
/// unverified. These are the values Excel gives for the same arguments.
#[test]
fn shape_statistics_match_excel() {
    // 3, 4, 5, 2, 3, 4, 5, 6, 4, 7
    let data = "{3,4,5,2,3,4,5,6,4,7}";
    assert!((calc_num(&format!("=SKEW({data})")) - 0.359543071).abs() < 1e-6);
    assert!((calc_num(&format!("=SKEW.P({data})")) - 0.303193339).abs() < 1e-6);
    assert!((calc_num(&format!("=KURT({data})")) - -0.151799637).abs() < 1e-6);
}

/// A list with no spread has no shape to describe.
///
/// Every value equals the mean, so the standard deviation is zero and the
/// standardised moments would divide by it. Excel answers `#DIV/0!`, and the
/// guard that produces that is the one most easily dropped in a rewrite.
#[test]
fn shape_statistics_refuse_a_list_with_no_spread() {
    assert_eq!(calc("=SKEW({5,5,5,5})"), Value::Error(CellError::Div0));
    assert_eq!(calc("=SKEW.P({5,5,5,5})"), Value::Error(CellError::Div0));
    assert_eq!(calc("=KURT({5,5,5,5})"), Value::Error(CellError::Div0));
}

/// Too few values for the statistic to be defined.
#[test]
fn shape_statistics_need_enough_values() {
    // SKEW divides by (n-1)(n-2), so it needs three; KURT needs four.
    assert_eq!(calc("=SKEW({1,2})"), Value::Error(CellError::Div0));
    assert_eq!(calc("=KURT({1,2,3})"), Value::Error(CellError::Div0));
    // SKEW.P needs only one value, but one value has no spread, so it lands on
    // the same refusal by the other route.
    assert_eq!(calc("=SKEW.P({5})"), Value::Error(CellError::Div0));
}
