//! XLSX import and export, built into the engine rather than bolted on.
//!
//! The point of owning this rather than reaching for a general spreadsheet
//! library is fidelity: formulas keep their source text, references keep their
//! `$` markers, and parts this crate does not model are carried through
//! untouched instead of being dropped on save.

pub mod package;
pub mod read;
pub mod write;
pub mod xml;
pub mod zip;

pub use package::Package;
pub use read::{read_workbook, ReadError};
pub use write::write_workbook;
pub use zip::{Archive, ZipError};
