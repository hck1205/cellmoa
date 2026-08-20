//! Shifting a formula's relative references.
//!
//! This is what makes a copied formula mean the same thing one row down. It is
//! used in three places that must agree: expanding a shared formula on import,
//! filling a series in the grid, and pasting a formula somewhere else. Having
//! one implementation is the only way they can.

use crate::ast::{ColRef, Expr, Ref, RefKind, RowRef};
use crate::rewrite::map_refs;
use cellmoa_core::reference::{MAX_COLS, MAX_ROWS};

/// Shifts every relative reference in an expression, for expanding a shared
/// formula into the cells that use it.
pub fn translate(expr: &Expr, dcol: i64, drow: i64) -> Expr {
    map_refs(expr, &mut |reference| Ref {
        sheet: reference.sheet.clone(),
        kind: translate_kind(&reference.kind, dcol, drow),
    })
}

fn translate_kind(kind: &RefKind, dcol: i64, drow: i64) -> RefKind {
    // A reference shifted off the sheet becomes #REF!, exactly as it would if
    // the formula had been copied there by hand.
    match kind {
        RefKind::Cell(cell) => match cell.offset(dcol, drow) {
            Ok(moved) => RefKind::Cell(moved),
            Err(_) => RefKind::Invalid,
        },
        RefKind::Range(range) => match range.offset(dcol, drow) {
            Ok(moved) => RefKind::Range(moved),
            Err(_) => RefKind::Invalid,
        },
        RefKind::Cols(a, b) => {
            let shift = |c: &ColRef| {
                if c.abs {
                    Some(*c)
                } else {
                    let moved = c.col as i64 + dcol;
                    (0..MAX_COLS as i64)
                        .contains(&moved)
                        .then_some(ColRef { col: moved as u32, abs: c.abs })
                }
            };
            match (shift(a), shift(b)) {
                (Some(a), Some(b)) => RefKind::Cols(a, b),
                _ => RefKind::Invalid,
            }
        }
        RefKind::Rows(a, b) => {
            let shift = |r: &RowRef| {
                if r.abs {
                    Some(*r)
                } else {
                    let moved = r.row as i64 + drow;
                    (0..MAX_ROWS as i64)
                        .contains(&moved)
                        .then_some(RowRef { row: moved as u32, abs: r.abs })
                }
            };
            match (shift(a), shift(b)) {
                (Some(a), Some(b)) => RefKind::Rows(a, b),
                _ => RefKind::Invalid,
            }
        }
        RefKind::Invalid => RefKind::Invalid,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    #[test]
    fn absolute_parts_stay_put() {
        assert_eq!(translate(&parse("$A$1+B2+C$3").unwrap(), 1, 1).to_string(), "$A$1+C3+D$3");
    }

    #[test]
    fn a_reference_pushed_off_the_sheet_becomes_a_ref_error() {
        assert_eq!(translate(&parse("A1").unwrap(), -1, 0).to_string(), "#REF!");
    }

    #[test]
    fn ranges_and_whole_rows_and_columns_move_too() {
        assert_eq!(translate(&parse("A1:B2").unwrap(), 2, 0).to_string(), "C1:D2");
        assert_eq!(translate(&parse("A:B").unwrap(), 1, 0).to_string(), "B:C");
        assert_eq!(translate(&parse("$A:$B").unwrap(), 1, 0).to_string(), "$A:$B");
        assert_eq!(translate(&parse("1:2").unwrap(), 0, 5).to_string(), "6:7");
    }

    #[test]
    fn a_sheet_qualifier_survives_the_shift() {
        assert_eq!(translate(&parse("Sheet2!A1").unwrap(), 0, 1).to_string(), "Sheet2!A2");
    }

    #[test]
    fn everything_that_is_not_a_reference_is_left_alone() {
        assert_eq!(
            translate(&parse("SUM(A1,2,\"x\")").unwrap(), 0, 1).to_string(),
            "SUM(A2,2,\"x\")"
        );
        assert_eq!(translate(&parse("{1,2;3,4}").unwrap(), 3, 3).to_string(), "{1,2;3,4}");
    }
}
