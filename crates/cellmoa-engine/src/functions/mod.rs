//! The built-in function library and the registry that resolves a name to it.
//!
//! Functions are declared as plain data so that the catalogue can be listed,
//! counted and checked against a reference implementation — the coverage target
//! is HyperFormula's 400-plus, and a catalogue you can enumerate is the only way
//! to know where you stand against it.

use crate::eval::EvalCtx;
use crate::operand::{Array, Operand};
use cellmoa_core::value::{CellError, Value};
use cellmoa_formula::ast::Expr;
use std::collections::HashMap;
use std::sync::OnceLock;

pub mod criteria;
pub mod info;
pub mod logical;
pub mod math;
pub mod stats;
pub mod text;

/// How a function receives its arguments.
#[derive(Clone, Copy)]
pub enum Call {
    /// Arguments are evaluated first, in the caller's context.
    Eager(fn(&mut EvalCtx, &[Operand]) -> Operand),
    /// Arguments arrive unevaluated, so the function can skip branches.
    Lazy(fn(&mut EvalCtx, &[Expr]) -> Operand),
}

/// One entry in the function catalogue.
pub struct Function {
    /// The canonical spelling, uppercase.
    pub name: &'static str,
    pub min_args: usize,
    /// `None` means variadic.
    pub max_args: Option<usize>,
    /// Recalculates on every pass even when nothing it reads has changed.
    pub volatile: bool,
    /// Evaluates its arguments with array semantics rather than intersecting
    /// them — what makes `SUMPRODUCT((A1:A9>5)*B1:B9)` work.
    pub array_context: bool,
    pub call: Call,
}

/// Declares an ordinary function.
pub const fn f(
    name: &'static str,
    min_args: usize,
    max_args: Option<usize>,
    call: fn(&mut EvalCtx, &[Operand]) -> Operand,
) -> Function {
    Function {
        name,
        min_args,
        max_args,
        volatile: false,
        array_context: false,
        call: Call::Eager(call),
    }
}

/// Declares a volatile function.
pub const fn volatile(
    name: &'static str,
    min_args: usize,
    max_args: Option<usize>,
    call: fn(&mut EvalCtx, &[Operand]) -> Operand,
) -> Function {
    Function {
        name,
        min_args,
        max_args,
        volatile: true,
        array_context: false,
        call: Call::Eager(call),
    }
}

/// Declares a function whose arguments are evaluated as arrays.
pub const fn array_fn(
    name: &'static str,
    min_args: usize,
    max_args: Option<usize>,
    call: fn(&mut EvalCtx, &[Operand]) -> Operand,
) -> Function {
    Function {
        name,
        min_args,
        max_args,
        volatile: false,
        array_context: true,
        call: Call::Eager(call),
    }
}

/// Declares a function that receives its arguments unevaluated.
pub const fn lazy(
    name: &'static str,
    min_args: usize,
    max_args: Option<usize>,
    call: fn(&mut EvalCtx, &[Expr]) -> Operand,
) -> Function {
    Function {
        name,
        min_args,
        max_args,
        volatile: false,
        array_context: false,
        call: Call::Lazy(call),
    }
}

/// Every category's catalogue, in registration order.
fn catalogues() -> &'static [&'static [Function]] {
    &[math::FUNCTIONS, logical::FUNCTIONS, text::FUNCTIONS, info::FUNCTIONS, stats::FUNCTIONS]
}

fn registry() -> &'static HashMap<String, &'static Function> {
    static REGISTRY: OnceLock<HashMap<String, &'static Function>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut map = HashMap::new();
        for catalogue in catalogues() {
            for function in *catalogue {
                if let Some(previous) = map.insert(function.name.to_uppercase(), function) {
                    // Two entries for one name would make behaviour depend on
                    // module order, which is exactly the kind of thing that
                    // silently diverges from the reference implementation.
                    panic!("duplicate function `{}` in the catalogue", previous.name);
                }
            }
        }
        map
    })
}

/// Looks a function up by name, case-insensitively.
///
/// The `_xlfn.` prefix that Excel writes for functions newer than the file
/// format is stripped, so `_xlfn.IFS` and `IFS` are the same function.
pub fn lookup(name: &str) -> Option<&'static Function> {
    let bare = name.strip_prefix("_xlfn.").unwrap_or(name);
    let bare = bare.strip_prefix("_xludf.").unwrap_or(bare);
    registry().get(&bare.to_uppercase()).copied()
}

/// Every function in the catalogue, sorted by name.
pub fn catalogue() -> Vec<&'static Function> {
    let mut all: Vec<&'static Function> = registry().values().copied().collect();
    all.sort_by_key(|f| f.name);
    all
}

// ---------------------------------------------------------------------------
// Helpers shared by the function bodies
// ---------------------------------------------------------------------------

/// Binds several coerced arguments at once, returning the first error.
///
/// Propagating the *actual* error matters: `LEFT(1/0, 2)` is `#DIV/0!`, not the
/// `#VALUE!` that a blanket "some argument was wrong" fallback would produce.
macro_rules! args {
    ($($binding:ident = $expr:expr),+ $(,)?) => {
        $(
            let $binding = match $expr {
                Ok(value) => value,
                Err(e) => return Operand::error(e),
            };
        )+
    };
}
pub(crate) use args;

/// Wraps a computed number, turning a non-finite result into `#NUM!`.
pub fn number(n: f64) -> Operand {
    if n.is_finite() {
        Operand::number(n)
    } else {
        Operand::error(CellError::Num)
    }
}

/// The scalar value of argument `i`, or `Blank` if it was omitted.
pub fn arg(ctx: &EvalCtx, args: &[Operand], i: usize) -> Value {
    args.get(i).map(|a| ctx.scalar(a)).unwrap_or(Value::Blank)
}

/// Argument `i` coerced to a number.
pub fn arg_num(ctx: &EvalCtx, args: &[Operand], i: usize) -> Result<f64, CellError> {
    arg(ctx, args, i).coerce_number()
}

/// Argument `i` coerced to a number, or `default` when it is absent or blank.
pub fn opt_num(ctx: &EvalCtx, args: &[Operand], i: usize, default: f64) -> Result<f64, CellError> {
    match arg(ctx, args, i) {
        Value::Blank => Ok(default),
        v => v.coerce_number(),
    }
}

/// Argument `i` coerced to a whole number, truncated toward zero as Excel does.
pub fn arg_int(ctx: &EvalCtx, args: &[Operand], i: usize) -> Result<i64, CellError> {
    let n = arg_num(ctx, args, i)?;
    if n.abs() >= 9.007_199_254_740_992e15 {
        return Err(CellError::Num);
    }
    Ok(n.trunc() as i64)
}

/// Argument `i` coerced to text.
pub fn arg_text(ctx: &EvalCtx, args: &[Operand], i: usize) -> Result<String, CellError> {
    arg(ctx, args, i).coerce_text()
}

/// Argument `i` coerced to a boolean.
pub fn arg_bool(ctx: &EvalCtx, args: &[Operand], i: usize) -> Result<bool, CellError> {
    arg(ctx, args, i).coerce_bool()
}

/// Applies a one-argument numeric function.
pub fn num1(ctx: &EvalCtx, args: &[Operand], f: impl Fn(f64) -> f64) -> Operand {
    match arg_num(ctx, args, 0) {
        Ok(n) => number(f(n)),
        Err(e) => Operand::error(e),
    }
}

/// Applies a one-argument numeric function that can reject its input.
pub fn num1_checked(
    ctx: &EvalCtx,
    args: &[Operand],
    f: impl Fn(f64) -> Result<f64, CellError>,
) -> Operand {
    match arg_num(ctx, args, 0).and_then(f) {
        Ok(n) => number(n),
        Err(e) => Operand::error(e),
    }
}

/// Applies a two-argument numeric function.
pub fn num2(
    ctx: &EvalCtx,
    args: &[Operand],
    f: impl Fn(f64, f64) -> Result<f64, CellError>,
) -> Operand {
    match arg_num(ctx, args, 0)
        .and_then(|a| Ok((a, arg_num(ctx, args, 1)?)))
        .and_then(|(a, b)| f(a, b))
    {
        Ok(n) => number(n),
        Err(e) => Operand::error(e),
    }
}

/// Collects the numbers from a list of arguments the way an aggregate does.
///
/// The rule Excel applies is not uniform, and the difference is visible:
/// `SUM(TRUE)` is `1`, but `SUM(A1)` with `TRUE` in `A1` is `0`. A value typed
/// directly into the formula is coerced; a value read out of a range is used
/// only if it is already a number. Errors always propagate.
pub fn collect_numbers(ctx: &EvalCtx, args: &[Operand]) -> Result<Vec<f64>, CellError> {
    let mut out = Vec::new();
    for operand in args {
        match operand {
            Operand::Value(v) => match v {
                Value::Error(e) => return Err(*e),
                Value::Blank => {}
                other => out.push(other.coerce_number()?),
            },
            _ => {
                let mut error = None;
                operand.for_each(ctx.wb, &mut |v| match v {
                    Value::Error(e) if error.is_none() => error = Some(*e),
                    Value::Number(n) => out.push(*n),
                    // Text and booleans inside a range are skipped, not coerced.
                    _ => {}
                });
                if let Some(e) = error {
                    return Err(e);
                }
            }
        }
    }
    Ok(out)
}

/// Collects every value from a list of arguments, flattened, blanks included
/// only when they were written literally.
pub fn collect_values(ctx: &EvalCtx, args: &[Operand]) -> Vec<Value> {
    let mut out = Vec::new();
    for operand in args {
        operand.for_each(ctx.wb, &mut |v| out.push(v.clone()));
    }
    out
}

/// Builds a single-row or single-column array, whichever the input shape
/// suggests — used by functions that return a list.
pub fn array_like(source: &Operand, values: Vec<Value>) -> Operand {
    let (_, cols) = source.shape();
    if cols == 1 {
        Operand::Array(Array::column(values))
    } else {
        Operand::Array(Array::row(values))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_is_case_insensitive_and_strips_the_xlfn_prefix() {
        assert!(lookup("sum").is_some());
        assert!(lookup("SUM").is_some());
        assert!(lookup("_xlfn.SUM").is_some());
        assert!(lookup("NOSUCHFUNCTION").is_none());
    }

    #[test]
    fn the_catalogue_has_no_duplicate_names() {
        // `registry()` panics on a duplicate; listing the catalogue forces it.
        let all = catalogue();
        let unique: std::collections::BTreeSet<&str> = all.iter().map(|f| f.name).collect();
        assert_eq!(all.len(), unique.len());
    }

    #[test]
    fn every_function_name_is_uppercase() {
        for function in catalogue() {
            assert_eq!(function.name, function.name.to_uppercase(), "{}", function.name);
        }
    }

    #[test]
    fn argument_counts_are_coherent() {
        for function in catalogue() {
            if let Some(max) = function.max_args {
                assert!(max >= function.min_args, "{} has max < min", function.name);
            }
        }
    }
}
