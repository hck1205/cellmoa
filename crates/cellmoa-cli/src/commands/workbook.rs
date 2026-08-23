//! The commands that open a workbook.
//!
//! Each one loads a .xlsx, recalculates it, and answers a question about what
//! it holds: a cell, a sheet, a check, a difference, a fingerprint.
use super::*;

pub(super) fn eval(args: &Args) -> Outcome {
    args.reject_unknown(&["file", "sheet", "seed", "now"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let formula = positional(args, 0, "a formula to evaluate")?;

    let engine = match args.value("file") {
        Some(path) => open(args, path)?,
        None => {
            let mut engine = Engine::new();
            engine.add_sheet("Sheet1");
            engine
        }
    };
    let sheet = sheet_id(&engine, args.value("sheet"))?;
    let value = engine
        .evaluate(sheet, formula)
        .map_err(|e| Fault::Parse(format!("cannot evaluate: {e}")))?;
    out!("{value}");
    ok()
}

pub(super) fn get(args: &Args) -> Outcome {
    args.reject_unknown(&["sheet", "seed", "now"]).map_err(|e| Fault::Usage(e.to_string()))?;
    let path = positional(args, 0, "a workbook")?;
    let target = positional(args, 1, "a cell or range")?;
    let engine = open(args, path)?;

    let (sheet_name, rest) = cellmoa_core::reference::parse_sheet_qualified(target);
    let sheet = sheet_id(&engine, sheet_name.as_deref().or(args.value("sheet")))?;
    let range = RangeRef::parse_a1(rest)
        .ok_or_else(|| Fault::Usage(format!("{target:?} is not a reference")))?;

    for (col, row) in range.iter() {
        let value = engine.value(CellAddr::new(sheet, col, row));
        if range.cell_count() == 1 {
            out!("{value}");
        } else {
            out!("{}{}\t{value}", cellmoa_core::reference::col_to_letters(col), row + 1);
        }
    }
    ok()
}

pub(super) fn export(args: &Args) -> Outcome {
    args.reject_unknown(&["format", "sheet", "out", "seed", "now"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let path = positional(args, 0, "a workbook")?;
    let engine = open(args, path)?;
    let sheet = sheet_id(&engine, args.value("sheet"))?;
    let sheet = engine.workbook().sheet(sheet).expect("resolved above");

    let text = match args.value("format").unwrap_or("csv") {
        "csv" => crate::tabular::write(&sheet_as_table(sheet), crate::tabular::Format::Csv, None),
        "json" => export_json(sheet),
        other => return Err(Fault::Format(format!("unknown format `{other}`; use csv or json"))),
    };
    match args.value("out") {
        Some(out) => crate::exit::write(out, &text)?,
        None => out_raw!("{text}"),
    }
    ok()
}

/// Reads a sheet's used range as a rectangle of display text, so the one CSV
/// writer in this crate can render it. There was a second CSV writer here
/// with its own quoting rules, and the two had already drifted over how a
/// number is written.
fn sheet_as_table(sheet: &cellmoa_core::model::Sheet) -> crate::tabular::Table {
    let Some(used) = sheet.used_range() else { return crate::tabular::Table::default() };
    let rows = (used.start.row..=used.end.row)
        .map(|row| {
            (used.start.col..=used.end.col).map(|col| sheet.value(col, row).to_string()).collect()
        })
        .collect();
    crate::tabular::Table { headers: None, rows }
}

fn export_json(sheet: &cellmoa_core::model::Sheet) -> String {
    let cells: Vec<serde_json::Value> = sheet
        .iter()
        .map(|(col, row, cell)| {
            let reference = format!("{}{}", cellmoa_core::reference::col_to_letters(col), row + 1);
            let mut entry = serde_json::json!({ "cell": reference });
            if let Some(formula) = cell.content.as_formula() {
                entry["formula"] = serde_json::Value::String(format!("={formula}"));
            }
            entry["value"] = as_json(&cell.value);
            entry
        })
        .collect();
    format!("{}\n", serde_json::json!({ "sheet": sheet.name, "cells": cells }))
}

pub(super) fn verify_command(args: &Args) -> Outcome {
    args.reject_unknown(&["expect", "json", "seed", "now", "sheet", "quiet"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let path = positional(args, 0, "a workbook")?;
    let spec_path = args
        .value("expect")
        .ok_or_else(|| Fault::Usage("`--expect <spec.json>` is required".to_string()))?;

    let text = crate::exit::read(spec_path)?;
    let spec: Spec =
        serde_json::from_str(&text).map_err(|e| Fault::Parse(format!("{spec_path}: {e}")))?;
    let engine = open(args, path)?;
    let report = verify(&engine, &spec);

    if args.has("json") {
        out!("{}", json(&report)?);
    } else {
        // The report is the whole point of the command, so it is the data.
        out!("{report}");
    }
    checked(report.passed())
}

pub(super) fn diff_command(args: &Args) -> Outcome {
    args.reject_unknown(&["json", "seed", "now", "quiet"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let before_path = positional(args, 0, "the earlier workbook")?;
    let after_path = positional(args, 1, "the later workbook")?;

    let before = open(args, before_path)?;
    let after = open(args, after_path)?;
    let differences = cellmoa_diff::diff(before.workbook(), after.workbook());

    if args.has("json") {
        out!("{}", json(&differences)?);
    } else if differences.is_empty() {
        // Nothing differed, so there is no data — only the news that there
        // is none, which belongs on stderr with the other diagnostics.
        note!(args, "no differences");
    } else {
        out_raw!("{differences}");
        note!(args, "{}", differences.summary());
    }
    checked(differences.is_empty())
}

pub(super) fn fingerprint_command(args: &Args) -> Outcome {
    args.reject_unknown(&["json", "seed", "now", "quiet"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let path = positional(args, 0, "a workbook")?;
    let engine = open(args, path)?;
    let digests = fingerprint(engine.workbook());

    if args.has("json") {
        let sheets: Vec<serde_json::Value> = digests
            .sheets
            .iter()
            .map(|s| serde_json::json!({ "name": s.name, "inputs": s.inputs, "values": s.values }))
            .collect();
        out!(
            "{}",
            serde_json::json!({
                "workbook": digests.workbook,
                "inputs": digests.inputs,
                "values": digests.values,
                "sheets": sheets,
            })
        );
    } else {
        out!("workbook  {}", digests.workbook);
        out!("inputs    {}", digests.inputs);
        out!("values    {}", digests.values);
        for sheet in &digests.sheets {
            out!("  {:<20} {}", sheet.name, sheet.inputs);
        }
    }
    ok()
}

pub(super) fn replay(args: &Args) -> Outcome {
    args.reject_unknown(&["onto", "out", "json", "seed", "now", "quiet"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let journal_path = positional(args, 0, "a journal")?;
    let text = crate::exit::read(journal_path)?;
    let journal: Journal =
        serde_json::from_str(&text).map_err(|e| Fault::Parse(format!("{journal_path}: {e}")))?;

    // Replaying onto the wrong document would produce something plausible and
    // wrong, so the base is named explicitly or assumed empty.
    let base = match args.value("onto") {
        Some(path) => Package::open(path).map_err(|e| classify_open(path, &e))?.workbook,
        None => Workbook::new(),
    };
    let workbook = journal.replay_onto(base).map_err(|e| Fault::Usage(e.to_string()))?;

    let mut engine = Engine::from_workbook(workbook);
    engine.rebuild();
    let digests = fingerprint(engine.workbook());

    if let Some(out) = args.value("out") {
        Package::new(engine.workbook().clone())
            .save(out)
            .map_err(|e| Fault::Io(format!("{out}: {e}")))?;
    }
    if args.has("json") {
        out!(
            "{}",
            serde_json::json!({
                "commits": journal.commits.len(),
                "fingerprint": digests.workbook,
            })
        );
    } else {
        note!(args, "replayed {} commit(s)", journal.commits.len());
        // The fingerprint is the answer the caller came for, so it is data
        // even when the count beside it is not.
        out!("{}", digests.workbook);
    }
    ok()
}
