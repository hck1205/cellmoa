//! Statistical functions, including the criteria-driven `*IF` family.

use super::args;
use super::criteria::Criterion;
use super::*;
use crate::operand::{Area, Operand};

/// Resizes a reference to a given shape, anchored at its own top-left corner.
///
/// This is Excel's quiet rule for the second range of a `SUMIF`: writing
/// `SUMIF(A1:A10,">5",B1)` sums `B1:B10`, because the sum range is stretched to
/// match the criteria range rather than being read as one cell.
fn resize_like(operand: &Operand, rows: usize, cols: usize) -> Operand {
    let Some(area) = operand.single_area() else { return operand.clone() };
    if area.range.height() as usize == rows && area.range.width() as usize == cols {
        return operand.clone();
    }
    let start = area.range.start;
    let end = cellmoa_core::reference::CellRef::new(
        start.col + cols.saturating_sub(1) as u32,
        start.row + rows.saturating_sub(1) as u32,
    );
    Operand::Ref(vec![Area::new(area.sheet, cellmoa_core::reference::RangeRef::new(start, end))])
}

/// Walks the positions where every criterion holds.
///
/// `pairs` are `(range, criterion)`; every range must have the same shape as the
/// first, which is the shape iterated.
fn for_each_matching(
    ctx: &EvalCtx,
    pairs: &[(&Operand, Criterion)],
    values: Option<&Operand>,
    f: &mut impl FnMut(&Value),
) -> Result<(), CellError> {
    let (rows, cols) = pairs[0].0.effective_shape(ctx.wb);
    let ranges: Vec<Operand> = pairs.iter().map(|(r, _)| resize_like(r, rows, cols)).collect();
    let values = values.map(|v| resize_like(v, rows, cols));
    for r in 0..rows {
        for c in 0..cols {
            let all_match = ranges
                .iter()
                .zip(pairs)
                .all(|(range, (_, criterion))| criterion.matches(&range.value_at(ctx.wb, r, c)));
            if !all_match {
                continue;
            }
            match &values {
                Some(source) => {
                    let value = source.value_at(ctx.wb, r, c);
                    if let Some(e) = value.as_error() {
                        return Err(e);
                    }
                    f(&value);
                }
                None => f(&Value::Blank),
            }
        }
    }
    Ok(())
}

/// Builds the `(range, criterion)` pairs of a `*IFS` call, whose arguments come
/// in `range, criterion` order after the leading value range.
fn pairs_from<'a>(ctx: &EvalCtx, args: &'a [Operand]) -> Vec<(&'a Operand, Criterion)> {
    args.chunks(2)
        .filter(|chunk| chunk.len() == 2)
        .map(|chunk| (&chunk[0], Criterion::parse(&ctx.scalar(&chunk[1]))))
        .collect()
}

/// Sums, counts and averages share this shape.
fn conditional(
    ctx: &EvalCtx,
    pairs: &[(&Operand, Criterion)],
    values: Option<&Operand>,
    finish: impl Fn(&[f64], usize) -> Operand,
) -> Operand {
    let mut numbers = Vec::new();
    let mut matched = 0usize;
    let result = for_each_matching(ctx, pairs, values, &mut |v| {
        matched += 1;
        if let Value::Number(n) = v {
            numbers.push(*n);
        }
    });
    match result {
        Err(e) => Operand::error(e),
        Ok(()) => finish(&numbers, matched),
    }
}

/// The numbers of an argument list, sorted ascending — the basis of every
/// order statistic.
fn sorted_numbers(ctx: &EvalCtx, args: &[Operand]) -> Result<Vec<f64>, CellError> {
    let mut values = collect_numbers(ctx, args)?;
    // Values never hold NaN, so this ordering is total.
    values.sort_by(|a, b| a.partial_cmp(b).expect("no NaN in a cell"));
    Ok(values)
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

/// Sum of squared deviations from the mean.
fn sum_squared_deviations(values: &[f64]) -> f64 {
    let m = mean(values);
    values.iter().map(|v| (v - m).powi(2)).sum()
}

/// Variance with the given denominator offset: 1 for a sample, 0 for a
/// population.
fn variance(values: &[f64], ddof: usize) -> Result<f64, CellError> {
    if values.len() <= ddof {
        return Err(CellError::Div0);
    }
    Ok(sum_squared_deviations(values) / (values.len() - ddof) as f64)
}

/// The values of an argument list as `AVERAGEA` and friends see them: text
/// counts as zero and booleans as 0 or 1, rather than being skipped.
fn collect_numbers_counting_text(ctx: &EvalCtx, args: &[Operand]) -> Result<Vec<f64>, CellError> {
    let mut out = Vec::new();
    let mut error = None;
    for operand in args {
        operand.for_each(ctx.wb, &mut |v| match v {
            Value::Error(e) if error.is_none() => error = Some(*e),
            Value::Number(n) => out.push(*n),
            Value::Bool(b) => out.push(f64::from(*b)),
            Value::Text(_) => out.push(0.0),
            _ => {}
        });
    }
    match error {
        Some(e) => Err(e),
        None => Ok(out),
    }
}

/// The paired numeric values of two ranges, skipping positions where either
/// side is not a number — the input every regression function needs.
fn paired(ctx: &EvalCtx, a: &Operand, b: &Operand) -> Result<(Vec<f64>, Vec<f64>), CellError> {
    let (x, y) = (a.to_array(ctx.wb), b.to_array(ctx.wb));
    if x.rows() * x.cols() != y.rows() * y.cols() {
        return Err(CellError::NA);
    }
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for (a, b) in x.values().zip(y.values()) {
        if let Some(e) = a.as_error().or_else(|| b.as_error()) {
            return Err(e);
        }
        if let (Value::Number(a), Value::Number(b)) = (a, b) {
            xs.push(*a);
            ys.push(*b);
        }
    }
    if xs.is_empty() {
        return Err(CellError::Div0);
    }
    Ok((xs, ys))
}

/// Covariance times n — the shared numerator of CORREL, SLOPE and RSQ.
fn co_moment(xs: &[f64], ys: &[f64]) -> (f64, f64, f64) {
    let (mx, my) = (mean(xs), mean(ys));
    let sxy: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
    let sxx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
    let syy: f64 = ys.iter().map(|y| (y - my).powi(2)).sum();
    (sxy, sxx, syy)
}

/// The percentile of a sorted list, interpolating between neighbours.
fn percentile_inclusive(sorted: &[f64], k: f64) -> Result<f64, CellError> {
    if sorted.is_empty() || !(0.0..=1.0).contains(&k) {
        return Err(CellError::Num);
    }
    let position = k * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let fraction = position - lower as f64;
    if lower + 1 >= sorted.len() {
        return Ok(sorted[sorted.len() - 1]);
    }
    Ok(sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]))
}

/// The exclusive variant, which refuses the ends of the distribution.
fn percentile_exclusive(sorted: &[f64], k: f64) -> Result<f64, CellError> {
    let n = sorted.len();
    if n == 0 || k <= 0.0 || k >= 1.0 {
        return Err(CellError::Num);
    }
    let position = k * (n as f64 + 1.0) - 1.0;
    if position < 0.0 || position > (n - 1) as f64 {
        return Err(CellError::Num);
    }
    let lower = position.floor() as usize;
    let fraction = position - lower as f64;
    if lower + 1 >= n {
        return Ok(sorted[n - 1]);
    }
    Ok(sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]))
}

pub const FUNCTIONS: &[Function] = &[
    // --- counting ---------------------------------------------------------
    f("COUNT", 1, None, |ctx, a| {
        let mut n = 0usize;
        for operand in a {
            match operand {
                // A literal is counted if it can be read as a number, so
                // COUNT(1,"1",TRUE) is 3.
                Operand::Value(v) => {
                    if !v.is_blank() && v.coerce_number().is_ok() {
                        n += 1;
                    }
                }
                // Inside a range only actual numbers count — and unlike the
                // other aggregates, COUNT is not derailed by an error sitting
                // in the range, it simply does not count it.
                _ => operand.for_each(ctx.wb, &mut |v| {
                    if matches!(v, Value::Number(_)) {
                        n += 1;
                    }
                }),
            }
        }
        Operand::number(n as f64)
    }),
    f("COUNTA", 1, None, |ctx, a| {
        let mut n = 0usize;
        for operand in a {
            operand.for_each(ctx.wb, &mut |v| {
                if !v.is_blank() {
                    n += 1;
                }
            });
        }
        Operand::number(n as f64)
    }),
    f("COUNTBLANK", 1, Some(1), |ctx, a| {
        let (rows, cols) = a[0].effective_shape(ctx.wb);
        let mut n = 0usize;
        for r in 0..rows {
            for c in 0..cols {
                let v = a[0].value_at(ctx.wb, r, c);
                // An empty string counts as blank here, unlike in COUNTA.
                if v.is_blank() || matches!(&v, Value::Text(t) if t.is_empty()) {
                    n += 1;
                }
            }
        }
        Operand::number(n as f64)
    }),
    f("COUNTIF", 2, Some(2), |ctx, a| {
        let pairs = vec![(&a[0], Criterion::parse(&ctx.scalar(&a[1])))];
        conditional(ctx, &pairs, None, |_, matched| Operand::number(matched as f64))
    }),
    f("COUNTIFS", 2, None, |ctx, a| {
        let pairs = pairs_from(ctx, a);
        if pairs.is_empty() {
            return Operand::error(CellError::Value);
        }
        conditional(ctx, &pairs, None, |_, matched| Operand::number(matched as f64))
    }),
    // --- conditional sums and averages -------------------------------------
    f("SUMIF", 2, Some(3), |ctx, a| {
        let pairs = vec![(&a[0], Criterion::parse(&ctx.scalar(&a[1])))];
        let values = a.get(2).unwrap_or(&a[0]);
        conditional(ctx, &pairs, Some(values), |numbers, _| number(numbers.iter().sum()))
    }),
    f("SUMIFS", 3, None, |ctx, a| {
        let pairs = pairs_from(ctx, &a[1..]);
        if pairs.is_empty() {
            return Operand::error(CellError::Value);
        }
        conditional(ctx, &pairs, Some(&a[0]), |numbers, _| number(numbers.iter().sum()))
    }),
    f("AVERAGEIF", 2, Some(3), |ctx, a| {
        let pairs = vec![(&a[0], Criterion::parse(&ctx.scalar(&a[1])))];
        let values = a.get(2).unwrap_or(&a[0]);
        conditional(ctx, &pairs, Some(values), |numbers, _| {
            if numbers.is_empty() {
                Operand::error(CellError::Div0)
            } else {
                number(mean(numbers))
            }
        })
    }),
    f("AVERAGEIFS", 3, None, |ctx, a| {
        let pairs = pairs_from(ctx, &a[1..]);
        if pairs.is_empty() {
            return Operand::error(CellError::Value);
        }
        conditional(ctx, &pairs, Some(&a[0]), |numbers, _| {
            if numbers.is_empty() {
                Operand::error(CellError::Div0)
            } else {
                number(mean(numbers))
            }
        })
    }),
    f("MAXIFS", 3, None, |ctx, a| {
        let pairs = pairs_from(ctx, &a[1..]);
        if pairs.is_empty() {
            return Operand::error(CellError::Value);
        }
        conditional(ctx, &pairs, Some(&a[0]), |numbers, _| {
            // Nothing matched is zero; a set of negatives is its own maximum.
            match numbers.iter().copied().reduce(f64::max) {
                Some(v) => number(v),
                None => Operand::number(0.0),
            }
        })
    }),
    f("MINIFS", 3, None, |ctx, a| {
        let pairs = pairs_from(ctx, &a[1..]);
        if pairs.is_empty() {
            return Operand::error(CellError::Value);
        }
        conditional(ctx, &pairs, Some(&a[0]), |numbers, _| {
            match numbers.iter().copied().reduce(f64::min) {
                Some(v) => number(v),
                None => Operand::number(0.0),
            }
        })
    }),
    // --- averages and extremes ---------------------------------------------
    f("AVERAGE", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Div0),
        Ok(values) => number(mean(&values)),
        Err(e) => Operand::error(e),
    }),
    f("AVERAGEA", 1, None, |ctx, a| match collect_numbers_counting_text(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Div0),
        Ok(values) => number(mean(&values)),
        Err(e) => Operand::error(e),
    }),
    f("MAX", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        // An empty MAX is zero in Excel, not an error.
        Ok(values) if values.is_empty() => Operand::number(0.0),
        Ok(values) => number(values.into_iter().fold(f64::NEG_INFINITY, f64::max)),
        Err(e) => Operand::error(e),
    }),
    f("MIN", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::number(0.0),
        Ok(values) => number(values.into_iter().fold(f64::INFINITY, f64::min)),
        Err(e) => Operand::error(e),
    }),
    f("MAXA", 1, None, |ctx, a| match collect_numbers_counting_text(ctx, a) {
        Ok(values) if values.is_empty() => Operand::number(0.0),
        Ok(values) => number(values.into_iter().fold(f64::NEG_INFINITY, f64::max)),
        Err(e) => Operand::error(e),
    }),
    f("MINA", 1, None, |ctx, a| match collect_numbers_counting_text(ctx, a) {
        Ok(values) if values.is_empty() => Operand::number(0.0),
        Ok(values) => number(values.into_iter().fold(f64::INFINITY, f64::min)),
        Err(e) => Operand::error(e),
    }),
    f("MEDIAN", 1, None, |ctx, a| match sorted_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Num),
        Ok(values) => {
            let mid = values.len() / 2;
            number(if values.len() % 2 == 0 {
                (values[mid - 1] + values[mid]) / 2.0
            } else {
                values[mid]
            })
        }
        Err(e) => Operand::error(e),
    }),
    f("LARGE", 2, Some(2), |ctx, a| {
        args!(k = arg_num(ctx, a, 1));
        match sorted_numbers(ctx, &a[..1]) {
            Ok(values) => {
                let k = k.trunc() as usize;
                if k < 1 || k > values.len() {
                    return Operand::error(CellError::Num);
                }
                number(values[values.len() - k])
            }
            Err(e) => Operand::error(e),
        }
    }),
    f("SMALL", 2, Some(2), |ctx, a| {
        args!(k = arg_num(ctx, a, 1));
        match sorted_numbers(ctx, &a[..1]) {
            Ok(values) => {
                let k = k.trunc() as usize;
                if k < 1 || k > values.len() {
                    return Operand::error(CellError::Num);
                }
                number(values[k - 1])
            }
            Err(e) => Operand::error(e),
        }
    }),
    // --- spread -------------------------------------------------------------
    f("VAR.S", 1, None, |ctx, a| spread(ctx, a, 1, false, false)),
    f("VAR", 1, None, |ctx, a| spread(ctx, a, 1, false, false)),
    f("VAR.P", 1, None, |ctx, a| spread(ctx, a, 0, false, false)),
    f("VARP", 1, None, |ctx, a| spread(ctx, a, 0, false, false)),
    f("VARA", 1, None, |ctx, a| spread(ctx, a, 1, false, true)),
    f("VARPA", 1, None, |ctx, a| spread(ctx, a, 0, false, true)),
    f("STDEV.S", 1, None, |ctx, a| spread(ctx, a, 1, true, false)),
    f("STDEV", 1, None, |ctx, a| spread(ctx, a, 1, true, false)),
    f("STDEV.P", 1, None, |ctx, a| spread(ctx, a, 0, true, false)),
    f("STDEVP", 1, None, |ctx, a| spread(ctx, a, 0, true, false)),
    f("STDEVA", 1, None, |ctx, a| spread(ctx, a, 1, true, true)),
    f("STDEVPA", 1, None, |ctx, a| spread(ctx, a, 0, true, true)),
    f("DEVSQ", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Num),
        Ok(values) => number(sum_squared_deviations(&values)),
        Err(e) => Operand::error(e),
    }),
    f("AVEDEV", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Num),
        Ok(values) => {
            let m = mean(&values);
            number(values.iter().map(|v| (v - m).abs()).sum::<f64>() / values.len() as f64)
        }
        Err(e) => Operand::error(e),
    }),
    f("SKEW", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.len() < 3 => Operand::error(CellError::Div0),
        Ok(values) => {
            let n = values.len() as f64;
            let m = mean(&values);
            let Ok(s) = variance(&values, 1).map(f64::sqrt) else {
                return Operand::error(CellError::Div0);
            };
            if s == 0.0 {
                return Operand::error(CellError::Div0);
            }
            let total: f64 = values.iter().map(|v| ((v - m) / s).powi(3)).sum();
            number(n / ((n - 1.0) * (n - 2.0)) * total)
        }
        Err(e) => Operand::error(e),
    }),
    f("SKEW.P", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Div0),
        Ok(values) => {
            let m = mean(&values);
            let Ok(s) = variance(&values, 0).map(f64::sqrt) else {
                return Operand::error(CellError::Div0);
            };
            if s == 0.0 {
                return Operand::error(CellError::Div0);
            }
            let n = values.len() as f64;
            number(values.iter().map(|v| ((v - m) / s).powi(3)).sum::<f64>() / n)
        }
        Err(e) => Operand::error(e),
    }),
    f("KURT", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.len() < 4 => Operand::error(CellError::Div0),
        Ok(values) => {
            let n = values.len() as f64;
            let m = mean(&values);
            let Ok(s) = variance(&values, 1).map(f64::sqrt) else {
                return Operand::error(CellError::Div0);
            };
            if s == 0.0 {
                return Operand::error(CellError::Div0);
            }
            let total: f64 = values.iter().map(|v| ((v - m) / s).powi(4)).sum();
            let scale = n * (n + 1.0) / ((n - 1.0) * (n - 2.0) * (n - 3.0));
            let correction = 3.0 * (n - 1.0).powi(2) / ((n - 2.0) * (n - 3.0));
            number(scale * total - correction)
        }
        Err(e) => Operand::error(e),
    }),
    // --- other means --------------------------------------------------------
    f("GEOMEAN", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Num),
        Ok(values) if values.iter().any(|v| *v <= 0.0) => Operand::error(CellError::Num),
        // Summing logarithms rather than multiplying keeps a long list from
        // overflowing to infinity before the root is taken.
        Ok(values) => {
            let n = values.len() as f64;
            number((values.iter().map(|v| v.ln()).sum::<f64>() / n).exp())
        }
        Err(e) => Operand::error(e),
    }),
    f("HARMEAN", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::error(CellError::Num),
        Ok(values) if values.iter().any(|v| *v <= 0.0) => Operand::error(CellError::Num),
        Ok(values) => {
            let n = values.len() as f64;
            number(n / values.iter().map(|v| 1.0 / v).sum::<f64>())
        }
        Err(e) => Operand::error(e),
    }),
    f("TRIMMEAN", 2, Some(2), |ctx, a| {
        args!(fraction = arg_num(ctx, a, 1));
        if !(0.0..1.0).contains(&fraction) {
            return Operand::error(CellError::Num);
        }
        match sorted_numbers(ctx, &a[..1]) {
            Ok(values) if values.is_empty() => Operand::error(CellError::Num),
            Ok(values) => {
                // The trimmed count is rounded down to an even number so that
                // the same amount comes off each end.
                let drop = ((values.len() as f64 * fraction) / 2.0).floor() as usize;
                let kept = &values[drop..values.len() - drop];
                if kept.is_empty() {
                    return Operand::error(CellError::Num);
                }
                number(mean(kept))
            }
            Err(e) => Operand::error(e),
        }
    }),
    f("STANDARDIZE", 3, Some(3), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), m = arg_num(ctx, a, 1), s = arg_num(ctx, a, 2));
        if s <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number((x - m) / s)
    }),
    f("FISHER", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |x| {
            if x.abs() >= 1.0 {
                Err(CellError::Num)
            } else {
                Ok(((1.0 + x) / (1.0 - x)).ln() / 2.0)
            }
        })
    }),
    f("FISHERINV", 1, Some(1), |ctx, a| {
        num1(ctx, a, |y| {
            let e = (2.0 * y).exp();
            (e - 1.0) / (e + 1.0)
        })
    }),
    // --- order statistics ---------------------------------------------------
    f("PERCENTILE.INC", 2, Some(2), |ctx, a| percentile(ctx, a, true)),
    f("PERCENTILE", 2, Some(2), |ctx, a| percentile(ctx, a, true)),
    f("PERCENTILE.EXC", 2, Some(2), |ctx, a| percentile(ctx, a, false)),
    f("QUARTILE.INC", 2, Some(2), |ctx, a| quartile(ctx, a, true)),
    f("QUARTILE", 2, Some(2), |ctx, a| quartile(ctx, a, true)),
    f("QUARTILE.EXC", 2, Some(2), |ctx, a| quartile(ctx, a, false)),
    f("RANK.EQ", 2, Some(3), |ctx, a| rank(ctx, a, false)),
    f("RANK", 2, Some(3), |ctx, a| rank(ctx, a, false)),
    f("RANK.AVG", 2, Some(3), |ctx, a| rank(ctx, a, true)),
    f("PERCENTRANK.INC", 2, Some(3), |ctx, a| percent_rank(ctx, a, true)),
    f("PERCENTRANK", 2, Some(3), |ctx, a| percent_rank(ctx, a, true)),
    f("PERCENTRANK.EXC", 2, Some(3), |ctx, a| percent_rank(ctx, a, false)),
    f("MODE.SNGL", 1, None, |ctx, a| mode_single(ctx, a)),
    f("MODE", 1, None, |ctx, a| mode_single(ctx, a)),
    f("MODE.MULT", 1, None, |ctx, a| match sorted_numbers(ctx, a) {
        Ok(values) => {
            let modes = modes_of(&values);
            if modes.is_empty() {
                return Operand::error(CellError::NA);
            }
            Operand::Array(crate::operand::Array::column(
                modes.into_iter().map(Value::Number).collect(),
            ))
        }
        Err(e) => Operand::error(e),
    }),
    // --- regression ---------------------------------------------------------
    array_fn("CORREL", 2, Some(2), |ctx, a| correlation(ctx, a)),
    array_fn("PEARSON", 2, Some(2), |ctx, a| correlation(ctx, a)),
    array_fn("RSQ", 2, Some(2), |ctx, a| match correlation(ctx, a) {
        Operand::Value(Value::Number(r)) => Operand::number(r * r),
        other => other,
    }),
    array_fn("COVARIANCE.P", 2, Some(2), |ctx, a| covariance(ctx, a, 0)),
    array_fn("COVAR", 2, Some(2), |ctx, a| covariance(ctx, a, 0)),
    array_fn("COVARIANCE.S", 2, Some(2), |ctx, a| covariance(ctx, a, 1)),
    array_fn("SLOPE", 2, Some(2), |ctx, a| {
        // Excel takes the dependent variable first.
        let (ys, xs) = match paired(ctx, &a[0], &a[1]) {
            Ok(v) => v,
            Err(e) => return Operand::error(e),
        };
        let (sxy, sxx, _) = co_moment(&xs, &ys);
        if sxx == 0.0 {
            return Operand::error(CellError::Div0);
        }
        number(sxy / sxx)
    }),
    array_fn("INTERCEPT", 2, Some(2), |ctx, a| {
        let (ys, xs) = match paired(ctx, &a[0], &a[1]) {
            Ok(v) => v,
            Err(e) => return Operand::error(e),
        };
        let (sxy, sxx, _) = co_moment(&xs, &ys);
        if sxx == 0.0 {
            return Operand::error(CellError::Div0);
        }
        number(mean(&ys) - sxy / sxx * mean(&xs))
    }),
    array_fn("FORECAST", 3, Some(3), |ctx, a| forecast(ctx, a)),
    array_fn("FORECAST.LINEAR", 3, Some(3), |ctx, a| forecast(ctx, a)),
    array_fn("STEYX", 2, Some(2), |ctx, a| {
        let (ys, xs) = match paired(ctx, &a[0], &a[1]) {
            Ok(v) => v,
            Err(e) => return Operand::error(e),
        };
        if xs.len() < 3 {
            return Operand::error(CellError::Div0);
        }
        let (sxy, sxx, syy) = co_moment(&xs, &ys);
        if sxx == 0.0 {
            return Operand::error(CellError::Div0);
        }
        let n = xs.len() as f64;
        number(((syy - sxy * sxy / sxx) / (n - 2.0)).sqrt())
    }),
];

/// The shared body of the variance and standard-deviation family.
fn spread(
    ctx: &EvalCtx,
    args: &[Operand],
    ddof: usize,
    take_root: bool,
    counting_text: bool,
) -> Operand {
    let collected = if counting_text {
        collect_numbers_counting_text(ctx, args)
    } else {
        collect_numbers(ctx, args)
    };
    match collected.and_then(|values| variance(&values, ddof)) {
        Ok(v) => number(if take_root { v.sqrt() } else { v }),
        Err(e) => Operand::error(e),
    }
}

fn percentile(ctx: &EvalCtx, a: &[Operand], inclusive: bool) -> Operand {
    args!(k = arg_num(ctx, a, 1));
    match sorted_numbers(ctx, &a[..1]) {
        Ok(values) => {
            let result = if inclusive {
                percentile_inclusive(&values, k)
            } else {
                percentile_exclusive(&values, k)
            };
            match result {
                Ok(v) => number(v),
                Err(e) => Operand::error(e),
            }
        }
        Err(e) => Operand::error(e),
    }
}

fn quartile(ctx: &EvalCtx, a: &[Operand], inclusive: bool) -> Operand {
    args!(quart = arg_num(ctx, a, 1));
    if !(0.0..=4.0).contains(&quart) {
        return Operand::error(CellError::Num);
    }
    match sorted_numbers(ctx, &a[..1]) {
        Ok(values) => {
            let k = quart.trunc() / 4.0;
            let result = if inclusive {
                percentile_inclusive(&values, k)
            } else {
                percentile_exclusive(&values, k)
            };
            match result {
                Ok(v) => number(v),
                Err(e) => Operand::error(e),
            }
        }
        Err(e) => Operand::error(e),
    }
}

fn rank(ctx: &EvalCtx, a: &[Operand], average_ties: bool) -> Operand {
    args!(target = arg_num(ctx, a, 0), order = opt_num(ctx, a, 2, 0.0));
    let Ok(values) = sorted_numbers(ctx, &a[1..2]) else {
        return Operand::error(CellError::Value);
    };
    if !values.contains(&target) {
        return Operand::error(CellError::NA);
    }
    // Ascending when the order argument is non-zero, descending otherwise.
    let better = if order == 0.0 {
        values.iter().filter(|v| **v > target).count()
    } else {
        values.iter().filter(|v| **v < target).count()
    };
    let ties = values.iter().filter(|v| **v == target).count();
    let top = better as f64 + 1.0;
    number(if average_ties { top + (ties as f64 - 1.0) / 2.0 } else { top })
}

fn percent_rank(ctx: &EvalCtx, a: &[Operand], inclusive: bool) -> Operand {
    args!(x = arg_num(ctx, a, 1), digits = opt_num(ctx, a, 2, 3.0));
    let Ok(values) = sorted_numbers(ctx, &a[..1]) else {
        return Operand::error(CellError::Value);
    };
    if values.is_empty() || x < values[0] || x > values[values.len() - 1] {
        return Operand::error(CellError::NA);
    }
    let n = values.len() as f64;
    let below = values.iter().filter(|v| **v < x).count() as f64;
    let equal = values.iter().filter(|v| **v == x).count() as f64;
    let raw = if equal > 0.0 {
        below
    } else {
        // Interpolate between the neighbours that bracket x.
        let lower = values.iter().rev().find(|v| **v < x).copied().unwrap_or(values[0]);
        let upper = values.iter().find(|v| **v > x).copied().unwrap_or(values[values.len() - 1]);
        below - 1.0 + if upper > lower { (x - lower) / (upper - lower) } else { 0.0 }
    };
    let rank = if inclusive { raw / (n - 1.0) } else { (raw + 1.0) / (n + 1.0) };
    // PERCENTRANK truncates rather than rounds, by design.
    let factor = 10f64.powi(digits.trunc().max(1.0) as i32);
    number((rank * factor).trunc() / factor)
}

/// The values that occur most often, in ascending order. Empty when nothing
/// repeats.
fn modes_of(sorted: &[f64]) -> Vec<f64> {
    let mut best = 1usize;
    let mut counts: Vec<(f64, usize)> = Vec::new();
    for &v in sorted {
        match counts.last_mut() {
            Some((value, count)) if *value == v => *count += 1,
            _ => counts.push((v, 1)),
        }
    }
    for (_, count) in &counts {
        best = best.max(*count);
    }
    if best < 2 {
        return Vec::new();
    }
    counts.into_iter().filter(|(_, c)| *c == best).map(|(v, _)| v).collect()
}

fn mode_single(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    match sorted_numbers(ctx, a) {
        Ok(values) => match modes_of(&values).first() {
            Some(&v) => Operand::number(v),
            None => Operand::error(CellError::NA),
        },
        Err(e) => Operand::error(e),
    }
}

fn correlation(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    let (xs, ys) = match paired(ctx, &a[0], &a[1]) {
        Ok(v) => v,
        Err(e) => return Operand::error(e),
    };
    let (sxy, sxx, syy) = co_moment(&xs, &ys);
    if sxx == 0.0 || syy == 0.0 {
        return Operand::error(CellError::Div0);
    }
    number(sxy / (sxx * syy).sqrt())
}

fn covariance(ctx: &EvalCtx, a: &[Operand], ddof: usize) -> Operand {
    let (xs, ys) = match paired(ctx, &a[0], &a[1]) {
        Ok(v) => v,
        Err(e) => return Operand::error(e),
    };
    if xs.len() <= ddof {
        return Operand::error(CellError::Div0);
    }
    let (sxy, _, _) = co_moment(&xs, &ys);
    number(sxy / (xs.len() - ddof) as f64)
}

fn forecast(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(x = arg_num(ctx, a, 0));
    let (ys, xs) = match paired(ctx, &a[1], &a[2]) {
        Ok(v) => v,
        Err(e) => return Operand::error(e),
    };
    let (sxy, sxx, _) = co_moment(&xs, &ys);
    if sxx == 0.0 {
        return Operand::error(CellError::Div0);
    }
    let slope = sxy / sxx;
    number(mean(&ys) + slope * (x - mean(&xs)))
}
