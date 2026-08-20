//! Excel-compatible formula parsing for cellmoa.
//!
//! The parser produces a tree that round-trips back to source text, so a
//! workbook can be imported, rewritten and exported without a formula being
//! reworded along the way.

pub mod adjust;
pub mod ast;
pub mod lexer;
pub mod parser;
pub mod translate;

pub use ast::{BinaryOp, ColRef, Expr, Ref, RefKind, RowRef, SheetSpec, UnaryOp};
pub use lexer::{tokenize, ParseError};
pub use parser::parse;
