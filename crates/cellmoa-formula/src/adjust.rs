//! Rewriting references when rows or columns are inserted or deleted.
//!
//! This is a different operation from [`crate::translate`], and confusing the
//! two produces wrong answers in both directions. Translating moves a formula
//! and leaves the sheet alone, so `$A$1` stays `$A$1`. Adjusting moves the
//! *sheet* underneath every formula in the workbook, so `$A$1` becomes `$A$2`
//! when a row is inserted above it — absolute means "does not move when
//! copied", not "does not move when the sheet changes shape".
//!
//! Every formula in the workbook has to be considered, not just the ones on the
//! sheet that changed: a formula on `Summary` pointing at `Data!A5` has to
//! follow `Data!A5` when a row is inserted on `Data`.

use crate::ast::{ColRef, Expr, Ref, RefKind, RowRef, SheetSpec};
use cellmoa_core::reference::{CellRef, RangeRef, MAX_COLS, MAX_ROWS};

/// Which way a sheet's cells are being moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    Rows,
    Cols,
}

/// A structural change to one sheet.
#[derive(Debug, Clone)]
pub struct Shift {
    /// The sheet whose shape is changing.
    pub sheet: String,
    pub axis: Axis,
    /// The first index inserted, or the first deleted.
    pub at: u32,
    /// How many. Positive inserts, negative deletes.
    pub count: i64,
}

impl Shift {
    pub fn insert_rows(sheet: impl Into<String>, at: u32, count: u32) -> Shift {
        Shift { sheet: sheet.into(), axis: Axis::Rows, at, count: count as i64 }
    }

    pub fn remove_rows(sheet: impl Into<String>, at: u32, count: u32) -> Shift {
        Shift { sheet: sheet.into(), axis: Axis::Rows, at, count: -(count as i64) }
    }

    pub fn insert_cols(sheet: impl Into<String>, at: u32, count: u32) -> Shift {
        Shift { sheet: sheet.into(), axis: Axis::Cols, at, count: count as i64 }
    }

    pub fn remove_cols(sheet: impl Into<String>, at: u32, count: u32) -> Shift {
        Shift { sheet: sheet.into(), axis: Axis::Cols, at, count: -(count as i64) }
    }

    /// Where a single index ends up, or `None` if it was deleted.
    pub fn moved(&self, index: u32) -> Option<u32> {
        let limit = self.limit();
        if self.count > 0 {
            if index < self.at {
                return Some(index);
            }
            let moved = index as i64 + self.count;
            // Pushed off the end of the sheet: the cell is gone, as it would be
            // in Excel.
            (moved < limit as i64).then_some(moved as u32)
        } else {
            let removed = (-self.count) as u32;
            if index < self.at {
                Some(index)
            } else if index < self.at.saturating_add(removed) {
                None
            } else {
                Some(index - removed)
            }
        }
    }

    /// The start of a range after the shift, clamped rather than deleted.
    fn moved_start(&self, index: u32) -> u32 {
        match self.moved(index) {
            Some(moved) => moved,
            // The row this range began on was deleted, so the range now begins
            // where the deleted block was.
            None => self.at,
        }
    }

    /// The end of a range after the shift, clamped the other way.
    fn moved_end(&self, index: u32) -> Option<u32> {
        match self.moved(index) {
            Some(moved) => Some(moved),
            // Likewise, the range now ends just before the deleted block —
            // which is nothing at all if the block started at zero.
            None => self.at.checked_sub(1),
        }
    }

    fn limit(&self) -> u32 {
        match self.axis {
            Axis::Rows => MAX_ROWS,
            Axis::Cols => MAX_COLS,
        }
    }
}

/// Rewrites every reference in a formula that the shift moves.
///
/// `on_sheet` is the sheet the formula itself lives on, which is what an
/// unqualified reference means.
pub fn adjust(expr: &Expr, shift: &Shift, on_sheet: &str) -> Expr {
    match expr {
        Expr::Ref(reference) => {
            if !applies_to(reference.sheet.as_ref(), shift, on_sheet) {
                return expr.clone();
            }
            Expr::Ref(Ref {
                sheet: reference.sheet.clone(),
                kind: adjust_kind(&reference.kind, shift),
            })
        }
        Expr::Unary { op, expr } => {
            Expr::Unary { op: *op, expr: Box::new(adjust(expr, shift, on_sheet)) }
        }
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(adjust(lhs, shift, on_sheet)),
            rhs: Box::new(adjust(rhs, shift, on_sheet)),
        },
        Expr::Func { name, args } => Expr::Func {
            name: name.clone(),
            args: args.iter().map(|a| adjust(a, shift, on_sheet)).collect(),
        },
        Expr::Paren(inner) => Expr::Paren(Box::new(adjust(inner, shift, on_sheet))),
        Expr::Array(rows) => Expr::Array(
            rows.iter()
                .map(|row| row.iter().map(|c| adjust(c, shift, on_sheet)).collect())
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Whether a reference points at the sheet whose shape is changing.
fn applies_to(spec: Option<&SheetSpec>, shift: &Shift, on_sheet: &str) -> bool {
    match spec {
        // Unqualified means the sheet the formula is written on.
        None => on_sheet.eq_ignore_ascii_case(&shift.sheet),
        Some(spec) => {
            // A 3-D reference spans a run of sheets; if the changed one is an
            // endpoint the reference covers it. Sheets in between cannot be
            // named here, so an endpoint match is as precise as this gets.
            spec.first.eq_ignore_ascii_case(&shift.sheet)
                || spec.last.as_deref().is_some_and(|last| last.eq_ignore_ascii_case(&shift.sheet))
        }
    }
}

fn adjust_kind(kind: &RefKind, shift: &Shift) -> RefKind {
    match kind {
        RefKind::Cell(cell) => match adjust_cell(cell, shift) {
            Some(moved) => RefKind::Cell(moved),
            None => RefKind::Invalid,
        },
        RefKind::Range(range) => match adjust_range(range, shift) {
            Some(moved) => RefKind::Range(moved),
            None => RefKind::Invalid,
        },
        RefKind::Cols(a, b) if shift.axis == Axis::Cols => {
            match (shift.moved_start(a.col), shift.moved_end(b.col)) {
                (start, Some(end)) if start <= end => RefKind::Cols(
                    ColRef { col: start, abs: a.abs },
                    ColRef { col: end, abs: b.abs },
                ),
                _ => RefKind::Invalid,
            }
        }
        RefKind::Rows(a, b) if shift.axis == Axis::Rows => {
            match (shift.moved_start(a.row), shift.moved_end(b.row)) {
                (start, Some(end)) if start <= end => RefKind::Rows(
                    RowRef { row: start, abs: a.abs },
                    RowRef { row: end, abs: b.abs },
                ),
                _ => RefKind::Invalid,
            }
        }
        // `A:C` is every row of those columns, so inserting a row cannot
        // change it.
        other => *other,
    }
}

fn adjust_cell(cell: &CellRef, shift: &Shift) -> Option<CellRef> {
    let mut moved = *cell;
    match shift.axis {
        Axis::Rows => moved.row = shift.moved(cell.row)?,
        Axis::Cols => moved.col = shift.moved(cell.col)?,
    }
    Some(moved)
}

/// Adjusts a range, growing it when the change happens inside it.
///
/// A range is not two independent cells: inserting a row in the middle of
/// `A1:A9` has to make it `A1:A10`, or a `SUM` silently stops counting the row
/// that was just added to the block it was summing.
fn adjust_range(range: &RangeRef, shift: &Shift) -> Option<RangeRef> {
    let mut moved = *range;
    match shift.axis {
        Axis::Rows => {
            let start = shift.moved_start(range.start.row);
            let end = shift.moved_end(range.end.row)?;
            if start > end {
                return None;
            }
            moved.start.row = start;
            moved.end.row = end;
        }
        Axis::Cols => {
            let start = shift.moved_start(range.start.col);
            let end = shift.moved_end(range.end.col)?;
            if start > end {
                return None;
            }
            moved.start.col = start;
            moved.end.col = end;
        }
    }
    Some(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    fn rewrite(formula: &str, shift: &Shift) -> String {
        adjust(&parse(formula).unwrap(), shift, "Sheet1").to_string()
    }

    #[test]
    fn an_insert_moves_everything_below_it_absolute_or_not() {
        let shift = Shift::insert_rows("Sheet1", 2, 1);
        // Absolute means "does not move when copied", not "does not move when
        // the sheet changes shape".
        assert_eq!(rewrite("A1+A3+$A$5", &shift), "A1+A4+$A$6");
    }

    #[test]
    fn an_insert_inside_a_range_grows_it() {
        let shift = Shift::insert_rows("Sheet1", 4, 1);
        assert_eq!(rewrite("SUM(A1:A9)", &shift), "SUM(A1:A10)");
        // But an insert at the very top of a range pushes the whole range down
        // rather than growing it, which is what Excel does.
        assert_eq!(rewrite("SUM(A2:A5)", &Shift::insert_rows("Sheet1", 1, 1)), "SUM(A3:A6)");
    }

    #[test]
    fn a_delete_turns_a_reference_to_a_deleted_cell_into_ref() {
        let shift = Shift::remove_rows("Sheet1", 2, 1);
        assert_eq!(rewrite("A3", &shift), "#REF!");
        assert_eq!(rewrite("A4", &shift), "A3");
        assert_eq!(rewrite("A1", &shift), "A1");
    }

    #[test]
    fn a_delete_inside_a_range_shrinks_it() {
        assert_eq!(rewrite("SUM(A1:A9)", &Shift::remove_rows("Sheet1", 4, 2)), "SUM(A1:A7)");
    }

    #[test]
    fn a_range_entirely_deleted_becomes_ref() {
        assert_eq!(rewrite("SUM(A3:A4)", &Shift::remove_rows("Sheet1", 2, 2)), "SUM(#REF!)");
    }

    #[test]
    fn a_range_clipped_at_its_start_keeps_what_survived() {
        // Rows 2-3 go; A2:A5 had rows 2-5, so rows 4-5 survive and become 2-3.
        assert_eq!(rewrite("SUM(A2:A5)", &Shift::remove_rows("Sheet1", 1, 2)), "SUM(A2:A3)");
    }

    #[test]
    fn a_column_change_leaves_row_references_alone() {
        assert_eq!(rewrite("A5", &Shift::insert_cols("Sheet1", 0, 1)), "B5");
        assert_eq!(rewrite("SUM(1:3)", &Shift::insert_cols("Sheet1", 0, 2)), "SUM(1:3)");
        assert_eq!(rewrite("SUM(A:B)", &Shift::insert_cols("Sheet1", 0, 1)), "SUM(B:C)");
    }

    #[test]
    fn a_whole_column_reference_ignores_a_row_insert() {
        assert_eq!(rewrite("SUM(A:A)", &Shift::insert_rows("Sheet1", 0, 5)), "SUM(A:A)");
    }

    #[test]
    fn only_references_to_the_changed_sheet_move() {
        let shift = Shift::insert_rows("Data", 0, 1);
        // The formula lives on Sheet1, so its unqualified references mean
        // Sheet1 and must not move.
        assert_eq!(rewrite("A5+Data!A5", &shift), "A5+Data!A6");
    }

    #[test]
    fn an_unqualified_reference_moves_when_its_own_sheet_changes() {
        assert_eq!(rewrite("A5", &Shift::insert_rows("sheet1", 0, 1)), "A6");
    }
}
