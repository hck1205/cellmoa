//! `fill`: write a CSV into a template.

use super::*;
use crate::strict::{self, Counts};
use cellmoa_core::edit::Actor;
use cellmoa_core::model::{CellAddr, CellContent};
use cellmoa_core::reference::{parse_sheet_qualified, CellRef};
use cellmoa_core::value::Value;
use cellmoa_xlsx::Package;

/// Loads a CSV into a template workbook and saves the result.
///
/// The template is opened, written into, and saved elsewhere; the file named
/// as the template is never modified. Fields go in under the strict rules in
/// `strict.rs` — nothing from the CSV can become a formula.
pub(super) fn fill(args: &Args) -> Outcome {
    args.reject_unknown(&[
        "csv",
        "target",
        "out",
        "headers",
        "clear",
        "delimiter",
        "json",
        "quiet",
    ])
    .map_err(|e| Fault::Usage(e.to_string()))?;

    let template = positional(args, 0, "a template workbook")?;
    let csv =
        args.value("csv").ok_or_else(|| Fault::Usage("`--csv <file>` is required".to_string()))?;
    let target = args
        .value("target")
        .ok_or_else(|| Fault::Usage("`--target <cell>` is required".to_string()))?;
    let out =
        args.value("out").ok_or_else(|| Fault::Usage("`--out <file>` is required".to_string()))?;

    let (sheet_name, cell) = parse_sheet_qualified(target);
    let corner = CellRef::parse_a1(cell)
        .ok_or_else(|| Fault::Usage(format!("`--target {target}` is not a cell reference")))?;

    let table = crate::tabular::read(
        &crate::exit::read(csv)?,
        crate::tabular::Reading {
            format: crate::tabular::Format::Csv,
            headers: args.has("headers"),
            delimiter: crate::input::delimiter(args)?,
        },
    )?;

    let mut engine = open(args, template)?;
    let sheet = sheet_id(&engine, sheet_name.as_deref())?;

    let mut writes: Vec<(CellAddr, CellContent)> = Vec::new();
    if args.has("clear") {
        // Data cells, not every cell: a template's formulas are the reason it
        // is a template, and clearing them would leave the second fill with a
        // workbook that computes nothing. Clearing goes wider than the cells
        // about to be written, though, so that last month's longer table does
        // not leave a tail hanging below this month's shorter one.
        writes.extend(
            engine
                .workbook()
                .sheet(sheet)
                .into_iter()
                .flat_map(|s| s.iter())
                .filter(|(_, _, cell)| cell.content.as_formula().is_none())
                .map(|(col, row, _)| {
                    (CellAddr::new(sheet, col, row), CellContent::Literal(Value::Blank))
                })
                .collect::<Vec<_>>(),
        );
    }

    let mut counts = Counts::default();
    for (r, row) in table.rows.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            let (content, kind) = strict::field(text);
            counts.add(kind);
            let address = CellAddr::new(sheet, corner.col + c as u32, corner.row + r as u32);
            writes.push((address, content));
        }
    }

    // One commit, one recalculation, and — the part that matters — the
    // contents go in as decided rather than being read back as input.
    engine
        .apply_contents(Actor::system(), writes, None)
        .map_err(|e| Fault::Parse(format!("filling: {e}")))?;

    Package::new(engine.workbook().clone())
        .save(out)
        .map_err(|e| Fault::Io(format!("{out}: {e}")))?;

    if args.has("json") {
        out!(
            "{}",
            serde_json::json!({
                "template": template,
                "csv": csv,
                "out": out,
                "sheet": engine.workbook().sheet(sheet).map(|s| s.name.clone()),
                "target": cell,
                "rows": table.rows.len(),
                "cells": counts.cells(),
                "numbers": counts.numbers,
                "text": counts.text,
                "neutralised": counts.neutralised,
            })
        );
    } else {
        note!(args, "filled {} cell(s) from {} row(s)", counts.cells(), table.rows.len());
    }
    // Saying so matters: someone who put a formula in the CSV and finds text
    // in the output should be told why, rather than concluding the fill
    // silently dropped it.
    if counts.neutralised > 0 {
        note!(
            args,
            "note: {} field(s) began like a formula and were stored as text",
            counts.neutralised
        );
    }
    ok()
}
