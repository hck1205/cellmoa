//! `peek`: look at a file without opening it in anything.

use super::*;
use crate::peek::{self, Limits, Peeked, Preview};
use crate::tabular::{Format, Table};

pub(super) fn peek_command(args: &Args) -> Outcome {
    args.reject_unknown(&[
        "headers",
        "no-headers",
        "no_headers",
        "max-rows",
        "max_rows",
        "force",
        "width-scan-rows",
        "width_scan_rows",
        "delimiter",
        "shape",
        "plain",
        "sheet",
        "recompute",
        "quiet",
        "from",
    ])
    .map_err(|e| Fault::Usage(e.to_string()))?;

    if args.has("headers") && (args.has("no-headers") || args.has("no_headers")) {
        return Err(Fault::Usage("`--headers` and `--no-headers` contradict each other".into()));
    }
    let path = positional(args, 0, "a file to look at")?;

    let max_rows = match args.value("max-rows").or_else(|| args.value("max_rows")) {
        // 0 means every row, which is the request the caps guard against.
        Some("0") => None,
        Some(text) => Some(
            text.parse::<usize>()
                .map_err(|_| Fault::Usage(format!("`--max-rows {text}` is not a number")))?,
        ),
        None => Some(peek::DEFAULT_MAX_ROWS),
    };
    let scan = match args.value("width-scan-rows").or_else(|| args.value("width_scan_rows")) {
        Some(text) => text
            .parse::<usize>()
            .map_err(|_| Fault::Usage(format!("`--width-scan-rows {text}` is not a number")))?,
        None => peek::DEFAULT_WIDTH_SCAN,
    };
    let limits = Limits { max_rows, force: args.has("force") };

    let format = match args.value("from") {
        Some(named) => Format::parse(named)?,
        // Deliberately lenient, where `input::format_from_name` refuses: peek
        // shows a file, it does not transform one. Guessing wrong here costs
        // the user a glance at a badly split table, and they can say `--from`;
        // guessing wrong in `convert` or `diff` writes the mistake to disk.
        // The reference documents the extensions it knows and is silent on the
        // rest, so this is our choice rather than its rule.
        None => Format::from_extension(path).unwrap_or(Format::Csv),
    };

    let mut peeked = match format {
        Format::Xlsx => workbook_preview(args, path, limits)?,
        _ => {
            let headers = args.has("headers");
            peek::read_text(
                path,
                &crate::exit::read(path)?,
                format,
                headers,
                crate::input::delimiter(args)?,
                limits,
            )?
        }
    };

    // A workbook with several sheets and no `--sheet` shows the first one and
    // says so, rather than picking silently and letting someone conclude the
    // other sheets are empty.
    if peeked.sheets.len() > 1 && args.value("sheet").is_none() && !args.has("shape") {
        let names: Vec<&str> = peeked.sheets.iter().map(|s| s.name.as_str()).collect();
        note!(
            args,
            "peek: {} sheets found; showing {:?} (use --sheet to select: {})",
            names.len(),
            names[0],
            names.join(", ")
        );
        peeked.sheets.truncate(1);
    }

    // --shape and --plain both write to stdout and neither takes over the
    // terminal, so they are safe in a pipeline.
    if args.has("shape") {
        out_raw!("{}", peek::shape(&peeked));
        return ok();
    }
    out_raw!("{}", peek::plain(&peeked, scan, 40));
    if !args.has("plain") {
        // The interactive viewer is not built. Printing the table and saying
        // so beats either pretending or refusing: the caller still gets to
        // see the file.
        note!(args, "peek: the interactive viewer is not built; this is `--plain` output");
    }
    ok()
}

/// Loads a workbook, one `Preview` per sheet.
fn workbook_preview(args: &Args, path: &str, limits: Limits) -> Result<Peeked, Fault> {
    let engine = open(args, path)?;
    let wanted = args.value("sheet");
    let mut sheets = Vec::new();

    for (index, sheet) in engine.workbook().sheets().enumerate() {
        if let Some(wanted) = wanted {
            // A sheet may be named or numbered, and both spellings appear in
            // scripts.
            let by_name = sheet.name.eq_ignore_ascii_case(wanted);
            let by_index = wanted.parse::<usize>().is_ok_and(|n| n == index);
            if !by_name && !by_index {
                continue;
            }
        }
        let used = sheet.used_range();
        let (height, width) = used
            .as_ref()
            .map(|r| {
                ((r.end.row - r.start.row + 1) as usize, (r.end.col - r.start.col + 1) as usize)
            })
            .unwrap_or((0, 0));

        if limits.max_rows.is_none() && height * width > peek::CELL_CAP && !limits.force {
            return Err(Fault::Usage(format!(
                "sheet {:?} is {height} x {width}, above the {} cell limit; \
                 pass `--max-rows <n>` or `--force`",
                sheet.name,
                peek::CELL_CAP
            )));
        }

        let mut rows = Vec::new();
        if let Some(range) = used {
            let limit = limits.max_rows.unwrap_or(usize::MAX);
            for row in range.start.row..=range.end.row {
                if rows.len() >= limit {
                    break;
                }
                rows.push(
                    (range.start.col..=range.end.col)
                        .map(|col| sheet.value(col, row).to_string())
                        .collect(),
                );
            }
        }
        let truncated = rows.len() < height;
        sheets.push(Preview {
            name: sheet.name.clone(),
            table: Table { headers: None, rows },
            total_rows: height,
            truncated,
        });
    }

    if sheets.is_empty() {
        let available: Vec<&str> = engine.workbook().sheets().map(|s| s.name.as_str()).collect();
        return Err(Fault::Usage(format!(
            "no sheet matches {:?}; this workbook has {available:?}",
            wanted.unwrap_or("")
        )));
    }
    Ok(Peeked { path: path.to_string(), format: Format::Xlsx, sheets, delimiter: None })
}
