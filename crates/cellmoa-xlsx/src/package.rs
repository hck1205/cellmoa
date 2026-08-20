//! The package: a workbook plus the parts of its file that are carried through
//! unchanged.

use crate::read::{read_workbook, ReadError};
use crate::write::write_workbook;
use crate::zip::Archive;
use cellmoa_core::model::Workbook;
use std::path::Path;

/// An XLSX file, opened.
///
/// The original archive is kept alongside the workbook so that saving preserves
/// the parts this crate does not model. Losing a workbook's formatting because
/// the engine had no opinion about it would be a worse failure than not opening
/// it at all.
pub struct Package {
    pub workbook: Workbook,
    original: Archive,
}

impl Package {
    /// A package with nothing carried over — the starting point for a workbook
    /// created from scratch.
    pub fn new(workbook: Workbook) -> Package {
        Package { workbook, original: Archive::new() }
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Package, ReadError> {
        let original = Archive::read(bytes)?;
        let workbook = read_workbook(&original)?;
        Ok(Package { workbook, original })
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Package, ReadError> {
        let bytes = std::fs::read(path)
            .map_err(|e| ReadError::NotAWorkbook(format!("cannot read the file: {e}")))?;
        Package::from_bytes(&bytes)
    }

    /// Serialises the package.
    ///
    /// Deterministic: the same workbook always produces the same bytes, which
    /// is what lets a fingerprint mean anything.
    pub fn to_bytes(&self) -> Vec<u8> {
        write_workbook(&self.workbook, &self.original).write()
    }

    pub fn save(&self, path: impl AsRef<Path>) -> std::io::Result<()> {
        std::fs::write(path, self.to_bytes())
    }

    /// The parts carried over from the file this package was read from.
    pub fn preserved(&self) -> &Archive {
        &self.original
    }
}
