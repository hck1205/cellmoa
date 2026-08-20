//! Lookup and reference functions.

use super::args;
use super::criteria::wildcard_match;
use super::*;
use crate::operand::{Area, Operand};
use crate::resolve::{resolve, Resolved};
use cellmoa_core::reference::{col_to_letters, CellRef, RangeRef};
use cellmoa_formula::ast::Expr;
use cellmoa_formula::parse;
use std::cmp::Ordering;

/// How a lookup compares a candidate against the value being searched for.
#[derive(Clone, Copy, PartialEq)]
enum MatchMode {
    /// Largest value less than or equal to the target; the data must be sorted
    /// ascending.
    LessOrEqual,
    Exact,
    /// Smallest value greater than or equal; the data must be sorted descending.
    GreaterOrEqual,
}

/// Compares a candidate with the target, honouring wildcards in exact mode.
fn hit(candidate: &Value, target: &Value, mode: MatchMode) -> bool {
    if mode == MatchMode::Exact {
        if let (Value::Text(pattern), Value::Text(text)) = (target, candidate) {
            if pattern.contains(['*', '?', '~']) {
                return wildcard_match(pattern, text);
            }
        }
    }
    candidate.compare(target).is_some_and(Ordering::is_eq)
}

/// Finds the position of `target` in a list of candidates.
///
/// Exact mode scans; the ordered modes binary-search, which is what makes a
/// `VLOOKUP` over a sorted column cheap rather than linear.
fn find(values: &[Value], target: &Value, mode: MatchMode) -> Option<usize> {
    if mode == MatchMode::Exact {
        return values.iter().position(|v| hit(v, target, mode));
    }
    // Values that do not compare with the target (a different type) are not
    // candidates, and are also not ordered relative to it, so they are skipped
    // rather than being allowed to steer the search.
    let comparable: Vec<usize> = (0..values.len())
        .filter(|&i| values[i].compare(target).is_some() && !values[i].is_blank())
        .collect();
    if comparable.is_empty() {
        return None;
    }
    let ascending = mode == MatchMode::LessOrEqual;
    let acceptable = |i: usize| {
        let ord = values[comparable[i]].compare(target).expect("filtered to comparable");
        if ascending {
            ord.is_le()
        } else {
            ord.is_ge()
        }
    };
    if !acceptable(0) {
        return None;
    }
    // Binary search for the last acceptable position.
    let (mut low, mut high) = (0usize, comparable.len() - 1);
    while low < high {
        let mid = (low + high).div_ceil(2);
        if acceptable(mid) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    Some(comparable[low])
}

/// The values of one row or column of an operand.
fn line(ctx: &EvalCtx, operand: &Operand, index: usize, horizontal: bool) -> Vec<Value> {
    let array = operand.to_array(ctx.wb);
    if horizontal {
        (0..array.cols()).map(|c| array.get(index, c)).collect()
    } else {
        (0..array.rows()).map(|r| array.get(r, index)).collect()
    }
}

/// Flattens an operand into a single list, for the lookup functions that take a
/// vector regardless of its orientation.
fn flatten(ctx: &EvalCtx, operand: &Operand) -> Vec<Value> {
    let array = operand.to_array(ctx.wb);
    (0..array.rows())
        .flat_map(|r| (0..array.cols()).map(move |c| (r, c)))
        .map(|(r, c)| array.get(r, c))
        .collect()
}

fn table_lookup(ctx: &EvalCtx, a: &[Operand], vertical: bool) -> Operand {
    let target = ctx.scalar(&a[0]);
    if let Some(e) = target.as_error() {
        return Operand::error(e);
    }
    args!(index = arg_num(ctx, a, 2));
    let approximate = match a.get(3) {
        // The fourth argument defaults to TRUE, which is why an unsorted table
        // with a forgotten FALSE is such a common source of wrong answers.
        None => true,
        Some(_) => match arg_bool(ctx, a, 3) {
            Ok(b) => b,
            Err(e) => return Operand::error(e),
        },
    };
    let mode = if approximate { MatchMode::LessOrEqual } else { MatchMode::Exact };

    let array = a[1].to_array(ctx.wb);
    let (search, limit) = if vertical {
        (line(ctx, &a[1], 0, false), array.cols())
    } else {
        (line(ctx, &a[1], 0, true), array.rows())
    };
    let index = index.trunc();
    if index < 1.0 || index as usize > limit {
        return Operand::error(CellError::Ref);
    }
    match find(&search, &target, mode) {
        Some(position) => {
            let value = if vertical {
                array.get(position, index as usize - 1)
            } else {
                array.get(index as usize - 1, position)
            };
            Operand::Value(value)
        }
        None => Operand::error(CellError::NA),
    }
}

/// Turns a `row, col` position inside an operand back into a reference when the
/// operand was one, so `INDEX` can be used as a range endpoint.
fn positioned(operand: &Operand, row: usize, col: usize, value: Value) -> Operand {
    match operand.single_area() {
        Some(area) => {
            let cell =
                CellRef::new(area.range.start.col + col as u32, area.range.start.row + row as u32);
            Operand::Ref(vec![Area::new(area.sheet, RangeRef::single(cell))])
        }
        None => Operand::Value(value),
    }
}

pub const FUNCTIONS: &[Function] = &[
    array_fn("VLOOKUP", 3, Some(4), |ctx, a| table_lookup(ctx, a, true)),
    array_fn("HLOOKUP", 3, Some(4), |ctx, a| table_lookup(ctx, a, false)),
    array_fn("LOOKUP", 2, Some(3), |ctx, a| {
        let target = ctx.scalar(&a[0]);
        let search = flatten(ctx, &a[1]);
        // With no result vector, LOOKUP returns from the last row or column of
        // the array it searched.
        let results = match a.get(2) {
            Some(operand) => flatten(ctx, operand),
            None => {
                let array = a[1].to_array(ctx.wb);
                if array.cols() > array.rows() {
                    (0..array.cols()).map(|c| array.get(array.rows() - 1, c)).collect()
                } else {
                    (0..array.rows()).map(|r| array.get(r, array.cols() - 1)).collect()
                }
            }
        };
        match find(&search, &target, MatchMode::LessOrEqual) {
            Some(position) => match results.get(position) {
                Some(v) => Operand::Value(v.clone()),
                None => Operand::error(CellError::NA),
            },
            None => Operand::error(CellError::NA),
        }
    }),
    array_fn("MATCH", 2, Some(3), |ctx, a| {
        let target = ctx.scalar(&a[0]);
        args!(kind = opt_num(ctx, a, 2, 1.0));
        let mode = match kind.trunc() as i64 {
            0 => MatchMode::Exact,
            n if n > 0 => MatchMode::LessOrEqual,
            _ => MatchMode::GreaterOrEqual,
        };
        match find(&flatten(ctx, &a[1]), &target, mode) {
            Some(position) => Operand::number(position as f64 + 1.0),
            None => Operand::error(CellError::NA),
        }
    }),
    array_fn("XMATCH", 2, Some(3), |ctx, a| {
        let target = ctx.scalar(&a[0]);
        args!(kind = opt_num(ctx, a, 2, 0.0));
        // XMATCH inverts the convention: zero means exact.
        let mode = match kind.trunc() as i64 {
            0 => MatchMode::Exact,
            n if n < 0 => MatchMode::LessOrEqual,
            _ => MatchMode::GreaterOrEqual,
        };
        match find(&flatten(ctx, &a[1]), &target, mode) {
            Some(position) => Operand::number(position as f64 + 1.0),
            None => Operand::error(CellError::NA),
        }
    }),
    array_fn("XLOOKUP", 3, Some(5), |ctx, a| {
        let target = ctx.scalar(&a[0]);
        args!(kind = opt_num(ctx, a, 4, 0.0));
        let mode = match kind.trunc() as i64 {
            0 => MatchMode::Exact,
            n if n < 0 => MatchMode::LessOrEqual,
            _ => MatchMode::GreaterOrEqual,
        };
        let results = flatten(ctx, &a[2]);
        match find(&flatten(ctx, &a[1]), &target, mode) {
            Some(position) => match results.get(position) {
                Some(v) => Operand::Value(v.clone()),
                None => Operand::error(CellError::Value),
            },
            // XLOOKUP's fourth argument is what it returns instead of #N/A.
            None => match a.get(3) {
                Some(fallback) => fallback.clone(),
                None => Operand::error(CellError::NA),
            },
        }
    }),
    array_fn("INDEX", 2, Some(4), |ctx, a| {
        args!(row = arg_num(ctx, a, 1), col = opt_num(ctx, a, 2, 0.0));
        let array = a[0].to_array(ctx.wb);
        let (rows, cols) = (array.rows(), array.cols());
        // A single row or column takes one index, and it selects along the axis
        // that actually has length.
        let (r, c) = if cols == 1 && col == 0.0 {
            (row, 1.0)
        } else if rows == 1 && col == 0.0 {
            (1.0, row)
        } else {
            (row, col)
        };
        if r < 0.0 || c < 0.0 || r as usize > rows || c as usize > cols {
            return Operand::error(CellError::Ref);
        }
        // A zero index means the whole row or column.
        if r == 0.0 || c == 0.0 {
            let Some(area) = a[0].single_area() else {
                return Operand::error(CellError::Ref);
            };
            let range = if r == 0.0 {
                let col = area.range.start.col + c as u32 - 1;
                RangeRef::new(
                    CellRef::new(col, area.range.start.row),
                    CellRef::new(col, area.range.end.row),
                )
            } else {
                let row = area.range.start.row + r as u32 - 1;
                RangeRef::new(
                    CellRef::new(area.range.start.col, row),
                    CellRef::new(area.range.end.col, row),
                )
            };
            return Operand::Ref(vec![Area::new(area.sheet, range)]);
        }
        let value = array.get(r as usize - 1, c as usize - 1);
        positioned(&a[0], r as usize - 1, c as usize - 1, value)
    }),
    f("AREAS", 1, Some(1), |_, a| match &a[0] {
        Operand::Ref(areas) => Operand::number(areas.len() as f64),
        _ => Operand::error(CellError::Value),
    }),
    f("ADDRESS", 2, Some(5), |ctx, a| {
        args!(row = arg_num(ctx, a, 0), col = arg_num(ctx, a, 1), kind = opt_num(ctx, a, 2, 1.0));
        if row < 1.0 || col < 1.0 {
            return Operand::error(CellError::Value);
        }
        // 1 = both absolute, 2 = row only, 3 = column only, 4 = neither.
        let (row_abs, col_abs) = match kind.trunc() as i64 {
            1 => (true, true),
            2 => (true, false),
            3 => (false, true),
            4 => (false, false),
            _ => return Operand::error(CellError::Value),
        };
        let mut out = String::new();
        if let Ok(sheet) = arg_text(ctx, a, 4) {
            if !sheet.is_empty() {
                out.push_str(&cellmoa_formula::ast::quote_sheet(&sheet));
                out.push('!');
            }
        }
        if col_abs {
            out.push('$');
        }
        out.push_str(&col_to_letters(col as u32 - 1));
        if row_abs {
            out.push('$');
        }
        out.push_str(&(row as u64).to_string());
        Operand::text(out)
    }),
    // INDIRECT builds a reference from text, so nothing static can know what it
    // reads — it is volatile, and the graph cannot track it.
    volatile("INDIRECT", 1, Some(2), |ctx, a| {
        args!(text = arg_text(ctx, a, 0));
        let Ok(Expr::Ref(reference)) = parse(&text) else {
            return Operand::error(CellError::Ref);
        };
        match resolve(ctx.wb, ctx.sheet, &reference) {
            Resolved::Invalid => Operand::error(CellError::Ref),
            resolved => Operand::Ref(
                resolved.areas().into_iter().map(|(s, range)| Area::new(s, range)).collect(),
            ),
        }
    }),
    volatile("OFFSET", 3, Some(5), |ctx, a| {
        let Some(area) = a[0].single_area() else {
            return Operand::error(CellError::Value);
        };
        args!(
            drow = arg_num(ctx, a, 1),
            dcol = arg_num(ctx, a, 2),
            height = opt_num(ctx, a, 3, area.range.height() as f64),
            width = opt_num(ctx, a, 4, area.range.width() as f64),
        );
        if height < 1.0 || width < 1.0 {
            return Operand::error(CellError::Ref);
        }
        let start_row = area.range.start.row as i64 + drow as i64;
        let start_col = area.range.start.col as i64 + dcol as i64;
        let end_row = start_row + height as i64 - 1;
        let end_col = start_col + width as i64 - 1;
        if start_row < 0 || start_col < 0 {
            return Operand::error(CellError::Ref);
        }
        let range = RangeRef::new(
            CellRef::new(start_col as u32, start_row as u32),
            CellRef::new(end_col as u32, end_row as u32),
        );
        if !range.end.in_bounds() {
            return Operand::error(CellError::Ref);
        }
        Operand::Ref(vec![Area::new(area.sheet, range)])
    }),
    f("FORMULATEXT", 1, Some(1), |ctx, a| {
        let Some(area) = a[0].single_area() else {
            return Operand::error(CellError::NA);
        };
        let addr = cellmoa_core::model::CellAddr::new(
            area.sheet,
            area.range.start.col,
            area.range.start.row,
        );
        match ctx.wb.content(addr).as_formula() {
            Some(src) => Operand::text(format!("={src}")),
            None => Operand::error(CellError::NA),
        }
    }),
    // --- array shaping ------------------------------------------------------
    array_fn("TRANSPOSE", 1, Some(1), |ctx, a| {
        let array = a[0].to_array(ctx.wb);
        let mut rows = Vec::with_capacity(array.cols());
        for c in 0..array.cols() {
            rows.push((0..array.rows()).map(|r| array.get(r, c)).collect());
        }
        Operand::Array(crate::operand::Array::from_rows(rows))
    }),
    array_fn("UNIQUE", 1, Some(3), |ctx, a| {
        let mut seen: Vec<Value> = Vec::new();
        for value in flatten(ctx, &a[0]) {
            if !seen.iter().any(|v| v.compare(&value).is_some_and(Ordering::is_eq)) {
                seen.push(value);
            }
        }
        array_like(&a[0], seen)
    }),
    array_fn("SORT", 1, Some(4), |ctx, a| {
        args!(order = opt_num(ctx, a, 2, 1.0));
        let mut values = flatten(ctx, &a[0]);
        values.sort_by(|x, y| {
            let ord = x.compare(y).unwrap_or(Ordering::Equal);
            if order < 0.0 {
                ord.reverse()
            } else {
                ord
            }
        });
        array_like(&a[0], values)
    }),
    array_fn("FILTER", 2, Some(3), |ctx, a| {
        let values = flatten(ctx, &a[0]);
        let mask = flatten(ctx, &a[1]);
        if values.len() != mask.len() {
            return Operand::error(CellError::Value);
        }
        let kept: Vec<Value> = values
            .into_iter()
            .zip(mask)
            .filter(|(_, keep)| keep.coerce_bool().unwrap_or(false))
            .map(|(v, _)| v)
            .collect();
        if kept.is_empty() {
            return match a.get(2) {
                Some(fallback) => fallback.clone(),
                None => Operand::error(CellError::Calc),
            };
        }
        array_like(&a[0], kept)
    }),
    f("SEQUENCE", 1, Some(4), |ctx, a| {
        args!(
            rows = arg_num(ctx, a, 0),
            cols = opt_num(ctx, a, 1, 1.0),
            start = opt_num(ctx, a, 2, 1.0),
            step = opt_num(ctx, a, 3, 1.0),
        );
        if rows < 1.0 || cols < 1.0 {
            return Operand::error(CellError::Value);
        }
        let (rows, cols) = (rows.trunc() as usize, cols.trunc() as usize);
        if rows.saturating_mul(cols) > 1_000_000 {
            return Operand::error(CellError::Num);
        }
        let data = (0..rows * cols).map(|i| Value::Number(start + i as f64 * step)).collect();
        Operand::Array(crate::operand::Array::new(rows, cols, data))
    }),
];
