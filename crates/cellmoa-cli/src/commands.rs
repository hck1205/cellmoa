//! The commands themselves.

use crate::args::Args;
use cellmoa_core::edit::Journal;
use cellmoa_core::fingerprint::fingerprint;
use cellmoa_core::model::{CellAddr, Workbook};
use cellmoa_core::reference::RangeRef;
use cellmoa_core::value::Value;
use cellmoa_engine::verify::{verify, Spec};
use cellmoa_engine::{catalogue, Engine};
use cellmoa_xlsx::Package;
use std::process::ExitCode;

/// Success, a failed check, and a usage error, in the form a shell reads.
const OK: u8 = 0;
const CHECK_FAILED: u8 = 1;

type Outcome = Result<ExitCode, String>;

pub fn run(args: &Args) -> Outcome {
    match args.command.as_str() {
        "calc" => calc(args),
        "eval" => eval(args),
        "get" => get(args),
        "export" => export(args),
        "verify" => verify_command(args),
        "diff" => diff_command(args),
        "fingerprint" => fingerprint_command(args),
        "replay" => replay(args),
        "functions" => functions(args),
        other => Err(format!("unknown command `{other}`")),
    }
}

/// Loads a workbook and hands back an engine with everything recalculated.
fn open(args: &Args, path: &str) -> Result<Engine, String> {
    let package = Package::open(path).map_err(|e| format!("{path}: {e}"))?;
    let mut engine = Engine::from_workbook(package.workbook);
    if let Some(seed) = args.value("seed") {
        let seed: u64 = seed.parse().map_err(|_| format!("`--seed {seed}` is not a number"))?;
        engine = engine.with_seed(seed);
    }
    if let Some(now) = args.value("now") {
        let now: f64 = now.parse().map_err(|_| format!("`--now {now}` is not a number"))?;
        engine = engine.with_now_serial(now);
    }
    engine.rebuild();
    Ok(engine)
}

fn positional<'a>(args: &'a Args, index: usize, what: &str) -> Result<&'a str, String> {
    args.positional.get(index).map(String::as_str).ok_or_else(|| format!("expected {what}"))
}

/// Resolves a sheet by name, or the first sheet if none was named.
fn sheet_id(engine: &Engine, name: Option<&str>) -> Result<u32, String> {
    match name {
        Some(name) => engine
            .workbook()
            .sheet_id_by_name(name)
            .ok_or_else(|| format!("no sheet called {name:?}")),
        None => engine
            .workbook()
            .sheets()
            .next()
            .map(|s| s.id)
            .ok_or_else(|| "the workbook has no sheets".to_string()),
    }
}

fn calc(args: &Args) -> Outcome {
    args.reject_unknown(&["out", "seed", "now", "json"]).map_err(|e| e.to_string())?;
    let path = positional(args, 0, "a workbook to recalculate")?;
    let engine = open(args, path)?;

    if let Some(out) = args.value("out") {
        Package::new(engine.workbook().clone()).save(out).map_err(|e| format!("{out}: {e}"))?;
    }

    let errors: Vec<String> = engine
        .workbook()
        .sheets()
        .flat_map(|sheet| {
            sheet.iter().filter(|(_, _, c)| c.value.is_error()).map(move |(col, row, cell)| {
                format!(
                    "{}!{}{}: {}",
                    sheet.name,
                    cellmoa_core::reference::col_to_letters(col),
                    row + 1,
                    cell.value
                )
            })
        })
        .collect();

    if args.has("json") {
        let digests = fingerprint(engine.workbook());
        println!(
            "{}",
            serde_json::json!({
                "sheets": engine.workbook().sheets().count(),
                "cells": engine.workbook().sheets().map(|s| s.cell_count()).sum::<usize>(),
                "errors": errors,
                "fingerprint": digests.workbook,
            })
        );
    } else {
        println!(
            "{} sheet(s), {} cell(s)",
            engine.workbook().sheets().count(),
            engine.workbook().sheets().map(|s| s.cell_count()).sum::<usize>()
        );
        for error in &errors {
            println!("  {error}");
        }
    }
    // Cells left holding errors are a result, not a failure of the tool.
    Ok(ExitCode::from(OK))
}

fn eval(args: &Args) -> Outcome {
    args.reject_unknown(&["file", "sheet", "seed", "now"]).map_err(|e| e.to_string())?;
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
    let value = engine.evaluate(sheet, formula).map_err(|e| format!("cannot evaluate: {e}"))?;
    println!("{value}");
    Ok(ExitCode::from(OK))
}

fn get(args: &Args) -> Outcome {
    args.reject_unknown(&["sheet", "seed", "now"]).map_err(|e| e.to_string())?;
    let path = positional(args, 0, "a workbook")?;
    let target = positional(args, 1, "a cell or range")?;
    let engine = open(args, path)?;

    let (sheet_name, rest) = cellmoa_core::reference::parse_sheet_qualified(target);
    let sheet = sheet_id(&engine, sheet_name.as_deref().or(args.value("sheet")))?;
    let range = RangeRef::parse_a1(rest).ok_or_else(|| format!("{target:?} is not a reference"))?;

    for (col, row) in range.iter() {
        let value = engine.value(CellAddr::new(sheet, col, row));
        if range.cell_count() == 1 {
            println!("{value}");
        } else {
            println!("{}{}\t{value}", cellmoa_core::reference::col_to_letters(col), row + 1);
        }
    }
    Ok(ExitCode::from(OK))
}

fn export(args: &Args) -> Outcome {
    args.reject_unknown(&["format", "sheet", "out", "seed", "now"]).map_err(|e| e.to_string())?;
    let path = positional(args, 0, "a workbook")?;
    let engine = open(args, path)?;
    let sheet = sheet_id(&engine, args.value("sheet"))?;
    let sheet = engine.workbook().sheet(sheet).expect("resolved above");

    let text = match args.value("format").unwrap_or("csv") {
        "csv" => export_csv(sheet),
        "json" => export_json(sheet),
        other => return Err(format!("unknown format `{other}`; use csv or json")),
    };
    match args.value("out") {
        Some(out) => std::fs::write(out, text).map_err(|e| format!("{out}: {e}"))?,
        None => print!("{text}"),
    }
    Ok(ExitCode::from(OK))
}

fn export_csv(sheet: &cellmoa_core::model::Sheet) -> String {
    let Some(used) = sheet.used_range() else { return String::new() };
    let mut out = String::new();
    for row in used.start.row..=used.end.row {
        for col in used.start.col..=used.end.col {
            if col > used.start.col {
                out.push(',');
            }
            let value = sheet.value(col, row).to_string();
            // Quote whenever the value could otherwise be misread as structure.
            if value.contains([',', '"', '\n', '\r']) {
                out.push('"');
                out.push_str(&value.replace('"', "\"\""));
                out.push('"');
            } else {
                out.push_str(&value);
            }
        }
        out.push('\n');
    }
    out
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
            entry["value"] = match &cell.value {
                Value::Blank => serde_json::Value::Null,
                Value::Number(n) => serde_json::json!(n),
                Value::Bool(b) => serde_json::json!(b),
                Value::Text(s) => serde_json::json!(s),
                Value::Error(e) => serde_json::json!(e.as_str()),
            };
            entry
        })
        .collect();
    format!("{}\n", serde_json::json!({ "sheet": sheet.name, "cells": cells }))
}

fn verify_command(args: &Args) -> Outcome {
    args.reject_unknown(&["expect", "json", "seed", "now", "sheet"]).map_err(|e| e.to_string())?;
    let path = positional(args, 0, "a workbook")?;
    let spec_path = args.value("expect").ok_or("`--expect <spec.json>` is required")?;

    let text = std::fs::read_to_string(spec_path).map_err(|e| format!("{spec_path}: {e}"))?;
    let spec: Spec = serde_json::from_str(&text).map_err(|e| format!("{spec_path}: {e}"))?;
    let engine = open(args, path)?;
    let report = verify(&engine, &spec);

    if args.has("json") {
        println!("{}", serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?);
    } else {
        println!("{report}");
    }
    Ok(ExitCode::from(if report.passed() { OK } else { CHECK_FAILED }))
}

fn diff_command(args: &Args) -> Outcome {
    args.reject_unknown(&["json", "seed", "now"]).map_err(|e| e.to_string())?;
    let before_path = positional(args, 0, "the earlier workbook")?;
    let after_path = positional(args, 1, "the later workbook")?;

    let before = open(args, before_path)?;
    let after = open(args, after_path)?;
    let differences = cellmoa_diff::diff(before.workbook(), after.workbook());

    if args.has("json") {
        println!("{}", serde_json::to_string_pretty(&differences).map_err(|e| e.to_string())?);
    } else if differences.is_empty() {
        println!("no differences");
    } else {
        print!("{differences}");
        println!("{}", differences.summary());
    }
    Ok(ExitCode::from(if differences.is_empty() { OK } else { CHECK_FAILED }))
}

fn fingerprint_command(args: &Args) -> Outcome {
    args.reject_unknown(&["json", "seed", "now"]).map_err(|e| e.to_string())?;
    let path = positional(args, 0, "a workbook")?;
    let engine = open(args, path)?;
    let digests = fingerprint(engine.workbook());

    if args.has("json") {
        let sheets: Vec<serde_json::Value> = digests
            .sheets
            .iter()
            .map(|s| serde_json::json!({ "name": s.name, "inputs": s.inputs, "values": s.values }))
            .collect();
        println!(
            "{}",
            serde_json::json!({
                "workbook": digests.workbook,
                "inputs": digests.inputs,
                "values": digests.values,
                "sheets": sheets,
            })
        );
    } else {
        println!("workbook  {}", digests.workbook);
        println!("inputs    {}", digests.inputs);
        println!("values    {}", digests.values);
        for sheet in &digests.sheets {
            println!("  {:<20} {}", sheet.name, sheet.inputs);
        }
    }
    Ok(ExitCode::from(OK))
}

fn replay(args: &Args) -> Outcome {
    args.reject_unknown(&["onto", "out", "json", "seed", "now"]).map_err(|e| e.to_string())?;
    let journal_path = positional(args, 0, "a journal")?;
    let text = std::fs::read_to_string(journal_path).map_err(|e| format!("{journal_path}: {e}"))?;
    let journal: Journal =
        serde_json::from_str(&text).map_err(|e| format!("{journal_path}: {e}"))?;

    // Replaying onto the wrong document would produce something plausible and
    // wrong, so the base is named explicitly or assumed empty.
    let base = match args.value("onto") {
        Some(path) => Package::open(path).map_err(|e| format!("{path}: {e}"))?.workbook,
        None => Workbook::new(),
    };
    let workbook = journal.replay_onto(base).map_err(|e| e.to_string())?;

    let mut engine = Engine::from_workbook(workbook);
    engine.rebuild();
    let digests = fingerprint(engine.workbook());

    if let Some(out) = args.value("out") {
        Package::new(engine.workbook().clone()).save(out).map_err(|e| format!("{out}: {e}"))?;
    }
    if args.has("json") {
        println!(
            "{}",
            serde_json::json!({
                "commits": journal.commits.len(),
                "fingerprint": digests.workbook,
            })
        );
    } else {
        println!("replayed {} commit(s)", journal.commits.len());
        println!("fingerprint {}", digests.workbook);
    }
    Ok(ExitCode::from(OK))
}

fn functions(args: &Args) -> Outcome {
    args.reject_unknown(&["json"]).map_err(|e| e.to_string())?;
    let all = catalogue();
    if args.has("json") {
        let entries: Vec<serde_json::Value> = all
            .iter()
            .map(|f| {
                serde_json::json!({
                    "name": f.name,
                    "min_args": f.min_args,
                    "max_args": f.max_args,
                    "volatile": f.volatile,
                })
            })
            .collect();
        println!("{}", serde_json::json!({ "count": entries.len(), "functions": entries }));
    } else {
        for function in &all {
            println!("{}", function.name);
        }
        println!("{} function(s)", all.len());
    }
    Ok(ExitCode::from(OK))
}
