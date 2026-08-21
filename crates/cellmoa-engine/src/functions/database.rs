//! Database functions.
//!
//! Each takes a table whose first row is headers, a field to aggregate, and a
//! criteria range that is also headed. Within a criteria row the conditions are
//! combined with AND; separate rows are alternatives, combined with OR.

use super::criteria::Criterion;
use super::*;
use crate::operand::{Array, Operand};

/// Locates a field by header name or by one-based position.
fn field_index(table: &Array, field: &Value) -> Option<usize> {
    match field {
        Value::Number(n) => {
            let i = n.trunc() as i64;
            (i >= 1 && i as usize <= table.cols()).then(|| i as usize - 1)
        }
        _ => {
            let wanted = field.coerce_text().ok()?;
            (0..table.cols()).find(|&c| {
                table
                    .get(0, c)
                    .coerce_text()
                    .is_ok_and(|header| header.eq_ignore_ascii_case(wanted.trim()))
            })
        }
    }
}

/// The values of one field for every record matching the criteria.
fn matching_values(ctx: &EvalCtx, a: &[Operand]) -> Result<Vec<Value>, CellError> {
    let table = a[0].to_array(ctx.wb);
    let criteria = a[2].to_array(ctx.wb);
    if table.rows() < 2 || criteria.rows() < 1 {
        return Err(CellError::Value);
    }
    let field = field_index(&table, &ctx.scalar(&a[1])).ok_or(CellError::Value)?;

    // Map each criteria column onto a table column once, rather than per row.
    let mut columns: Vec<(usize, usize)> = Vec::new();
    for c in 0..criteria.cols() {
        let header = criteria.get(0, c);
        if header.is_blank() {
            continue;
        }
        match field_index(&table, &header) {
            Some(table_column) => columns.push((c, table_column)),
            // A criteria header naming no field makes the whole call invalid,
            // rather than silently matching everything.
            None => return Err(CellError::Value),
        }
    }

    let mut out = Vec::new();
    for row in 1..table.rows() {
        // Each criteria row is an alternative; an all-blank one matches
        // everything, which is how a header-only criteria range selects the
        // whole table.
        let matched = (1..criteria.rows()).any(|criteria_row| {
            columns.iter().all(|&(c, table_column)| {
                let condition = criteria.get(criteria_row, c);
                condition.is_blank()
                    || Criterion::parse(&condition).matches(&table.get(row, table_column))
            })
        });
        if matched {
            out.push(table.get(row, field));
        }
    }
    Ok(out)
}

/// The numeric values of the matching records.
fn matching_numbers(ctx: &EvalCtx, a: &[Operand]) -> Result<Vec<f64>, CellError> {
    Ok(matching_values(ctx, a)?
        .into_iter()
        .filter_map(|v| match v {
            Value::Number(n) => Some(n),
            _ => None,
        })
        .collect())
}

/// Shared body: aggregate the matching numbers, or report why not.
fn aggregate(ctx: &EvalCtx, a: &[Operand], finish: impl Fn(&[f64]) -> Option<f64>) -> Operand {
    match matching_numbers(ctx, a) {
        Ok(values) => match finish(&values) {
            Some(v) => number(v),
            None => Operand::error(CellError::Div0),
        },
        Err(e) => Operand::error(e),
    }
}

fn mean(values: &[f64]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
}

fn variance(values: &[f64], ddof: usize) -> Option<f64> {
    if values.len() <= ddof {
        return None;
    }
    let m = mean(values)?;
    Some(values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (values.len() - ddof) as f64)
}

pub const FUNCTIONS: &[Function] = &[
    array_fn("DSUM", 3, Some(3), |ctx, a| aggregate(ctx, a, |values| Some(values.iter().sum()))),
    array_fn("DPRODUCT", 3, Some(3), |ctx, a| {
        aggregate(ctx, a, |values| Some(values.iter().product()))
    }),
    array_fn("DAVERAGE", 3, Some(3), |ctx, a| aggregate(ctx, a, mean)),
    array_fn("DMAX", 3, Some(3), |ctx, a| {
        aggregate(ctx, a, |values| values.iter().copied().reduce(f64::max).or(Some(0.0)))
    }),
    array_fn("DMIN", 3, Some(3), |ctx, a| {
        aggregate(ctx, a, |values| values.iter().copied().reduce(f64::min).or(Some(0.0)))
    }),
    array_fn("DVAR", 3, Some(3), |ctx, a| aggregate(ctx, a, |v| variance(v, 1))),
    array_fn("DVARP", 3, Some(3), |ctx, a| aggregate(ctx, a, |v| variance(v, 0))),
    array_fn("DSTDEV", 3, Some(3), |ctx, a| aggregate(ctx, a, |v| variance(v, 1).map(f64::sqrt))),
    array_fn("DSTDEVP", 3, Some(3), |ctx, a| aggregate(ctx, a, |v| variance(v, 0).map(f64::sqrt))),
    array_fn("DCOUNT", 3, Some(3), |ctx, a| match matching_numbers(ctx, a) {
        Ok(values) => Operand::number(values.len() as f64),
        Err(e) => Operand::error(e),
    }),
    array_fn("DCOUNTA", 3, Some(3), |ctx, a| match matching_values(ctx, a) {
        Ok(values) => Operand::number(values.iter().filter(|v| !v.is_blank()).count() as f64),
        Err(e) => Operand::error(e),
    }),
    array_fn("DGET", 3, Some(3), |ctx, a| match matching_values(ctx, a) {
        Ok(values) => match values.as_slice() {
            [single] => Operand::Value(single.clone()),
            // DGET insists on exactly one record: none is #VALUE!, several is
            // #NUM!, and neither is a silent first-match.
            [] => Operand::error(CellError::Value),
            _ => Operand::error(CellError::Num),
        },
        Err(e) => Operand::error(e),
    }),
];
