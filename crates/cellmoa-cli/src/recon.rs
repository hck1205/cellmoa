//! Reconciling two tables by a key column.
//!
//! This answers the question a finance team asks of two exports: which rows
//! are on both sides, which are only on one, and where the two disagree about
//! a number. It is a join, and the interesting parts are all in what counts as
//! the same key and what counts as the same value.
//!
//! Two decisions shape everything else:
//!
//! - A difference inside `--tolerance` is reported but is not *material*. A
//!   penny of rounding between a ledger and a warehouse is not a discrepancy,
//!   and a build that fails on it teaches people to ignore the build.
//! - A key that matches more than one row on the other side is never resolved
//!   by picking one. Picking would produce a reconciliation that balances and
//!   is wrong, which is worse than one that stops and says why.

use crate::exit::Fault;
use crate::reshape::{listed, number, resolve};
use crate::tabular::Table;

/// How a left key is matched against the right side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Matching {
    /// The keys are equal after transformation.
    Exact,
    /// The left key appears somewhere inside the right side's search text.
    /// Used when one system writes `INV-1001` and the other writes
    /// `Payment for invoice INV-1001, thanks`.
    Contains,
}

impl Matching {
    pub fn parse(name: &str) -> Result<Matching, Fault> {
        match name {
            "exact" => Ok(Matching::Exact),
            "contains" => Ok(Matching::Contains),
            other => Err(Fault::Usage(format!("`--match {other}` should be exact or contains"))),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Matching::Exact => "exact",
            Matching::Contains => "contains",
        }
    }
}

/// What to do to a key before comparing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transform {
    None,
    Trim,
    /// Only the ASCII digits, so `Order #100154` and `100154` are one key.
    Digits,
    /// Only the ASCII letters and digits, uppercased, so `Order #O2025-X`
    /// becomes `ORDERO2025X`. The best default when two systems disagree
    /// about punctuation but agree about the identifier.
    Alnum,
}

impl Transform {
    pub fn parse(name: &str) -> Result<Transform, Fault> {
        match name {
            "none" => Ok(Transform::None),
            "trim" => Ok(Transform::Trim),
            "digits" => Ok(Transform::Digits),
            "alnum" => Ok(Transform::Alnum),
            other => Err(Fault::Usage(format!(
                "`--key-transform {other}` should be none, trim, digits or alnum"
            ))),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Transform::None => "none",
            Transform::Trim => "trim",
            Transform::Digits => "digits",
            Transform::Alnum => "alnum",
        }
    }

    pub fn apply(self, key: &str) -> String {
        match self {
            Transform::None => key.to_string(),
            Transform::Trim => key.trim().to_string(),
            Transform::Digits => key.chars().filter(char::is_ascii_digit).collect(),
            Transform::Alnum => {
                key.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase()
            }
        }
    }
}

/// What became of one key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Matched,
    Diff,
    OnlyLeft,
    OnlyRight,
    Ambiguous,
}

impl Status {
    pub fn name(self) -> &'static str {
        match self {
            Status::Matched => "matched",
            Status::Diff => "diff",
            Status::OnlyLeft => "only_left",
            Status::OnlyRight => "only_right",
            Status::Ambiguous => "ambiguous",
        }
    }

    pub fn parse(name: &str) -> Result<Status, Fault> {
        match name {
            "matched" => Ok(Status::Matched),
            "diff" => Ok(Status::Diff),
            "only_left" => Ok(Status::OnlyLeft),
            "only_right" => Ok(Status::OnlyRight),
            "ambiguous" => Ok(Status::Ambiguous),
            other => Err(Fault::Usage(format!(
                "`{other}` is not a status; use only_left, only_right, matched, diff or ambiguous"
            ))),
        }
    }
}

/// One column where two matched rows disagree.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnDiff {
    pub column: String,
    pub left: String,
    pub right: String,
    /// The numeric gap, when both sides are numbers. `None` when the
    /// disagreement is textual, where subtraction has no meaning.
    pub delta: Option<f64>,
    pub within_tolerance: bool,
}

/// One key's outcome, with enough back-references to export the rows.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub status: Status,
    pub key: String,
    pub diffs: Vec<ColumnDiff>,
    pub left_row: Option<usize>,
    pub right_row: Option<usize>,
    /// Every right-hand row a `contains` match found, when there was more
    /// than one.
    pub candidates: Vec<usize>,
}

impl Outcome {
    /// True when this outcome should fail a build: a row missing from one
    /// side, or a disagreement wider than the tolerance allows.
    pub fn is_material(&self) -> bool {
        match self.status {
            Status::OnlyLeft | Status::OnlyRight | Status::Ambiguous => true,
            Status::Diff => self.diffs.iter().any(|d| !d.within_tolerance),
            Status::Matched => false,
        }
    }
}

/// The counts a caller reads instead of the exit code.
#[derive(Debug, Clone, Default)]
pub struct Summary {
    pub left_rows: usize,
    pub right_rows: usize,
    pub matched: usize,
    pub only_left: usize,
    pub only_right: usize,
    pub diff: usize,
    pub diff_outside_tolerance: usize,
    pub ambiguous: usize,
}

/// Everything the caller asked for.
#[derive(Debug, Clone)]
pub struct Settings<'a> {
    pub key: &'a str,
    pub matching: Matching,
    pub transform: Transform,
    /// Columns to compare. Empty means every column except the key.
    pub compare: Vec<&'a str>,
    pub tolerance: f64,
    /// Right-hand column searched in `contains` mode. `None` means the key
    /// column itself.
    pub contains_column: Option<&'a str>,
}

#[derive(Debug)]
pub struct Reconciliation {
    pub outcomes: Vec<Outcome>,
    pub summary: Summary,
}

/// Resolves a column named by header, by letter, or by 1-indexed position.
///
/// Three spellings because three things produce them: a person types the
/// header, a spreadsheet user thinks in letters, and a script counts columns.
fn column(table: &Table, wanted: &str) -> Result<usize, Fault> {
    if let Some(headers) = table.headers.as_ref() {
        if let Ok(index) = resolve(headers, wanted) {
            return Ok(index);
        }
    }
    // A bare number is 1-indexed, the way a person counts columns.
    if let Ok(position) = wanted.trim().parse::<usize>() {
        if position >= 1 {
            return Ok(position - 1);
        }
    }
    let letters = wanted.trim();
    if !letters.is_empty() && letters.chars().all(|c| c.is_ascii_alphabetic()) {
        if let Some(reference) = cellmoa_core::reference::CellRef::parse_a1(&format!("{letters}1"))
        {
            return Ok(reference.col as usize);
        }
    }
    match table.headers.as_ref() {
        Some(headers) => Err(Fault::Usage(format!(
            "no column called {wanted:?}; this file has {}",
            listed(headers)
        ))),
        None => Err(Fault::Usage(format!(
            "{wanted:?} is not a column letter or number, and there are no headers to name"
        ))),
    }
}

fn cell(row: &[String], index: usize) -> &str {
    row.get(index).map(String::as_str).unwrap_or("")
}

/// Compares two tables by key.
pub fn reconcile(
    left: &Table,
    right: &Table,
    settings: &Settings<'_>,
) -> Result<Reconciliation, Fault> {
    let left_key = column(left, settings.key)?;
    let right_key = column(right, settings.key)?;
    let search_column = match settings.contains_column {
        Some(named) => column(right, named)?,
        None => right_key,
    };

    let compared = compared_columns(left, right, settings, left_key)?;
    let mut outcomes = Vec::new();
    let mut used_right = vec![false; right.rows.len()];

    for (index, row) in left.rows.iter().enumerate() {
        let key = settings.transform.apply(cell(row, left_key));
        let found = find(right, settings, right_key, search_column, &key, &mut used_right);
        match found.as_slice() {
            [] => outcomes.push(Outcome {
                status: Status::OnlyLeft,
                key,
                diffs: Vec::new(),
                left_row: Some(index),
                right_row: None,
                candidates: Vec::new(),
            }),
            [only] => {
                used_right[*only] = true;
                let diffs = compare(left, right, index, *only, &compared, settings.tolerance)?;
                outcomes.push(Outcome {
                    status: if diffs.is_empty() { Status::Matched } else { Status::Diff },
                    key,
                    diffs,
                    left_row: Some(index),
                    right_row: Some(*only),
                    candidates: Vec::new(),
                });
            }
            many => outcomes.push(Outcome {
                status: Status::Ambiguous,
                key,
                diffs: Vec::new(),
                left_row: Some(index),
                right_row: None,
                candidates: many.to_vec(),
            }),
        }
    }

    // Whatever nothing on the left claimed is only on the right.
    for (index, row) in right.rows.iter().enumerate() {
        if used_right[index] {
            continue;
        }
        outcomes.push(Outcome {
            status: Status::OnlyRight,
            key: settings.transform.apply(cell(row, right_key)),
            diffs: Vec::new(),
            left_row: None,
            right_row: Some(index),
            candidates: Vec::new(),
        });
    }

    let mut summary =
        Summary { left_rows: left.rows.len(), right_rows: right.rows.len(), ..Summary::default() };
    for outcome in &outcomes {
        match outcome.status {
            Status::Matched => summary.matched += 1,
            Status::Diff => {
                summary.matched += 1;
                summary.diff += 1;
                if outcome.diffs.iter().any(|d| !d.within_tolerance) {
                    summary.diff_outside_tolerance += 1;
                }
            }
            Status::OnlyLeft => summary.only_left += 1,
            Status::OnlyRight => summary.only_right += 1,
            Status::Ambiguous => summary.ambiguous += 1,
        }
    }
    Ok(Reconciliation { outcomes, summary })
}

/// The right-hand rows a left key matches.
fn find(
    right: &Table,
    settings: &Settings<'_>,
    right_key: usize,
    search_column: usize,
    key: &str,
    used: &mut [bool],
) -> Vec<usize> {
    match settings.matching {
        Matching::Exact => right
            .rows
            .iter()
            .enumerate()
            .filter(|(index, row)| {
                !used[*index] && settings.transform.apply(cell(row, right_key)) == key
            })
            .map(|(index, _)| index)
            .collect(),
        // Substring matching naturally produces several candidates, so this
        // does not stop at the first: the caller decides what to do with more
        // than one.
        Matching::Contains => {
            if key.is_empty() {
                // An empty key is inside every string. Matching everything is
                // never what was meant.
                return Vec::new();
            }
            let needle = key.to_lowercase();
            right
                .rows
                .iter()
                .enumerate()
                .filter(|(index, row)| {
                    !used[*index]
                        && settings
                            .transform
                            .apply(cell(row, search_column))
                            .to_lowercase()
                            .contains(&needle)
                })
                .map(|(index, _)| index)
                .collect()
        }
    }
}

/// The columns to compare: those named, or every column but the key.
fn compared_columns(
    left: &Table,
    right: &Table,
    settings: &Settings<'_>,
    left_key: usize,
) -> Result<Vec<String>, Fault> {
    let Some(headers) = left.headers.as_ref() else {
        // Without headers there is nothing to name, so every column but the
        // key is compared by position.
        let width = left.rows.iter().map(Vec::len).max().unwrap_or(0);
        return Ok((0..width)
            .filter(|index| *index != left_key)
            .map(|index| format!("{}", index + 1))
            .collect());
    };

    if settings.compare.is_empty() {
        return Ok(headers
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != left_key)
            .map(|(_, name)| name.clone())
            .collect());
    }

    let mut named = Vec::new();
    for wanted in settings.compare.iter().flat_map(|c| c.split(',')) {
        let wanted = wanted.trim();
        if wanted.is_empty() {
            continue;
        }
        let index = column(left, wanted)?;
        // Refusing here rather than comparing by position is deliberate: a
        // silent fallback would compare `Amount` against whatever the right
        // file happens to have in that slot.
        column(right, wanted).map_err(|_| {
            Fault::Usage(format!(
                "`--compare {wanted}` names a column the right file does not have; it has {}",
                right.headers.as_ref().map(|h| listed(h)).unwrap_or_else(|| "no headers".into())
            ))
        })?;
        named.push(headers[index].clone());
    }
    Ok(named)
}

/// Compares one matched pair across the compared columns.
fn compare(
    left: &Table,
    right: &Table,
    left_row: usize,
    right_row: usize,
    compared: &[String],
    tolerance: f64,
) -> Result<Vec<ColumnDiff>, Fault> {
    let mut diffs = Vec::new();
    for name in compared {
        let left_index = column(left, name)?;
        let right_index = column(right, name)?;
        let before = cell(&left.rows[left_row], left_index);
        let after = cell(&right.rows[right_row], right_index);

        match (number(before), number(after)) {
            (Some(a), Some(b)) => {
                let delta = b - a;
                if delta != 0.0 {
                    diffs.push(ColumnDiff {
                        column: name.clone(),
                        left: before.to_string(),
                        right: after.to_string(),
                        delta: Some(delta),
                        within_tolerance: delta.abs() <= tolerance,
                    });
                }
            }
            _ => {
                if before != after {
                    diffs.push(ColumnDiff {
                        column: name.clone(),
                        left: before.to_string(),
                        right: after.to_string(),
                        // Text has no distance, so a tolerance cannot excuse
                        // it. Calling a textual difference "within tolerance"
                        // would hide a changed name behind a numeric setting.
                        delta: None,
                        within_tolerance: false,
                    });
                }
            }
        }
    }
    Ok(diffs)
}

/// Keys appearing more than once on one side, which make a join ambiguous
/// before any matching happens.
pub fn duplicate_keys(
    table: &Table,
    key: &str,
    transform: Transform,
) -> Result<Vec<String>, Fault> {
    let index = column(table, key)?;
    let mut seen: Vec<(String, usize)> = Vec::new();
    for row in &table.rows {
        let value = transform.apply(cell(row, index));
        match seen.iter_mut().find(|(k, _)| *k == value) {
            Some((_, count)) => *count += 1,
            None => seen.push((value, 1)),
        }
    }
    Ok(seen.into_iter().filter(|(_, count)| *count > 1).map(|(key, _)| key).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(headers: &[&str], rows: &[&[&str]]) -> Table {
        Table {
            headers: Some(headers.iter().map(|h| h.to_string()).collect()),
            rows: rows.iter().map(|r| r.iter().map(|c| c.to_string()).collect()).collect(),
        }
    }

    fn settings(key: &str) -> Settings<'_> {
        Settings {
            key,
            matching: Matching::Exact,
            transform: Transform::Trim,
            compare: Vec::new(),
            tolerance: 0.0,
            contains_column: None,
        }
    }

    fn run(left: &Table, right: &Table, settings: &Settings<'_>) -> Reconciliation {
        reconcile(left, right, settings).unwrap()
    }

    fn statuses(r: &Reconciliation) -> Vec<(&'static str, String)> {
        r.outcomes.iter().map(|o| (o.status.name(), o.key.clone())).collect()
    }

    #[test]
    fn rows_on_both_sides_with_the_same_values_match() {
        let left = table(&["id", "amount"], &[&["a", "1"], &["b", "2"]]);
        let right = table(&["id", "amount"], &[&["a", "1"], &["b", "2"]]);
        let result = run(&left, &right, &settings("id"));
        assert_eq!(result.summary.matched, 2);
        assert_eq!(result.summary.diff, 0);
        assert!(!result.outcomes.iter().any(Outcome::is_material));
    }

    #[test]
    fn a_row_missing_from_each_side_is_reported_on_the_side_it_is_missing_from() {
        let left = table(&["id"], &[&["a"], &["b"]]);
        let right = table(&["id"], &[&["b"], &["c"]]);
        let result = run(&left, &right, &settings("id"));
        assert_eq!(result.summary.only_left, 1);
        assert_eq!(result.summary.only_right, 1);
        assert!(statuses(&result).contains(&("only_left", "a".to_string())));
        assert!(statuses(&result).contains(&("only_right", "c".to_string())));
    }

    #[test]
    fn a_differing_value_is_a_diff_with_the_gap() {
        let left = table(&["id", "amount"], &[&["a", "1200"]]);
        let right = table(&["id", "amount"], &[&["a", "1350"]]);
        let result = run(&left, &right, &settings("id"));
        let diff = &result.outcomes[0].diffs[0];
        assert_eq!(diff.column, "amount");
        assert_eq!(diff.delta, Some(150.0));
        assert!(!diff.within_tolerance);
        assert_eq!(result.summary.diff_outside_tolerance, 1);
    }

    #[test]
    fn a_difference_inside_the_tolerance_is_reported_but_not_material() {
        // This is the whole point of --tolerance: a penny of rounding is
        // recorded so someone can look, and does not fail the build.
        let left = table(&["id", "amount"], &[&["a", "100.00"]]);
        let right = table(&["id", "amount"], &[&["a", "100.005"]]);
        let mut s = settings("id");
        s.tolerance = 0.01;
        let result = run(&left, &right, &s);
        assert_eq!(result.summary.diff, 1);
        assert_eq!(result.summary.diff_outside_tolerance, 0);
        assert!(result.outcomes[0].diffs[0].within_tolerance);
        assert!(!result.outcomes[0].is_material());
    }

    #[test]
    fn a_tolerance_cannot_excuse_a_textual_difference() {
        // A changed vendor name is not "within 0.01"; text has no distance.
        let left = table(&["id", "vendor"], &[&["a", "Acme"]]);
        let right = table(&["id", "vendor"], &[&["a", "Acme Inc"]]);
        let mut s = settings("id");
        s.tolerance = 1000.0;
        let result = run(&left, &right, &s);
        assert_eq!(result.outcomes[0].diffs[0].delta, None);
        assert!(!result.outcomes[0].diffs[0].within_tolerance);
        assert!(result.outcomes[0].is_material());
    }

    #[test]
    fn money_punctuation_is_read_as_a_number_on_both_sides() {
        let left = table(&["id", "amount"], &[&["a", "$1,200.00"]]);
        let right = table(&["id", "amount"], &[&["a", "1200"]]);
        let result = run(&left, &right, &settings("id"));
        assert_eq!(result.summary.diff, 0, "these are the same amount written twice");
    }

    #[test]
    fn a_parenthesised_negative_matches_a_signed_one() {
        let left = table(&["id", "amount"], &[&["a", "(500)"]]);
        let right = table(&["id", "amount"], &[&["a", "-500"]]);
        assert_eq!(run(&left, &right, &settings("id")).summary.diff, 0);
    }

    #[test]
    fn compare_narrows_which_columns_matter() {
        let left = table(&["id", "amount", "note"], &[&["a", "1", "before"]]);
        let right = table(&["id", "amount", "note"], &[&["a", "1", "after"]]);
        let mut s = settings("id");
        s.compare = vec!["amount"];
        assert_eq!(run(&left, &right, &s).summary.diff, 0, "note was not asked about");
        let s = settings("id");
        assert_eq!(run(&left, &right, &s).summary.diff, 1, "by default every column counts");
    }

    #[test]
    fn compare_refuses_a_column_the_right_file_does_not_have() {
        // Falling back to position would compare `amount` against whatever
        // happens to sit in that slot, and report a difference that is an
        // artefact of the fallback.
        let left = table(&["id", "amount"], &[&["a", "1"]]);
        let right = table(&["id", "total"], &[&["a", "1"]]);
        let mut s = settings("id");
        s.compare = vec!["amount"];
        let fault = reconcile(&left, &right, &s).unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("total"), "{fault}");
    }

    #[test]
    fn the_key_may_be_named_by_letter_or_by_position() {
        let left = table(&["id", "amount"], &[&["a", "1"]]);
        let right = table(&["id", "amount"], &[&["a", "2"]]);
        for spelling in ["id", "A", "1"] {
            let result = run(&left, &right, &settings(spelling));
            assert_eq!(result.summary.diff, 1, "key spelled {spelling}");
        }
    }

    #[test]
    fn the_digits_transform_ignores_the_decoration_around_an_id() {
        let left = table(&["id"], &[&["Order #100154"]]);
        let right = table(&["id"], &[&["100154"]]);
        let mut s = settings("id");
        assert_eq!(run(&left, &right, &s).summary.only_left, 1, "as written they differ");
        s.transform = Transform::Digits;
        assert_eq!(run(&left, &right, &s).summary.matched, 1);
    }

    #[test]
    fn the_alnum_transform_keeps_letters_and_drops_punctuation() {
        assert_eq!(Transform::Alnum.apply("Order #O2025-X"), "ORDERO2025X");
        assert_eq!(Transform::Digits.apply("Order #100154"), "100154");
        assert_eq!(Transform::Trim.apply("  INV-123  "), "INV-123");
        assert_eq!(Transform::None.apply("  x  "), "  x  ");
    }

    #[test]
    fn contains_matches_a_key_inside_the_other_sides_text() {
        let left = table(&["Invoice"], &[&["INV-1001"]]);
        let right = table(&["Invoice"], &[&["Payment for INV-1001, thanks"]]);
        let mut s = settings("Invoice");
        assert_eq!(run(&left, &right, &s).summary.only_left, 1, "not equal as written");
        s.matching = Matching::Contains;
        assert_eq!(run(&left, &right, &s).summary.matched, 1);
    }

    #[test]
    fn contains_can_search_a_different_column() {
        let left = table(&["Invoice"], &[&["INV-1001"]]);
        let right = table(&["Invoice", "description"], &[&["x", "for INV-1001"]]);
        let mut s = settings("Invoice");
        s.matching = Matching::Contains;
        s.contains_column = Some("description");
        assert_eq!(run(&left, &right, &s).summary.matched, 1);
    }

    #[test]
    fn a_key_matching_several_rows_is_ambiguous_rather_than_resolved() {
        // Picking one would balance the reconciliation and be wrong.
        let left = table(&["id"], &[&["12"]]);
        let right = table(&["id"], &[&["100154612"], &["100154312"]]);
        let mut s = settings("id");
        s.matching = Matching::Contains;
        let result = run(&left, &right, &s);
        assert_eq!(result.summary.ambiguous, 1);
        assert_eq!(result.outcomes[0].candidates.len(), 2);
        assert!(result.outcomes[0].is_material());
    }

    #[test]
    fn an_empty_key_does_not_match_every_row_in_contains_mode() {
        let left = table(&["id"], &[&[""]]);
        let right = table(&["id"], &[&["a"], &["b"]]);
        let mut s = settings("id");
        s.matching = Matching::Contains;
        assert_eq!(run(&left, &right, &s).summary.only_left, 1);
    }

    #[test]
    fn a_right_row_is_claimed_once_so_two_left_rows_do_not_share_it() {
        let left = table(&["id"], &[&["a"], &["a"]]);
        let right = table(&["id"], &[&["a"]]);
        let result = run(&left, &right, &settings("id"));
        assert_eq!(result.summary.matched, 1);
        assert_eq!(result.summary.only_left, 1, "the second `a` has nothing left to match");
    }

    #[test]
    fn duplicate_keys_are_found_before_matching_starts() {
        let t = table(&["id"], &[&["a"], &["a"], &["b"]]);
        assert_eq!(duplicate_keys(&t, "id", Transform::Trim).unwrap(), vec!["a"]);
        let clean = table(&["id"], &[&["a"], &["b"]]);
        assert!(duplicate_keys(&clean, "id", Transform::Trim).unwrap().is_empty());
    }

    #[test]
    fn an_unknown_key_column_names_the_ones_that_exist() {
        let left = table(&["id"], &[&["a"]]);
        let right = table(&["id"], &[&["a"]]);
        let fault = reconcile(&left, &right, &settings("nope")).unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("\"id\""), "{fault}");
    }

    #[test]
    fn without_headers_columns_are_compared_by_position() {
        let left = Table { headers: None, rows: vec![vec!["a".into(), "1".into()]] };
        let right = Table { headers: None, rows: vec![vec!["a".into(), "2".into()]] };
        let result = run(&left, &right, &settings("1"));
        assert_eq!(result.summary.diff, 1);
        assert_eq!(result.outcomes[0].diffs[0].column, "2", "the second column, by number");
    }
}
