//! Tests of the command surface.
//!
//! These go through the JSON boundary rather than calling the engine directly,
//! because that boundary is what the grid, the MCP server and the desktop shell
//! all see — and a mistake in it is a mistake in all three.

use cellmoa_api::Session;
use serde_json::{json, Value};

fn send(session: &mut Session, request: Value) -> Value {
    let text = session.dispatch_json(&request.to_string());
    serde_json::from_str(&text).expect("the response should be JSON")
}

fn ok(session: &mut Session, request: Value) -> Value {
    let response = send(session, request.clone());
    assert_eq!(response["ok"], json!(true), "request {request} failed: {response}");
    response
}

#[test]
fn a_new_session_starts_with_one_empty_sheet() {
    let mut session = Session::new();
    let response = ok(&mut session, json!({ "op": "sheets" }));
    assert_eq!(response["sheets"][0]["name"], json!("Sheet1"));
    assert_eq!(response["sheets"][0]["cells"], json!(0));
    assert_eq!(response["revision"], json!(0));
}

#[test]
fn writing_and_reading_cells() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [
            { "cell": "A1", "input": "10" },
            { "cell": "B1", "input": "=A1*2" },
            { "cell": "C1", "input": "hello" }
        ]}),
    );
    let response = ok(&mut session, json!({ "op": "read", "range": "A1:C1" }));
    let cells = response["cells"].as_array().unwrap();
    assert_eq!(cells.len(), 3);
    assert_eq!(cells[1]["cell"], json!("B1"));
    assert_eq!(cells[1]["text"], json!("20"));
    assert_eq!(cells[1]["value"], json!(20.0));
    assert_eq!(cells[1]["formula"], json!("=A1*2"));
    // A literal has no formula field at all.
    assert!(cells[0]["formula"].is_null());
}

#[test]
fn reading_an_empty_area_returns_nothing_rather_than_a_grid_of_nulls() {
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "1" }] }));
    // A thousand cells asked for, one cell returned.
    let response = ok(&mut session, json!({ "op": "read", "range": "A1:Z40" }));
    assert_eq!(response["cells"].as_array().unwrap().len(), 1);
}

#[test]
fn every_response_carries_the_revision_to_guard_the_next_write() {
    let mut session = Session::new();
    let before = ok(&mut session, json!({ "op": "sheets" }))["revision"].as_u64().unwrap();
    let after =
        ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "1" }] }))
            ["revision"]
            .as_u64()
            .unwrap();
    assert_eq!(after, before + 1);
}

#[test]
fn a_stale_write_is_refused_and_says_what_the_revision_is_now() {
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "1" }] }));
    let seen = session.revision();

    // Someone else edits in the meantime.
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "2" }] }));

    let response = send(
        &mut session,
        json!({ "op": "write", "revision": seen, "who": { "kind": "agent", "id": "a1" },
                "cells": [{ "cell": "A1", "input": "999" }] }),
    );
    assert_eq!(response["ok"], json!(false));
    assert_eq!(response["code"], json!("revision_conflict"));
    assert_eq!(response["revision"], json!(session.revision()));

    // The refused write left nothing behind.
    let read = ok(&mut session, json!({ "op": "read", "range": "A1" }));
    assert_eq!(read["cells"][0]["text"], json!("2"));

    // Rebased against the current revision, the same write goes through.
    let current = session.revision();
    ok(
        &mut session,
        json!({ "op": "write", "revision": current,
                "who": { "kind": "agent", "id": "a1" },
                "cells": [{ "cell": "A1", "input": "999" }] }),
    );
}

#[test]
fn an_agents_edits_can_be_undone_without_disturbing_the_users() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "who": { "kind": "human", "id": "u1" },
                "cells": [{ "cell": "A1", "input": "1" }] }),
    );
    ok(
        &mut session,
        json!({ "op": "write", "who": { "kind": "agent", "id": "agent-7" },
                "cells": [{ "cell": "A1", "input": "999" }], "label": "forecast" }),
    );
    ok(
        &mut session,
        json!({ "op": "write", "who": { "kind": "human", "id": "u1" },
                "cells": [{ "cell": "B1", "input": "=A1*2" }] }),
    );

    ok(&mut session, json!({ "op": "undo", "only_by": "agent-7" }));

    let read = ok(&mut session, json!({ "op": "read", "range": "A1:B1" }));
    let cells = read["cells"].as_array().unwrap();
    assert_eq!(cells[0]["text"], json!("1"), "the agent's change should be gone");
    // The user's formula survived, and its value was brought back in step.
    assert_eq!(cells[1]["text"], json!("2"));
}

#[test]
fn the_history_of_a_cell_names_who_changed_it_and_why() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "who": { "kind": "human", "id": "u1" },
                "cells": [{ "cell": "A1", "input": "1" }], "label": "opening balance" }),
    );
    ok(
        &mut session,
        json!({ "op": "write", "who": { "kind": "agent", "id": "a1" },
                "cells": [{ "cell": "A1", "input": "2" }], "label": "revised forecast" }),
    );

    let response = ok(&mut session, json!({ "op": "history", "cell": "A1" }));
    let history = response["history"].as_array().unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0]["actor"]["id"], json!("u1"));
    assert_eq!(history[0]["label"], json!("opening balance"));
    assert_eq!(history[1]["actor"]["kind"], json!("agent"));
    assert_eq!(history[1]["label"], json!("revised forecast"));
}

#[test]
fn evaluating_a_formula_does_not_change_the_workbook() {
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "10" }] }));
    let before = session.revision();

    let response = ok(&mut session, json!({ "op": "eval", "formula": "=A1*4+ROUND(2.675,2)" }));
    assert_eq!(response["value"], json!(42.68));
    assert_eq!(session.revision(), before, "eval must not count as an edit");
}

#[test]
fn inserting_a_row_moves_the_cells_and_the_formulas_that_point_at_them() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [
            { "cell": "A1", "input": "1" },
            { "cell": "A2", "input": "2" },
            { "cell": "C1", "input": "=SUM(A1:A2)" }
        ] }),
    );
    ok(&mut session, json!({ "op": "alter", "action": "insert_row", "index": 1 }));

    let read = ok(&mut session, json!({ "op": "read", "range": "A1:C3" }));
    let cells = read["cells"].as_array().unwrap();
    let find = |a1: &str| cells.iter().find(|c| c["cell"] == a1).cloned().unwrap_or_default();
    assert_eq!(find("A3")["text"], json!("2"));
    // The sum grew to cover the row inserted inside it.
    assert_eq!(find("C1")["formula"], json!("=SUM(A1:A3)"));
    assert_eq!(find("C1")["text"], json!("3"));
}

#[test]
fn deleting_a_row_leaves_ref_errors_behind_rather_than_wrong_numbers() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [
            { "cell": "A2", "input": "5" },
            { "cell": "C1", "input": "=A2" }
        ] }),
    );
    ok(&mut session, json!({ "op": "alter", "action": "remove_row", "index": 1 }));
    let read = ok(&mut session, json!({ "op": "read", "range": "C1" }));
    assert_eq!(read["cells"][0]["error"], json!("#REF!"));
}

#[test]
fn an_unknown_alteration_is_refused_by_name() {
    let mut session = Session::new();
    let response = session
        .dispatch_json(&json!({ "op": "alter", "action": "sideways", "index": 0 }).to_string());
    assert!(response.contains("bad_action"), "{response}");
}

#[test]
fn a_cells_history_says_who_set_it_to_what() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [{ "cell": "A1", "input": "1" }],
                             "who": { "kind": "human", "id": "ada" } }),
    );
    ok(
        &mut session,
        json!({ "op": "write", "cells": [{ "cell": "A1", "input": "=2*2" }],
                             "who": { "kind": "agent", "id": "bot" }, "label": "recalculated" }),
    );

    let history = ok(&mut session, json!({ "op": "history", "cell": "A1" }));
    let entries = history["history"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["actor"]["id"], json!("ada"));
    assert_eq!(entries[0]["input"], json!("1"));
    assert_eq!(entries[1]["actor"]["kind"], json!("agent"));
    assert_eq!(entries[1]["input"], json!("=2*2"));
    assert_eq!(entries[1]["label"], json!("recalculated"));
}

#[test]
fn a_snapshot_says_what_changed_since_it_was_taken() {
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "1" }] }));
    ok(&mut session, json!({ "op": "snapshot", "name": "before the agent" }));

    ok(
        &mut session,
        json!({ "op": "write", "cells": [
            { "cell": "A1", "input": "2" },
            { "cell": "B1", "input": "new" }
        ], "who": { "kind": "agent", "id": "bot" } }),
    );

    let diff = ok(&mut session, json!({ "op": "diff", "against": "before the agent" }));
    assert_eq!(diff["summary"]["cells"], json!(2));
    let changes = diff["changes"].as_array().unwrap();
    let changed = changes.iter().find(|c| c["cell"] == "A1").unwrap();
    assert_eq!(changed["before"]["value"], json!("1"));
    assert_eq!(changed["after"]["value"], json!("2"));

    assert_eq!(
        ok(&mut session, json!({ "op": "snapshots" }))["snapshots"],
        json!(["before the agent"])
    );
}

#[test]
fn diffing_against_a_snapshot_that_was_never_taken_says_so() {
    let mut session = Session::new();
    let response = session.dispatch_json(&json!({ "op": "diff", "against": "nope" }).to_string());
    assert!(response.contains("no_such_snapshot"), "{response}");
}

#[test]
fn undo_state_counts_what_each_actor_can_take_back() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [{ "cell": "A1", "input": "1" }],
                             "who": { "kind": "human", "id": "ada" } }),
    );
    ok(
        &mut session,
        json!({ "op": "write", "cells": [{ "cell": "A2", "input": "2" }],
                             "who": { "kind": "agent", "id": "bot" } }),
    );

    let state = ok(&mut session, json!({ "op": "undo_state" }));
    assert_eq!(state["canUndo"], json!(true));
    assert_eq!(state["canRedo"], json!(false));
    assert_eq!(state["undoCount"], json!(2));
    assert_eq!(state["nextUndo"]["actor"]["id"], json!("bot"));
    assert_eq!(
        state["undoByActor"],
        json!([{ "actor": "ada", "count": 1 }, { "actor": "bot", "count": 1 }])
    );

    // Taking back only the agent's work leaves the person's alone.
    ok(&mut session, json!({ "op": "undo", "only_by": "bot" }));
    let after = ok(&mut session, json!({ "op": "undo_state" }));
    assert_eq!(after["undoByActor"], json!([{ "actor": "ada", "count": 1 }]));
    assert_eq!(after["redoByActor"], json!([{ "actor": "bot", "count": 1 }]));
    assert_eq!(after["nextRedo"]["actor"]["kind"], json!("agent"));
}

#[test]
fn translating_a_formula_moves_its_relative_references() {
    let mut session = Session::new();
    let response =
        ok(&mut session, json!({ "op": "translate", "formula": "=A1+$B$2", "rows": 2, "cols": 1 }));
    assert_eq!(response["formula"], json!("=B3+$B$2"));
}

#[test]
fn translating_something_that_is_not_a_formula_leaves_it_alone() {
    let mut session = Session::new();
    // Filling a column of text must not go through the parser at all.
    let response = ok(&mut session, json!({ "op": "translate", "formula": "A1", "rows": 5 }));
    assert_eq!(response["formula"], json!("A1"));
    // Nor may an unparseable formula be dropped on the floor.
    let broken = ok(&mut session, json!({ "op": "translate", "formula": "=SUM(", "rows": 1 }));
    assert_eq!(broken["formula"], json!("=SUM("));
}

#[test]
fn errors_are_reported_in_a_field_of_their_own() {
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "=1/0" }] }));
    let read = ok(&mut session, json!({ "op": "read", "range": "A1" }));
    assert_eq!(read["cells"][0]["error"], json!("#DIV/0!"));
    assert_eq!(read["cells"][0]["text"], json!("#DIV/0!"));
}

#[test]
fn a_sheet_added_during_editing_is_recorded_and_can_be_undone() {
    // Unlike the document's first sheet, one added later is an edit.
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "add_sheet", "name": "Extra" }));
    assert_eq!(ok(&mut session, json!({ "op": "sheets" }))["sheets"].as_array().unwrap().len(), 2);
    ok(&mut session, json!({ "op": "undo" }));
    assert_eq!(ok(&mut session, json!({ "op": "sheets" }))["sheets"].as_array().unwrap().len(), 1);
}

#[test]
fn several_sheets() {
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "add_sheet", "name": "Q1 Sales" }));
    ok(
        &mut session,
        json!({ "op": "write", "cells": [{ "cell": "'Q1 Sales'!A1", "input": "99" }] }),
    );
    ok(
        &mut session,
        json!({ "op": "write", "cells": [{ "cell": "A1", "input": "='Q1 Sales'!A1+1" }] }),
    );
    let read = ok(&mut session, json!({ "op": "read", "sheet": "Sheet1", "range": "A1" }));
    assert_eq!(read["cells"][0]["text"], json!("100"));

    // A duplicate name is refused rather than silently accepted.
    let response = send(&mut session, json!({ "op": "add_sheet", "name": "Q1 Sales" }));
    assert_eq!(response["code"], json!("duplicate_sheet"));
}

#[test]
fn fingerprint_and_verify_are_reachable_from_the_same_surface() {
    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [
        { "cell": "A1", "input": "10" }, { "cell": "B1", "input": "=A1*2" }]}),
    );

    let digests = ok(&mut session, json!({ "op": "fingerprint" }));
    assert_eq!(digests["fingerprint"]["workbook"].as_str().unwrap().len(), 64);

    let report = ok(
        &mut session,
        json!({ "op": "verify", "spec": { "expect": [{ "cell": "B1", "equals": 20 }] } }),
    );
    assert_eq!(report["passed"], json!(true));

    let report = ok(
        &mut session,
        json!({ "op": "verify", "spec": { "expect": [{ "cell": "B1", "equals": 21 }] } }),
    );
    // A failed check is a successful request with a failing report, not an
    // error: the caller asked a question and got an answer.
    assert_eq!(report["passed"], json!(false));
}

#[test]
fn the_journal_comes_back_ready_to_replay() {
    use cellmoa_core::edit::Journal;
    let mut session = Session::new();
    ok(&mut session, json!({ "op": "write", "cells": [{ "cell": "A1", "input": "7" }] }));
    let response = ok(&mut session, json!({ "op": "journal" }));

    let journal: Journal = serde_json::from_value(response["journal"].clone()).expect("a journal");
    // The journal replays onto the document's starting point — a blank
    // workbook with one sheet — not onto nothing.
    let mut base = cellmoa_core::model::Workbook::new();
    base.add_sheet("Sheet1");
    let replayed = journal.replay_onto(base).expect("the base should match");
    assert_eq!(
        replayed.value(cellmoa_core::model::CellAddr::new(0, 0, 0)),
        cellmoa_core::value::Value::Number(7.0)
    );
}

#[test]
fn opening_and_saving_a_file() {
    let directory = std::env::temp_dir().join(format!("cellmoa-api-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("book.xlsx");
    let path = path.to_str().unwrap();

    let mut session = Session::new();
    ok(
        &mut session,
        json!({ "op": "write", "cells": [
        { "cell": "A1", "input": "10" }, { "cell": "B1", "input": "=A1*2" }]}),
    );
    ok(&mut session, json!({ "op": "save", "path": path }));

    let mut reopened = Session::new();
    ok(&mut reopened, json!({ "op": "open", "path": path }));
    let read = ok(&mut reopened, json!({ "op": "read", "range": "B1" }));
    assert_eq!(read["cells"][0]["formula"], json!("=A1*2"));
    assert_eq!(read["cells"][0]["text"], json!("20"));

    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn malformed_input_is_answered_rather_than_panicked_on() {
    let mut session = Session::new();
    for request in [
        "not json at all",
        r#"{"op":"nonsense"}"#,
        r#"{"op":"read","range":"not a range"}"#,
        r#"{"op":"write","cells":[{"cell":"not a cell","input":"1"}]}"#,
        r#"{"op":"read","sheet":"Nope"}"#,
        r#"{"op":"eval","formula":"SUM("}"#,
    ] {
        let response: Value = serde_json::from_str(&session.dispatch_json(request))
            .expect("even a rejection should be JSON");
        assert_eq!(response["ok"], json!(false), "{request} should have been refused");
        assert!(response["code"].is_string(), "{request} needs a machine-readable code");
    }
}

#[test]
fn nothing_to_undo_is_a_named_condition_not_a_crash() {
    let mut session = Session::new();
    let response = send(&mut session, json!({ "op": "undo" }));
    assert_eq!(response["code"], json!("nothing_to_undo"));
}
