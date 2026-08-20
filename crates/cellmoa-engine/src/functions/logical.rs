//! Logical functions.
//!
//! Most of these take their arguments unevaluated. That is not an optimisation:
//! `IF(A1=0,0,1/A1)` must not divide by zero, and `IFERROR(x,y)` must not
//! evaluate `y` unless `x` actually failed.

use super::*;
use crate::eval::eval;
use crate::operand::Operand;

/// Evaluates an argument to a single value.
fn scalar(ctx: &mut EvalCtx, args: &[Expr], i: usize) -> Value {
    match args.get(i) {
        Some(expr) => {
            let operand = eval(ctx, expr);
            ctx.scalar(&operand)
        }
        None => Value::Blank,
    }
}

/// Folds the logical values in a list of operands.
///
/// Booleans and numbers count; text and blanks inside a range are skipped, as
/// in Excel. A list with nothing logical in it is a `#VALUE!`.
fn fold_logical(
    ctx: &EvalCtx,
    args: &[Operand],
    init: bool,
    f: impl Fn(bool, bool) -> bool,
) -> Operand {
    let mut acc = init;
    let mut seen = false;
    let mut error = None;
    for operand in args {
        let literal = matches!(operand, Operand::Value(_));
        operand.for_each(ctx.wb, &mut |v| {
            if error.is_some() {
                return;
            }
            match v {
                Value::Error(e) => error = Some(*e),
                Value::Bool(b) => {
                    acc = f(acc, *b);
                    seen = true;
                }
                Value::Number(n) => {
                    acc = f(acc, *n != 0.0);
                    seen = true;
                }
                // Text typed directly is coerced; text sitting in a cell is not.
                Value::Text(_) if literal => match v.coerce_bool() {
                    Ok(b) => {
                        acc = f(acc, b);
                        seen = true;
                    }
                    Err(e) => error = Some(e),
                },
                _ => {}
            }
        });
    }
    match (error, seen) {
        (Some(e), _) => Operand::error(e),
        (None, false) => Operand::error(CellError::Value),
        (None, true) => Operand::bool(acc),
    }
}

pub const FUNCTIONS: &[Function] = &[
    lazy("IF", 2, Some(3), |ctx, args| {
        match scalar(ctx, args, 0).coerce_bool() {
            Err(e) => Operand::error(e),
            Ok(true) => eval(ctx, &args[1]),
            // `IF(cond, x)` with a false condition yields FALSE, not blank.
            Ok(false) => match args.get(2) {
                Some(expr) => eval(ctx, expr),
                None => Operand::bool(false),
            },
        }
    }),
    lazy("IFS", 2, None, |ctx, args| {
        for pair in args.chunks(2) {
            let [condition, result] = pair else {
                // A trailing condition with no result is a malformed call.
                return Operand::error(CellError::NA);
            };
            let operand = eval(ctx, condition);
            match ctx.scalar(&operand).coerce_bool() {
                Err(e) => return Operand::error(e),
                Ok(true) => return eval(ctx, result),
                Ok(false) => {}
            }
        }
        // No condition matched: Excel reports #N/A rather than a blank.
        Operand::error(CellError::NA)
    }),
    lazy("IFERROR", 2, Some(2), |ctx, args| {
        let operand = eval(ctx, &args[0]);
        if ctx.scalar(&operand).is_error() {
            return eval(ctx, &args[1]);
        }
        operand
    }),
    lazy("IFNA", 2, Some(2), |ctx, args| {
        let operand = eval(ctx, &args[0]);
        if ctx.scalar(&operand).as_error() == Some(CellError::NA) {
            return eval(ctx, &args[1]);
        }
        operand
    }),
    lazy("CHOOSE", 2, None, |ctx, args| {
        let index = match scalar(ctx, args, 0).coerce_number() {
            Ok(n) => n.trunc(),
            Err(e) => return Operand::error(e),
        };
        if index < 1.0 || index as usize >= args.len() {
            return Operand::error(CellError::Value);
        }
        eval(ctx, &args[index as usize])
    }),
    lazy("SWITCH", 3, None, |ctx, args| {
        let subject = scalar(ctx, args, 0);
        if let Some(e) = subject.as_error() {
            return Operand::error(e);
        }
        let mut i = 1;
        while i + 1 < args.len() {
            if subject.compare(&scalar(ctx, args, i)).is_some_and(|o| o.is_eq()) {
                return eval(ctx, &args[i + 1]);
            }
            i += 2;
        }
        // An odd argument left over is the default.
        match args.len() % 2 {
            0 => eval(ctx, &args[args.len() - 1]),
            _ => Operand::error(CellError::NA),
        }
    }),
    f("AND", 1, None, |ctx, a| fold_logical(ctx, a, true, |acc, v| acc && v)),
    f("OR", 1, None, |ctx, a| fold_logical(ctx, a, false, |acc, v| acc || v)),
    f("XOR", 1, None, |ctx, a| fold_logical(ctx, a, false, |acc, v| acc ^ v)),
    f("NOT", 1, Some(1), |ctx, a| match arg_bool(ctx, a, 0) {
        Ok(b) => Operand::bool(!b),
        Err(e) => Operand::error(e),
    }),
    f("TRUE", 0, Some(0), |_, _| Operand::bool(true)),
    f("FALSE", 0, Some(0), |_, _| Operand::bool(false)),
];
