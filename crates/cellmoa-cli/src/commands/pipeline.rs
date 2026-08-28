//! The commands that work on a stream rather than on a workbook.
//!
//! `convert` and the stdin form of `calc` both take data that arrived on a
//! pipe or as plain text, which makes them a different kind of command from
//! the ones that open a .xlsx: there is no revision to respect, nothing to
//! save, and the answer goes straight out to the next process.
use super::*;

/// Converts tabular data between formats, optionally renaming, filtering and
/// projecting columns on the way through.
///
/// The three column operations run in a fixed order — rename, filter, select —
/// so that `--where` and `--select` speak the names `--rename` produced. Any
/// other order would make the flags mean different things depending on which
/// were present.
pub(super) fn convert(args: &Args) -> Outcome {
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
    let delimiter = crate::input::delimiter(args)?;

    let mut table = crate::input::table(args, args.positional.first().map(String::as_str))?;

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

    let text = crate::tabular::write(&table, to, delimiter)?;
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

/// Evaluates one formula against data piped in.
///
/// The data is loaded into a throwaway sheet and the formula is evaluated
/// against it, so `=SUM(A:A)` means what it means in a spreadsheet. Nothing is
/// written anywhere; the answer goes to stdout and the exit code says whether
/// it is an answer.
pub(super) fn calc_stdin(args: &Args) -> Outcome {
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
        out!("{value}");
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

    let format = crate::tabular::Format::parse(spill)?;
    match format {
        crate::tabular::Format::Json => {
            // JSON keeps the values typed: an array of numbers read back as
            // strings would have to be parsed again on the far side of the pipe.
            let rows: Vec<Vec<serde_json::Value>> = (0..array.rows())
                .map(|row| (0..array.cols()).map(|col| as_json(&array.get(row, col))).collect())
                .collect();
            out!("{}", serde_json::json!(rows));
        }
        crate::tabular::Format::Csv => {
            let table = crate::tabular::Table {
                headers: None,
                rows: (0..array.rows())
                    .map(|row| {
                        (0..array.cols()).map(|col| array.get(row, col).to_string()).collect()
                    })
                    .collect(),
            };
            out_raw!("{}", crate::tabular::write(&table, format, None)?);
        }
        _ => return Err(Fault::Format(format!("cannot spill as `{spill}`; use csv or json"))),
    }
    ok()
}

/// Reads stdin and loads it into a fresh single-sheet workbook.
fn load_stdin(args: &Args) -> Result<Engine, Fault> {
    // Stdin only, on purpose: this form takes a formula as its argument, so
    // there is no room for a path without making one of the two ambiguous.
    let table = crate::input::table(args, None)?;

    let corner = match args.value("into") {
        Some(cell) => cellmoa_core::reference::CellRef::parse_a1(cell)
            .ok_or_else(|| Fault::Usage(format!("`--into {cell}` is not a cell reference")))?,
        None => cellmoa_core::reference::CellRef::new(0, 0),
    };

    let mut engine = Engine::new();
    let sheet = engine.add_sheet("Sheet1");
    engine = determined(engine, args)?;

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
