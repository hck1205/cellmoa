//! `diff` in its dataset form: reconcile two files by a key column.

use super::*;
use crate::recon::{self, Matching, Outcome as Row, Reconciliation, Settings, Status, Transform};
use crate::tabular::{Format, Table};

/// Reconciles two tables by key.
///
/// Shares its name with the workbook comparison, and is told apart by `--key`,
/// which this form requires and that one has no use for.
pub(super) fn reconcile(args: &Args) -> Outcome {
    args.reject_unknown(&[
        "key",
        "match",
        "key-transform",
        "key_transform",
        "compare",
        "tolerance",
        "on-duplicate",
        "on_duplicate",
        "on-ambiguous",
        "on_ambiguous",
        "save-ambiguous",
        "contains-column",
        "no-fail",
        "out",
        "output",
        "summary",
        "export",
        "export-side",
        "no-headers",
        "no_headers",
        "header-row",
        "header_row",
        "delimiter",
        "stdin-format",
        "strict-exit",
        "quiet",
        "from",
        "headers",
    ])
    .map_err(|e| Fault::Usage(e.to_string()))?;

    let key =
        args.value("key").ok_or_else(|| Fault::Usage("`--key <column>` is required".into()))?;
    let matching = match args.value("match") {
        Some(named) => Matching::parse(named)?,
        None => Matching::Exact,
    };
    let transform = match args.value("key-transform").or_else(|| args.value("key_transform")) {
        Some(named) => Transform::parse(named)?,
        None => Transform::Trim,
    };
    let tolerance = match args.value("tolerance") {
        Some(text) => text
            .parse::<f64>()
            .map_err(|_| Fault::Usage(format!("`--tolerance {text}` is not a number")))?,
        None => 0.0,
    };
    let contains_column = args.value("contains-column");
    if contains_column.is_some() && matching != Matching::Contains {
        return Err(Fault::Usage(
            "`--contains-column` only means something with `--match contains`".into(),
        ));
    }

    let (left, right) = read_sides(args)?;

    // Duplicate keys make the join ambiguous before any matching happens, so
    // they are caught first rather than showing up as a puzzling row count.
    // Contains mode expects several candidates on the right and routes them
    // through --on-ambiguous instead.
    let policy =
        args.value("on-duplicate").or_else(|| args.value("on_duplicate")).unwrap_or("error");
    if policy == "error" {
        for (side, table) in [("left", &left), ("right", &right)] {
            if side == "right" && matching == Matching::Contains {
                continue;
            }
            let repeated = recon::duplicate_keys(table, key, transform)?;
            if let Some(first) = repeated.first() {
                return Err(Fault::Io(format!(
                    "the {side} file has {} duplicate key(s), starting with {first:?}; \
                     a key that appears twice cannot be reconciled",
                    repeated.len()
                )));
            }
        }
    }

    let settings = Settings {
        key,
        matching,
        transform,
        compare: args.values("compare"),
        tolerance,
        contains_column,
    };
    let result = recon::reconcile(&left, &right, &settings)?;

    // Exports are written before any exit decision, so the files a caller
    // asked for exist even on the runs that fail. Chaining a second pass on
    // /tmp/unmatched.csv only works if the first pass wrote it.
    write_exports(args, &result, &left, &right)?;
    if let Some(path) = args.value("save-ambiguous") {
        save_ambiguous(path, &result, &right, &settings)?;
    }

    let text = match args.value("out").unwrap_or("json") {
        "json" => as_json_report(&result, &settings, args),
        "csv" => as_csv_report(&result)?,
        other => {
            return Err(Fault::Format(format!("`--out {other}` should be json or csv")));
        }
    };
    match args.value("output") {
        Some(path) => crate::exit::write(path, &text)?,
        None => out_raw!("{text}"),
    }

    match args.value("summary").unwrap_or("stderr") {
        "stderr" => note!(args, "{}", summary_line(&result)),
        "none" | "json" => {}
        other => {
            return Err(Fault::Usage(format!("`--summary {other}` should be stderr, json or none")))
        }
    }

    let ambiguous_policy =
        args.value("on-ambiguous").or_else(|| args.value("on_ambiguous")).unwrap_or("error");
    if result.summary.ambiguous > 0 && ambiguous_policy == "error" && !args.has("no-fail") {
        return Err(Fault::Parse(format!(
            "{} key(s) matched more than one row; pass `--on-ambiguous report` to keep going",
            result.summary.ambiguous
        )));
    }

    // --no-fail says: you ran, that is enough. Agents read the summary rather
    // than the exit code, and a non-zero exit reads to them as a crash.
    if args.has("no-fail") {
        return ok();
    }
    let material = if args.has("strict-exit") {
        // Unix `diff` semantics: any difference at all is a difference.
        result.summary.diff > 0
            || result.summary.only_left > 0
            || result.summary.only_right > 0
            || result.summary.ambiguous > 0
    } else {
        result.outcomes.iter().any(Row::is_material)
    };
    checked(!material)
}

/// Reads both sides, either of which may be `-` for stdin.
fn read_sides(args: &Args) -> Result<(Table, Table), Fault> {
    let left_path = positional(args, 0, "the left file")?;
    let right_path = positional(args, 1, "the right file")?;
    if left_path == "-" && right_path == "-" {
        return Err(Fault::Usage("only one side can be stdin".into()));
    }

    // A pipe carries no filename, so the format comes from the other side's
    // extension unless --stdin-format says otherwise.
    let inferred = |other: &str| {
        args.value("stdin-format").map(Format::parse).unwrap_or_else(|| {
            Format::from_extension(other).ok_or_else(|| {
                Fault::Usage(format!(
                    "cannot tell what format stdin is in; {other:?} does not say, \
                         so pass `--stdin-format`"
                ))
            })
        })
    };

    let read = |path: &str, other: &str| -> Result<Table, Fault> {
        if path == "-" {
            let format = inferred(other)?;
            use std::io::Read;
            let mut text = String::new();
            std::io::stdin()
                .read_to_string(&mut text)
                .map_err(|e| Fault::Io(format!("stdin: {e}")))?;
            return crate::tabular::read(&text, reading(args, format)?);
        }
        let format = match args.value("from") {
            Some(named) => Format::parse(named)?,
            None => Format::from_extension(path).ok_or_else(|| {
                Fault::Usage(format!(
                    "cannot tell the format of {path:?} from its name; pass `--from`"
                ))
            })?,
        };
        crate::tabular::read(&crate::exit::read(path)?, reading(args, format)?)
    };

    Ok((read(left_path, right_path)?, read(right_path, left_path)?))
}

/// Headers are on unless `--no-headers` turns them off — the opposite default
/// from `convert`, because reconciliation is by column name and a file with no
/// names is the unusual case here.
///
/// This returns a Result because `--delimiter` can be wrong, and it used to
/// swallow that: `diff --delimiter wat` ignored the flag and went on to report
/// a difference, while `convert --delimiter wat` said the delimiter was wrong.
/// One mistake answered two ways is worse than either answer.
fn reading(args: &Args, format: Format) -> Result<crate::tabular::Reading, Fault> {
    let headers = !(args.has("no-headers") || args.has("no_headers"));
    Ok(crate::tabular::Reading { format, headers, delimiter: crate::input::delimiter(args)? })
}

fn summary_line(result: &Reconciliation) -> String {
    let s = &result.summary;
    format!(
        "{} matched, {} only left, {} only right, {} diff ({} outside tolerance), {} ambiguous",
        s.matched, s.only_left, s.only_right, s.diff, s.diff_outside_tolerance, s.ambiguous
    )
}

fn as_json_report(result: &Reconciliation, settings: &Settings<'_>, args: &Args) -> String {
    let s = &result.summary;
    let mut summary = serde_json::json!({
        "left_rows": s.left_rows,
        "right_rows": s.right_rows,
        "matched": s.matched,
        "only_left": s.only_left,
        "only_right": s.only_right,
        "diff": s.diff,
        "diff_outside_tolerance": s.diff_outside_tolerance,
        "ambiguous": s.ambiguous,
        "tolerance": settings.tolerance,
        "key": settings.key,
        "match": settings.matching.name(),
        "key_transform": settings.transform.name(),
    });
    if args.value("summary") == Some("json") {
        summary["destination"] = serde_json::json!("json");
    }

    let results: Vec<serde_json::Value> = result
        .outcomes
        .iter()
        .map(|outcome| {
            let mut entry = serde_json::json!({
                "status": outcome.status.name(),
                "key": outcome.key,
            });
            if outcome.status == Status::Diff {
                entry["diffs"] = serde_json::Value::Array(
                    outcome
                        .diffs
                        .iter()
                        .map(|d| {
                            serde_json::json!({
                                "column": d.column,
                                "left": d.left,
                                "right": d.right,
                                "delta": d.delta,
                                "within_tolerance": d.within_tolerance,
                            })
                        })
                        .collect(),
                );
            } else if outcome.status == Status::Matched {
                entry["diffs"] = serde_json::Value::Null;
            }
            if outcome.status == Status::Ambiguous {
                entry["candidate_count"] = serde_json::json!(outcome.candidates.len());
            }
            entry
        })
        .collect();

    format!(
        "{}\n",
        serde_json::to_string_pretty(&serde_json::json!({
            "summary": summary,
            "results": results,
        }))
        .unwrap_or_default()
    )
}

fn as_csv_report(result: &Reconciliation) -> Result<String, Fault> {
    let mut table = Table {
        headers: Some(
            ["status", "key", "column", "left", "right", "delta", "within_tolerance"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
        rows: Vec::new(),
    };
    for outcome in &result.outcomes {
        if outcome.diffs.is_empty() {
            table.rows.push(vec![
                outcome.status.name().to_string(),
                outcome.key.clone(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
            ]);
            continue;
        }
        // One row per disagreeing column, so a spreadsheet can filter on it.
        for diff in &outcome.diffs {
            table.rows.push(vec![
                outcome.status.name().to_string(),
                outcome.key.clone(),
                diff.column.clone(),
                diff.left.clone(),
                diff.right.clone(),
                diff.delta.map(|d| d.to_string()).unwrap_or_default(),
                diff.within_tolerance.to_string(),
            ]);
        }
    }
    crate::tabular::write(&table, Format::Csv, None)
}

/// Writes `--export STATUS:PATH` files.
fn write_exports(
    args: &Args,
    result: &Reconciliation,
    left: &Table,
    right: &Table,
) -> Result<(), Fault> {
    let side = args.value("export-side").unwrap_or("left");
    if !matches!(side, "left" | "right" | "both") {
        return Err(Fault::Usage(format!("`--export-side {side}` should be left, right or both")));
    }
    for spec in args.values("export") {
        let (status, path) = spec
            .split_once(':')
            .ok_or_else(|| Fault::Usage(format!("`--export {spec}` should be STATUS:PATH")))?;
        let status = Status::parse(status.trim())?;
        let table = export_table(result, left, right, status, side);
        crate::exit::write(path.trim(), &crate::tabular::write(&table, Format::Csv, None)?)?;
    }
    Ok(())
}

fn export_table(
    result: &Reconciliation,
    left: &Table,
    right: &Table,
    status: Status,
    side: &str,
) -> Table {
    // only_left has no right-hand row and only_right has no left-hand one, so
    // for those the side is decided by what exists rather than by the flag.
    let effective = match status {
        Status::OnlyLeft => "left",
        Status::OnlyRight => "right",
        _ => side,
    };
    let chosen: Vec<&Row> = result.outcomes.iter().filter(|o| o.status == status).collect();

    match effective {
        "right" => Table {
            headers: right.headers.clone(),
            rows: chosen
                .iter()
                .filter_map(|o| o.right_row)
                .map(|index| right.rows[index].clone())
                .collect(),
        },
        "both" => {
            let mut headers = vec!["_status".to_string(), "_key".to_string()];
            headers.extend(left.headers.clone().unwrap_or_default());
            headers.extend(
                right.headers.clone().unwrap_or_default().iter().map(|h| format!("right_{h}")),
            );
            headers.push("_candidate_count".to_string());
            headers.push("_candidate_index".to_string());

            let width_left = left.headers.as_ref().map_or(0, Vec::len);
            let width_right = right.headers.as_ref().map_or(0, Vec::len);
            let mut rows = Vec::new();
            for outcome in &chosen {
                // An ambiguous key becomes one row per candidate, so every
                // possibility is on the page for whoever reviews it.
                let candidates: Vec<Option<usize>> = if outcome.candidates.is_empty() {
                    vec![outcome.right_row]
                } else {
                    outcome.candidates.iter().map(|i| Some(*i)).collect()
                };
                for (position, candidate) in candidates.iter().enumerate() {
                    let mut row = vec![outcome.status.name().to_string(), outcome.key.clone()];
                    row.extend(pad(outcome.left_row.map(|i| &left.rows[i]), width_left));
                    row.extend(pad(candidate.map(|i| &right.rows[i]), width_right));
                    row.push(candidates.len().to_string());
                    row.push(position.to_string());
                    rows.push(row);
                }
            }
            Table { headers: Some(headers), rows }
        }
        _ => Table {
            headers: left.headers.clone(),
            rows: chosen
                .iter()
                .filter_map(|o| o.left_row)
                .map(|index| left.rows[index].clone())
                .collect(),
        },
    }
}

/// A row padded to the full width, so a short row does not shift the columns
/// after it.
fn pad(row: Option<&Vec<String>>, width: usize) -> Vec<String> {
    let mut out = row.cloned().unwrap_or_default();
    out.resize(width, String::new());
    out
}

fn save_ambiguous(
    path: &str,
    result: &Reconciliation,
    right: &Table,
    settings: &Settings<'_>,
) -> Result<(), Fault> {
    let key_column = right
        .headers
        .as_ref()
        .and_then(|headers| crate::reshape::resolve(headers, settings.key).ok())
        .unwrap_or(0);
    let mut table = Table {
        headers: Some(
            ["left_key", "candidate_count", "candidate_keys"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
        rows: Vec::new(),
    };
    for outcome in result.outcomes.iter().filter(|o| o.status == Status::Ambiguous) {
        let keys: Vec<String> = outcome
            .candidates
            .iter()
            .map(|index| right.rows[*index].get(key_column).cloned().unwrap_or_default())
            .collect();
        table.rows.push(vec![outcome.key.clone(), keys.len().to_string(), keys.join("|")]);
    }
    crate::exit::write(path, &crate::tabular::write(&table, Format::Csv, None)?)
}
