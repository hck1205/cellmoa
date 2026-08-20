//! A JSON command surface over the engine.
//!
//! Everything that drives a workbook from outside — the web grid, an agent over
//! MCP, the desktop shell — speaks this one protocol. Sharing it is what makes
//! the concurrency guard real: a person typing and an agent writing are the
//! same kind of caller, holding the same kind of revision, and neither can
//! overwrite the other by going in through a different door.

pub mod protocol;

use cellmoa_core::edit::{EditError, Journal};
use cellmoa_core::fingerprint::fingerprint;
use cellmoa_core::model::{CellAddr, SheetId};
use cellmoa_core::reference::{col_to_letters, parse_sheet_qualified, CellRef, RangeRef};
use cellmoa_core::value::Value;
use cellmoa_engine::verify::verify;
use cellmoa_engine::{catalogue, Engine};
use cellmoa_xlsx::Package;
use protocol::{CellView, Request, Response, Who, Write};
use serde_json::json;

/// One open workbook.
pub struct Session {
    engine: Engine,
    /// The file this workbook came from, and the parts of it the engine does
    /// not model.
    source: Option<Package>,
    path: Option<String>,
}

impl Default for Session {
    fn default() -> Self {
        Session::new()
    }
}

impl Session {
    /// A session holding an empty workbook with one sheet.
    pub fn new() -> Session {
        Session { engine: blank("Sheet1"), source: None, path: None }
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn revision(&self) -> u64 {
        self.engine.revision()
    }

    /// Loads a workbook from the bytes of an `.xlsx` file.
    ///
    /// The browser has no filesystem to open a path against, so this is the
    /// entry point the web grid uses; the bytes come from a file input or a
    /// fetch.
    pub fn open_bytes(&mut self, bytes: &[u8]) -> Result<(), String> {
        let package = Package::from_bytes(bytes).map_err(|e| e.to_string())?;
        let mut engine = Engine::from_workbook(package.workbook.clone());
        engine.rebuild();
        self.engine = engine;
        self.source = Some(package);
        self.path = None;
        Ok(())
    }

    /// Serialises the workbook as an `.xlsx` file.
    pub fn to_bytes(&mut self) -> Vec<u8> {
        let package = match self.source.take() {
            Some(mut package) => {
                package.workbook = self.engine.workbook().clone();
                package
            }
            None => Package::new(self.engine.workbook().clone()),
        };
        let bytes = package.to_bytes();
        self.source = Some(package);
        bytes
    }

    /// Handles a request given as JSON and returns the response as JSON.
    ///
    /// Malformed input is answered, not panicked on: this is the boundary the
    /// outside world reaches, and everything past it has already been checked.
    pub fn dispatch_json(&mut self, request: &str) -> String {
        let response = match serde_json::from_str::<Request>(request) {
            Ok(request) => self.dispatch(request),
            Err(e) => Response::error("bad_request", e.to_string()),
        };
        serde_json::to_string(&response)
            .unwrap_or_else(|e| format!(r#"{{"ok":false,"code":"internal","message":"{e}"}}"#))
    }

    /// Handles a parsed request.
    pub fn dispatch(&mut self, request: Request) -> Response {
        match request {
            Request::New { sheet } => {
                self.engine = blank(&sheet.unwrap_or_else(|| "Sheet1".to_string()));
                self.source = None;
                self.path = None;
                self.ok(json!({}))
            }
            Request::Open { path } => self.open(&path),
            Request::Save { path } => self.save(path),
            Request::Sheets => self.sheets(),
            Request::Read { sheet, range } => self.read(sheet.as_deref(), range.as_deref()),
            Request::Write { sheet, cells, who, revision, label } => {
                self.write(sheet.as_deref(), &cells, &who, revision, label)
            }
            Request::Undo { who, only_by } => self.undo(&who, only_by.as_deref()),
            Request::Redo { who, only_by } => self.redo(&who, only_by.as_deref()),
            Request::AddSheet { name, who } => self.add_sheet(&name, &who),
            Request::Eval { formula, sheet } => self.eval(&formula, sheet.as_deref()),
            Request::Translate { formula, rows, cols } => self.translate(&formula, rows, cols),
            Request::History { cell, sheet } => self.history(&cell, sheet.as_deref()),
            Request::Fingerprint => {
                let digests = fingerprint(self.engine.workbook());
                self.ok(json!({
                    "fingerprint": {
                        "workbook": digests.workbook,
                        "inputs": digests.inputs,
                        "values": digests.values,
                        "sheets": digests.sheets.iter().map(|s| json!({
                            "name": s.name, "inputs": s.inputs, "values": s.values
                        })).collect::<Vec<_>>(),
                    }
                }))
            }
            Request::Verify { spec } => {
                let report = verify(&self.engine, &spec);
                let passed = report.passed();
                self.ok(json!({ "passed": passed, "report": report }))
            }
            Request::Journal => {
                let journal = Journal::of(&self.engine.doc);
                self.ok(json!({ "journal": journal }))
            }
            Request::Functions => {
                let names: Vec<&str> = catalogue().iter().map(|f| f.name).collect();
                self.ok(json!({ "count": names.len(), "functions": names }))
            }
        }
    }

    fn ok(&self, data: serde_json::Value) -> Response {
        Response::ok(self.engine.revision(), data)
    }

    fn open(&mut self, path: &str) -> Response {
        match Package::open(path) {
            Ok(package) => {
                let mut engine = Engine::from_workbook(package.workbook.clone());
                engine.rebuild();
                self.engine = engine;
                self.source = Some(package);
                self.path = Some(path.to_string());
                self.sheets()
            }
            Err(e) => Response::error("cannot_open", format!("{path}: {e}")),
        }
    }

    fn save(&mut self, path: Option<String>) -> Response {
        let Some(path) = path.or_else(|| self.path.clone()) else {
            return Response::error("no_path", "this workbook has never been saved; give a path");
        };
        // Saving through the original package keeps the parts the engine does
        // not model — formatting, themes — instead of dropping them.
        let package = match self.source.take() {
            Some(mut package) => {
                package.workbook = self.engine.workbook().clone();
                package
            }
            None => Package::new(self.engine.workbook().clone()),
        };
        let result = package.save(&path);
        self.source = Some(package);
        match result {
            Ok(()) => {
                self.path = Some(path.clone());
                self.ok(json!({ "path": path }))
            }
            Err(e) => Response::error("cannot_save", format!("{path}: {e}")),
        }
    }

    fn sheets(&self) -> Response {
        let sheets: Vec<serde_json::Value> = self
            .engine
            .workbook()
            .sheets()
            .map(|sheet| {
                let used = sheet.used_range();
                json!({
                    "id": sheet.id,
                    "name": sheet.name,
                    "cells": sheet.cell_count(),
                    "used": used.map(|r| r.to_a1()),
                    "rows": used.map_or(0, |r| r.end.row + 1),
                    "cols": used.map_or(0, |r| r.end.col + 1),
                })
            })
            .collect();
        self.ok(json!({ "sheets": sheets }))
    }

    /// Resolves a sheet by name, or the first sheet when none is named.
    fn sheet_id(&self, name: Option<&str>) -> Result<SheetId, Response> {
        match name {
            Some(name) => self.engine.workbook().sheet_id_by_name(name).ok_or_else(|| {
                Response::error("no_such_sheet", format!("no sheet called {name:?}"))
            }),
            None => self
                .engine
                .workbook()
                .sheets()
                .next()
                .map(|s| s.id)
                .ok_or_else(|| Response::error("no_sheets", "the workbook has no sheets")),
        }
    }

    fn read(&self, sheet: Option<&str>, range: Option<&str>) -> Response {
        let (sheet_name, range) = match range {
            Some(range) => {
                let (qualified, rest) = parse_sheet_qualified(range);
                (qualified.or_else(|| sheet.map(String::from)), Some(rest.to_string()))
            }
            None => (sheet.map(String::from), None),
        };
        let id = match self.sheet_id(sheet_name.as_deref()) {
            Ok(id) => id,
            Err(response) => return response,
        };
        let sheet = self.engine.workbook().sheet(id).expect("resolved above");

        let area = match range {
            Some(text) => match RangeRef::parse_a1(&text) {
                Some(range) => range,
                None => return Response::error("bad_range", format!("{text:?} is not a range")),
            },
            // With no range, the sheet's used area is what a grid wants first.
            None => match sheet.used_range() {
                Some(range) => range,
                None => return self.ok(json!({ "sheet": sheet.name, "range": null, "cells": [] })),
            },
        };

        // Only cells that exist are returned; a client fills the gaps itself.
        // A screenful of an empty sheet must not be a screenful of JSON.
        let cells: Vec<CellView> = sheet
            .iter_range(&area)
            .map(|(col, row, cell)| CellView {
                cell: format!("{}{}", col_to_letters(col), row + 1),
                row,
                col,
                text: cell.value.to_string(),
                value: value_json(&cell.value),
                formula: cell.content.as_formula().map(|src| format!("={src}")),
                style: cell.style,
                error: cell.value.as_error().map(|e| e.as_str().to_string()),
            })
            .collect();

        self.ok(json!({ "sheet": sheet.name, "range": area.to_a1(), "cells": cells }))
    }

    fn write(
        &mut self,
        sheet: Option<&str>,
        cells: &[Write],
        who: &Who,
        revision: Option<u64>,
        label: Option<String>,
    ) -> Response {
        let default_sheet = match self.sheet_id(sheet) {
            Ok(id) => id,
            Err(response) => return response,
        };

        let mut edits = Vec::with_capacity(cells.len());
        for write in cells {
            let (qualified, rest) = parse_sheet_qualified(&write.cell);
            let id = match qualified {
                Some(name) => match self.engine.workbook().sheet_id_by_name(&name) {
                    Some(id) => id,
                    None => {
                        return Response::error(
                            "no_such_sheet",
                            format!("no sheet called {name:?}"),
                        )
                    }
                },
                None => default_sheet,
            };
            let Some(reference) = CellRef::parse_a1(rest) else {
                return Response::error("bad_cell", format!("{:?} is not a cell", write.cell));
            };
            edits.push((CellAddr::new(id, reference.col, reference.row), write.input.as_str()));
        }

        let result = self.engine.apply_labeled(who.actor(), edits, revision, label, None);
        match result {
            Ok(()) => self.ok(json!({ "written": cells.len() })),
            Err(EditError::RevisionConflict { expected, actual }) => Response::error_with(
                "revision_conflict",
                format!(
                    "this edit was made against revision {expected}, but the workbook is at {actual}"
                ),
                json!({ "expected": expected, "revision": actual }),
            ),
            Err(e) => Response::error("cannot_write", e.to_string()),
        }
    }

    fn undo(&mut self, who: &Who, only_by: Option<&str>) -> Response {
        match self.engine.undo(who.actor(), only_by) {
            Ok(()) => self.ok(json!({ "undone": true })),
            Err(EditError::NothingToUndo) => {
                Response::error("nothing_to_undo", "there is nothing to undo")
            }
            Err(e) => Response::error("cannot_undo", e.to_string()),
        }
    }

    fn redo(&mut self, who: &Who, only_by: Option<&str>) -> Response {
        match self.engine.redo(who.actor(), only_by) {
            Ok(()) => self.ok(json!({ "redone": true })),
            Err(EditError::NothingToRedo) => {
                Response::error("nothing_to_redo", "there is nothing to redo")
            }
            Err(e) => Response::error("cannot_redo", e.to_string()),
        }
    }

    fn add_sheet(&mut self, name: &str, _who: &Who) -> Response {
        if self.engine.workbook().sheet_id_by_name(name).is_some() {
            return Response::error("duplicate_sheet", format!("a sheet called {name:?} exists"));
        }
        let id = self.engine.add_sheet(name);
        self.ok(json!({ "id": id, "name": name }))
    }

    fn eval(&mut self, formula: &str, sheet: Option<&str>) -> Response {
        let id = match self.sheet_id(sheet) {
            Ok(id) => id,
            Err(response) => return response,
        };
        match self.engine.evaluate(id, formula) {
            Ok(value) => self.ok(json!({
                "text": value.to_string(),
                "value": value_json(&value),
                "error": value.as_error().map(|e| e.as_str()),
            })),
            Err(e) => Response::error("bad_formula", e),
        }
    }

    fn translate(&self, formula: &str, rows: i64, cols: i64) -> Response {
        let body = formula.strip_prefix('=').unwrap_or(formula);
        // Anything that is not a formula is carried over unchanged: filling a
        // column of text must not try to parse it.
        if !formula.starts_with('=') {
            return self.ok(json!({ "formula": formula }));
        }
        match cellmoa_formula::parse(body) {
            Ok(expr) => {
                let moved = cellmoa_formula::translate::translate(&expr, cols, rows);
                self.ok(json!({ "formula": format!("={moved}") }))
            }
            // A formula the parser rejects is copied verbatim rather than
            // dropped, which is what a spreadsheet does with text it cannot
            // read.
            Err(_) => self.ok(json!({ "formula": formula })),
        }
    }

    fn history(&self, cell: &str, sheet: Option<&str>) -> Response {
        let (qualified, rest) = parse_sheet_qualified(cell);
        let id = match self.sheet_id(qualified.as_deref().or(sheet)) {
            Ok(id) => id,
            Err(response) => return response,
        };
        let Some(reference) = CellRef::parse_a1(rest) else {
            return Response::error("bad_cell", format!("{cell:?} is not a cell"));
        };
        let addr = CellAddr::new(id, reference.col, reference.row);

        let entries: Vec<serde_json::Value> = self
            .engine
            .doc
            .history_of(addr)
            .map(|commit| {
                json!({
                    "revision": commit.revision,
                    "actor": { "kind": format!("{:?}", commit.actor.kind).to_lowercase(),
                               "id": commit.actor.id },
                    "label": commit.label,
                    "at": commit.at,
                    "undone": commit.undone,
                })
            })
            .collect();
        self.ok(json!({ "cell": cell, "history": entries }))
    }
}

/// A blank workbook with one sheet, as the document's starting point rather
/// than as its first edit.
///
/// The distinction matters: a sheet created through the journal would be
/// undoable, and undo on a brand-new document would take away the only sheet
/// there is. The initial state is the base a journal replays onto, not a change
/// recorded in it.
fn blank(sheet: &str) -> Engine {
    let mut workbook = cellmoa_core::model::Workbook::new();
    workbook.add_sheet(sheet);
    Engine::from_workbook(workbook)
}

/// A value in the form a JSON client wants it, keeping its type.
fn value_json(value: &Value) -> serde_json::Value {
    match value {
        Value::Blank => serde_json::Value::Null,
        Value::Number(n) => json!(n),
        Value::Bool(b) => json!(b),
        Value::Text(s) => json!(s),
        // An error is not a string the client should compute with, so it is
        // reported both here and in the dedicated `error` field.
        Value::Error(e) => json!(e.as_str()),
    }
}
