//! Document model for cellmoa: values, references, workbooks, and the edit
//! history that revision-guarded writes, undo/redo, audit and replay build on.
//!
//! This crate is deliberately free of I/O, time and randomness. Everything that
//! makes a document deterministic — stable iteration order, caller-supplied
//! timestamps, no ambient state — is enforced here so that the fingerprint and
//! replay features further up the stack can rely on it.

pub mod edit;
pub mod fingerprint;
pub mod model;
pub mod reference;
pub mod sha256;
pub mod value;

pub use edit::{Actor, ActorKind, Commit, CommitKind, Document, EditError, Op};
pub use model::{Cell, CellAddr, CellContent, DefinedName, Sheet, SheetId, Workbook};
pub use reference::{CellRef, RangeRef, MAX_COLS, MAX_ROWS};
pub use value::{CellError, Value};
