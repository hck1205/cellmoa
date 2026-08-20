//! The formula lexer.
//!
//! Two things make this more than a token split. Sheet qualifiers are resolved
//! here, including the quoted form and 3-D ranges, because deciding whether the
//! `:` in `Sheet1:Sheet3!A1` joins two sheet names or two cells needs lookahead
//! that the parser does not have. And whitespace is recorded on each token,
//! because a space between two references is Excel's intersection operator.

use crate::ast::SheetSpec;
use cellmoa_core::value::CellError;
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum TokKind {
    Number(f64),
    Text(String),
    /// An error literal such as `#N/A`.
    Error(CellError),
    /// A function name, a defined name, or a reference body, with the sheet
    /// qualifier already split off.
    Ident {
        sheet: Option<SheetSpec>,
        body: String,
    },
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Percent,
    Amp,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Comma,
    Semi,
    Colon,
    Eof,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokKind,
    /// Byte offset of the token in the source, for error reporting.
    pub start: usize,
    /// Whether whitespace preceded this token — the intersection operator.
    pub space_before: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    /// Byte offset where the problem was found.
    pub position: usize,
}

impl ParseError {
    pub fn new(message: impl Into<String>, position: usize) -> ParseError {
        ParseError { message: message.into(), position }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (at offset {})", self.message, self.position)
    }
}

impl std::error::Error for ParseError {}

/// Characters that may appear in a bare name, reference or sheet name.
fn is_ref_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '.' || c == '$'
}

pub struct Lexer<'a> {
    src: &'a str,
    chars: Vec<(usize, char)>,
    pos: usize,
}

impl<'a> Lexer<'a> {
    pub fn new(src: &'a str) -> Lexer<'a> {
        Lexer { src, chars: src.char_indices().collect(), pos: 0 }
    }

    /// Tokenises the whole input, ending with a single [`TokKind::Eof`].
    pub fn tokenize(mut self) -> Result<Vec<Token>, ParseError> {
        let mut out = Vec::new();
        loop {
            let space_before = self.skip_whitespace();
            let start = self.offset();
            if self.pos >= self.chars.len() {
                out.push(Token { kind: TokKind::Eof, start, space_before });
                return Ok(out);
            }
            let kind = self.next_kind(start)?;
            out.push(Token { kind, start, space_before });
        }
    }

    fn offset(&self) -> usize {
        self.chars.get(self.pos).map(|&(i, _)| i).unwrap_or(self.src.len())
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).map(|&(_, c)| c)
    }

    fn peek_at(&self, n: usize) -> Option<char> {
        self.chars.get(self.pos + n).map(|&(_, c)| c)
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn skip_whitespace(&mut self) -> bool {
        let start = self.pos;
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.pos += 1;
        }
        self.pos > start
    }

    fn next_kind(&mut self, start: usize) -> Result<TokKind, ParseError> {
        let c = self.peek().expect("caller checked for input");
        match c {
            '+' => self.single(TokKind::Plus),
            '*' => self.single(TokKind::Star),
            '/' => self.single(TokKind::Slash),
            '^' => self.single(TokKind::Caret),
            '%' => self.single(TokKind::Percent),
            '&' => self.single(TokKind::Amp),
            '=' => self.single(TokKind::Eq),
            '(' => self.single(TokKind::LParen),
            ')' => self.single(TokKind::RParen),
            '{' => self.single(TokKind::LBrace),
            '}' => self.single(TokKind::RBrace),
            ',' => self.single(TokKind::Comma),
            ';' => self.single(TokKind::Semi),
            ':' => self.single(TokKind::Colon),
            '-' => self.single(TokKind::Minus),
            '<' => {
                self.pos += 1;
                if self.eat('>') {
                    Ok(TokKind::Ne)
                } else if self.eat('=') {
                    Ok(TokKind::Le)
                } else {
                    Ok(TokKind::Lt)
                }
            }
            '>' => {
                self.pos += 1;
                Ok(if self.eat('=') { TokKind::Ge } else { TokKind::Gt })
            }
            '"' => self.lex_string(start),
            '#' => self.lex_error_literal(start),
            c if c.is_ascii_digit() => self.lex_number(start),
            '.' if self.peek_at(1).is_some_and(|c| c.is_ascii_digit()) => self.lex_number(start),
            '\'' => self.lex_quoted_ref(start),
            c if is_ref_char(c) => self.lex_bare_ref(start),
            other => Err(ParseError::new(format!("unexpected character `{other}`"), start)),
        }
    }

    fn single(&mut self, kind: TokKind) -> Result<TokKind, ParseError> {
        self.pos += 1;
        Ok(kind)
    }

    /// Reads a `"…"` literal. A doubled quote inside stands for one quote.
    fn lex_string(&mut self, start: usize) -> Result<TokKind, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            match self.bump() {
                Some('"') => {
                    if self.eat('"') {
                        out.push('"');
                    } else {
                        return Ok(TokKind::Text(out));
                    }
                }
                Some(c) => out.push(c),
                None => return Err(ParseError::new("unterminated string literal", start)),
            }
        }
    }

    fn lex_error_literal(&mut self, start: usize) -> Result<TokKind, ParseError> {
        const LITERALS: [CellError; 10] = [
            CellError::Div0,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Cycle,
            CellError::Spill,
            CellError::Calc,
            // `#N/A` is checked last: it is a prefix of nothing, but keeping the
            // longer literals first makes the intent explicit.
            CellError::NA,
        ];
        let rest = &self.src[start..];
        for err in LITERALS {
            let lit = err.as_str();
            if rest.len() >= lit.len() && rest[..lit.len()].eq_ignore_ascii_case(lit) {
                self.advance_bytes(lit.len());
                return Ok(TokKind::Error(err));
            }
        }
        Err(ParseError::new("unknown error literal", start))
    }

    /// Moves the cursor forward by a known byte length of ASCII text.
    fn advance_bytes(&mut self, len: usize) {
        let target = self.offset() + len;
        while self.offset() < target && self.pos < self.chars.len() {
            self.pos += 1;
        }
    }

    fn lex_number(&mut self, start: usize) -> Result<TokKind, ParseError> {
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        // An exponent only counts when digits actually follow, so `1E` stays a
        // malformed number rather than swallowing a following reference.
        if matches!(self.peek(), Some('e' | 'E')) {
            let sign_len = usize::from(matches!(self.peek_at(1), Some('+' | '-')));
            if self.peek_at(1 + sign_len).is_some_and(|c| c.is_ascii_digit()) {
                self.pos += 1 + sign_len;
                while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                    self.pos += 1;
                }
            }
        }
        let end = self.offset();
        let text = &self.src[start..end];
        // A name may not start with a digit, so `1A` is a malformed number
        // rather than an identifier.
        if self.peek().is_some_and(is_ref_char) {
            return Err(ParseError::new(format!("malformed number near `{text}`"), start));
        }
        text.parse::<f64>()
            .map(TokKind::Number)
            .map_err(|_| ParseError::new(format!("malformed number `{text}`"), start))
    }

    /// Reads a `'Quoted Sheet'!A1` reference, including the 3-D form.
    fn lex_quoted_ref(&mut self, start: usize) -> Result<TokKind, ParseError> {
        let first = self.read_quoted_name(start)?;
        let last = if self.peek() == Some(':') && self.sheet_range_follows(1) {
            self.pos += 1;
            Some(match self.peek() {
                Some('\'') => self.read_quoted_name(start)?,
                _ => self.read_bare_run(),
            })
        } else {
            None
        };
        if !self.eat('!') {
            return Err(ParseError::new("expected `!` after a quoted sheet name", start));
        }
        let body = self.read_bare_run();
        if body.is_empty() {
            return Err(ParseError::new("expected a reference after `!`", start));
        }
        Ok(TokKind::Ident { sheet: Some(SheetSpec { first, last }), body })
    }

    fn read_quoted_name(&mut self, start: usize) -> Result<String, ParseError> {
        if !self.eat('\'') {
            return Err(ParseError::new("expected a quoted sheet name", start));
        }
        let mut name = String::new();
        loop {
            match self.bump() {
                Some('\'') => {
                    if self.eat('\'') {
                        name.push('\'');
                    } else {
                        return Ok(name);
                    }
                }
                Some(c) => name.push(c),
                None => return Err(ParseError::new("unterminated sheet name", start)),
            }
        }
    }

    fn read_bare_run(&mut self) -> String {
        let start = self.offset();
        while self.peek().is_some_and(is_ref_char) {
            self.pos += 1;
        }
        self.src[start..self.offset()].to_string()
    }

    /// Reads a bare `A1`, `SUM`, `MyName`, `Sheet1!A1` or `Sheet1:Sheet3!A1`.
    fn lex_bare_ref(&mut self, start: usize) -> Result<TokKind, ParseError> {
        let first = self.read_bare_run();

        // `Sheet1:Sheet3!A1` — a colon joins sheet names only when a `!`
        // follows the second name. Otherwise the colon is the range operator
        // and belongs to the parser.
        if self.peek() == Some(':') && self.sheet_range_follows(1) {
            self.pos += 1;
            let last = match self.peek() {
                Some('\'') => self.read_quoted_name(start)?,
                _ => self.read_bare_run(),
            };
            if !self.eat('!') {
                return Err(ParseError::new("expected `!` after a 3-D sheet range", start));
            }
            let body = self.read_bare_run();
            if body.is_empty() {
                return Err(ParseError::new("expected a reference after `!`", start));
            }
            return Ok(TokKind::Ident { sheet: Some(SheetSpec { first, last: Some(last) }), body });
        }

        if self.eat('!') {
            let body = self.read_bare_run();
            if body.is_empty() {
                return Err(ParseError::new("expected a reference after `!`", start));
            }
            return Ok(TokKind::Ident { sheet: Some(SheetSpec::one(first)), body });
        }

        Ok(TokKind::Ident { sheet: None, body: first })
    }

    /// Looks past `offset` characters for `name!`, which is what distinguishes
    /// a 3-D sheet range from the ordinary range operator.
    fn sheet_range_follows(&self, offset: usize) -> bool {
        let mut i = self.pos + offset;
        if self.chars.get(i).map(|&(_, c)| c) == Some('\'') {
            i += 1;
            while let Some(&(_, c)) = self.chars.get(i) {
                if c == '\'' {
                    // A doubled quote is an escape, not the end of the name.
                    if self.chars.get(i + 1).map(|&(_, c)| c) == Some('\'') {
                        i += 2;
                        continue;
                    }
                    return self.chars.get(i + 1).map(|&(_, c)| c) == Some('!');
                }
                i += 1;
            }
            return false;
        }
        let run_start = i;
        while self.chars.get(i).is_some_and(|&(_, c)| is_ref_char(c)) {
            i += 1;
        }
        i > run_start && self.chars.get(i).map(|&(_, c)| c) == Some('!')
    }
}

/// Convenience wrapper over [`Lexer::tokenize`].
pub fn tokenize(src: &str) -> Result<Vec<Token>, ParseError> {
    Lexer::new(src).tokenize()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<TokKind> {
        tokenize(src).unwrap().into_iter().map(|t| t.kind).collect()
    }

    fn ident(sheet: Option<SheetSpec>, body: &str) -> TokKind {
        TokKind::Ident { sheet, body: body.to_string() }
    }

    #[test]
    fn operators_and_comparisons() {
        assert_eq!(
            kinds("<= >= <> < > ="),
            vec![
                TokKind::Le,
                TokKind::Ge,
                TokKind::Ne,
                TokKind::Lt,
                TokKind::Gt,
                TokKind::Eq,
                TokKind::Eof
            ]
        );
    }

    #[test]
    fn strings_unescape_doubled_quotes() {
        assert_eq!(kinds(r#""he said ""hi""""#)[0], TokKind::Text("he said \"hi\"".into()));
        assert!(tokenize("\"open").is_err());
    }

    #[test]
    fn numbers_including_exponents_and_leading_dot() {
        assert_eq!(kinds("1.5")[0], TokKind::Number(1.5));
        assert_eq!(kinds(".5")[0], TokKind::Number(0.5));
        assert_eq!(kinds("1e-3")[0], TokKind::Number(0.001));
        assert_eq!(kinds("2E2")[0], TokKind::Number(200.0));
        // `1E` is not a number and must not silently absorb what follows.
        assert!(tokenize("1E").is_err());
        assert!(tokenize("1A").is_err());
    }

    #[test]
    fn error_literals() {
        assert_eq!(kinds("#DIV/0!")[0], TokKind::Error(CellError::Div0));
        assert_eq!(kinds("#N/A")[0], TokKind::Error(CellError::NA));
        assert_eq!(kinds("#REF!")[0], TokKind::Error(CellError::Ref));
        assert!(tokenize("#WAT!").is_err());
    }

    #[test]
    fn sheet_qualifiers_split_off_the_body() {
        assert_eq!(kinds("Sheet1!A1")[0], ident(Some(SheetSpec::one("Sheet1")), "A1"));
        assert_eq!(kinds("'Q1 Sales'!$B$2")[0], ident(Some(SheetSpec::one("Q1 Sales")), "$B$2"));
        assert_eq!(kinds("'It''s'!A1")[0], ident(Some(SheetSpec::one("It's")), "A1"));
    }

    #[test]
    fn a_colon_between_sheet_names_is_a_3d_reference() {
        assert_eq!(
            kinds("Sheet1:Sheet3!A1")[0],
            ident(Some(SheetSpec { first: "Sheet1".into(), last: Some("Sheet3".into()) }), "A1")
        );
        assert_eq!(
            kinds("'a b':'c d'!A1")[0],
            ident(Some(SheetSpec { first: "a b".into(), last: Some("c d".into()) }), "A1")
        );
    }

    #[test]
    fn a_colon_between_cells_stays_the_range_operator() {
        assert_eq!(
            kinds("A1:B2"),
            vec![ident(None, "A1"), TokKind::Colon, ident(None, "B2"), TokKind::Eof]
        );
        assert_eq!(
            kinds("Sheet1!A1:B2"),
            vec![
                ident(Some(SheetSpec::one("Sheet1")), "A1"),
                TokKind::Colon,
                ident(None, "B2"),
                TokKind::Eof
            ]
        );
    }

    #[test]
    fn whitespace_is_recorded_for_the_intersection_operator() {
        let toks = tokenize("A1:A5 B1:B5").unwrap();
        let space: Vec<bool> = toks.iter().map(|t| t.space_before).collect();
        // Only the token starting the second reference is preceded by a space.
        assert_eq!(space, vec![false, false, false, true, false, false, false]);
    }

    #[test]
    fn function_names_may_contain_dots_and_underscores() {
        assert_eq!(kinds("_xlfn.STDEV.P")[0], ident(None, "_xlfn.STDEV.P"));
    }
}
