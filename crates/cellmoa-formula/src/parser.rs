//! The formula parser.
//!
//! Precedence follows Excel's own table, which is not the one most languages
//! use. Two places where getting it wrong changes results:
//!
//! * unary minus binds **tighter** than `^`, so `-2^2` is `4`, not `-4`;
//! * `^` is left-associative, so `2^3^2` is `64`, not `512`.
//!
//! From loosest to tightest: comparison, `&`, `+ -`, `* /`, `^`, `%`, unary
//! `- +`, then the reference operators (intersection, then `:`).

use crate::ast::{BinaryOp, ColRef, Expr, Ref, RefKind, RowRef, SheetSpec, UnaryOp};
use crate::lexer::{tokenize, ParseError, TokKind, Token};
use cellmoa_core::reference::{letters_to_col, CellRef, RangeRef, MAX_ROWS};

/// Parses a formula, with or without a leading `=`.
pub fn parse(src: &str) -> Result<Expr, ParseError> {
    let body = src.strip_prefix('=').unwrap_or(src);
    let mut parser = Parser { toks: tokenize(body)?, pos: 0 };
    let expr = parser.parse_expr()?;
    match parser.peek().kind {
        TokKind::Eof => Ok(expr),
        _ => Err(ParseError::new("unexpected trailing input", parser.peek().start)),
    }
}

/// An identifier that is not yet known to be a reference: it becomes a column
/// or row endpoint if a `:` follows, and a defined name otherwise.
struct Partial {
    sheet: Option<SheetSpec>,
    body: String,
}

enum Atom {
    Done(Expr),
    Partial(Partial),
}

struct Parser {
    toks: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> &Token {
        &self.toks[self.pos.min(self.toks.len() - 1)]
    }

    fn bump(&mut self) -> Token {
        let tok = self.peek().clone();
        if self.pos < self.toks.len() - 1 {
            self.pos += 1;
        }
        tok
    }

    fn eat(&mut self, kind: &TokKind) -> bool {
        if &self.peek().kind == kind {
            self.bump();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, kind: &TokKind, what: &str) -> Result<(), ParseError> {
        if self.eat(kind) {
            Ok(())
        } else {
            Err(ParseError::new(format!("expected {what}"), self.peek().start))
        }
    }

    fn parse_expr(&mut self) -> Result<Expr, ParseError> {
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_concat()?;
        loop {
            let op = match self.peek().kind {
                TokKind::Eq => BinaryOp::Eq,
                TokKind::Ne => BinaryOp::Ne,
                TokKind::Lt => BinaryOp::Lt,
                TokKind::Le => BinaryOp::Le,
                TokKind::Gt => BinaryOp::Gt,
                TokKind::Ge => BinaryOp::Ge,
                _ => return Ok(lhs),
            };
            self.bump();
            let rhs = self.parse_concat()?;
            lhs = binary(op, lhs, rhs);
        }
    }

    fn parse_concat(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_additive()?;
        while self.eat(&TokKind::Amp) {
            let rhs = self.parse_additive()?;
            lhs = binary(BinaryOp::Concat, lhs, rhs);
        }
        Ok(lhs)
    }

    fn parse_additive(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_multiplicative()?;
        loop {
            let op = match self.peek().kind {
                TokKind::Plus => BinaryOp::Add,
                TokKind::Minus => BinaryOp::Sub,
                _ => return Ok(lhs),
            };
            self.bump();
            let rhs = self.parse_multiplicative()?;
            lhs = binary(op, lhs, rhs);
        }
    }

    fn parse_multiplicative(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_power()?;
        loop {
            let op = match self.peek().kind {
                TokKind::Star => BinaryOp::Mul,
                TokKind::Slash => BinaryOp::Div,
                _ => return Ok(lhs),
            };
            self.bump();
            let rhs = self.parse_power()?;
            lhs = binary(op, lhs, rhs);
        }
    }

    /// `^`, left-associative.
    fn parse_power(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_percent()?;
        while self.eat(&TokKind::Caret) {
            let rhs = self.parse_percent()?;
            lhs = binary(BinaryOp::Pow, lhs, rhs);
        }
        Ok(lhs)
    }

    fn parse_percent(&mut self) -> Result<Expr, ParseError> {
        let mut expr = self.parse_unary()?;
        while self.eat(&TokKind::Percent) {
            expr = Expr::Unary { op: UnaryOp::Percent, expr: Box::new(expr) };
        }
        Ok(expr)
    }

    fn parse_unary(&mut self) -> Result<Expr, ParseError> {
        let op = match self.peek().kind {
            TokKind::Minus => UnaryOp::Neg,
            TokKind::Plus => UnaryOp::Plus,
            _ => return self.parse_intersection(),
        };
        self.bump();
        let expr = self.parse_unary()?;
        Ok(Expr::Unary { op, expr: Box::new(expr) })
    }

    /// A space between two references means their intersection.
    fn parse_intersection(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_range()?;
        while is_reference_like(&lhs) && self.peek().space_before && self.starts_reference() {
            let rhs = self.parse_range()?;
            lhs = binary(BinaryOp::Intersect, lhs, rhs);
        }
        Ok(lhs)
    }

    /// Whether the current token could begin another reference — the test that
    /// separates `A1:A5 B1:B5` from `1 + 2`.
    fn starts_reference(&self) -> bool {
        matches!(self.peek().kind, TokKind::Ident { .. } | TokKind::LParen)
    }

    fn parse_range(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.parse_atom()?;
        while self.peek().kind == TokKind::Colon {
            self.bump();
            let rhs = self.parse_atom()?;
            lhs = Atom::Done(join_range(lhs, rhs)?);
        }
        Ok(self.settle(lhs))
    }

    /// Turns a still-ambiguous identifier into a defined name, now that no `:`
    /// followed it.
    fn settle(&self, atom: Atom) -> Expr {
        match atom {
            Atom::Done(expr) => expr,
            Atom::Partial(p) => match p.sheet {
                Some(sheet) => Expr::Name(format!("{sheet}!{}", p.body)),
                None => Expr::Name(p.body),
            },
        }
    }

    fn parse_atom(&mut self) -> Result<Atom, ParseError> {
        let tok = self.bump();
        match tok.kind {
            TokKind::Number(n) => Ok(Atom::Done(Expr::Number(n))),
            TokKind::Text(s) => Ok(Atom::Done(Expr::Text(s))),
            TokKind::Error(e) => Ok(Atom::Done(Expr::Error(e))),
            TokKind::LParen => {
                let expr = self.parse_paren_body()?;
                self.expect(&TokKind::RParen, "`)`")?;
                Ok(Atom::Done(Expr::Paren(Box::new(expr))))
            }
            TokKind::LBrace => Ok(Atom::Done(self.parse_array()?)),
            TokKind::Ident { sheet, body } => self.parse_ident(sheet, body, tok.start),
            _ => Err(ParseError::new("expected a value", tok.start)),
        }
    }

    /// Inside parentheses a comma is the union operator rather than a separator.
    fn parse_paren_body(&mut self) -> Result<Expr, ParseError> {
        let mut expr = self.parse_expr()?;
        while self.eat(&TokKind::Comma) {
            let rhs = self.parse_expr()?;
            expr = binary(BinaryOp::Union, expr, rhs);
        }
        Ok(expr)
    }

    fn parse_ident(
        &mut self,
        sheet: Option<SheetSpec>,
        body: String,
        start: usize,
    ) -> Result<Atom, ParseError> {
        if self.peek().kind == TokKind::LParen {
            if sheet.is_some() {
                return Err(ParseError::new("a function name cannot be sheet-qualified", start));
            }
            self.bump();
            let args = self.parse_args()?;
            self.expect(&TokKind::RParen, "`)` to close the argument list")?;
            return Ok(Atom::Done(Expr::Func { name: body, args }));
        }
        if sheet.is_none() {
            if body.eq_ignore_ascii_case("TRUE") {
                return Ok(Atom::Done(Expr::Bool(true)));
            }
            if body.eq_ignore_ascii_case("FALSE") {
                return Ok(Atom::Done(Expr::Bool(false)));
            }
        }
        match CellRef::parse_a1(&body) {
            Some(cell) => Ok(Atom::Done(Expr::Ref(Ref { sheet, kind: RefKind::Cell(cell) }))),
            // Could still be a column or row endpoint; `parse_range` decides.
            None => Ok(Atom::Partial(Partial { sheet, body })),
        }
    }

    fn parse_args(&mut self) -> Result<Vec<Expr>, ParseError> {
        if self.peek().kind == TokKind::RParen {
            return Ok(Vec::new());
        }
        let mut args = Vec::new();
        loop {
            // An omitted argument, as in `IF(A1,,0)`, is a real position.
            if matches!(self.peek().kind, TokKind::Comma | TokKind::RParen) {
                args.push(Expr::Missing);
            } else {
                args.push(self.parse_expr()?);
            }
            if !self.eat(&TokKind::Comma) {
                return Ok(args);
            }
        }
    }

    /// `{1,2;3,4}` — commas separate columns, semicolons separate rows.
    fn parse_array(&mut self) -> Result<Expr, ParseError> {
        let mut rows = Vec::new();
        let mut row = Vec::new();
        loop {
            row.push(self.parse_expr()?);
            match self.peek().kind {
                TokKind::Comma => {
                    self.bump();
                }
                TokKind::Semi => {
                    self.bump();
                    rows.push(std::mem::take(&mut row));
                }
                TokKind::RBrace => {
                    self.bump();
                    rows.push(row);
                    let width = rows[0].len();
                    if rows.iter().any(|r| r.len() != width) {
                        return Err(ParseError::new(
                            "array rows must all have the same length",
                            self.peek().start,
                        ));
                    }
                    return Ok(Expr::Array(rows));
                }
                _ => {
                    return Err(ParseError::new(
                        "expected `,`, `;` or `}` in an array literal",
                        self.peek().start,
                    ))
                }
            }
        }
    }
}

/// Whether an expression can be the left side of an intersection. Without this
/// guard a stray space would turn `1 A1` into an intersection instead of the
/// syntax error it is.
fn is_reference_like(expr: &Expr) -> bool {
    matches!(
        expr,
        Expr::Ref(_) | Expr::Name(_) | Expr::Func { .. } | Expr::Paren(_) | Expr::Binary { .. }
    )
}

fn binary(op: BinaryOp, lhs: Expr, rhs: Expr) -> Expr {
    Expr::Binary { op, lhs: Box::new(lhs), rhs: Box::new(rhs) }
}

/// Combines the two sides of a `:` into the tightest reference that fits.
///
/// Falls back to a dynamic range operator for things like `A1:INDEX(B:B,2)`,
/// where the endpoint is only known at evaluation time.
fn join_range(lhs: Atom, rhs: Atom) -> Result<Expr, ParseError> {
    let (left, right) = (endpoint(lhs), endpoint(rhs));
    // The sheet qualifier on the left endpoint governs the whole range:
    // `Sheet1!A1:B2` means `Sheet1!A1:Sheet1!B2`.
    let sheet = left.sheet();
    Ok(match (left, right) {
        (End::Cell { cell: a, .. }, End::Cell { cell: b, .. }) => {
            Expr::Ref(Ref { sheet, kind: RefKind::Range(RangeRef::new(a, b)) })
        }
        (End::Col { col: a, .. }, End::Col { col: b, .. }) => {
            let (a, b) = if a.col <= b.col { (a, b) } else { (b, a) };
            Expr::Ref(Ref { sheet, kind: RefKind::Cols(a, b) })
        }
        (End::Row { row: a, .. }, End::Row { row: b, .. }) => {
            let (a, b) = if a.row <= b.row { (a, b) } else { (b, a) };
            Expr::Ref(Ref { sheet, kind: RefKind::Rows(a, b) })
        }
        (a, b) => binary(BinaryOp::Range, a.into_expr(), b.into_expr()),
    })
}

/// One side of a `:`, classified as far as syntax allows.
enum End {
    Cell {
        sheet: Option<SheetSpec>,
        cell: CellRef,
    },
    /// A bare column letter such as the `A` in `A:C`.
    Col {
        sheet: Option<SheetSpec>,
        col: ColRef,
    },
    /// A bare row number such as the `1` in `1:3`.
    Row {
        sheet: Option<SheetSpec>,
        row: RowRef,
    },
    /// Anything else — a function call, a name, a parenthesised expression.
    Other(Expr),
}

impl End {
    fn sheet(&self) -> Option<SheetSpec> {
        match self {
            End::Cell { sheet, .. } | End::Col { sheet, .. } | End::Row { sheet, .. } => {
                sheet.clone()
            }
            End::Other(_) => None,
        }
    }

    fn into_expr(self) -> Expr {
        match self {
            End::Cell { sheet, cell } => Expr::Ref(Ref { sheet, kind: RefKind::Cell(cell) }),
            End::Col { sheet, col } => Expr::Ref(Ref { sheet, kind: RefKind::Cols(col, col) }),
            End::Row { sheet, row } => Expr::Ref(Ref { sheet, kind: RefKind::Rows(row, row) }),
            End::Other(expr) => expr,
        }
    }
}

fn endpoint(atom: Atom) -> End {
    match atom {
        Atom::Done(Expr::Ref(Ref { sheet, kind: RefKind::Cell(cell) })) => {
            End::Cell { sheet, cell }
        }
        // A plain integer is a relative row endpoint: the `1` in `1:3`.
        Atom::Done(Expr::Number(n)) => match row_from_number(n) {
            Some(row) => End::Row { sheet: None, row },
            None => End::Other(Expr::Number(n)),
        },
        Atom::Done(expr) => End::Other(expr),
        Atom::Partial(p) => {
            if let Some(col) = col_from_text(&p.body) {
                End::Col { sheet: p.sheet, col }
            } else if let Some(row) = row_from_absolute_text(&p.body) {
                End::Row { sheet: p.sheet, row }
            } else {
                End::Other(match p.sheet {
                    Some(sheet) => Expr::Name(format!("{sheet}!{}", p.body)),
                    None => Expr::Name(p.body),
                })
            }
        }
    }
}

fn col_from_text(text: &str) -> Option<ColRef> {
    let (abs, letters) = match text.strip_prefix('$') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    letters_to_col(letters).map(|col| ColRef { col, abs })
}

fn row_from_number(n: f64) -> Option<RowRef> {
    let r = n as u32;
    (n.fract() == 0.0 && n >= 1.0 && n <= MAX_ROWS as f64)
        .then(|| RowRef { row: r - 1, abs: false })
}

/// The `$1` form, which lexes as an identifier rather than a number.
fn row_from_absolute_text(text: &str) -> Option<RowRef> {
    let digits = text.strip_prefix('$')?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let r: u32 = digits.parse().ok()?;
    (1..=MAX_ROWS).contains(&r).then(|| RowRef { row: r - 1, abs: true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellmoa_core::value::CellError;

    fn p(src: &str) -> Expr {
        parse(src).unwrap_or_else(|e| panic!("failed to parse `{src}`: {e}"))
    }

    /// A formula written in canonical form must survive parse → print unchanged.
    fn round_trip(src: &str) {
        assert_eq!(p(src).to_string(), src, "round trip of `{src}`");
    }

    #[test]
    fn unary_minus_binds_tighter_than_the_power_operator() {
        // Excel's own quirk: -2^2 is 4, not -4.
        assert_eq!(
            p("-2^2"),
            binary(
                BinaryOp::Pow,
                Expr::Unary { op: UnaryOp::Neg, expr: Box::new(Expr::Number(2.0)) },
                Expr::Number(2.0)
            )
        );
        // The negation on the right of `^` still parses as an exponent sign.
        assert_eq!(
            p("2^-1"),
            binary(
                BinaryOp::Pow,
                Expr::Number(2.0),
                Expr::Unary { op: UnaryOp::Neg, expr: Box::new(Expr::Number(1.0)) }
            )
        );
    }

    #[test]
    fn the_power_operator_is_left_associative() {
        // 2^3^2 is (2^3)^2 = 64 in Excel, not 2^(3^2) = 512.
        let Expr::Binary { op, lhs, .. } = p("2^3^2") else { panic!("expected a binary node") };
        assert_eq!(op, BinaryOp::Pow);
        assert!(matches!(*lhs, Expr::Binary { op: BinaryOp::Pow, .. }));
    }

    #[test]
    fn arithmetic_precedence() {
        let Expr::Binary { op, rhs, .. } = p("1+2*3") else { panic!("expected a binary node") };
        assert_eq!(op, BinaryOp::Add);
        assert!(matches!(*rhs, Expr::Binary { op: BinaryOp::Mul, .. }));
    }

    #[test]
    fn comparison_is_the_loosest_operator() {
        let Expr::Binary { op, lhs, .. } = p("1+2=3") else { panic!("expected a binary node") };
        assert_eq!(op, BinaryOp::Eq);
        assert!(matches!(*lhs, Expr::Binary { op: BinaryOp::Add, .. }));
    }

    #[test]
    fn concatenation_sits_between_arithmetic_and_comparison() {
        let Expr::Binary { op, lhs, .. } = p("1&2=3") else { panic!("expected a binary node") };
        assert_eq!(op, BinaryOp::Eq);
        assert!(matches!(*lhs, Expr::Binary { op: BinaryOp::Concat, .. }));
    }

    #[test]
    fn percent_is_a_postfix_operator() {
        assert_eq!(
            p("50%"),
            Expr::Unary { op: UnaryOp::Percent, expr: Box::new(Expr::Number(50.0)) }
        );
        round_trip("A1*50%");
    }

    #[test]
    fn cell_and_range_references() {
        assert_eq!(p("A1"), Expr::Ref(Ref::cell(CellRef::new(0, 0))));
        assert_eq!(
            p("$B$7"),
            Expr::Ref(Ref::cell(CellRef { col: 1, row: 6, col_abs: true, row_abs: true }))
        );
        assert_eq!(
            p("A1:B2"),
            Expr::Ref(Ref::local(RefKind::Range(RangeRef::parse_a1("A1:B2").unwrap())))
        );
    }

    #[test]
    fn whole_column_and_whole_row_ranges() {
        assert_eq!(
            p("A:C"),
            Expr::Ref(Ref::local(RefKind::Cols(
                ColRef { col: 0, abs: false },
                ColRef { col: 2, abs: false }
            )))
        );
        assert_eq!(
            p("$A:$A"),
            Expr::Ref(Ref::local(RefKind::Cols(
                ColRef { col: 0, abs: true },
                ColRef { col: 0, abs: true }
            )))
        );
        assert_eq!(
            p("1:3"),
            Expr::Ref(Ref::local(RefKind::Rows(
                RowRef { row: 0, abs: false },
                RowRef { row: 2, abs: false }
            )))
        );
        assert_eq!(
            p("$1:$3"),
            Expr::Ref(Ref::local(RefKind::Rows(
                RowRef { row: 0, abs: true },
                RowRef { row: 2, abs: true }
            )))
        );
    }

    #[test]
    fn the_left_sheet_qualifier_governs_the_whole_range() {
        let Expr::Ref(r) = p("Sheet1!A1:B2") else { panic!("expected a reference") };
        assert_eq!(r.sheet, Some(SheetSpec::one("Sheet1")));
        assert_eq!(r.kind, RefKind::Range(RangeRef::parse_a1("A1:B2").unwrap()));
        assert_eq!(p("Sheet1!A1:B2").to_string(), "Sheet1!A1:B2");
    }

    #[test]
    fn three_dimensional_references() {
        let Expr::Ref(r) = p("Sheet1:Sheet3!A1") else { panic!("expected a reference") };
        assert_eq!(
            r.sheet,
            Some(SheetSpec { first: "Sheet1".into(), last: Some("Sheet3".into()) })
        );
        round_trip("Sheet1:Sheet3!A1");
    }

    #[test]
    fn sheet_names_are_requoted_only_when_needed() {
        round_trip("'Q1 Sales'!A1");
        round_trip("Sheet1!A1");
        assert_eq!(p("'Sheet1'!A1").to_string(), "Sheet1!A1");
    }

    #[test]
    fn function_calls_including_omitted_arguments() {
        assert_eq!(
            p("SUM(A1:A5,B1)"),
            Expr::Func {
                name: "SUM".into(),
                args: vec![
                    Expr::Ref(Ref::local(RefKind::Range(RangeRef::parse_a1("A1:A5").unwrap()))),
                    Expr::Ref(Ref::cell(CellRef::new(1, 0))),
                ]
            }
        );
        assert_eq!(p("TODAY()"), Expr::Func { name: "TODAY".into(), args: vec![] });
        // An omitted argument keeps its position, so IF still sees three of them.
        let Expr::Func { args, .. } = p("IF(A1,,0)") else { panic!("expected a call") };
        assert_eq!(args.len(), 3);
        assert_eq!(args[1], Expr::Missing);
        round_trip("IF(A1,,0)");
    }

    #[test]
    fn function_names_keep_their_original_spelling() {
        assert_eq!(p("sum(A1)").to_string(), "sum(A1)");
        round_trip("_xlfn.STDEV.P(A1:A9)");
    }

    #[test]
    fn true_and_false_are_literals_but_can_also_be_called() {
        assert_eq!(p("TRUE"), Expr::Bool(true));
        assert_eq!(p("false"), Expr::Bool(false));
        assert_eq!(p("TRUE()"), Expr::Func { name: "TRUE".into(), args: vec![] });
    }

    #[test]
    fn array_literals() {
        assert_eq!(
            p("{1,2;3,4}"),
            Expr::Array(vec![
                vec![Expr::Number(1.0), Expr::Number(2.0)],
                vec![Expr::Number(3.0), Expr::Number(4.0)],
            ])
        );
        round_trip("{1,2;3,4}");
        assert!(parse("{1,2;3}").is_err(), "ragged array rows must be rejected");
    }

    #[test]
    fn a_comma_inside_extra_parentheses_is_the_union_operator() {
        let Expr::Func { args, .. } = p("SUM((A1:A2,C1:C2))") else { panic!("expected a call") };
        assert_eq!(args.len(), 1, "the union is one argument, not two");
        let Expr::Paren(inner) = &args[0] else { panic!("expected parentheses") };
        assert!(matches!(**inner, Expr::Binary { op: BinaryOp::Union, .. }));
        round_trip("SUM((A1:A2,C1:C2))");
    }

    #[test]
    fn a_space_between_references_is_the_intersection_operator() {
        assert!(matches!(p("A1:A5 B1:B5"), Expr::Binary { op: BinaryOp::Intersect, .. }));
        round_trip("A1:A5 B1:B5");
        // A space that is not between references stays insignificant.
        assert_eq!(p("1 + 2"), binary(BinaryOp::Add, Expr::Number(1.0), Expr::Number(2.0)));
        assert!(parse("1 A1").is_err());
    }

    #[test]
    fn defined_names() {
        assert_eq!(p("TaxRate"), Expr::Name("TaxRate".into()));
        assert_eq!(p("Sheet1!Total"), Expr::Name("Sheet1!Total".into()));
        round_trip("Sheet1!Total*2");
    }

    #[test]
    fn error_literals_are_values() {
        assert_eq!(p("#N/A"), Expr::Error(CellError::NA));
        round_trip("IFERROR(A1,#N/A)");
    }

    #[test]
    fn string_literals_re_escape_on_the_way_out() {
        assert_eq!(p(r#""he said ""hi""""#), Expr::Text("he said \"hi\"".into()));
        round_trip(r#"CONCAT("a""b","c")"#);
    }

    #[test]
    fn redundant_parentheses_survive_the_round_trip() {
        round_trip("(1+2)*3");
        round_trip("((A1))");
    }

    #[test]
    fn a_dynamic_endpoint_falls_back_to_the_range_operator() {
        assert!(matches!(p("A1:INDEX(B:B,2)"), Expr::Binary { op: BinaryOp::Range, .. }));
        round_trip("A1:INDEX(B:B,2)");
    }

    #[test]
    fn the_leading_equals_sign_is_optional() {
        assert_eq!(p("=1+1"), p("1+1"));
    }

    #[test]
    fn malformed_input_is_rejected_with_a_position() {
        assert!(parse("SUM(A1").is_err());
        assert!(parse("1+").is_err());
        assert!(parse("A1 B1)").is_err());
        let err = parse("1+*2").unwrap_err();
        assert_eq!(err.position, 2);
    }

    #[test]
    fn refs_and_names_are_collected_for_the_dependency_graph() {
        let expr = p("SUM(A1:A5,Sheet2!B$3)*TaxRate+{1,2}");
        let refs: Vec<String> = expr.refs().iter().map(|r| r.to_string()).collect();
        assert_eq!(refs, vec!["A1:A5", "Sheet2!B$3"]);
        assert_eq!(expr.names(), vec!["TaxRate"]);
    }
}
