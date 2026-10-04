//! Deciding what a CSV field becomes when it is written into someone else's
//! template.
//!
//! Everywhere else in this tool a field is read the way a spreadsheet reads
//! what you type: `=A1+1` becomes a formula, `$1,200.00` is money. `fill` is
//! the one place that is wrong, for two reasons.
//!
//! **A formula is an instruction, and this data came from somewhere else.**
//! A CSV handed over by a vendor, a bank, or an API is not a person typing
//! into their own sheet. If `=HYPERLINK("http://evil","click")` in a cell of
//! that file becomes a live formula in the template, the file's author has
//! written code into a document they were only supposed to supply numbers
//! for. So nothing here ever becomes a formula. A field that looks like one
//! is stored as the text it is, which renders it inert without losing it.
//!
//! **A number that is nearly right is worse than a string.** `$1,200.00` is
//! unambiguous to a person and ambiguous to a program: a European export
//! writes twelve hundred as `1.200,00`. Guessing gets it right most of the
//! time, and the times it does not are silent. So only two shapes are
//! numbers — a plain integer, and a plain amount with exactly two decimals —
//! and everything else stays text, where it can be seen and fixed.

use cellmoa_core::model::CellContent;
use cellmoa_core::value::Value;

/// Beyond this many digits a decimal integer cannot survive a round trip
/// through `f64`. Storing one as a number would quietly change it, so a long
/// digit string — an account number, an order id — stays text.
const MAX_EXACT_DIGITS: usize = 15;

/// What a field became.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Number,
    Text,
    /// Text that would have been a formula somewhere less careful.
    Neutralised,
}

/// Reads one field into the contents a cell should hold.
///
/// The return type is deliberately `CellContent::Literal` in every branch:
/// there is no path through here that produces a formula.
pub fn field(text: &str) -> (CellContent, Kind) {
    if let Some(number) = strict_number(text) {
        return (CellContent::Literal(Value::Number(number)), Kind::Number);
    }
    let kind = if looks_like_a_formula(text) { Kind::Neutralised } else { Kind::Text };
    (CellContent::Literal(Value::Text(text.to_string())), kind)
}

/// True for the prefixes a spreadsheet treats as the start of an expression.
///
/// `=` is the obvious one. `+` and `-` start a formula in Excel, and `@`
/// introduces a function name in some locales, which is why the four are
/// treated together — a field beginning with any of them is a candidate for
/// being executed rather than displayed.
pub fn looks_like_a_formula(text: &str) -> bool {
    let trimmed = text.trim_start();
    let Some(first) = trimmed.chars().next() else { return false };
    if !matches!(first, '=' | '+' | '-' | '@') {
        return false;
    }
    // `-500` is a number, not an attack, and `strict_number` has already had
    // its chance at it. Anything still here that is not a plain number is
    // being treated as text either way; the flag only decides whether it gets
    // counted as neutralised.
    strict_number(trimmed).is_none()
}

/// A number, under the strict rule: an optional minus, digits, and either
/// nothing or exactly two decimal places.
///
/// No currency symbol, no thousands separator, no exponent, no leading plus,
/// no whitespace inside. Every one of those is a place where two locales
/// disagree, and disagreeing quietly is the failure this exists to prevent.
pub fn strict_number(text: &str) -> Option<f64> {
    let text = text.trim();
    let body = text.strip_prefix('-').unwrap_or(text);
    if body.is_empty() {
        return None;
    }

    let (whole, decimals) = match body.split_once('.') {
        Some((whole, decimals)) => (whole, Some(decimals)),
        None => (body, None),
    };
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    match decimals {
        // "exact 2-decimal amounts only": `1.5` and `1.500` are both refused,
        // because a file that writes one of them is not writing money the way
        // this expects and the difference is worth seeing.
        Some(decimals) if decimals.len() != 2 || !decimals.bytes().all(|b| b.is_ascii_digit()) => {
            return None
        }
        _ => {}
    }

    // A leading zero on a multi-digit whole part means the zero carries
    // meaning — a zip code, a product code — and turning it into a number
    // loses it.
    if whole.len() > 1 && whole.starts_with('0') {
        return None;
    }
    if whole.len() > MAX_EXACT_DIGITS {
        return None;
    }
    text.parse::<f64>().ok()
}

/// How a fill went, for the report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub numbers: usize,
    pub text: usize,
    pub neutralised: usize,
}

impl Counts {
    pub fn add(&mut self, kind: Kind) {
        match kind {
            Kind::Number => self.numbers += 1,
            Kind::Text => self.text += 1,
            Kind::Neutralised => {
                self.text += 1;
                self.neutralised += 1;
            }
        }
    }

    pub fn cells(&self) -> usize {
        self.numbers + self.text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(text: &str) -> Kind {
        field(text).1
    }

    fn number(text: &str) -> Option<f64> {
        strict_number(text)
    }

    #[test]
    fn a_plain_integer_is_a_number() {
        assert_eq!(number("42"), Some(42.0));
        assert_eq!(number("0"), Some(0.0));
        assert_eq!(number("-500"), Some(-500.0));
    }

    #[test]
    fn exactly_two_decimals_is_a_number_and_anything_else_is_not() {
        assert_eq!(number("1200.00"), Some(1200.0));
        assert_eq!(number("-0.05"), Some(-0.05));
        assert_eq!(number("1.5"), None, "one decimal is not the documented shape");
        assert_eq!(number("1.500"), None, "three decimals either");
        assert_eq!(number("1."), None);
        assert_eq!(number(".50"), None);
    }

    #[test]
    fn money_punctuation_is_refused_here_even_though_a_filter_accepts_it() {
        // `convert --where 'Amount>1000'` reads $1,200.00 on purpose: it is
        // comparing, and a wrong guess only mismatches a row. This is writing
        // into a document, and a wrong guess is stored.
        assert_eq!(number("$1,200.00"), None);
        assert_eq!(number("1,200.00"), None);
        assert_eq!(number("(500)"), None);
        assert_eq!(number("1200 "), Some(1200.0), "surrounding space is not punctuation");
    }

    #[test]
    fn an_exponent_is_not_a_number_here() {
        assert_eq!(number("1e5"), None);
        assert_eq!(number("1E5"), None);
    }

    #[test]
    fn a_leading_plus_is_refused() {
        // It is also a formula prefix, so accepting it would be the one place
        // an injection prefix became a number.
        assert_eq!(number("+42"), None);
        assert_eq!(kind("+42"), Kind::Neutralised);
    }

    #[test]
    fn a_leading_zero_stays_text_because_the_zero_means_something() {
        // A zip code is not the number 2138.
        assert_eq!(number("02138"), None);
        assert_eq!(kind("02138"), Kind::Text);
        assert_eq!(number("0"), Some(0.0), "a lone zero is still zero");
        assert_eq!(number("0.50"), Some(0.5));
    }

    #[test]
    fn a_digit_string_too_long_to_survive_f64_stays_text() {
        // 12345678901234567890 as an f64 comes back 12345678901234567168.
        // Storing it as a number would change an account number in silence.
        assert_eq!(number("12345678901234567890"), None);
        assert_eq!(kind("12345678901234567890"), Kind::Text);
        assert_eq!(number("123456789012345"), Some(123456789012345.0), "fifteen digits is fine");
    }

    #[test]
    fn a_formula_becomes_the_text_of_itself() {
        let (content, kind) = field("=HYPERLINK(\"http://evil\",\"click\")");
        assert_eq!(kind, Kind::Neutralised);
        assert_eq!(
            content,
            CellContent::Literal(Value::Text("=HYPERLINK(\"http://evil\",\"click\")".to_string()))
        );
        assert!(content.as_formula().is_none(), "never a formula");
    }

    #[test]
    fn every_prefix_a_spreadsheet_treats_as_an_expression_is_caught() {
        for attack in ["=1+1", "+1+1", "@SUM(A1)", "-1+1", " =1+1", "=cmd|'/c calc'!A1"] {
            assert_eq!(kind(attack), Kind::Neutralised, "{attack}");
        }
    }

    #[test]
    fn a_negative_number_is_not_mistaken_for_an_attack() {
        assert_eq!(kind("-500"), Kind::Number);
        assert_eq!(kind("-0.05"), Kind::Number);
    }

    #[test]
    fn ordinary_text_is_ordinary() {
        for plain in ["Alice", "Q1", "", "a-b", "3 apples", "01/02/2026"] {
            assert_eq!(kind(plain), Kind::Text, "{plain}");
        }
    }

    #[test]
    fn the_counts_add_up() {
        let mut counts = Counts::default();
        for text in ["1", "two", "=1+1"] {
            counts.add(field(text).1);
        }
        assert_eq!(counts, Counts { numbers: 1, text: 2, neutralised: 1 });
        assert_eq!(counts.cells(), 3, "a neutralised cell is still a cell that was written");
    }
}
