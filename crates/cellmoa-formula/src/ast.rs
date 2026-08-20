//! The formula syntax tree.
//!
//! The tree keeps enough of the source to reproduce it verbatim: absolute-
//! reference markers, redundant parentheses, the original spelling of function
//! and sheet names. Export writes formulas back from this tree, so anything it
//! forgets is data lost on a round trip (C1).

use cellmoa_core::reference::{col_to_letters, CellRef, RangeRef};
use cellmoa_core::value::CellError;
use std::fmt;

/// A whole-column endpoint, as in `A:C`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ColRef {
    pub col: u32,
    pub abs: bool,
}

/// A whole-row endpoint, as in `1:3`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RowRef {
    pub row: u32,
    pub abs: bool,
}

/// What a reference points at, before any sheet qualifier is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RefKind {
    Cell(CellRef),
    Range(RangeRef),
    /// `A:C` — every row of the given columns.
    Cols(ColRef, ColRef),
    /// `1:3` — every column of the given rows.
    Rows(RowRef, RowRef),
    /// A `#REF!` left behind when the target was deleted.
    Invalid,
}

/// The sheet qualifier on a reference. `last` is set only for a 3-D reference
/// such as `Sheet1:Sheet3!A1`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SheetSpec {
    pub first: String,
    pub last: Option<String>,
}

impl SheetSpec {
    pub fn one(name: impl Into<String>) -> SheetSpec {
        SheetSpec { first: name.into(), last: None }
    }
}

impl fmt::Display for SheetSpec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.last {
            Some(last) => write!(f, "{}:{}", quote_sheet(&self.first), quote_sheet(last)),
            None => f.write_str(&quote_sheet(&self.first)),
        }
    }
}

/// A reference expression: an optional sheet qualifier plus a target.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Ref {
    pub sheet: Option<SheetSpec>,
    pub kind: RefKind,
}

impl Ref {
    pub fn local(kind: RefKind) -> Ref {
        Ref { sheet: None, kind }
    }

    pub fn cell(cell: CellRef) -> Ref {
        Ref::local(RefKind::Cell(cell))
    }
}

impl fmt::Display for Ref {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(sheet) = &self.sheet {
            write!(f, "{sheet}!")?;
        }
        match &self.kind {
            RefKind::Cell(c) => f.write_str(&c.to_a1()),
            RefKind::Range(r) => f.write_str(&r.to_a1()),
            RefKind::Cols(a, b) => write!(f, "{}:{}", fmt_col(a), fmt_col(b)),
            RefKind::Rows(a, b) => write!(f, "{}:{}", fmt_row(a), fmt_row(b)),
            RefKind::Invalid => f.write_str(CellError::Ref.as_str()),
        }
    }
}

fn fmt_col(c: &ColRef) -> String {
    format!("{}{}", if c.abs { "$" } else { "" }, col_to_letters(c.col))
}

fn fmt_row(r: &RowRef) -> String {
    format!("{}{}", if r.abs { "$" } else { "" }, r.row + 1)
}

/// Wraps a sheet name in quotes when the bare form would not lex back.
pub fn quote_sheet(name: &str) -> String {
    let needs_quotes = name.is_empty()
        || name.chars().next().is_some_and(|c| c.is_ascii_digit())
        || !name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.');
    if needs_quotes {
        format!("'{}'", name.replace('\'', "''"))
    } else {
        name.to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UnaryOp {
    /// Leading `-`.
    Neg,
    /// Leading `+`, which is a no-op but is preserved for round-tripping.
    Plus,
    /// Trailing `%`.
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Concat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    /// `A1:B2` — the range operator between two references.
    Range,
    /// A space between two references: their intersection.
    Intersect,
    /// A comma between two references inside parentheses: their union.
    Union,
}

impl BinaryOp {
    pub const fn symbol(self) -> &'static str {
        match self {
            BinaryOp::Add => "+",
            BinaryOp::Sub => "-",
            BinaryOp::Mul => "*",
            BinaryOp::Div => "/",
            BinaryOp::Pow => "^",
            BinaryOp::Concat => "&",
            BinaryOp::Eq => "=",
            BinaryOp::Ne => "<>",
            BinaryOp::Lt => "<",
            BinaryOp::Le => "<=",
            BinaryOp::Gt => ">",
            BinaryOp::Ge => ">=",
            BinaryOp::Range => ":",
            BinaryOp::Intersect => " ",
            BinaryOp::Union => ",",
        }
    }
}

/// A node in the formula tree.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    /// An error literal written directly in the formula, e.g. `NA()`'s `#N/A`.
    Error(CellError),
    Ref(Ref),
    /// A defined name or a table reference that is resolved at evaluation time.
    Name(String),
    Func {
        /// The name as written, so `SUM` and `sum` both round-trip.
        name: String,
        args: Vec<Expr>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
    /// An array literal: rows of constants, `{1,2;3,4}`.
    Array(Vec<Vec<Expr>>),
    /// Explicit parentheses. Kept as a node because removing them would change
    /// the source text even when it would not change the value.
    Paren(Box<Expr>),
    /// An argument that was left out, as in `IF(A1,,"no")`.
    Missing,
}

impl Expr {
    /// Visits every node, parents before children.
    pub fn walk(&self, f: &mut impl FnMut(&Expr)) {
        f(self);
        match self {
            Expr::Unary { expr, .. } | Expr::Paren(expr) => expr.walk(f),
            Expr::Binary { lhs, rhs, .. } => {
                lhs.walk(f);
                rhs.walk(f);
            }
            Expr::Func { args, .. } => args.iter().for_each(|a| a.walk(f)),
            Expr::Array(rows) => rows.iter().flatten().for_each(|c| c.walk(f)),
            _ => {}
        }
    }

    /// Every reference the formula mentions. The dependency graph is built from
    /// this, so a reference the walker misses is a cell that never recalculates.
    pub fn refs(&self) -> Vec<&Ref> {
        let mut out = Vec::new();
        // `walk` cannot hand out borrows through a `FnMut(&Expr)`, so collect
        // by matching inside the closure.
        self.collect_refs(&mut out);
        out
    }

    fn collect_refs<'a>(&'a self, out: &mut Vec<&'a Ref>) {
        match self {
            Expr::Ref(r) => out.push(r),
            Expr::Unary { expr, .. } | Expr::Paren(expr) => expr.collect_refs(out),
            Expr::Binary { lhs, rhs, .. } => {
                lhs.collect_refs(out);
                rhs.collect_refs(out);
            }
            Expr::Func { args, .. } => args.iter().for_each(|a| a.collect_refs(out)),
            Expr::Array(rows) => rows.iter().flatten().for_each(|c| c.collect_refs(out)),
            _ => {}
        }
    }

    /// Every defined name the formula mentions.
    pub fn names(&self) -> Vec<&str> {
        let mut out = Vec::new();
        self.collect_names(&mut out);
        out
    }

    fn collect_names<'a>(&'a self, out: &mut Vec<&'a str>) {
        match self {
            Expr::Name(n) => out.push(n),
            Expr::Unary { expr, .. } | Expr::Paren(expr) => expr.collect_names(out),
            Expr::Binary { lhs, rhs, .. } => {
                lhs.collect_names(out);
                rhs.collect_names(out);
            }
            Expr::Func { args, .. } => args.iter().for_each(|a| a.collect_names(out)),
            Expr::Array(rows) => rows.iter().flatten().for_each(|c| c.collect_names(out)),
            _ => {}
        }
    }
}

impl fmt::Display for Expr {
    /// Writes the formula back out without a leading `=`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // A literal in a formula is stored, not shown, so it keeps every digit.
            Expr::Number(n) => f.write_str(&cellmoa_core::value::format_number_exact(*n)),
            Expr::Text(s) => write!(f, "\"{}\"", s.replace('"', "\"\"")),
            Expr::Bool(b) => f.write_str(if *b { "TRUE" } else { "FALSE" }),
            Expr::Error(e) => f.write_str(e.as_str()),
            Expr::Ref(r) => write!(f, "{r}"),
            Expr::Name(n) => f.write_str(n),
            Expr::Func { name, args } => {
                write!(f, "{name}(")?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        f.write_str(",")?;
                    }
                    write!(f, "{arg}")?;
                }
                f.write_str(")")
            }
            Expr::Unary { op: UnaryOp::Percent, expr } => write!(f, "{expr}%"),
            Expr::Unary { op: UnaryOp::Neg, expr } => write!(f, "-{expr}"),
            Expr::Unary { op: UnaryOp::Plus, expr } => write!(f, "+{expr}"),
            Expr::Binary { op, lhs, rhs } => write!(f, "{lhs}{}{rhs}", op.symbol()),
            Expr::Array(rows) => {
                f.write_str("{")?;
                for (i, row) in rows.iter().enumerate() {
                    if i > 0 {
                        f.write_str(";")?;
                    }
                    for (j, cell) in row.iter().enumerate() {
                        if j > 0 {
                            f.write_str(",")?;
                        }
                        write!(f, "{cell}")?;
                    }
                }
                f.write_str("}")
            }
            Expr::Paren(inner) => write!(f, "({inner})"),
            Expr::Missing => Ok(()),
        }
    }
}
