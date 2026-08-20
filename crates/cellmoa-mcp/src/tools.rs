//! The tools this server exposes, and how they map onto the engine.
//!
//! Each tool is a thin shell over one command of the session API. The point of
//! going through that API rather than the engine directly is the revision
//! guard: an agent editing a workbook a person also has open is exactly the
//! situation the guard exists for, and it only works if the agent comes in
//! through the same door.

use cellmoa_api::protocol::Request;
use cellmoa_api::Session;
use serde_json::{json, Value};

/// One tool, as `tools/list` describes it.
pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    /// The JSON Schema of the tool's arguments.
    pub schema: fn() -> Value,
}

/// A cell reference argument, described once.
fn cell_property(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub const TOOLS: &[Tool] = &[
    Tool {
        name: "read_cells",
        description: "Read a rectangle of cells from a sheet. Returns only the cells that hold \
                      something, each with its displayed text, typed value and formula.",
        schema: || {
            json!({
                "type": "object",
                "properties": {
                    "range": cell_property("An A1 range such as `A1:D20`, optionally sheet-qualified. Omit for the whole used area."),
                    "sheet": cell_property("The sheet to read. Defaults to the first one."),
                },
            })
        },
    },
    Tool {
        name: "write_cells",
        description: "Write cells. Each input is typed as a user would type it: a leading `=` \
                      makes a formula, an empty string clears the cell. Pass the revision you \
                      last saw to be refused rather than overwrite someone else's edit.",
        schema: || {
            json!({
                "type": "object",
                "required": ["cells"],
                "properties": {
                    "cells": {
                        "type": "array",
                        "description": "The cells to write.",
                        "items": {
                            "type": "object",
                            "required": ["cell", "input"],
                            "properties": {
                                "cell": cell_property("The target cell, e.g. `B2` or `Sheet2!B2`."),
                                "input": cell_property("What to type, e.g. `42`, `hello` or `=SUM(A1:A9)`."),
                            },
                        },
                    },
                    "sheet": cell_property("The sheet unqualified references belong to."),
                    "revision": { "type": "integer", "description": "The revision this edit was computed against." },
                    "label": cell_property("A short description of the change, kept in the audit trail."),
                },
            })
        },
    },
    Tool {
        name: "evaluate",
        description: "Evaluate a formula against the open workbook without storing it anywhere. \
                      Use this to check what a formula would produce before writing it.",
        schema: || {
            json!({
                "type": "object",
                "required": ["formula"],
                "properties": {
                    "formula": cell_property("The formula, with or without a leading `=`."),
                    "sheet": cell_property("The sheet its references belong to."),
                },
            })
        },
    },
    Tool {
        name: "list_sheets",
        description: "List the sheets in the open workbook with their sizes.",
        schema: || json!({ "type": "object", "properties": {} }),
    },
    Tool {
        name: "add_sheet",
        description: "Add a sheet to the open workbook.",
        schema: || {
            json!({
                "type": "object",
                "required": ["name"],
                "properties": { "name": cell_property("The name of the new sheet.") },
            })
        },
    },
    Tool {
        name: "open_workbook",
        description: "Open an .xlsx file, replacing whatever workbook is open.",
        schema: || {
            json!({
                "type": "object",
                "required": ["path"],
                "properties": { "path": cell_property("The path to the file.") },
            })
        },
    },
    Tool {
        name: "save_workbook",
        description: "Save the open workbook. Formatting the engine does not model is preserved.",
        schema: || {
            json!({
                "type": "object",
                "properties": { "path": cell_property("Where to save. Defaults to where it was opened from.") },
            })
        },
    },
    Tool {
        name: "undo",
        description: "Undo the most recent change. Pass `only_mine` to undo only what this agent \
                      did, leaving the user's edits in place.",
        schema: || {
            json!({
                "type": "object",
                "properties": {
                    "only_mine": { "type": "boolean", "description": "Undo only this agent's changes." },
                },
            })
        },
    },
    Tool {
        name: "redo",
        description: "Re-apply the most recently undone change.",
        schema: || {
            json!({
                "type": "object",
                "properties": {
                    "only_mine": { "type": "boolean", "description": "Redo only this agent's changes." },
                },
            })
        },
    },
    Tool {
        name: "cell_history",
        description: "Who changed a cell, when, and with what description.",
        schema: || {
            json!({
                "type": "object",
                "required": ["cell"],
                "properties": { "cell": cell_property("The cell, e.g. `B2` or `Sheet2!B2`.") },
            })
        },
    },
    Tool {
        name: "verify",
        description: "Check the workbook against expectations. Each expectation names a cell or \
                      range and what it should hold: `equals`, `approx` with a `tolerance`, \
                      `error`, `no_error`, `formula`, `sum` or `count`.",
        schema: || {
            json!({
                "type": "object",
                "required": ["expect"],
                "properties": {
                    "expect": { "type": "array", "items": { "type": "object" },
                                "description": "The expectations to check." },
                    "sheet": cell_property("The sheet unqualified references belong to."),
                },
            })
        },
    },
    Tool {
        name: "fingerprint",
        description: "The workbook's content fingerprints: `inputs` for what was entered, \
                      `values` for what the sheets show, and `workbook` for both.",
        schema: || json!({ "type": "object", "properties": {} }),
    },
];

/// Turns a tool call into a session request.
///
/// `agent` names the caller, so its edits can be told from the user's and rolled
/// back on their own.
pub fn to_request(name: &str, arguments: &Value, agent: &str) -> Result<Request, String> {
    let who = json!({ "kind": "agent", "id": agent });
    let mut body = match name {
        "read_cells" => json!({ "op": "read" }),
        "write_cells" => json!({ "op": "write", "who": who }),
        "evaluate" => json!({ "op": "eval" }),
        "list_sheets" => json!({ "op": "sheets" }),
        "add_sheet" => json!({ "op": "add_sheet", "who": who }),
        "open_workbook" => json!({ "op": "open" }),
        "save_workbook" => json!({ "op": "save" }),
        "undo" => json!({ "op": "undo", "who": who }),
        "redo" => json!({ "op": "redo", "who": who }),
        "cell_history" => json!({ "op": "history" }),
        "verify" => json!({ "op": "verify" }),
        "fingerprint" => json!({ "op": "fingerprint" }),
        other => return Err(format!("unknown tool `{other}`")),
    };

    let object = body.as_object_mut().expect("built as an object above");
    match name {
        // `only_mine` is the agent's own id, which is what makes an
        // agent-scoped undo possible.
        "undo" | "redo" => {
            if arguments.get("only_mine").and_then(Value::as_bool).unwrap_or(false) {
                object.insert("only_by".into(), json!(agent));
            }
        }
        // The verify tool takes the specification inline rather than nested.
        "verify" => {
            object.insert("spec".into(), arguments.clone());
        }
        _ => {
            if let Some(given) = arguments.as_object() {
                for (key, value) in given {
                    object.insert(key.clone(), value.clone());
                }
            }
        }
    }

    serde_json::from_value(body).map_err(|e| format!("bad arguments for `{name}`: {e}"))
}

/// Calls a tool and returns the session's answer.
pub fn call(session: &mut Session, name: &str, arguments: &Value, agent: &str) -> Value {
    match to_request(name, arguments, agent) {
        Ok(request) => serde_json::to_value(session.dispatch(request)).unwrap_or_else(
            |e| json!({ "ok": false, "code": "internal", "message": e.to_string() }),
        ),
        Err(message) => json!({ "ok": false, "code": "bad_arguments", "message": message }),
    }
}
