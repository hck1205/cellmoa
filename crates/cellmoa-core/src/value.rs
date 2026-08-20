//! Cell values and the Excel error taxonomy.

use std::fmt;

/// The error values a cell can hold. Errors are first-class values in a
/// spreadsheet: they propagate through formulas rather than aborting evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum CellError {
    /// `#DIV/0!` — division by zero.
    Div0,
    /// `#N/A` — a lookup found nothing.
    NA,
    /// `#NAME?` — unknown function or defined name.
    Name,
    /// `#NULL!` — intersection of two ranges that do not overlap.
    Null,
    /// `#NUM!` — a numeric argument is out of the function's domain.
    Num,
    /// `#REF!` — a reference points at a cell that no longer exists.
    Ref,
    /// `#VALUE!` — an argument has the wrong type.
    Value,
    /// `#CYCLE!` — the cell takes part in a circular reference.
    Cycle,
    /// `#SPILL!` — an array result cannot expand into the target area.
    Spill,
}

impl CellError {
    /// The literal as it is written in a formula and displayed in a cell.
    pub const fn as_str(self) -> &'static str {
        match self {
            CellError::Div0 => "#DIV/0!",
            CellError::NA => "#N/A",
            CellError::Name => "#NAME?",
            CellError::Null => "#NULL!",
            CellError::Num => "#NUM!",
            CellError::Ref => "#REF!",
            CellError::Value => "#VALUE!",
            CellError::Cycle => "#CYCLE!",
            CellError::Spill => "#SPILL!",
        }
    }

    /// Parses an error literal such as `#DIV/0!`. Case-insensitive.
    pub fn parse(s: &str) -> Option<CellError> {
        const ALL: [CellError; 9] = [
            CellError::Div0,
            CellError::NA,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Cycle,
            CellError::Spill,
        ];
        ALL.into_iter().find(|e| e.as_str().eq_ignore_ascii_case(s))
    }
}

impl fmt::Display for CellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A scalar cell value.
///
/// `Number` deliberately holds a plain `f64`; NaN never reaches a cell because
/// every arithmetic path that could produce one yields [`CellError::Num`]
/// instead. That keeps [`Value`] totally ordered and hashable, which the
/// fingerprint (D2) and replay (D4) features depend on.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// An empty cell. Coerces to `0` in arithmetic and `""` in text context.
    Blank,
    Number(f64),
    Text(String),
    Bool(bool),
    Error(CellError),
}

impl Value {
    pub fn number(n: impl Into<f64>) -> Value {
        Value::Number(n.into())
    }

    pub fn text(s: impl Into<String>) -> Value {
        Value::Text(s.into())
    }

    pub fn is_blank(&self) -> bool {
        matches!(self, Value::Blank)
    }

    pub fn is_error(&self) -> bool {
        matches!(self, Value::Error(_))
    }

    /// Returns the error if this value is one, so callers can propagate it.
    pub fn as_error(&self) -> Option<CellError> {
        match self {
            Value::Error(e) => Some(*e),
            _ => None,
        }
    }

    /// Excel's implicit coercion to a number.
    ///
    /// Text is converted only when the whole string parses as a number, which
    /// is why `"3"+1` is `4` but `"3a"+1` is `#VALUE!`.
    pub fn coerce_number(&self) -> Result<f64, CellError> {
        match self {
            Value::Blank => Ok(0.0),
            Value::Number(n) => Ok(*n),
            Value::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
            Value::Text(s) => parse_number(s).ok_or(CellError::Value),
            Value::Error(e) => Err(*e),
        }
    }

    /// Excel's implicit coercion to text.
    pub fn coerce_text(&self) -> Result<String, CellError> {
        match self {
            Value::Blank => Ok(String::new()),
            Value::Number(n) => Ok(format_number(*n)),
            Value::Bool(b) => Ok(if *b { "TRUE".into() } else { "FALSE".into() }),
            Value::Text(s) => Ok(s.clone()),
            Value::Error(e) => Err(*e),
        }
    }

    /// Excel's implicit coercion to a boolean.
    ///
    /// Unlike numbers, text does *not* coerce here except for the literals
    /// `TRUE`/`FALSE` — `IF("1", ..)` is a `#VALUE!` in Excel.
    pub fn coerce_bool(&self) -> Result<bool, CellError> {
        match self {
            Value::Blank => Ok(false),
            Value::Number(n) => Ok(*n != 0.0),
            Value::Bool(b) => Ok(*b),
            Value::Text(s) if s.eq_ignore_ascii_case("TRUE") => Ok(true),
            Value::Text(s) if s.eq_ignore_ascii_case("FALSE") => Ok(false),
            Value::Text(_) => Err(CellError::Value),
            Value::Error(e) => Err(*e),
        }
    }

    /// The ordering rank Excel uses when comparing values of different types:
    /// numbers sort before text, text before booleans.
    fn type_rank(&self) -> u8 {
        match self {
            Value::Blank => 0,
            Value::Number(_) => 1,
            Value::Text(_) => 2,
            Value::Bool(_) => 3,
            Value::Error(_) => 4,
        }
    }

    /// Compares two values with Excel's cross-type ordering. Returns `None`
    /// when either side is an error, since errors are not comparable.
    pub fn compare(&self, other: &Value) -> Option<std::cmp::Ordering> {
        use std::cmp::Ordering;
        if self.is_error() || other.is_error() {
            return None;
        }
        // A blank compares against its zero/empty-string counterpart rather
        // than sorting before everything, so `A1=0` is TRUE for an empty A1.
        match (self, other) {
            (Value::Blank, Value::Number(n)) => return 0.0.partial_cmp(n),
            (Value::Number(n), Value::Blank) => return n.partial_cmp(&0.0),
            (Value::Blank, Value::Text(s)) => return Some("".cmp(s.as_str())),
            (Value::Text(s), Value::Blank) => return Some(s.as_str().cmp("")),
            (Value::Blank, Value::Blank) => return Some(Ordering::Equal),
            _ => {}
        }
        match self.type_rank().cmp(&other.type_rank()) {
            Ordering::Equal => match (self, other) {
                (Value::Number(a), Value::Number(b)) => a.partial_cmp(b),
                // Text comparison is case-insensitive, as in Excel.
                (Value::Text(a), Value::Text(b)) => {
                    Some(a.to_lowercase().cmp(&b.to_lowercase()))
                }
                (Value::Bool(a), Value::Bool(b)) => Some(a.cmp(b)),
                _ => Some(Ordering::Equal),
            },
            ord => Some(ord),
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Blank => Ok(()),
            Value::Number(n) => f.write_str(&format_number(*n)),
            Value::Text(s) => f.write_str(s),
            Value::Bool(b) => f.write_str(if *b { "TRUE" } else { "FALSE" }),
            Value::Error(e) => f.write_str(e.as_str()),
        }
    }
}

/// Renders a number the way a spreadsheet does with the General format:
/// integers without a decimal point, and no exponent for everyday magnitudes.
pub fn format_number(n: f64) -> String {
    if n == 0.0 {
        // Normalises -0.0, which would otherwise print as "-0".
        return "0".to_string();
    }
    if !n.is_finite() {
        return CellError::Num.as_str().to_string();
    }
    let abs = n.abs();
    if (1e-10..1e21).contains(&abs) {
        // {} on f64 already gives the shortest round-tripping decimal form.
        let s = format!("{n}");
        if s.contains('e') || s.contains('E') {
            return format!("{n:.10}").trim_end_matches('0').trim_end_matches('.').to_string();
        }
        s
    } else {
        format!("{n:E}").replace('E', "E+").replace("E+-", "E-")
    }
}

/// Parses the numeric text forms a spreadsheet accepts in a coercion context.
fn parse_number(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(n) = t.parse::<f64>() {
        return n.is_finite().then_some(n);
    }
    // Percent literals: "50%" -> 0.5
    if let Some(head) = t.strip_suffix('%') {
        if let Ok(n) = head.trim().parse::<f64>() {
            return n.is_finite().then_some(n / 100.0);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_coerces_only_when_fully_numeric() {
        assert_eq!(Value::text("3").coerce_number(), Ok(3.0));
        assert_eq!(Value::text(" 3.5 ").coerce_number(), Ok(3.5));
        assert_eq!(Value::text("50%").coerce_number(), Ok(0.5));
        assert_eq!(Value::text("3a").coerce_number(), Err(CellError::Value));
        assert_eq!(Value::text("").coerce_number(), Err(CellError::Value));
    }

    #[test]
    fn blank_compares_as_zero_and_empty_string() {
        use std::cmp::Ordering::Equal;
        assert_eq!(Value::Blank.compare(&Value::number(0)), Some(Equal));
        assert_eq!(Value::Blank.compare(&Value::text("")), Some(Equal));
        assert_ne!(Value::Blank.compare(&Value::number(1)), Some(Equal));
    }

    #[test]
    fn numbers_sort_before_text_before_bools() {
        use std::cmp::Ordering::Less;
        assert_eq!(Value::number(99).compare(&Value::text("a")), Some(Less));
        assert_eq!(Value::text("z").compare(&Value::Bool(false)), Some(Less));
    }

    #[test]
    fn errors_are_not_comparable() {
        assert_eq!(Value::Error(CellError::NA).compare(&Value::number(1)), None);
    }

    #[test]
    fn general_format_matches_spreadsheet_output() {
        assert_eq!(format_number(1.0), "1");
        assert_eq!(format_number(-0.0), "0");
        assert_eq!(format_number(0.5), "0.5");
        assert_eq!(format_number(1234567.0), "1234567");
    }

    #[test]
    fn error_literals_round_trip() {
        for s in ["#DIV/0!", "#N/A", "#NAME?", "#REF!", "#VALUE!"] {
            assert_eq!(CellError::parse(s).unwrap().as_str(), s);
        }
        assert_eq!(CellError::parse("#nope!"), None);
    }
}
