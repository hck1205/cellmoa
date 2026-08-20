//! The expression evaluator.
//!
//! Evaluation is a plain recursive walk of the tree, with two Excel-specific
//! wrinkles handled here rather than in the individual functions:
//!
//! * **Scalar context.** A multi-cell reference used where one value is wanted
//!   is intersected against the formula's own row or column. Functions that
//!   genuinely want array semantics — `SUMPRODUCT` and friends — switch the
//!   context on, and then the same reference broadcasts instead.
//! * **Error propagation.** Errors are values, not aborts. They travel through
//!   arithmetic and out of functions unless a function deliberately catches
//!   them, which is what makes `IFERROR` and `ISERROR` work.

use crate::functions::{self, Call};
use crate::operand::{Area, Array, Operand};
use crate::resolve::{resolve, Resolved};
use cellmoa_core::model::{SheetId, Workbook};
use cellmoa_core::reference::CellRef;
use cellmoa_core::value::{CellError, Value};
use cellmoa_formula::ast::{BinaryOp, Expr, UnaryOp};
use cellmoa_formula::parse;

/// A splitmix64 generator: small, fast, and — the point here — reproducible.
#[derive(Debug, Clone)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn seeded(seed: u64) -> Rng {
        Rng { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A value in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        // 53 bits is exactly the mantissa width, so every output is exact.
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// How deep a formula may nest before it is treated as runaway recursion.
/// Excel's own limit is 64 levels of function nesting; this is well past it and
/// exists only to keep a pathological defined name from exhausting the stack.
const MAX_DEPTH: usize = 256;

/// Everything an expression needs in order to be evaluated.
pub struct EvalCtx<'a> {
    pub wb: &'a Workbook,
    /// The sheet the formula lives on — the target of unqualified references.
    pub sheet: SheetId,
    /// The cell the formula lives in, used for implicit intersection.
    pub cell: CellRef,
    /// When set, references broadcast element-wise instead of intersecting.
    pub array_context: bool,
    /// Set if any function used makes the formula volatile.
    pub volatile: bool,
    /// The current date and time as a serial number, or `None` when the host
    /// has not supplied a clock.
    ///
    /// The engine never reads the system clock on its own. `TODAY()` and
    /// `NOW()` are as corrosive to reproducibility as `RAND()` is, so the time
    /// is an input the host provides and the journal records, not something the
    /// engine helps itself to.
    pub now: Option<f64>,
    /// Deterministic random source for `RAND` and `RANDBETWEEN`.
    ///
    /// A spreadsheet engine that reaches for the system entropy pool cannot be
    /// replayed or fingerprinted. The engine seeds this per cell from the
    /// workbook seed and the cell's address, so a random value is stable for a
    /// given cell and recalculation, and a replay reproduces it exactly.
    pub rng: Rng,
    depth: usize,
    /// Defined names currently being expanded, to catch a name that refers to
    /// itself.
    name_stack: Vec<String>,
}

impl<'a> EvalCtx<'a> {
    pub fn new(wb: &'a Workbook, sheet: SheetId, cell: CellRef) -> EvalCtx<'a> {
        EvalCtx {
            wb,
            sheet,
            cell,
            array_context: false,
            volatile: false,
            now: None,
            rng: Rng::seeded(0),
            depth: 0,
            name_stack: Vec::new(),
        }
    }

    /// Reseeds the random source, which the engine does per cell.
    pub fn with_seed(mut self, seed: u64) -> EvalCtx<'a> {
        self.rng = Rng::seeded(seed);
        self
    }

    /// Supplies the clock `TODAY` and `NOW` read.
    pub fn with_now(mut self, now: Option<f64>) -> EvalCtx<'a> {
        self.now = now;
        self
    }

    /// Evaluates a sub-expression with array semantics switched on.
    pub fn in_array_context<T>(&mut self, f: impl FnOnce(&mut EvalCtx<'a>) -> T) -> T {
        let saved = std::mem::replace(&mut self.array_context, true);
        let out = f(self);
        self.array_context = saved;
        out
    }

    /// Forces an operand to a single value in this cell's context.
    pub fn scalar(&self, operand: &Operand) -> Value {
        operand.to_scalar(self.wb, self.cell)
    }
}

/// Evaluates an expression to an operand.
pub fn eval(ctx: &mut EvalCtx, expr: &Expr) -> Operand {
    if ctx.depth > MAX_DEPTH {
        return Operand::error(CellError::Value);
    }
    ctx.depth += 1;
    let out = eval_inner(ctx, expr);
    ctx.depth -= 1;
    out
}

/// Evaluates a formula down to the single value that is stored in a cell.
pub fn eval_to_value(ctx: &mut EvalCtx, expr: &Expr) -> Value {
    let operand = eval(ctx, expr);
    ctx.scalar(&operand)
}

fn eval_inner(ctx: &mut EvalCtx, expr: &Expr) -> Operand {
    match expr {
        Expr::Number(n) => Operand::number(*n),
        Expr::Text(s) => Operand::text(s.clone()),
        Expr::Bool(b) => Operand::bool(*b),
        Expr::Error(e) => Operand::error(*e),
        // An omitted argument reads as blank, which coerces to 0 or "" exactly
        // as an empty cell would.
        Expr::Missing => Operand::blank(),
        Expr::Paren(inner) => eval(ctx, inner),
        Expr::Ref(r) => match resolve(ctx.wb, ctx.sheet, r) {
            Resolved::Invalid => Operand::error(CellError::Ref),
            resolved => Operand::Ref(
                resolved.areas().into_iter().map(|(s, range)| Area::new(s, range)).collect(),
            ),
        },
        Expr::Name(name) => eval_name(ctx, name),
        Expr::Array(rows) => eval_array_literal(ctx, rows),
        Expr::Unary { op, expr } => eval_unary(ctx, *op, expr),
        Expr::Binary { op, lhs, rhs } => eval_binary(ctx, *op, lhs, rhs),
        Expr::Func { name, args } => eval_call(ctx, name, args),
    }
}

fn eval_array_literal(ctx: &mut EvalCtx, rows: &[Vec<Expr>]) -> Operand {
    let values: Vec<Vec<Value>> =
        rows.iter().map(|row| row.iter().map(|cell| eval_to_value(ctx, cell)).collect()).collect();
    Operand::Array(Array::from_rows(values))
}

/// Expands a defined name to whatever it refers to.
fn eval_name(ctx: &mut EvalCtx, name: &str) -> Operand {
    // A name may be written sheet-qualified: `Sheet1!Total`.
    let (scope, bare) = match name.rsplit_once('!') {
        Some((sheet, bare)) => (ctx.wb.sheet_id_by_name(sheet.trim_matches('\'')), bare),
        None => (None, name),
    };
    let Some(defined) = ctx.wb.name(bare) else {
        return Operand::error(CellError::Name);
    };
    if ctx.name_stack.iter().any(|n| n.eq_ignore_ascii_case(bare)) {
        // A name that refers to itself would otherwise recurse forever.
        return Operand::error(CellError::Cycle);
    }
    let Ok(expr) = parse(&defined.refers_to) else {
        return Operand::error(CellError::Name);
    };

    // The name's own scope decides what its unqualified references mean.
    let target_sheet = scope.or(defined.scope).unwrap_or(ctx.sheet);
    let saved_sheet = std::mem::replace(&mut ctx.sheet, target_sheet);
    ctx.name_stack.push(bare.to_string());
    let out = eval(ctx, &expr);
    ctx.name_stack.pop();
    ctx.sheet = saved_sheet;
    out
}

fn eval_unary(ctx: &mut EvalCtx, op: UnaryOp, expr: &Expr) -> Operand {
    let operand = eval(ctx, expr);
    map_elementwise(ctx, &operand, |v| match op {
        UnaryOp::Plus => match v.coerce_number() {
            Ok(_) => v,
            Err(e) => Value::Error(e),
        },
        UnaryOp::Neg => match v.coerce_number() {
            Ok(n) => Value::Number(-n),
            Err(e) => Value::Error(e),
        },
        UnaryOp::Percent => match v.coerce_number() {
            Ok(n) => Value::Number(n / 100.0),
            Err(e) => Value::Error(e),
        },
    })
}

fn eval_binary(ctx: &mut EvalCtx, op: BinaryOp, lhs: &Expr, rhs: &Expr) -> Operand {
    match op {
        BinaryOp::Range => return eval_range_operator(ctx, lhs, rhs),
        BinaryOp::Intersect => return eval_intersection(ctx, lhs, rhs),
        BinaryOp::Union => return eval_union(ctx, lhs, rhs),
        _ => {}
    }
    let left = eval(ctx, lhs);
    let right = eval(ctx, rhs);
    zip_elementwise(ctx, &left, &right, |a, b| apply_binary(op, a, b))
}

/// The value-level part of a binary operator, once both sides are scalars.
fn apply_binary(op: BinaryOp, a: Value, b: Value) -> Value {
    if let Some(e) = a.as_error().or_else(|| b.as_error()) {
        return Value::Error(e);
    }
    match op {
        BinaryOp::Concat => match (a.coerce_text(), b.coerce_text()) {
            (Ok(x), Ok(y)) => Value::Text(x + &y),
            (Err(e), _) | (_, Err(e)) => Value::Error(e),
        },
        BinaryOp::Eq | BinaryOp::Ne | BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge => {
            let Some(ord) = a.compare(&b) else {
                return Value::Error(CellError::Value);
            };
            Value::Bool(match op {
                BinaryOp::Eq => ord.is_eq(),
                BinaryOp::Ne => ord.is_ne(),
                BinaryOp::Lt => ord.is_lt(),
                BinaryOp::Le => ord.is_le(),
                BinaryOp::Gt => ord.is_gt(),
                _ => ord.is_ge(),
            })
        }
        _ => {
            let (x, y) = match (a.coerce_number(), b.coerce_number()) {
                (Ok(x), Ok(y)) => (x, y),
                (Err(e), _) | (_, Err(e)) => return Value::Error(e),
            };
            match op {
                BinaryOp::Add => finite(x + y),
                BinaryOp::Sub => finite(x - y),
                BinaryOp::Mul => finite(x * y),
                BinaryOp::Div => {
                    if y == 0.0 {
                        Value::Error(CellError::Div0)
                    } else {
                        finite(x / y)
                    }
                }
                BinaryOp::Pow => {
                    let r = x.powf(y);
                    if r.is_nan() {
                        // e.g. (-8)^(1/3): outside the reals, so #NUM! as in Excel.
                        Value::Error(CellError::Num)
                    } else {
                        finite(r)
                    }
                }
                _ => unreachable!("handled above"),
            }
        }
    }
}

/// Keeps non-finite results out of cells: a cell never holds an infinity or a
/// NaN, which is what lets `Value` stay comparable and hashable.
fn finite(n: f64) -> Value {
    if n.is_finite() {
        Value::Number(n)
    } else {
        Value::Error(CellError::Num)
    }
}

/// `A1:INDEX(...)` — a range whose endpoints are computed.
fn eval_range_operator(ctx: &mut EvalCtx, lhs: &Expr, rhs: &Expr) -> Operand {
    let (left, right) = (eval(ctx, lhs), eval(ctx, rhs));
    let (Some(a), Some(b)) = (left.single_area(), right.single_area()) else {
        return Operand::error(CellError::Value);
    };
    if a.sheet != b.sheet {
        return Operand::error(CellError::Value);
    }
    let range = cellmoa_core::reference::RangeRef::new(a.range.start, b.range.end);
    Operand::Ref(vec![Area::new(a.sheet, range)])
}

/// A space between two references: the cells they have in common.
fn eval_intersection(ctx: &mut EvalCtx, lhs: &Expr, rhs: &Expr) -> Operand {
    let (left, right) = (eval(ctx, lhs), eval(ctx, rhs));
    let (Some(a), Some(b)) = (left.single_area(), right.single_area()) else {
        return Operand::error(CellError::Null);
    };
    if a.sheet != b.sheet {
        return Operand::error(CellError::Null);
    }
    match a.range.intersection(&b.range) {
        Some(range) => Operand::Ref(vec![Area::new(a.sheet, range)]),
        // Ranges that do not overlap are exactly what `#NULL!` reports.
        None => Operand::error(CellError::Null),
    }
}

/// A comma between two references inside parentheses: both areas together.
fn eval_union(ctx: &mut EvalCtx, lhs: &Expr, rhs: &Expr) -> Operand {
    let (left, right) = (eval(ctx, lhs), eval(ctx, rhs));
    match (left, right) {
        (Operand::Ref(mut a), Operand::Ref(b)) => {
            a.extend(b);
            Operand::Ref(a)
        }
        _ => Operand::error(CellError::Value),
    }
}

/// Applies a value-level function across an operand, respecting array context.
fn map_elementwise(ctx: &EvalCtx, operand: &Operand, f: impl Fn(Value) -> Value + Copy) -> Operand {
    if !ctx.array_context {
        return Operand::Value(f(ctx.scalar(operand)));
    }
    let (rows, cols) = operand.shape();
    if rows == 1 && cols == 1 {
        return Operand::Value(f(ctx.scalar(operand)));
    }
    let mut data = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            data.push(f(operand.value_at(ctx.wb, r, c)));
        }
    }
    Operand::Array(Array::new(rows, cols, data))
}

/// Combines two operands element-wise, respecting array context.
fn zip_elementwise(
    ctx: &EvalCtx,
    lhs: &Operand,
    rhs: &Operand,
    f: impl Fn(Value, Value) -> Value + Copy,
) -> Operand {
    if !ctx.array_context {
        return Operand::Value(f(ctx.scalar(lhs), ctx.scalar(rhs)));
    }
    let (lr, lc) = lhs.shape();
    let (rr, rc) = rhs.shape();
    let (rows, cols) = (lr.max(rr), lc.max(rc));
    if rows == 1 && cols == 1 {
        return Operand::Value(f(ctx.scalar(lhs), ctx.scalar(rhs)));
    }
    let mut data = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            data.push(f(lhs.value_at(ctx.wb, r, c), rhs.value_at(ctx.wb, r, c)));
        }
    }
    Operand::Array(Array::new(rows, cols, data))
}

fn eval_call(ctx: &mut EvalCtx, name: &str, args: &[Expr]) -> Operand {
    let Some(function) = functions::lookup(name) else {
        return Operand::error(CellError::Name);
    };
    if args.len() < function.min_args || function.max_args.is_some_and(|max| args.len() > max) {
        return Operand::error(CellError::Value);
    }
    if function.volatile {
        ctx.volatile = true;
    }

    match function.call {
        // Lazy functions receive the unevaluated arguments so they can skip
        // branches — without this, `IF(A1=0,0,1/A1)` would still divide by zero.
        Call::Lazy(f) => f(ctx, args),
        Call::Eager(f) => {
            let evaluate = |ctx: &mut EvalCtx| -> Vec<Operand> {
                args.iter().map(|arg| eval(ctx, arg)).collect()
            };
            let operands =
                if function.array_context { ctx.in_array_context(evaluate) } else { evaluate(ctx) };
            if function.array_context {
                ctx.in_array_context(|ctx| f(ctx, &operands))
            } else {
                f(ctx, &operands)
            }
        }
    }
}
