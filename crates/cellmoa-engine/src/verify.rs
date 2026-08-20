//! Checking a workbook's results against expectations.
//!
//! This is what turns a spreadsheet into something a build can gate on. A
//! specification names cells and what they should hold; the checker reports
//! every mismatch with the coordinate, what was expected and what was found,
//! and the caller turns that into an exit code.

use crate::engine::Engine;
use cellmoa_core::model::{CellAddr, CellContent};
use cellmoa_core::reference::{CellRef, RangeRef};
use cellmoa_core::value::{CellError, Value};
use serde::{Deserialize, Serialize};
use std::fmt;

/// A value an expectation can compare against.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Expected {
    Number(f64),
    Bool(bool),
    Text(String),
}

impl fmt::Display for Expected {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expected::Number(n) => f.write_str(&cellmoa_core::value::format_number(*n)),
            Expected::Bool(b) => f.write_str(if *b { "TRUE" } else { "FALSE" }),
            Expected::Text(s) => write!(f, "{s:?}"),
        }
    }
}

/// One thing to check.
///
/// Exactly one target (`cell` or `range`) and one condition should be given;
/// anything else is reported as a malformed expectation rather than quietly
/// passing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Expectation {
    /// A cell, optionally sheet-qualified: `Sheet1!B2` or `B2`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell: Option<String>,
    /// A range, for the aggregate conditions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<String>,
    /// A description shown in the report.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,

    /// The value the cell must hold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equals: Option<Expected>,
    /// The number the cell must be near.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approx: Option<f64>,
    /// How near, for `approx`. Defaults to a part in a billion, which is about
    /// where a spreadsheet's own arithmetic stops being reproducible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tolerance: Option<f64>,
    /// The error the cell must hold, e.g. `#DIV/0!`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The cell must hold no error.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub no_error: bool,
    /// The formula the cell must contain, with or without a leading `=`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// The sum of the numbers in the range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sum: Option<f64>,
    /// How many numbers the range holds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
}

/// A set of expectations.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Spec {
    /// The sheet unqualified references belong to. Defaults to the first sheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
    pub expect: Vec<Expectation>,
}

/// The outcome of one expectation.
#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub passed: bool,
    pub expected: String,
    pub actual: String,
}

impl fmt::Display for CheckResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mark = if self.passed { "ok" } else { "FAILED" };
        write!(f, "{mark}  {}", self.target)?;
        if let Some(label) = &self.label {
            write!(f, " ({label})")?;
        }
        if !self.passed {
            write!(f, "\n      expected {}\n      found    {}", self.expected, self.actual)?;
        }
        Ok(())
    }
}

/// The result of checking a whole specification.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub results: Vec<CheckResult>,
}

impl Report {
    pub fn passed(&self) -> bool {
        self.results.iter().all(|r| r.passed)
    }

    pub fn failures(&self) -> impl Iterator<Item = &CheckResult> {
        self.results.iter().filter(|r| !r.passed)
    }

    pub fn failure_count(&self) -> usize {
        self.failures().count()
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for result in &self.results {
            writeln!(f, "{result}")?;
        }
        let failed = self.failure_count();
        write!(f, "{} checked, {} failed", self.results.len(), failed)
    }
}

/// Checks a workbook against a specification.
pub fn verify(engine: &Engine, spec: &Spec) -> Report {
    let default_sheet = spec
        .sheet
        .as_deref()
        .and_then(|name| engine.workbook().sheet_id_by_name(name))
        .or_else(|| engine.workbook().sheets().next().map(|s| s.id));

    Report { results: spec.expect.iter().map(|e| check(engine, e, default_sheet)).collect() }
}

/// Splits a target into its sheet and its A1 part.
fn split_target<'a>(
    target: &'a str,
    engine: &Engine,
    default: Option<u32>,
) -> (Option<u32>, &'a str) {
    let (sheet, rest) = cellmoa_core::reference::parse_sheet_qualified(target);
    match sheet {
        Some(name) => (engine.workbook().sheet_id_by_name(&name), rest),
        None => (default, rest),
    }
}

fn check(engine: &Engine, expectation: &Expectation, default_sheet: Option<u32>) -> CheckResult {
    let target =
        expectation.cell.as_deref().or(expectation.range.as_deref()).unwrap_or("").to_string();
    let fail = |expected: String, actual: String| CheckResult {
        target: target.clone(),
        label: expectation.label.clone(),
        passed: false,
        expected,
        actual,
    };

    if expectation.cell.is_some() && expectation.range.is_some() {
        return fail("one target".into(), "both `cell` and `range` were given".into());
    }

    if let Some(cell) = &expectation.cell {
        let (Some(sheet), rest) = split_target(cell, engine, default_sheet) else {
            return fail("a sheet that exists".into(), format!("no sheet for {cell:?}"));
        };
        let Some(reference) = CellRef::parse_a1(rest) else {
            return fail("a cell reference".into(), format!("{cell:?} is not one"));
        };
        let addr = CellAddr::new(sheet, reference.col, reference.row);
        return check_cell(engine, expectation, addr, target);
    }

    if let Some(range) = &expectation.range {
        let (Some(sheet), rest) = split_target(range, engine, default_sheet) else {
            return fail("a sheet that exists".into(), format!("no sheet for {range:?}"));
        };
        let Some(area) = RangeRef::parse_a1(rest) else {
            return fail("a range reference".into(), format!("{range:?} is not one"));
        };
        return check_range(engine, expectation, sheet, area, target);
    }

    fail("a `cell` or a `range`".into(), "neither was given".into())
}

fn check_cell(
    engine: &Engine,
    expectation: &Expectation,
    addr: CellAddr,
    target: String,
) -> CheckResult {
    let value = engine.value(addr);
    let result = |passed: bool, expected: String| CheckResult {
        target: target.clone(),
        label: expectation.label.clone(),
        passed,
        expected,
        actual: describe(&value),
    };

    if let Some(expected) = &expectation.equals {
        let matches = match (expected, &value) {
            (Expected::Number(a), Value::Number(b)) => a == b,
            (Expected::Bool(a), Value::Bool(b)) => a == b,
            (Expected::Text(a), Value::Text(b)) => a == b,
            // A text expectation is also allowed to match an error literal, so
            // `"#N/A"` reads naturally.
            (Expected::Text(a), Value::Error(e)) => a == e.as_str(),
            _ => false,
        };
        return result(matches, expected.to_string());
    }
    if let Some(expected) = expectation.approx {
        let tolerance = expectation.tolerance.unwrap_or(1e-9);
        let matches = matches!(value, Value::Number(n) if (n - expected).abs() <= tolerance);
        return result(matches, format!("{expected} +/- {tolerance}"));
    }
    if let Some(expected) = &expectation.error {
        let matches = value.as_error().is_some_and(|e| e.as_str() == expected);
        return result(matches, expected.clone());
    }
    if expectation.no_error {
        return result(!value.is_error(), "no error".into());
    }
    if let Some(expected) = &expectation.formula {
        let wanted = expected.strip_prefix('=').unwrap_or(expected);
        let found = engine.formula(addr);
        return CheckResult {
            target,
            label: expectation.label.clone(),
            passed: found.as_deref() == Some(wanted),
            expected: format!("={wanted}"),
            actual: match found {
                Some(source) => format!("={source}"),
                None => match engine.workbook().content(addr) {
                    CellContent::Empty => "(empty)".into(),
                    _ => "a literal, not a formula".into(),
                },
            },
        };
    }
    result(false, "a condition".into())
}

fn check_range(
    engine: &Engine,
    expectation: &Expectation,
    sheet: u32,
    area: RangeRef,
    target: String,
) -> CheckResult {
    let numbers: Vec<f64> = engine
        .workbook()
        .sheet(sheet)
        .map(|s| {
            s.iter_range(&area)
                .filter_map(|(_, _, cell)| match cell.value {
                    Value::Number(n) => Some(n),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();

    if let Some(expected) = expectation.sum {
        let total: f64 = numbers.iter().sum();
        let tolerance = expectation.tolerance.unwrap_or(1e-9);
        return CheckResult {
            target,
            label: expectation.label.clone(),
            passed: (total - expected).abs() <= tolerance,
            expected: format!("sum {expected}"),
            actual: format!("sum {total}"),
        };
    }
    if let Some(expected) = expectation.count {
        return CheckResult {
            target,
            label: expectation.label.clone(),
            passed: numbers.len() == expected,
            expected: format!("{expected} number(s)"),
            actual: format!("{} number(s)", numbers.len()),
        };
    }
    if expectation.no_error {
        let errors = engine
            .workbook()
            .sheet(sheet)
            .map(|s| s.iter_range(&area).filter(|(_, _, c)| c.value.is_error()).count())
            .unwrap_or(0);
        return CheckResult {
            target,
            label: expectation.label.clone(),
            passed: errors == 0,
            expected: "no errors".into(),
            actual: format!("{errors} error(s)"),
        };
    }
    CheckResult {
        target,
        label: expectation.label.clone(),
        passed: false,
        expected: "a range condition (`sum`, `count` or `no_error`)".into(),
        actual: "none was given".into(),
    }
}

fn describe(value: &Value) -> String {
    match value {
        Value::Blank => "(blank)".into(),
        Value::Text(s) => format!("{s:?}"),
        other => other.to_string(),
    }
}

/// Parses `#DIV/0!` and friends, for validating a specification before it is
/// run against a workbook.
pub fn known_error(text: &str) -> bool {
    CellError::parse(text).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellmoa_core::edit::Actor;

    fn engine_with(cells: &[(&str, &str)]) -> Engine {
        let mut engine = Engine::new();
        engine.add_sheet("Sheet1");
        for (a1, input) in cells {
            let cell = CellRef::parse_a1(a1).expect("valid address");
            engine
                .set(Actor::human("test"), CellAddr::new(0, cell.col, cell.row), input)
                .expect("edit should apply");
        }
        engine
    }

    fn run(engine: &Engine, json: &str) -> Report {
        let spec: Spec = serde_json::from_str(json).expect("spec should parse");
        verify(engine, &spec)
    }

    #[test]
    fn a_passing_and_a_failing_expectation() {
        let engine = engine_with(&[("A1", "10"), ("B1", "=A1*2")]);
        let report =
            run(&engine, r#"{"expect":[{"cell":"B1","equals":20},{"cell":"A1","equals":11}]}"#);
        assert_eq!(report.results.len(), 2);
        assert!(report.results[0].passed);
        assert!(!report.results[1].passed);
        assert!(!report.passed());
        assert_eq!(report.failure_count(), 1);
        assert_eq!(report.results[1].actual, "10");
    }

    #[test]
    fn text_and_boolean_expectations() {
        let engine = engine_with(&[("A1", "hello"), ("A2", "TRUE")]);
        let report = run(
            &engine,
            r#"{"expect":[{"cell":"A1","equals":"hello"},{"cell":"A2","equals":true}]}"#,
        );
        assert!(report.passed(), "{report}");
    }

    #[test]
    fn an_approximate_comparison_needs_a_tolerance_not_an_exact_match() {
        let engine = engine_with(&[("A1", "=1/3")]);
        let strict = run(&engine, r#"{"expect":[{"cell":"A1","equals":0.3333333333333333}]}"#);
        assert!(strict.passed());
        let approximate =
            run(&engine, r#"{"expect":[{"cell":"A1","approx":0.3333,"tolerance":0.001}]}"#);
        assert!(approximate.passed());
        let too_tight =
            run(&engine, r#"{"expect":[{"cell":"A1","approx":0.3333,"tolerance":0.00001}]}"#);
        assert!(!too_tight.passed());
    }

    #[test]
    fn expecting_an_error_and_expecting_none() {
        let engine = engine_with(&[("A1", "=1/0"), ("B1", "=1+1")]);
        // Doubled hashes: the specification text itself contains `"#`.
        let report = run(
            &engine,
            r##"{"expect":[
                {"cell":"A1","error":"#DIV/0!"},
                {"cell":"B1","no_error":true},
                {"cell":"A1","no_error":true}
            ]}"##,
        );
        assert!(report.results[0].passed);
        assert!(report.results[1].passed);
        assert!(!report.results[2].passed, "an error cell must fail a no-error check");
    }

    #[test]
    fn a_formula_expectation_checks_the_source_not_the_result() {
        let engine = engine_with(&[("A1", "=SUM(B1:B9)"), ("A2", "42")]);
        let report = run(
            &engine,
            r#"{"expect":[
                {"cell":"A1","formula":"=SUM(B1:B9)"},
                {"cell":"A1","formula":"SUM(B1:B9)"},
                {"cell":"A2","formula":"=SUM(B1:B9)"}
            ]}"#,
        );
        assert!(report.results[0].passed);
        // The leading = is optional in the specification.
        assert!(report.results[1].passed);
        assert!(!report.results[2].passed);
        assert_eq!(report.results[2].actual, "a literal, not a formula");
    }

    #[test]
    fn range_conditions() {
        let engine = engine_with(&[("A1", "1"), ("A2", "2"), ("A3", "3"), ("A4", "text")]);
        let report = run(
            &engine,
            r#"{"expect":[
                {"range":"A1:A4","sum":6},
                {"range":"A1:A4","count":3},
                {"range":"A1:A4","no_error":true}
            ]}"#,
        );
        assert!(report.passed(), "{report}");
    }

    #[test]
    fn a_sheet_qualified_target() {
        let mut engine = engine_with(&[("A1", "1")]);
        let second = engine.add_sheet("Other");
        engine.set(Actor::human("t"), CellAddr::new(second, 0, 0), "99").unwrap();
        let report = run(
            &engine,
            r#"{"expect":[{"cell":"Other!A1","equals":99},{"cell":"A1","equals":1}]}"#,
        );
        assert!(report.passed(), "{report}");
    }

    #[test]
    fn the_default_sheet_can_be_named() {
        let mut engine = engine_with(&[("A1", "1")]);
        let second = engine.add_sheet("Other");
        engine.set(Actor::human("t"), CellAddr::new(second, 0, 0), "99").unwrap();
        let report = run(&engine, r#"{"sheet":"Other","expect":[{"cell":"A1","equals":99}]}"#);
        assert!(report.passed(), "{report}");
    }

    #[test]
    fn a_malformed_expectation_fails_rather_than_passing_quietly() {
        let engine = engine_with(&[("A1", "1")]);
        for spec in [
            r#"{"expect":[{"cell":"not a cell","equals":1}]}"#,
            r#"{"expect":[{"cell":"Nope!A1","equals":1}]}"#,
            r#"{"expect":[{"cell":"A1"}]}"#,
            r#"{"expect":[{"equals":1}]}"#,
            r#"{"expect":[{"cell":"A1","range":"A1:A2","equals":1}]}"#,
        ] {
            assert!(!run(&engine, spec).passed(), "{spec} should not have passed");
        }
    }

    #[test]
    fn the_report_names_the_cell_and_both_values() {
        let engine = engine_with(&[("A1", "10")]);
        let report =
            run(&engine, r#"{"expect":[{"cell":"A1","equals":11,"label":"opening balance"}]}"#);
        let text = report.to_string();
        assert!(text.contains("A1"), "{text}");
        assert!(text.contains("opening balance"), "{text}");
        assert!(text.contains("11"), "{text}");
        assert!(text.contains("10"), "{text}");
        assert!(text.contains("1 checked, 1 failed"), "{text}");
    }
}
