//! Turning parsed references into concrete addresses.
//!
//! The parser works without a workbook, so it leaves sheet names as text and
//! whole-column ranges as endpoints. Resolution binds those to sheet ids and
//! rectangles, and reports `#REF!` for anything that no longer exists.

use cellmoa_core::model::{CellAddr, SheetId, Workbook};
use cellmoa_core::reference::{CellRef, RangeRef, MAX_COLS, MAX_ROWS};
use cellmoa_formula::ast::{Ref, RefKind, SheetSpec};

/// A reference bound to real sheets and cells.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    Cell(CellAddr),
    Range {
        sheet: SheetId,
        range: RangeRef,
    },
    /// A 3-D reference: the same rectangle on a run of sheets.
    Sheets {
        sheets: Vec<SheetId>,
        range: RangeRef,
    },
    /// The target does not exist — evaluates to `#REF!`.
    Invalid,
}

impl Resolved {
    /// Every `(sheet, range)` pair this reference covers, so callers can treat
    /// 3-D and ordinary references the same way.
    pub fn areas(&self) -> Vec<(SheetId, RangeRef)> {
        match self {
            Resolved::Cell(addr) => {
                vec![(addr.sheet, RangeRef::single(CellRef::new(addr.col, addr.row)))]
            }
            Resolved::Range { sheet, range } => vec![(*sheet, *range)],
            Resolved::Sheets { sheets, range } => sheets.iter().map(|&s| (s, *range)).collect(),
            Resolved::Invalid => Vec::new(),
        }
    }
}

/// Resolves a reference that appears in a formula on `context_sheet`.
pub fn resolve(wb: &Workbook, context_sheet: SheetId, r: &Ref) -> Resolved {
    let range = match rectangle(&r.kind) {
        Some(range) => range,
        None => return Resolved::Invalid,
    };

    let sheets = match &r.sheet {
        None => vec![context_sheet],
        Some(SheetSpec { first, last: None }) => match wb.sheet_id_by_name(first) {
            Some(id) => vec![id],
            None => return Resolved::Invalid,
        },
        Some(SheetSpec { first, last: Some(last) }) => {
            let (Some(a), Some(b)) = (wb.sheet_id_by_name(first), wb.sheet_id_by_name(last)) else {
                return Resolved::Invalid;
            };
            // A 3-D reference spans sheets by position, in whichever order the
            // two names appear in the workbook.
            let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
            (lo..=hi).filter(|&id| wb.sheet(id).is_some()).collect()
        }
    };

    match (sheets.len(), &r.kind) {
        (0, _) => Resolved::Invalid,
        (1, RefKind::Cell(cell)) => Resolved::Cell(CellAddr::new(sheets[0], cell.col, cell.row)),
        (1, _) => Resolved::Range { sheet: sheets[0], range },
        _ => Resolved::Sheets { sheets, range },
    }
}

/// The rectangle a reference kind covers, with whole columns and rows expanded
/// to the sheet's full extent.
fn rectangle(kind: &RefKind) -> Option<RangeRef> {
    Some(match kind {
        RefKind::Cell(c) => {
            if !c.in_bounds() {
                return None;
            }
            RangeRef::single(*c)
        }
        RefKind::Range(r) => {
            if !r.start.in_bounds() || !r.end.in_bounds() {
                return None;
            }
            *r
        }
        RefKind::Cols(a, b) => {
            RangeRef::new(CellRef::new(a.col, 0), CellRef::new(b.col, MAX_ROWS - 1))
        }
        RefKind::Rows(a, b) => {
            RangeRef::new(CellRef::new(0, a.row), CellRef::new(MAX_COLS - 1, b.row))
        }
        RefKind::Invalid => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellmoa_formula::parse;
    use cellmoa_formula::Expr;

    fn wb() -> Workbook {
        let mut wb = Workbook::new();
        wb.add_sheet("Sheet1");
        wb.add_sheet("Sheet2");
        wb.add_sheet("Q1 Sales");
        wb
    }

    fn resolve_src(wb: &Workbook, sheet: SheetId, src: &str) -> Resolved {
        match parse(src).unwrap() {
            Expr::Ref(r) => resolve(wb, sheet, &r),
            other => panic!("expected a reference, got {other:?}"),
        }
    }

    #[test]
    fn an_unqualified_reference_binds_to_the_formulas_own_sheet() {
        assert_eq!(resolve_src(&wb(), 1, "A1"), Resolved::Cell(CellAddr::new(1, 0, 0)));
    }

    #[test]
    fn a_qualified_reference_binds_by_name() {
        assert_eq!(resolve_src(&wb(), 0, "Sheet2!B2"), Resolved::Cell(CellAddr::new(1, 1, 1)));
        assert_eq!(resolve_src(&wb(), 0, "'Q1 Sales'!A1"), Resolved::Cell(CellAddr::new(2, 0, 0)));
    }

    #[test]
    fn a_missing_sheet_is_a_ref_error() {
        assert_eq!(resolve_src(&wb(), 0, "Nope!A1"), Resolved::Invalid);
    }

    #[test]
    fn whole_columns_expand_to_the_full_sheet_height() {
        let Resolved::Range { range, .. } = resolve_src(&wb(), 0, "B:C") else {
            panic!("expected a range")
        };
        assert_eq!((range.start.col, range.end.col), (1, 2));
        assert_eq!((range.start.row, range.end.row), (0, MAX_ROWS - 1));
    }

    #[test]
    fn whole_rows_expand_to_the_full_sheet_width() {
        let Resolved::Range { range, .. } = resolve_src(&wb(), 0, "2:3") else {
            panic!("expected a range")
        };
        assert_eq!((range.start.row, range.end.row), (1, 2));
        assert_eq!((range.start.col, range.end.col), (0, MAX_COLS - 1));
    }

    #[test]
    fn a_3d_reference_covers_the_run_of_sheets_between_its_endpoints() {
        let r = resolve_src(&wb(), 0, "Sheet1:'Q1 Sales'!A1");
        assert_eq!(
            r,
            Resolved::Sheets { sheets: vec![0, 1, 2], range: RangeRef::parse_a1("A1").unwrap() }
        );
        // Written the other way round it covers the same sheets.
        assert_eq!(resolve_src(&wb(), 0, "'Q1 Sales':Sheet1!A1"), r);
    }

    #[test]
    fn a_3d_reference_skips_deleted_sheets() {
        let mut wb = wb();
        wb.remove_sheet(1);
        let Resolved::Sheets { sheets, .. } = resolve_src(&wb, 0, "Sheet1:'Q1 Sales'!A1") else {
            panic!("expected a 3-D reference")
        };
        assert_eq!(sheets, vec![0, 2]);
    }

    #[test]
    fn areas_flattens_every_reference_shape() {
        let wb = wb();
        assert_eq!(resolve_src(&wb, 0, "A1").areas().len(), 1);
        assert_eq!(resolve_src(&wb, 0, "Sheet1:Sheet2!A1:B2").areas().len(), 2);
        assert_eq!(Resolved::Invalid.areas(), Vec::new());
    }
}
