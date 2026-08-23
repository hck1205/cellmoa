//! The commands themselves.

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

pub fn run(args: &Args) -> Outcome {
    match args.command.as_str() {
        "calc" => calc(args),
        "convert" => convert(args),
        "eval" => eval(args),
        "get" => get(args),
        "export" => export(args),
        "verify" => verify_command(args),
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

/// Converts tabular data between formats, optionally renaming, filtering and
/// projecting columns on the way through.
///
/// The three column operations run in a fixed order — rename, filter, select —
/// so that `--where` and `--select` speak the names `--rename` produced. Any
/// other order would make the flags mean different things depending on which
/// were present.
fn convert(args: &Args) -> Outcome {
    args.reject_unknown(&[
        "from",
        "to",
        "out",
        "sheet",
        "delimiter",
        "headers",
        "where",
        "select",
        "rename",
        "quiet",
    ])
    .map_err(|e| Fault::Usage(e.to_string()))?;

    let to =
        args.value("to").ok_or_else(|| Fault::Usage("`--to <format>` is required".to_string()))?;
    let to = crate::tabular::Format::parse(to)?;
    let delimiter = match args.value("delimiter") {
        Some(text) => Some(one_char(text)?),
        None => None,
    };
    let headers = args.has("headers");

    let mut table = read_input(args, headers, delimiter)?;

    // Rename first: everything downstream refers to columns by name, and the
    // names the caller has in mind are the ones they just assigned.
    let renames = args.values("rename");
    crate::reshape::rename(&mut table, &renames)?;

    let filters: Vec<crate::reshape::Filter> = args
        .values("where")
        .iter()
        .map(|clause| crate::reshape::Filter::parse(clause))
        .collect::<Result<_, _>>()?;
    let report = crate::reshape::filter(&mut table, &filters)?;

    let selected = args.values("select");
    crate::reshape::select(&mut table, &selected)?;

    let text = crate::tabular::write(&table, to, delimiter);
    match args.value("out") {
        Some(path) => crate::exit::write(path, &text)?,
        None => out_raw!("{text}"),
    }

    // A row count smaller than expected has a reason, and this is it. It goes
    // to stderr after the data, so a pipeline sees only the data.
    for (column, count) in &report.skipped {
        let rows = if *count == 1 { "row" } else { "rows" };
        note!(args, "note: {count} {rows} skipped ({column} not numeric)");
    }
    ok()
}

/// Reads the input named on the command line, or stdin when none was.
fn read_input(
    args: &Args,
    headers: bool,
    delimiter: Option<char>,
) -> Result<crate::tabular::Table, Fault> {
    use crate::tabular::{Format, Reading};
    let path = args.positional.first().map(String::as_str).filter(|p| *p != "-");

    // From a file the extension usually says what the format is; from a pipe
    // there is nothing to go on, so `--from` is required rather than guessed.
    let format = match args.value("from") {
        Some(named) => Format::parse(named)?,
        None => match path {
            Some(path) => Format::from_extension(path).ok_or_else(|| {
                Fault::Usage(format!(
                    "cannot tell the format of {path:?} from its name; pass `--from`"
                ))
            })?,
            None => {
                return Err(Fault::Usage("reading from stdin needs `--from <format>`".to_string()))
            }
        },
    };

    let text = match path {
        Some(path) => crate::exit::read(path)?,
        None => {
            use std::io::Read;
            let mut text = String::new();
            std::io::stdin()
                .read_to_string(&mut text)
                .map_err(|e| Fault::Io(format!("stdin: {e}")))?;
            text
        }
    };
    crate::tabular::read(&text, Reading { format, headers, delimiter })
}

/// Evaluates one formula against data piped in./// Evaluates one formula against data piped in.
///
/// The data is loaded into a throwaway sheet and the formula is evaluated
/// against it, so `=SUM(A:A)` means what it means in a spreadsheet. Nothing is
/// written anywhere; the answer goes to stdout and the exit code says whether
/// it is an answer.
fn calc_stdin(args: &Args) -> Outcome {
    args.reject_unknown(&["from", "headers", "into", "delimiter", "spill", "seed", "now", "quiet"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let formula = positional(args, 0, "a formula to evaluate")?;

    let engine = load_stdin(args)?;
    let sheet = sheet_id(&engine, None)?;

    // Ask for the whole shape first: a scalar is a 1x1 rectangle, so one path
    // handles both and the size is known before deciding what to print.
    let array = engine
        .evaluate_array(sheet, formula)
        .map_err(|e| Fault::Parse(format!("cannot evaluate: {e}")))?;

    if array.rows() == 1 && array.cols() == 1 {
        let value = array.get(0, 0);
        out!("{}", raw(&value));
        if let Value::Error(e) = &value {
            // The token is the answer, so it goes to stdout with everything
            // else; the explanation is a diagnostic.
            note!(args, "{formula} evaluated to {}", e.as_str());
            return Ok(std::process::ExitCode::from(crate::exit::CHECK_FAILED));
        }
        return ok();
    }

    let Some(spill) = args.value("spill") else {
        // Printing the top-left corner of a 40-row answer would look like a
        // result rather than a truncation, so the size is named and nothing
        // is printed. This is a 1 rather than a 2: the command line was
        // right and the formula evaluated: it simply has an answer that does
        // not fit on one line.
        note!(
            args,
            "the result is {}; pass `--spill csv` or `--spill json` to write it",
            shape(array.rows(), array.cols())
        );
        return Ok(std::process::ExitCode::from(crate::exit::CHECK_FAILED));
    };

    match spill {
        "csv" => {
            for row in 0..array.rows() {
                let cells: Vec<String> =
                    (0..array.cols()).map(|col| csv_field(&raw(&array.get(row, col)))).collect();
                out!("{}", cells.join(","));
            }
        }
        "json" => {
            let rows: Vec<Vec<serde_json::Value>> = (0..array.rows())
                .map(|row| (0..array.cols()).map(|col| as_json(&array.get(row, col))).collect())
                .collect();
            out!("{}", serde_json::json!(rows));
        }
        other => {
            return Err(Fault::Format(format!("unknown spill format `{other}`; use csv or json")))
        }
    }
    ok()
}

/// Reads stdin and loads it into a fresh single-sheet workbook.
fn load_stdin(args: &Args) -> Result<Engine, Fault> {
    use std::io::Read;
    // `--from` is a switch until it is declared as taking a value, and a
    // switch here would leave the format missing and the format name sitting
    // in the positionals, where it would be read as the formula.
    let named =
        args.value("from").ok_or_else(|| Fault::Usage("`--from` needs a format".to_string()))?;
    let format = crate::tabular::Format::parse(named)?;
    let delimiter = match args.value("delimiter") {
        Some(text) => Some(one_char(text)?),
        None => None,
    };

    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text).map_err(|e| Fault::Io(format!("stdin: {e}")))?;
    let table = crate::tabular::read(
        &text,
        crate::tabular::Reading { format, headers: args.has("headers"), delimiter },
    )?;

    let corner = match args.value("into") {
        Some(cell) => cellmoa_core::reference::CellRef::parse_a1(cell)
            .ok_or_else(|| Fault::Usage(format!("`--into {cell}` is not a cell reference")))?,
        None => cellmoa_core::reference::CellRef::new(0, 0),
    };

    let mut engine = Engine::new();
    let sheet = engine.add_sheet("Sheet1");
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

    let edits: Vec<(CellAddr, String)> = table
        .rows
        .iter()
        .enumerate()
        .flat_map(|(r, row)| {
            row.iter().enumerate().map(move |(c, field)| {
                let addr = CellAddr::new(sheet, corner.col + c as u32, corner.row + r as u32);
                (addr, field.clone())
            })
        })
        .collect();

    for (addr, field) in edits {
        // A field is loaded exactly as it arrived, so a leading `=` in the
        // data becomes a formula the same way typing it would. That is the
        // spreadsheet's rule, and departing from it here would make piped
        // data behave differently from pasted data.
        engine
            .set(cellmoa_core::edit::Actor::system(), addr, &field)
            .map_err(|e| Fault::Parse(format!("loading data: {e}")))?;
    }
    engine.rebuild();
    Ok(engine)
}

fn one_char(text: &str) -> Result<char, Fault> {
    let mut characters = text.chars();
    match (characters.next(), characters.next()) {
        (Some(c), None) => Ok(c),
        // Named delimiters read better in a shell than an escaped tab does.
        _ => match text {
            "tab" => Ok('\t'),
            "comma" => Ok(','),
            "pipe" => Ok('|'),
            "semicolon" => Ok(';'),
            other => Err(Fault::Usage(format!(
                "`--delimiter {other}` should be one character, or tab, comma, pipe or semicolon"
            ))),
        },
    }
}

/// A value as text, with no locale formatting: `1234.5678`, not `$1,234.57`.
/// Whatever reads this is a program, and a program wants the number.
fn raw(value: &Value) -> String {
    match value {
        Value::Blank => String::new(),
        Value::Number(n) => {
            let mut text = format!("{n}");
            if text == "-0" {
                text = "0".to_string();
            }
            text
        }
        Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Value::Text(s) => s.clone(),
        Value::Error(e) => e.as_str().to_string(),
    }
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

/// Quotes a field when it would otherwise be misread as structure.
fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn eval(args: &Args) -> Outcome {
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

fn get(args: &Args) -> Outcome {
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

fn export(args: &Args) -> Outcome {
    args.reject_unknown(&["format", "sheet", "out", "seed", "now"])
        .map_err(|e| Fault::Usage(e.to_string()))?;
    let path = positional(args, 0, "a workbook")?;
    let engine = open(args, path)?;
    let sheet = sheet_id(&engine, args.value("sheet"))?;
    let sheet = engine.workbook().sheet(sheet).expect("resolved above");

    let text = match args.value("format").unwrap_or("csv") {
        "csv" => export_csv(sheet),
        "json" => export_json(sheet),
        other => return Err(Fault::Format(format!("unknown format `{other}`; use csv or json"))),
    };
    match args.value("out") {
        Some(out) => crate::exit::write(out, &text)?,
        None => out_raw!("{text}"),
    }
    ok()
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

fn diff_command(args: &Args) -> Outcome {
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

fn fingerprint_command(args: &Args) -> Outcome {
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

fn replay(args: &Args) -> Outcome {
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

/// Prints the built-in functions, one name per line, sorted — a list a shell
/// can grep and count. The tally goes to stderr so that `| wc -l` returns the
/// number of functions rather than the number of functions plus one.
fn list_functions(args: &Args) -> Outcome {
    args.reject_unknown(&["json", "quiet"]).map_err(|e| Fault::Usage(e.to_string()))?;
    let mut all = catalogue();
    all.sort_by(|a, b| a.name.cmp(b.name));

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
        out!("{}", serde_json::json!({ "count": entries.len(), "functions": entries }));
    } else {
        for function in &all {
            out!("{}", function.name);
        }
        note!(args, "{} function(s)", all.len());
    }
    ok()
}

/// Serialises a report, turning a serialisation failure into a fault rather
/// than a bare string.
fn json<T: serde::Serialize>(value: &T) -> Result<String, Fault> {
    serde_json::to_string_pretty(value).map_err(|e| Fault::Parse(e.to_string()))
}
