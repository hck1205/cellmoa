//! Criteria matching for the `*IF` family.
//!
//! A criterion is written as a value: `5`, `">5"`, `"<>apple"`, `"a*"`. Text
//! comparisons are case-insensitive and support `*` and `?` wildcards, with `~`
//! escaping them — the same rules `COUNTIF` and `SUMIF` have always used.

use cellmoa_core::value::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

/// A parsed criterion, ready to test values against.
#[derive(Debug, Clone)]
pub struct Criterion {
    op: Op,
    operand: Value,
    /// Set when the operand is text containing an unescaped wildcard.
    pattern: Option<String>,
}

impl Criterion {
    /// Parses a criterion from the value the user supplied.
    pub fn parse(value: &Value) -> Criterion {
        let Value::Text(text) = value else {
            // A non-text criterion is a plain equality test.
            return Criterion { op: Op::Eq, operand: value.clone(), pattern: None };
        };
        let (op, rest) = split_operator(text);
        let operand = interpret(rest);
        let pattern = match (&operand, op) {
            (Value::Text(t), Op::Eq | Op::Ne) if needs_pattern_match(t) => Some(t.clone()),
            _ => None,
        };
        Criterion { op, operand, pattern }
    }

    /// Whether a value satisfies the criterion.
    pub fn matches(&self, value: &Value) -> bool {
        // An error in the data never satisfies a criterion; it is simply
        // skipped, which is why COUNTIF over a column with a #N/A still counts.
        if value.is_error() {
            return false;
        }
        if let Some(pattern) = &self.pattern {
            let Ok(text) = value.coerce_text() else { return false };
            let hit = wildcard_match(pattern, &text);
            return if self.op == Op::Ne { !hit } else { hit };
        }
        // An empty criterion matches an empty cell.
        if matches!(self.operand, Value::Blank) {
            let blank = value.is_blank() || matches!(value, Value::Text(t) if t.is_empty());
            return if self.op == Op::Ne { !blank } else { blank };
        }
        // A blank cell never satisfies an ordinary comparison, so that
        // `COUNTIF(A:A,">0")` does not count the empty part of the column.
        if value.is_blank() {
            return false;
        }
        let Some(ord) = value.compare(&self.operand) else { return false };
        match self.op {
            Op::Eq => ord.is_eq(),
            Op::Ne => ord.is_ne(),
            Op::Lt => ord.is_lt(),
            Op::Le => ord.is_le(),
            Op::Gt => ord.is_gt(),
            Op::Ge => ord.is_ge(),
        }
    }
}

fn split_operator(text: &str) -> (Op, &str) {
    for (prefix, op) in [
        ("<>", Op::Ne),
        (">=", Op::Ge),
        ("<=", Op::Le),
        (">", Op::Gt),
        ("<", Op::Lt),
        ("=", Op::Eq),
    ] {
        if let Some(rest) = text.strip_prefix(prefix) {
            return (op, rest);
        }
    }
    (Op::Eq, text)
}

/// Reads the right-hand side of a criterion, which may be a number or a
/// boolean written as text.
fn interpret(text: &str) -> Value {
    if text.is_empty() {
        return Value::Blank;
    }
    if text.eq_ignore_ascii_case("TRUE") {
        return Value::Bool(true);
    }
    if text.eq_ignore_ascii_case("FALSE") {
        return Value::Bool(false);
    }
    match text.trim().parse::<f64>() {
        Ok(n) if n.is_finite() => Value::Number(n),
        _ => Value::Text(text.to_string()),
    }
}

/// Whether a criterion has to go through the wildcard matcher.
///
/// A tilde counts even when nothing else does: `"a~*b"` has no live wildcard,
/// but it still means the literal `a*b`, and a plain string comparison would
/// look for the tilde as well.
fn needs_pattern_match(pattern: &str) -> bool {
    pattern.contains(['*', '?', '~'])
}

/// Matches `text` against a criterion pattern, case-insensitively.
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let text: Vec<char> = text.to_lowercase().chars().collect();
    // Iterative backtracking: `*` remembers where it can resume, so the match
    // stays linear in the common case instead of recursing per star.
    let (mut p, mut t) = (0usize, 0usize);
    let (mut star, mut resume) = (None, 0usize);
    while t < text.len() {
        let literal = match pattern.get(p) {
            Some('~') => pattern.get(p + 1).copied().map(|c| (c, 2)),
            Some('?') => {
                p += 1;
                t += 1;
                continue;
            }
            Some('*') => {
                star = Some(p);
                p += 1;
                resume = t;
                continue;
            }
            Some(&c) => Some((c, 1)),
            None => None,
        };
        match literal {
            Some((c, width)) if c == text[t] => {
                p += width;
                t += 1;
            }
            _ => match star {
                // Backtrack: let the last `*` swallow one more character.
                Some(at) => {
                    p = at + 1;
                    resume += 1;
                    t = resume;
                }
                None => return false,
            },
        }
    }
    // Any trailing pattern must be stars only.
    pattern[p.min(pattern.len())..].iter().all(|&c| c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matches(criterion: &str, value: Value) -> bool {
        Criterion::parse(&Value::Text(criterion.into())).matches(&value)
    }

    #[test]
    fn comparison_operators() {
        assert!(matches(">5", Value::Number(6.0)));
        assert!(!matches(">5", Value::Number(5.0)));
        assert!(matches(">=5", Value::Number(5.0)));
        assert!(matches("<>5", Value::Number(6.0)));
        assert!(!matches("<>5", Value::Number(5.0)));
    }

    #[test]
    fn a_bare_value_is_an_equality_test_and_is_case_insensitive() {
        assert!(matches("apple", Value::Text("Apple".into())));
        assert!(matches("5", Value::Number(5.0)));
        assert!(!matches("apple", Value::Text("apples".into())));
    }

    #[test]
    fn wildcards() {
        assert!(matches("a*", Value::Text("apple".into())));
        assert!(matches("*e", Value::Text("apple".into())));
        assert!(matches("a?ple", Value::Text("apple".into())));
        assert!(!matches("a?ple", Value::Text("aple".into())));
        assert!(matches("*p*p*", Value::Text("apple".into())));
        assert!(!matches("b*", Value::Text("apple".into())));
    }

    #[test]
    fn a_tilde_escapes_a_wildcard() {
        assert!(matches("a~*b", Value::Text("a*b".into())));
        assert!(!matches("a~*b", Value::Text("axb".into())));
    }

    #[test]
    fn a_negated_wildcard_inverts_the_match() {
        assert!(matches("<>a*", Value::Text("banana".into())));
        assert!(!matches("<>a*", Value::Text("apple".into())));
    }

    #[test]
    fn an_empty_criterion_matches_an_empty_cell() {
        assert!(matches("", Value::Blank));
        assert!(matches("", Value::Text(String::new())));
        assert!(!matches("", Value::Number(0.0)));
        assert!(matches("<>", Value::Number(0.0)));
    }

    #[test]
    fn a_blank_cell_fails_an_ordinary_comparison() {
        // Otherwise `COUNTIF(A:A,"<10")` would count the empty part of a column.
        assert!(!matches("<10", Value::Blank));
        assert!(!matches(">0", Value::Blank));
    }

    #[test]
    fn errors_in_the_data_are_skipped() {
        assert!(!matches("<>x", Value::Error(cellmoa_core::value::CellError::NA)));
    }
}
