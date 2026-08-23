//! The commands themselves.
//!
//! Split three ways by what a command works on: a stream (`pipeline`), a
//! workbook on disk (`workbook`), or the engine itself (`catalogue`). What
//! they share stays here, with the table that routes a verb to one of them.

use crate::args::Args;
use crate::exit::{checked, ok, Fault, Outcome};
use cellmoa_core::edit::Journal;
use cellmoa_core::fingerprint::fingerprint;
use cellmoa_core::model::{CellAddr, Workbook};
use cellmoa_core::reference::RangeRef;
use cellmoa_core::value::Value;
use cellmoa_engine::verify::{verify, Spec};
use cellmoa_engine::{catalogue, Engine};
use cellmoa_xlsx::Package;

/// Writes a line of data to stdout.
///
/// `println!` panics when the reader has gone away, which is what `| head -5`
/// does the moment it has five lines. A tool documented as something you pipe
/// cannot die that way, so a closed pipe is read as "the reader has what it
/// wanted" and the process leaves quietly.
macro_rules! out {
    ($($arg:tt)*) => {{
        use std::io::Write;
        if writeln!(std::io::stdout(), $($arg)*).is_err() {
            std::process::exit(0);
        }
    }};
}

/// As `out!`, without the newline, for text that already ends in one.
macro_rules! out_raw {
    ($($arg:tt)*) => {{
        use std::io::Write;
        if write!(std::io::stdout(), $($arg)*).is_err() {
            std::process::exit(0);
        }
    }};
}

/// Prints a note on stderr unless `--quiet` asked for silence. Counts and
/// summaries go here rather than to stdout, so that piping a command's output
/// into another one does not feed it a summary line as data.
macro_rules! note {
    ($args:expr, $($arg:tt)*) => {
        if !$args.has("quiet") {
            eprintln!($($arg)*);
        }
    };
}

mod catalogue;
mod pipeline;
mod reconcile;
mod workbook;

use catalogue::list_functions;
use pipeline::{calc_stdin, convert};
use reconcile::reconcile;
use workbook::{diff_command, eval, export, fingerprint_command, get, replay, verify_command};

pub fn run(args: &Args) -> Outcome {
    match args.command.as_str() {
        "calc" => calc(args),
        "convert" => convert(args),
        "eval" => eval(args),
        "get" => get(args),
        "export" => export(args),
        "verify" => verify_command(args),
        // Two commands share the name. `--key` decides: with it, two data
        // files are reconciled row by row; without it, two workbooks are
        // compared cell by cell.
        "diff" if args.has("key") => reconcile(args),
        "diff" => diff_command(args),
        "fingerprint" => fingerprint_command(args),
        "replay" => replay(args),
        // `functions` was the older name and still works; the documented
        // spelling is the one that reads as a verb phrase.
        "list-functions" | "functions" => list_functions(args),
        other => Err(Fault::Usage(format!("unknown command `{other}`"))),
    }
}

/// Loads a workbook and hands back an engine with everything recalculated.
fn open(args: &Args, path: &str) -> Result<Engine, Fault> {
    // A workbook that will not open and one that opens as nonsense are
    // different problems for whoever is reading the exit code, so they get
    // different codes rather than a shared "could not load".
    let package = Package::open(path).map_err(|e| classify_open(path, &e))?;
    let mut engine = Engine::from_workbook(package.workbook);
    if let Some(seed) = args.value("seed") {
        let seed: u64 =
            seed.parse().map_err(|_| Fault::Usage(format!("`--seed {seed}` is not a number")))?;
        engine = engine.with_seed(seed);
    }
    if let Some(now) = args.value("now") {
        let now: f64 =
            now.parse().map_err(|_| Fault::Usage(format!("`--now {now}` is not a number")))?;
        engine = engine.with_now_serial(now);
    }
    engine.rebuild();
    Ok(engine)
}

/// Decides whether a failure to open a workbook was the filesystem's doing or
/// the file's. `Package::open` reports both, and the caller needs to tell them
/// apart: a missing file is fixed by a different action than a corrupt one.
fn classify_open(path: &str, error: &impl std::fmt::Display) -> Fault {
    let message = format!("{path}: {error}");
    let text = error.to_string().to_lowercase();
    let filesystem = ["no such file", "permission denied", "is a directory", "os error"];
    if filesystem.iter().any(|needle| text.contains(needle)) {
        Fault::Io(message)
    } else {
        Fault::Parse(message)
    }
}

fn positional<'a>(args: &'a Args, index: usize, what: &str) -> Result<&'a str, Fault> {
    args.positional
        .get(index)
        .map(String::as_str)
        .ok_or_else(|| Fault::Usage(format!("expected {what}")))
}

/// Resolves a sheet by name, or the first sheet if none was named.
fn sheet_id(engine: &Engine, name: Option<&str>) -> Result<u32, Fault> {
    match name {
        Some(name) => engine.workbook().sheet_id_by_name(name).ok_or_else(|| {
            let available: Vec<&str> =
                engine.workbook().sheets().map(|s| s.name.as_str()).collect();
            // Naming what is there turns "wrong sheet" from a guess into a
            // correction the caller can make on the next run.
            Fault::Usage(format!("no sheet called {name:?}; this workbook has {available:?}"))
        }),
        None => engine
            .workbook()
            .sheets()
            .next()
            .map(|s| s.id)
            .ok_or_else(|| Fault::Parse("the workbook has no sheets".to_string())),
    }
}

fn calc(args: &Args) -> Outcome {
    // Two commands share the name. `--from` says which: with it, the argument
    // is a formula and the data arrives on stdin; without it, the argument is
    // a workbook to recalculate. The flag is required for the stdin form, so
    // there is nothing to guess.
    if args.has("from") {
        return calc_stdin(args);
    }
    args.reject_unknown(&["out", "seed", "now", "json", "quiet"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let path = positional(args, 0, "a workbook to recalculate")?;
    let engine = open(args, path)?;

    if let Some(out) = args.value("out") {
        Package::new(engine.workbook().clone())
            .save(out)
            .map_err(|e| Fault::Io(format!("{out}: {e}")))?;
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
        out!(
            "{}",
            serde_json::json!({
                "sheets": engine.workbook().sheets().count(),
                "cells": engine.workbook().sheets().map(|s| s.cell_count()).sum::<usize>(),
                "errors": errors,
                "fingerprint": digests.workbook,
            })
        );
    } else {
        // Without --json there is no data to emit, only a report, and a
        // report is a diagnostic.
        note!(
            args,
            "{} sheet(s), {} cell(s)",
            engine.workbook().sheets().count(),
            engine.workbook().sheets().map(|s| s.cell_count()).sum::<usize>()
        );
        for error in &errors {
            note!(args, "  {error}");
        }
    }
    // Cells left holding errors are a result, not a failure of the tool.
    ok()
}

/// "3 rows by 1 column", counted rather than pluralised blindly.
fn shape(rows: usize, cols: usize) -> String {
    let plural = |n: usize, word: &str| {
        if n == 1 {
            format!("{n} {word}")
        } else {
            format!("{n} {word}s")
        }
    };
    format!("{} by {}", plural(rows, "row"), plural(cols, "column"))
}

fn as_json(value: &Value) -> serde_json::Value {
    match value {
        Value::Blank => serde_json::Value::Null,
        // A whole number is written without a fractional part, so `jq` and
        // anything else downstream sees 15 rather than 15.0.
        Value::Number(n) if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 => {
            serde_json::json!(*n as i64)
        }
        Value::Number(n) => serde_json::json!(n),
        Value::Bool(b) => serde_json::json!(b),
        Value::Text(s) => serde_json::json!(s),
        Value::Error(e) => serde_json::json!(e.as_str()),
    }
}

/// Serialises a report, turning a serialisation failure into a fault rather
/// than a bare string.
fn json<T: serde::Serialize>(value: &T) -> Result<String, Fault> {
    serde_json::to_string_pretty(value).map_err(|e| Fault::Parse(e.to_string()))
}
