//! The request and response types.
//!
//! One command surface serves the web grid, the MCP server and the desktop
//! shell. That is deliberate: an agent editing a workbook and a person typing
//! into it must go through the same door, or the revision guard that keeps them
//! from overwriting each other only protects one of them.

use cellmoa_core::edit::ActorKind;
use cellmoa_engine::verify::Spec;
use serde::{Deserialize, Serialize};

/// Who is making a request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Who {
    /// `human`, `agent`, `script` or `system`.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// A stable identifier: a user id, an agent session id, a script name.
    #[serde(default = "default_id")]
    pub id: String,
}

fn one() -> u32 {
    1
}

fn default_kind() -> String {
    "human".to_string()
}

fn default_id() -> String {
    "anonymous".to_string()
}

impl Default for Who {
    fn default() -> Self {
        Who { kind: default_kind(), id: default_id() }
    }
}

impl Who {
    pub fn actor(&self) -> cellmoa_core::edit::Actor {
        let kind = match self.kind.to_ascii_lowercase().as_str() {
            "agent" => ActorKind::Agent,
            "script" => ActorKind::Script,
            "system" => ActorKind::System,
            _ => ActorKind::Human,
        };
        cellmoa_core::edit::Actor { kind, id: self.id.clone() }
    }
}

/// One cell to write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Write {
    /// The target, optionally sheet-qualified: `Sheet1!B2` or `B2`.
    pub cell: String,
    /// What to type into it. A leading `=` makes a formula; an empty string
    /// clears the cell.
    pub input: String,
}

/// A command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    /// Start a new, empty workbook.
    New {
        #[serde(default)]
        sheet: Option<String>,
    },
    /// Open a workbook from disk.
    Open { path: String },
    /// Save the workbook, to its own path or another one.
    Save {
        #[serde(default)]
        path: Option<String>,
    },
    /// The sheets and their sizes.
    Sheets,
    /// Read a rectangle of cells. This is what the grid asks for as it scrolls.
    Read {
        #[serde(default)]
        sheet: Option<String>,
        /// An A1 range. Defaults to the sheet's used range.
        #[serde(default)]
        range: Option<String>,
    },
    /// Write cells. Every write goes through the revision guard.
    Write {
        #[serde(default)]
        sheet: Option<String>,
        cells: Vec<Write>,
        #[serde(default)]
        who: Who,
        /// The revision the caller last saw. Omit to force the write through.
        #[serde(default)]
        revision: Option<u64>,
        #[serde(default)]
        label: Option<String>,
    },
    /// Undo, optionally only what one actor did.
    Undo {
        #[serde(default)]
        who: Who,
        #[serde(default)]
        only_by: Option<String>,
    },
    Redo {
        #[serde(default)]
        who: Who,
        #[serde(default)]
        only_by: Option<String>,
    },
    /// Add a sheet.
    AddSheet {
        name: String,
        #[serde(default)]
        who: Who,
    },
    /// Insert or delete rows or columns.
    ///
    /// One commit, so it undoes in one step, and every formula in the workbook
    /// is rewritten to keep pointing at what it pointed at.
    Alter {
        /// `insert_row`, `remove_row`, `insert_col` or `remove_col`.
        action: String,
        #[serde(default)]
        sheet: Option<String>,
        /// The first row or column affected, zero-based.
        index: u32,
        #[serde(default = "one")]
        amount: u32,
        #[serde(default)]
        who: Who,
        #[serde(default)]
        revision: Option<u64>,
        #[serde(default)]
        label: Option<String>,
    },
    /// Evaluate a formula without storing it.
    Eval {
        formula: String,
        #[serde(default)]
        sheet: Option<String>,
    },
    /// Shift a formula's relative references, as copying it would.
    ///
    /// The grid needs this for filling and for pasting: a formula moved one row
    /// down must mean the same thing one row down, and the shift has to follow
    /// the same rules the importer uses for shared formulas.
    Translate {
        /// The formula, with or without its leading `=`.
        formula: String,
        /// Rows to move by; negative moves up.
        #[serde(default)]
        rows: i64,
        /// Columns to move by; negative moves left.
        #[serde(default)]
        cols: i64,
    },
    /// Who changed a cell, and when.
    History {
        cell: String,
        #[serde(default)]
        sheet: Option<String>,
    },
    /// The workbook's content fingerprints.
    Fingerprint,
    /// Check the workbook against a specification.
    Verify { spec: Spec },
    /// Record the workbook as it stands, under a name, to compare against later.
    Snapshot { name: String },
    /// The snapshots that have been recorded.
    Snapshots,
    /// The changes between a snapshot and the workbook as it stands.
    Diff { against: String },
    /// What undo and redo would do next.
    ///
    /// A toolbar needs this to grey out its buttons, and the per-actor counts
    /// are what let it offer "undo the agent's changes" separately from "undo".
    UndoState,
    /// The whole edit journal, for saving or replaying.
    Journal,
    /// The built-in function catalogue.
    Functions,
}

/// A cell as the grid receives it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CellView {
    pub cell: String,
    pub row: u32,
    pub col: u32,
    /// The displayed value.
    pub text: String,
    /// The value in its own type, for a client that wants to format it itself.
    pub value: serde_json::Value,
    /// The formula source, with its `=`, when the cell holds one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    /// Set when the value is an error, so a client can mark it without parsing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A response.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum Response {
    Ok {
        ok: bool,
        /// The revision after the command, so the caller can guard its next
        /// write with it.
        revision: u64,
        #[serde(flatten)]
        data: serde_json::Value,
    },
    Error {
        ok: bool,
        /// A stable machine-readable code, so a caller can branch without
        /// matching on prose.
        code: String,
        message: String,
        #[serde(flatten)]
        data: serde_json::Value,
    },
}

impl Response {
    pub fn ok(revision: u64, data: serde_json::Value) -> Response {
        Response::Ok { ok: true, revision, data }
    }

    pub fn error(code: &str, message: impl Into<String>) -> Response {
        Response::Error {
            ok: false,
            code: code.to_string(),
            message: message.into(),
            data: serde_json::Value::Null,
        }
    }

    /// An error carrying extra fields, such as the current revision after a
    /// conflict.
    pub fn error_with(code: &str, message: impl Into<String>, data: serde_json::Value) -> Response {
        Response::Error { ok: false, code: code.to_string(), message: message.into(), data }
    }

    /// The refusal the revision guard produces.
    ///
    /// One place, because a caller tells a conflict from any other failure by
    /// the `code` and reads the workbook's real revision out of `data` — and a
    /// second copy of this that spelled either differently would be a refusal
    /// the caller could not recover from.
    pub fn conflict(expected: u64, actual: u64) -> Response {
        Response::error_with(
            "revision_conflict",
            format!(
                "this edit was made against revision {expected}, \
                 but the workbook is at {actual}"
            ),
            serde_json::json!({ "expected": expected, "revision": actual }),
        )
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Response::Ok { .. })
    }
}
