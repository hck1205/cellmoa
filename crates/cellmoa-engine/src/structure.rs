//! Inserting and deleting rows and columns.
//!
//! A structural edit is not a new kind of operation in the journal — it is a
//! group of ordinary cell writes, computed once and applied as one commit. That
//! is a deliberate choice. It means insert and delete undo, replay and
//! fingerprint through exactly the same machinery as typing into a cell, with
//! no second code path that could disagree with the first.
//!
//! Two things move, and they are separate problems. The *cells* on the changed
//! sheet slide up or down. The *formulas* — everywhere in the workbook, on
//! every sheet — have their references rewritten to follow them.

use cellmoa_core::edit::Op;
use cellmoa_core::model::{CellAddr, CellContent, SheetId, Workbook};
use cellmoa_core::reference::{MAX_COLS, MAX_ROWS};
use cellmoa_formula::adjust::{adjust, Axis, Shift};
use cellmoa_formula::parse;
use std::collections::{BTreeMap, BTreeSet};

/// Why a structural edit could not be made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StructureError {
    NoSuchSheet(SheetId),
    /// The index is past the end of what a sheet can hold.
    OutOfRange {
        at: u32,
        limit: u32,
    },
    /// A count of zero would be a no-op written to the journal as if it were a
    /// change, which makes the audit trail lie.
    EmptyCount,
}

impl std::fmt::Display for StructureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StructureError::NoSuchSheet(id) => write!(f, "there is no sheet {id}"),
            StructureError::OutOfRange { at, limit } => {
                write!(f, "index {at} is outside the sheet, which holds {limit}")
            }
            StructureError::EmptyCount => f.write_str("a count of zero changes nothing"),
        }
    }
}

impl std::error::Error for StructureError {}

/// The ops that insert `count` rows at `at`.
pub fn insert_rows(
    workbook: &Workbook,
    sheet: SheetId,
    at: u32,
    count: u32,
) -> Result<Vec<Op>, StructureError> {
    plan(workbook, sheet, Axis::Rows, at, count as i64)
}

/// The ops that delete `count` rows starting at `at`.
pub fn remove_rows(
    workbook: &Workbook,
    sheet: SheetId,
    at: u32,
    count: u32,
) -> Result<Vec<Op>, StructureError> {
    plan(workbook, sheet, Axis::Rows, at, -(count as i64))
}

/// The ops that insert `count` columns at `at`.
pub fn insert_cols(
    workbook: &Workbook,
    sheet: SheetId,
    at: u32,
    count: u32,
) -> Result<Vec<Op>, StructureError> {
    plan(workbook, sheet, Axis::Cols, at, count as i64)
}

/// The ops that delete `count` columns starting at `at`.
pub fn remove_cols(
    workbook: &Workbook,
    sheet: SheetId,
    at: u32,
    count: u32,
) -> Result<Vec<Op>, StructureError> {
    plan(workbook, sheet, Axis::Cols, at, -(count as i64))
}

fn plan(
    workbook: &Workbook,
    sheet: SheetId,
    axis: Axis,
    at: u32,
    count: i64,
) -> Result<Vec<Op>, StructureError> {
    if count == 0 {
        return Err(StructureError::EmptyCount);
    }
    let target = workbook.sheet(sheet).ok_or(StructureError::NoSuchSheet(sheet))?;
    let limit = match axis {
        Axis::Rows => MAX_ROWS,
        Axis::Cols => MAX_COLS,
    };
    if at >= limit {
        return Err(StructureError::OutOfRange { at, limit });
    }
    let shift = Shift { sheet: target.name.clone(), axis, at, count };

    // Every address whose content changes, and what it becomes. A map rather
    // than a list because a cell can be written twice — once because something
    // slid into it and once because its own formula was rewritten — and the
    // second answer is the one that has to survive.
    let mut planned: BTreeMap<CellAddr, CellContent> = BTreeMap::new();

    // The cells on the changed sheet move. Clearing and landing are two
    // separate passes, and they have to be: a cell that lands on an address
    // that also has to be cleared would otherwise be wiped out by the clear,
    // depending on which one the loop reached last.
    for (col, row, _) in target.iter() {
        let index = match axis {
            Axis::Rows => row,
            Axis::Cols => col,
        };
        if index >= at {
            planned.insert(CellAddr { sheet, col, row }, CellContent::Empty);
        }
    }
    for (col, row, cell) in target.iter() {
        let index = match axis {
            Axis::Rows => row,
            Axis::Cols => col,
        };
        if index < at {
            continue;
        }
        if let Some(moved) = shift.moved(index) {
            let addr = match axis {
                Axis::Rows => CellAddr { sheet, col, row: moved },
                Axis::Cols => CellAddr { sheet, col: moved, row },
            };
            planned.insert(addr, cell.content.clone());
        }
    }

    // Now the formulas, across the whole workbook: a formula on another sheet
    // pointing into this one has to follow what it points at.
    //
    // Every address that will hold something afterwards is considered, and its
    // *post-move* content is what gets rewritten. A formula that slid down with
    // an insert still needs its references adjusted — it moved, but so did
    // everything it was pointing at.
    let mut candidates: BTreeSet<CellAddr> = planned.keys().copied().collect();
    for source in workbook.sheets() {
        for (col, row, _) in source.iter() {
            candidates.insert(CellAddr { sheet: source.id, col, row });
        }
    }
    for addr in candidates {
        let content = planned.get(&addr).cloned().unwrap_or_else(|| workbook.content(addr));
        let CellContent::Formula(text) = content else {
            continue;
        };
        let Some(on_sheet) = workbook.sheet(addr.sheet).map(|s| s.name.clone()) else {
            continue;
        };
        let Ok(expr) = parse(&text) else {
            // An unparseable formula keeps its text rather than being silently
            // rewritten into something else.
            continue;
        };
        let rewritten = adjust(&expr, &shift, &on_sheet).to_string();
        if rewritten != text {
            planned.insert(addr, CellContent::Formula(rewritten));
        }
    }

    Ok(planned.into_iter().map(|(addr, content)| Op::SetCell { addr, content }).collect())
}

/// One structural change, named so a caller can pass it around.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alter {
    InsertRows { sheet: SheetId, at: u32, count: u32 },
    RemoveRows { sheet: SheetId, at: u32, count: u32 },
    InsertCols { sheet: SheetId, at: u32, count: u32 },
    RemoveCols { sheet: SheetId, at: u32, count: u32 },
}

impl Alter {
    /// The cell writes this change amounts to.
    pub fn plan(self, workbook: &Workbook) -> Result<Vec<Op>, StructureError> {
        match self {
            Alter::InsertRows { sheet, at, count } => insert_rows(workbook, sheet, at, count),
            Alter::RemoveRows { sheet, at, count } => remove_rows(workbook, sheet, at, count),
            Alter::InsertCols { sheet, at, count } => insert_cols(workbook, sheet, at, count),
            Alter::RemoveCols { sheet, at, count } => remove_cols(workbook, sheet, at, count),
        }
    }
}

/// Why an `alter` failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AlterError {
    Structure(StructureError),
    Edit(cellmoa_core::edit::EditError),
}

impl std::fmt::Display for AlterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlterError::Structure(e) => e.fmt(f),
            AlterError::Edit(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for AlterError {}
