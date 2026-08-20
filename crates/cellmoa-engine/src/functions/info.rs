//! Information functions: what a value is, and where a cell sits.

use super::*;
use crate::operand::Operand;
use cellmoa_core::model::CellAddr;

/// The unevaluated view of an argument, needed by the `IS*` family: `ISBLANK`
/// has to see an empty cell as blank rather than as the zero it coerces to.
fn raw(ctx: &EvalCtx, args: &[Operand], i: usize) -> Value {
    args.get(i).map(|a| ctx.scalar(a)).unwrap_or(Value::Blank)
}

pub const FUNCTIONS: &[Function] = &[
    f("ISBLANK", 1, Some(1), |ctx, a| Operand::bool(raw(ctx, a, 0).is_blank())),
    f("ISERROR", 1, Some(1), |ctx, a| Operand::bool(raw(ctx, a, 0).is_error())),
    f("ISERR", 1, Some(1), |ctx, a| {
        // ISERR is ISERROR minus #N/A — the distinction matters when a lookup
        // legitimately finds nothing.
        let e = raw(ctx, a, 0).as_error();
        Operand::bool(e.is_some_and(|e| e != CellError::NA))
    }),
    f("ISNA", 1, Some(1), |ctx, a| Operand::bool(raw(ctx, a, 0).as_error() == Some(CellError::NA))),
    f("ISNUMBER", 1, Some(1), |ctx, a| Operand::bool(matches!(raw(ctx, a, 0), Value::Number(_)))),
    f("ISTEXT", 1, Some(1), |ctx, a| Operand::bool(matches!(raw(ctx, a, 0), Value::Text(_)))),
    f("ISNONTEXT", 1, Some(1), |ctx, a| Operand::bool(!matches!(raw(ctx, a, 0), Value::Text(_)))),
    f("ISLOGICAL", 1, Some(1), |ctx, a| Operand::bool(matches!(raw(ctx, a, 0), Value::Bool(_)))),
    f("ISREF", 1, Some(1), |_, a| Operand::bool(matches!(a.first(), Some(Operand::Ref(_))))),
    f("ISEVEN", 1, Some(1), |ctx, a| match arg_num(ctx, a, 0) {
        Ok(n) => Operand::bool((n.trunc() as i64) % 2 == 0),
        Err(e) => Operand::error(e),
    }),
    f("ISODD", 1, Some(1), |ctx, a| match arg_num(ctx, a, 0) {
        Ok(n) => Operand::bool((n.trunc() as i64) % 2 != 0),
        Err(e) => Operand::error(e),
    }),
    f("ISFORMULA", 1, Some(1), |ctx, a| {
        let Some(area) = a.first().and_then(Operand::single_area) else {
            return Operand::error(CellError::Value);
        };
        let addr = CellAddr::new(area.sheet, area.range.start.col, area.range.start.row);
        Operand::bool(ctx.wb.content(addr).as_formula().is_some())
    }),
    f("NA", 0, Some(0), |_, _| Operand::error(CellError::NA)),
    f("ERROR.TYPE", 1, Some(1), |ctx, a| {
        // The numbering is Excel's own and is what users switch on.
        match raw(ctx, a, 0).as_error() {
            Some(CellError::Null) => Operand::number(1.0),
            Some(CellError::Div0) => Operand::number(2.0),
            Some(CellError::Value) => Operand::number(3.0),
            Some(CellError::Ref) => Operand::number(4.0),
            Some(CellError::Name) => Operand::number(5.0),
            Some(CellError::Num) => Operand::number(6.0),
            Some(CellError::NA) => Operand::number(7.0),
            Some(CellError::Spill) => Operand::number(9.0),
            Some(CellError::Calc) => Operand::number(14.0),
            // #CYCLE! has no Excel number of its own; 20 is outside the range
            // Excel uses so that a formula switching on ERROR.TYPE cannot
            // mistake it for one of them.
            Some(CellError::Cycle) => Operand::number(20.0),
            None => Operand::error(CellError::NA),
        }
    }),
    f("N", 1, Some(1), |ctx, a| match raw(ctx, a, 0) {
        Value::Number(n) => Operand::number(n),
        Value::Bool(b) => Operand::number(f64::from(b)),
        Value::Error(e) => Operand::error(e),
        // Text becomes zero rather than an error, unlike a plain coercion.
        _ => Operand::number(0.0),
    }),
    f("TYPE", 1, Some(1), |ctx, a| {
        let code = match a.first() {
            Some(Operand::Array(_)) => 64.0,
            _ => match raw(ctx, a, 0) {
                Value::Number(_) | Value::Blank => 1.0,
                Value::Text(_) => 2.0,
                Value::Bool(_) => 4.0,
                Value::Error(_) => 16.0,
            },
        };
        Operand::number(code)
    }),
    f("ROW", 0, Some(1), |ctx, a| match a.first().and_then(Operand::single_area) {
        Some(area) => Operand::number(area.range.start.row as f64 + 1.0),
        None if a.is_empty() => Operand::number(ctx.cell.row as f64 + 1.0),
        None => Operand::error(CellError::Value),
    }),
    f("COLUMN", 0, Some(1), |ctx, a| match a.first().and_then(Operand::single_area) {
        Some(area) => Operand::number(area.range.start.col as f64 + 1.0),
        None if a.is_empty() => Operand::number(ctx.cell.col as f64 + 1.0),
        None => Operand::error(CellError::Value),
    }),
    f("ROWS", 1, Some(1), |_, a| Operand::number(a[0].shape().0 as f64)),
    f("COLUMNS", 1, Some(1), |_, a| Operand::number(a[0].shape().1 as f64)),
    f("SHEET", 0, Some(1), |ctx, a| match a.first().and_then(Operand::single_area) {
        Some(area) => Operand::number(area.sheet as f64 + 1.0),
        None => Operand::number(ctx.sheet as f64 + 1.0),
    }),
    f("SHEETS", 0, Some(1), |ctx, _| Operand::number(ctx.wb.sheets().count() as f64)),
];
