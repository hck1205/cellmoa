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
