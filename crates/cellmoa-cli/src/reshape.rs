//! Renaming, filtering and projecting a table by column name.
//!
//! These three run in a fixed order — rename, then filter, then select —
//! because the order decides what a name means. Renaming first is what lets
//! `--where` and `--select` use the new names, which is the only order that
//! reads the way the command line does.
//!
//! Every name here is matched case-insensitively and after trimming, because
//! a header exported as `" Status "` is the same column as `Status` to
//! everyone except a string comparison. Two columns that collide under that
//! rule are refused rather than silently resolved: picking one would give a
//! wrong answer that looks like a right one.

use crate::exit::Fault;
use crate::tabular::Table;

/// A column named on the command line, resolved against real headers.
pub fn resolve(headers: &[String], wanted: &str) -> Result<usize, Fault> {
    let wanted = wanted.trim();
    let matches: Vec<usize> = headers
        .iter()
        .enumerate()
        .filter(|(_, header)| header.trim().eq_ignore_ascii_case(wanted))
        .map(|(index, _)| index)
        .collect();

    match matches.as_slice() {
        [only] => Ok(*only),
        [] => Err(Fault::Usage(format!(
            "no column called {wanted:?}; this file has {}",
            listed(headers)
        ))),
        many => Err(Fault::Usage(format!(
            "{wanted:?} matches {} columns ({}); rename one so the choice is not a guess",
            many.len(),
            many.iter().map(|i| format!("{:?}", headers[*i])).collect::<Vec<_>>().join(", ")
        ))),
    }
}

pub fn listed(headers: &[String]) -> String {
    if headers.is_empty() {
        return "no columns".to_string();
    }
    headers.iter().map(|h| format!("{:?}", h.trim())).collect::<Vec<_>>().join(", ")
}

/// Applies `OLD:NEW` pairs to the header row.
pub fn rename(table: &mut Table, pairs: &[&str]) -> Result<(), Fault> {
    if pairs.is_empty() {
        return Ok(());
    }
    let Some(headers) = table.headers.as_mut() else {
        return Err(Fault::Usage("`--rename` needs `--headers` to know the column names".into()));
    };
    // Resolved against the headers as they were, so that renaming A to B and
    // B to C does not turn A into C.
    let original = headers.clone();
    for pair in pairs.iter().flat_map(|pair| pair.split(',')) {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let (old, new) = pair
            .split_once(':')
            .ok_or_else(|| Fault::Usage(format!("`--rename {pair}` should be OLD:NEW")))?;
        let index = resolve(&original, old)?;
        headers[index] = new.trim().to_string();
    }
    Ok(())
}

/// Keeps the named columns, in the order named.
pub fn select(table: &mut Table, wanted: &[&str]) -> Result<(), Fault> {
    if wanted.is_empty() {
        return Ok(());
    }
    let Some(headers) = table.headers.as_ref() else {
        return Err(Fault::Usage("`--select` needs `--headers` to know the column names".into()));
    };
    let names: Vec<&str> =
        wanted.iter().flat_map(|w| w.split(',')).map(str::trim).filter(|n| !n.is_empty()).collect();

    let mut indices = Vec::new();
    for name in &names {
        let index = resolve(headers, name)?;
        if indices.contains(&index) {
            // Asking for the same column twice is a mistake with two possible
            // fixes; guessing which would produce a file the caller did not
            // ask for.
            return Err(Fault::Usage(format!("`--select` names {name:?} more than once")));
        }
        indices.push(index);
    }

    table.headers = Some(indices.iter().map(|i| headers[*i].clone()).collect());
    for row in &mut table.rows {
        *row = indices.iter().map(|i| row.get(*i).cloned().unwrap_or_default()).collect();
    }
    Ok(())
}

/// What a `--where` clause compares with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Compare {
    Equal,
    NotEqual,
    Less,
    Greater,
    Contains,
}

/// One parsed `--where` clause.
#[derive(Debug, Clone)]
pub struct Filter {
    column: String,
    compare: Compare,
    wanted: String,
}

impl Filter {
    /// Reads `col=value`, `col!=value`, `col<n`, `col>n`, `col~text`.
    ///
    /// `!=` is looked for before `=`, since `a!=b` contains both and the
    /// longer operator is the one that was meant.
    pub fn parse(clause: &str) -> Result<Filter, Fault> {
        const OPERATORS: &[(&str, Compare)] = &[
            ("!=", Compare::NotEqual),
            ("=", Compare::Equal),
            ("<", Compare::Less),
            (">", Compare::Greater),
            ("~", Compare::Contains),
        ];
        for (token, compare) in OPERATORS {
            if let Some((column, wanted)) = clause.split_once(token) {
                if column.trim().is_empty() {
                    break;
                }
                return Ok(Filter {
                    column: column.trim().to_string(),
                    compare: *compare,
                    wanted: unquote(wanted.trim()),
                });
            }
        }
        Err(Fault::Usage(format!(
            "`--where {clause}` should be col=value, col!=value, col<number, \
             col>number or col~text (>= and <= are not supported; negate the opposite)"
        )))
    }

    /// True when `cell` satisfies the clause. `numeric_miss` is set when a
    /// numeric comparison met something that is not a number, so the caller
    /// can report how many rows that cost.
    fn matches(&self, cell: &str, numeric_miss: &mut bool) -> bool {
        match self.compare {
            Compare::Contains => cell.to_lowercase().contains(&self.wanted.to_lowercase()),
            Compare::Less | Compare::Greater => {
                let (Some(left), Some(right)) = (number(cell), number(&self.wanted)) else {
                    *numeric_miss = true;
                    return false;
                };
                if self.compare == Compare::Less {
                    left < right
                } else {
                    left > right
                }
            }
            // Typed: a right-hand side that reads as a number compares as one,
            // so `Amount=0` is arithmetic and `Status=Pending` is text, with
            // no extra syntax to remember.
            Compare::Equal | Compare::NotEqual => {
                let equal = match number(&self.wanted) {
                    Some(right) => match number(cell) {
                        Some(left) => left == right,
                        None => {
                            *numeric_miss = true;
                            false
                        }
                    },
                    None => cell.trim().eq_ignore_ascii_case(self.wanted.trim()),
                };
                if self.compare == Compare::Equal {
                    equal
                } else {
                    // A cell that is not a number never satisfies `!=` against
                    // a number either: it is not "different", it is unknown,
                    // and counting it as a match would quietly widen the
                    // result.
                    !equal && !(*numeric_miss)
                }
            }
        }
    }
}

/// Strips a surrounding pair of quotes, so a value with spaces survives the
/// shell without the quotes becoming part of the text.
fn unquote(text: &str) -> String {
    let bytes = text.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0] as char;
        let last = bytes[bytes.len() - 1] as char;
        if (first == '"' || first == '\'') && first == last {
            return text[1..text.len() - 1].to_string();
        }
    }
    text.to_string()
}

/// Reads a number, forgiving the punctuation money is written with: `$1,200.00`
/// is 1200, and `(500)` is -500 as it is on a statement.
pub fn number(text: &str) -> Option<f64> {
    let text = text.trim();
    let (text, negated) = match text.strip_prefix('(').and_then(|t| t.strip_suffix(')')) {
        Some(inner) => (inner, true),
        None => (text, false),
    };
    let cleaned: String = text.chars().filter(|c| *c != '$' && *c != ',').collect();
    if cleaned.is_empty() {
        return None;
    }
    let value: f64 = cleaned.trim().parse().ok()?;
    Some(if negated { -value } else { value })
}

/// How a filter pass went: the rows kept, and what it had to skip.
#[derive(Debug)]
pub struct Filtered {
    /// Columns a numeric comparison met a non-number in, and how many rows
    /// that happened on. Reported so a surprising row count has a reason.
    pub skipped: Vec<(String, usize)>,
}

/// Keeps the rows matching every filter. Several filters are an AND.
pub fn filter(table: &mut Table, filters: &[Filter]) -> Result<Filtered, Fault> {
    if filters.is_empty() {
        return Ok(Filtered { skipped: Vec::new() });
    }
    let Some(headers) = table.headers.as_ref() else {
        return Err(Fault::Usage("`--where` needs `--headers` to know the column names".into()));
    };

    let resolved: Vec<(usize, &Filter)> = filters
        .iter()
        .map(|f| resolve(headers, &f.column).map(|index| (index, f)))
        .collect::<Result<_, _>>()?;

    let mut skipped: Vec<(String, usize)> = Vec::new();
    let mut kept = Vec::with_capacity(table.rows.len());
    for row in std::mem::take(&mut table.rows) {
        let mut keep = true;
        for (index, filter) in &resolved {
            let cell = row.get(*index).map(String::as_str).unwrap_or("");
            let mut numeric_miss = false;
            let matched = filter.matches(cell, &mut numeric_miss);
            if numeric_miss {
                match skipped.iter_mut().find(|(name, _)| *name == filter.column) {
                    Some((_, count)) => *count += 1,
                    None => skipped.push((filter.column.clone(), 1)),
                }
            }
            if !matched {
                keep = false;
                break;
            }
        }
        if keep {
            kept.push(row);
        }
    }
    table.rows = kept;
    Ok(Filtered { skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(headers: &[&str], rows: &[&[&str]]) -> Table {
        let mut table = Table::headed(headers);
        for row in rows {
            table.push(row.iter().copied());
        }
        table
    }

    fn keep(mut t: Table, clauses: &[&str]) -> Vec<Vec<String>> {
        let filters: Vec<Filter> = clauses.iter().map(|c| Filter::parse(c).unwrap()).collect();
        filter(&mut t, &filters).unwrap();
        t.rows
    }

    #[test]
    fn equals_on_text_ignores_case() {
        let t = table(&["Status"], &[&["Pending"], &["done"]]);
        assert_eq!(keep(t, &["Status=pending"]), vec![vec!["Pending"]]);
    }

    #[test]
    fn equals_on_a_number_compares_as_a_number() {
        // "0" and "0.00" are the same amount and different strings.
        let t = table(&["Amount"], &[&["0.00"], &["5"]]);
        assert_eq!(keep(t, &["Amount=0"]), vec![vec!["0.00"]]);
    }

    #[test]
    fn less_and_greater_are_numeric() {
        let t = table(&["Amount"], &[&["-5"], &["5"], &["50"]]);
        assert_eq!(keep(t.clone(), &["Amount<0"]), vec![vec!["-5"]]);
        assert_eq!(keep(t, &["Amount>10"]), vec![vec!["50"]]);
    }

    #[test]
    fn money_punctuation_does_not_defeat_a_numeric_comparison() {
        let t = table(&["Amount"], &[&["$1,200.00"], &["$3.00"]]);
        assert_eq!(keep(t, &["Amount>1000"]), vec![vec!["$1,200.00"]]);
    }

    #[test]
    fn a_parenthesised_amount_is_negative_as_it_is_on_a_statement() {
        assert_eq!(number("(500)"), Some(-500.0));
        let t = table(&["Amount"], &[&["(500)"], &["500"]]);
        assert_eq!(keep(t, &["Amount<0"]), vec![vec!["(500)"]]);
    }

    #[test]
    fn contains_ignores_case() {
        let t = table(&["Description"], &[&["Google Workspace"], &["AWS"]]);
        assert_eq!(keep(t, &["Description~google workspace"]), vec![vec!["Google Workspace"]]);
    }

    #[test]
    fn not_equal_is_read_before_equal() {
        let t = table(&["Status"], &[&["Pending"], &["done"]]);
        assert_eq!(keep(t, &["Status!=Pending"]), vec![vec!["done"]]);
    }

    #[test]
    fn several_filters_are_an_and() {
        let t =
            table(&["Status", "Amount"], &[&["Pending", "-5"], &["Pending", "5"], &["done", "-5"]]);
        assert_eq!(keep(t, &["Status=Pending", "Amount<0"]), vec![vec!["Pending", "-5"]]);
    }

    #[test]
    fn a_quoted_value_may_hold_spaces() {
        let t = table(&["Entity Name"], &[&["Affinity House Inc"], &["Other"]]);
        assert_eq!(
            keep(t, &["Entity Name=\"Affinity House Inc\""]),
            vec![vec!["Affinity House Inc"]]
        );
    }

    #[test]
    fn a_header_with_stray_whitespace_still_matches() {
        let t = table(&[" Status "], &[&["Pending"]]);
        assert_eq!(keep(t, &["Status=Pending"]), vec![vec!["Pending"]]);
    }

    #[test]
    fn a_non_numeric_cell_does_not_match_and_is_counted() {
        let mut t = table(&["Amount"], &[&["12"], &["n/a"], &[""]]);
        let filters = vec![Filter::parse("Amount>0").unwrap()];
        let report = filter(&mut t, &filters).unwrap();
        assert_eq!(t.rows, vec![vec!["12"]]);
        assert_eq!(report.skipped, vec![("Amount".to_string(), 2)]);
    }

    #[test]
    fn a_non_numeric_cell_is_not_swept_in_by_not_equals() {
        // Treating "unknown" as "different" would widen the result silently.
        let t = table(&["Amount"], &[&["5"], &["n/a"]]);
        assert_eq!(keep(t, &["Amount!=0"]), vec![vec!["5"]]);
    }

    #[test]
    fn an_unknown_column_names_the_ones_that_exist() {
        let mut t = table(&["Status", "Amount"], &[&["a", "1"]]);
        let filters = vec![Filter::parse("Vendor=x").unwrap()];
        let fault = filter(&mut t, &filters).unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("\"Status\""), "{fault}");
        assert!(fault.to_string().contains("\"Amount\""), "{fault}");
    }

    #[test]
    fn two_columns_that_collide_are_refused_rather_than_guessed() {
        let mut t = table(&["Status", "status"], &[&["a", "b"]]);
        let filters = vec![Filter::parse("Status=a").unwrap()];
        let fault = filter(&mut t, &filters).unwrap_err();
        assert!(fault.to_string().contains("matches 2 columns"), "{fault}");
    }

    #[test]
    fn a_clause_with_no_operator_is_rejected_with_the_syntax() {
        let fault = Filter::parse("Status").unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("col=value"), "{fault}");
    }

    #[test]
    fn select_keeps_the_named_columns_in_the_order_named() {
        let mut t = table(&["a", "b", "c"], &[&["1", "2", "3"]]);
        select(&mut t, &["c,a"]).unwrap();
        assert_eq!(t.headers, Some(vec!["c".to_string(), "a".to_string()]));
        assert_eq!(t.rows, vec![vec!["3", "1"]]);
    }

    #[test]
    fn select_accepts_repeated_flags_as_well_as_commas() {
        let mut t = table(&["a", "b"], &[&["1", "2"]]);
        select(&mut t, &["b", "a"]).unwrap();
        assert_eq!(t.rows, vec![vec!["2", "1"]]);
    }

    #[test]
    fn select_refuses_the_same_column_twice() {
        let mut t = table(&["a", "b"], &[&["1", "2"]]);
        assert_eq!(select(&mut t, &["a,a"]).unwrap_err().code(), 2);
    }

    #[test]
    fn rename_changes_a_header_and_leaves_the_data() {
        let mut t = table(&["order_number", "total"], &[&["1", "2"]]);
        rename(&mut t, &["order_number:Invoice,total:Amount"]).unwrap();
        assert_eq!(t.headers, Some(vec!["Invoice".to_string(), "Amount".to_string()]));
        assert_eq!(t.rows, vec![vec!["1", "2"]]);
    }

    #[test]
    fn renaming_a_to_b_and_b_to_c_does_not_turn_a_into_c() {
        // Resolving against the headers as they were is what stops the second
        // pair from catching what the first just produced.
        let mut t = table(&["a", "b"], &[&["1", "2"]]);
        rename(&mut t, &["a:b,b:c"]).unwrap();
        assert_eq!(t.headers, Some(vec!["b".to_string(), "c".to_string()]));
    }

    #[test]
    fn rename_reports_a_pair_that_is_not_a_pair() {
        let mut t = table(&["a"], &[&["1"]]);
        let fault = rename(&mut t, &["a"]).unwrap_err();
        assert!(fault.to_string().contains("OLD:NEW"), "{fault}");
    }

    #[test]
    fn these_operations_need_headers_to_have_names_to_work_with() {
        let mut t = Table { headers: None, rows: vec![vec!["1".to_string()]] };
        assert!(rename(&mut t, &["a:b"]).unwrap_err().to_string().contains("--headers"));
        assert!(select(&mut t, &["a"]).unwrap_err().to_string().contains("--headers"));
        let filters = vec![Filter::parse("a=1").unwrap()];
        assert!(filter(&mut t, &filters).unwrap_err().to_string().contains("--headers"));
    }
}
