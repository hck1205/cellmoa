//! Mathematical and trigonometric functions.

use super::args;
use super::*;
use crate::operand::Operand;

/// Rounds half away from zero, the way a spreadsheet does.
///
/// The detour through a decimal string is not decoration. `2.675 * 100` is
/// `267.49999999999997` in binary floating point, so rounding it directly gives
/// `2.67` where every spreadsheet gives `2.68`. Excel carries 15 significant
/// decimal digits, and re-reading the scaled value at that precision restores
/// the number the user actually typed.
pub fn excel_round(value: f64, digits: i32) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let factor = 10f64.powi(digits);
    let scaled = value * factor;
    if !scaled.is_finite() {
        return value;
    }
    let at_15_digits: f64 = format!("{scaled:.14e}").parse().unwrap_or(scaled);
    at_15_digits.abs().round().copysign(at_15_digits) / factor
}

fn truncate(value: f64, digits: i32) -> f64 {
    let factor = 10f64.powi(digits);
    let scaled = value * factor;
    if !scaled.is_finite() {
        return value;
    }
    let at_15_digits: f64 = format!("{scaled:.14e}").parse().unwrap_or(scaled);
    at_15_digits.trunc() / factor
}

/// `CEILING`/`FLOOR` with an explicit rounding direction.
fn to_multiple(number: f64, significance: f64, up: bool) -> Result<f64, CellError> {
    if significance == 0.0 {
        return Ok(0.0);
    }
    let quotient = number / significance;
    let rounded = if up { quotient.ceil() } else { quotient.floor() };
    Ok(rounded * significance)
}

fn factorial(n: f64) -> Result<f64, CellError> {
    if !(0.0..171.0).contains(&n) {
        return Err(CellError::Num);
    }
    Ok((1..=(n.trunc() as u64)).fold(1.0, |acc, i| acc * i as f64))
}

fn combinations(n: f64, k: f64) -> Result<f64, CellError> {
    let (n, k) = (n.trunc(), k.trunc());
    if n < 0.0 || k < 0.0 || k > n {
        return Err(CellError::Num);
    }
    // Multiplicative form: stays exact far longer than n!/(k!(n-k)!).
    let k = k.min(n - k);
    let mut result = 1.0;
    for i in 0..(k as u64) {
        result = result * (n - i as f64) / (i as f64 + 1.0);
    }
    Ok(result)
}

fn gcd2(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd2(b, a % b)
    }
}

/// The whole-number arguments that GCD and LCM take.
fn whole_numbers(ctx: &EvalCtx, args: &[Operand]) -> Result<Vec<u64>, CellError> {
    collect_numbers(ctx, args)?
        .into_iter()
        .map(
            |n| {
                if n < 0.0 || n >= 2f64.powi(53) {
                    Err(CellError::Num)
                } else {
                    Ok(n.trunc() as u64)
                }
            },
        )
        .collect()
}

fn roman(mut n: i64) -> Result<String, CellError> {
    if !(0..4000).contains(&n) {
        return Err(CellError::Value);
    }
    const TABLE: [(i64, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, numeral) in TABLE {
        while n >= value {
            out.push_str(numeral);
            n -= value;
        }
    }
    Ok(out)
}

fn arabic(text: &str) -> Result<f64, CellError> {
    let upper = text.trim().to_uppercase();
    let (negative, body) = match upper.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, upper.as_str()),
    };
    let digit = |c: char| match c {
        'I' => Some(1),
        'V' => Some(5),
        'X' => Some(10),
        'L' => Some(50),
        'C' => Some(100),
        'D' => Some(500),
        'M' => Some(1000),
        _ => None,
    };
    let values: Option<Vec<i64>> = body.chars().map(digit).collect();
    let values = values.ok_or(CellError::Value)?;
    // A numeral smaller than the one after it is subtracted: IV is 4.
    let total: i64 = values
        .iter()
        .enumerate()
        .map(|(i, &v)| if values[i + 1..].iter().any(|&next| next > v) { -v } else { v })
        .sum();
    Ok(if negative { -total as f64 } else { total as f64 })
}

fn to_base(mut n: u64, radix: u32, min_len: usize) -> String {
    const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % radix as u64) as usize]);
        n /= radix as u64;
    }
    while out.len() < min_len.max(1) {
        out.push(b'0');
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII digits")
}

pub const FUNCTIONS: &[Function] = &[
    // --- basic arithmetic -------------------------------------------------
    f("ABS", 1, Some(1), |ctx, a| num1(ctx, a, f64::abs)),
    f("SIGN", 1, Some(1), |ctx, a| {
        num1(ctx, a, |n| {
            if n > 0.0 {
                1.0
            } else if n < 0.0 {
                -1.0
            } else {
                0.0
            }
        })
    }),
    f("SQRT", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n < 0.0 { Err(CellError::Num) } else { Ok(n.sqrt()) })
    }),
    f("SQRTPI", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| {
            if n < 0.0 {
                Err(CellError::Num)
            } else {
                Ok((n * std::f64::consts::PI).sqrt())
            }
        })
    }),
    f("POWER", 2, Some(2), |ctx, a| {
        num2(ctx, a, |b, e| {
            let r = b.powf(e);
            if r.is_nan() {
                Err(CellError::Num)
            } else {
                Ok(r)
            }
        })
    }),
    f("EXP", 1, Some(1), |ctx, a| num1(ctx, a, f64::exp)),
    f("LN", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n <= 0.0 { Err(CellError::Num) } else { Ok(n.ln()) })
    }),
    f("LOG10", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n <= 0.0 { Err(CellError::Num) } else { Ok(n.log10()) })
    }),
    f("LOG", 1, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), base = opt_num(ctx, a, 1, 10.0));
        if n <= 0.0 || base <= 0.0 || base == 1.0 {
            return Operand::error(CellError::Num);
        }
        number(n.log(base))
    }),
    f("MOD", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, d| {
            if d == 0.0 {
                // Excel reports a division by zero rather than a domain error.
                Err(CellError::Div0)
            } else {
                // The result takes the divisor's sign: MOD(-3,2) is 1, not -1.
                Ok(n - d * (n / d).floor())
            }
        })
    }),
    f("QUOTIENT", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, d| if d == 0.0 { Err(CellError::Div0) } else { Ok((n / d).trunc()) })
    }),
    // --- rounding ---------------------------------------------------------
    f("INT", 1, Some(1), |ctx, a| num1(ctx, a, f64::floor)),
    f("TRUNC", 1, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), digits = opt_num(ctx, a, 1, 0.0));
        number(truncate(n, digits.trunc() as i32))
    }),
    f("ROUND", 2, Some(2), |ctx, a| num2(ctx, a, |n, d| Ok(excel_round(n, d.trunc() as i32)))),
    f("ROUNDUP", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, d| {
            let factor = 10f64.powi(d.trunc() as i32);
            Ok((n * factor).abs().ceil().copysign(n) / factor)
        })
    }),
    f("ROUNDDOWN", 2, Some(2), |ctx, a| num2(ctx, a, |n, d| Ok(truncate(n, d.trunc() as i32)))),
    f("MROUND", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, m| {
            if m == 0.0 {
                return Ok(0.0);
            }
            if n.signum() != m.signum() && n != 0.0 {
                return Err(CellError::Num);
            }
            Ok((n / m).abs().round().copysign(n / m) * m)
        })
    }),
    f("CEILING", 1, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), sig = opt_num(ctx, a, 1, 1.0));
        // The legacy form refuses to mix signs, unlike CEILING.MATH.
        if n > 0.0 && sig < 0.0 {
            return Operand::error(CellError::Num);
        }
        match to_multiple(n, sig, true) {
            Ok(v) => number(v),
            Err(e) => Operand::error(e),
        }
    }),
    f("CEILING.PRECISE", 1, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), sig = opt_num(ctx, a, 1, 1.0));
        number(to_multiple(n, sig.abs(), true).unwrap_or(0.0))
    }),
    f("CEILING.MATH", 1, Some(3), |ctx, a| {
        args!(
            n = arg_num(ctx, a, 0),
            sig = opt_num(ctx, a, 1, 1.0),
            mode = opt_num(ctx, a, 2, 0.0),
        );
        // With a non-zero mode a negative number rounds away from zero.
        let up = n >= 0.0 || mode == 0.0;
        number(to_multiple(n, sig.abs(), up).unwrap_or(0.0))
    }),
    f("FLOOR", 1, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), sig = opt_num(ctx, a, 1, 1.0));
        if sig == 0.0 {
            return Operand::error(CellError::Div0);
        }
        if n > 0.0 && sig < 0.0 {
            return Operand::error(CellError::Num);
        }
        match to_multiple(n, sig, false) {
            Ok(v) => number(v),
            Err(e) => Operand::error(e),
        }
    }),
    f("FLOOR.PRECISE", 1, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), sig = opt_num(ctx, a, 1, 1.0));
        number(to_multiple(n, sig.abs(), false).unwrap_or(0.0))
    }),
    f("FLOOR.MATH", 1, Some(3), |ctx, a| {
        args!(
            n = arg_num(ctx, a, 0),
            sig = opt_num(ctx, a, 1, 1.0),
            mode = opt_num(ctx, a, 2, 0.0),
        );
        let up = n < 0.0 && mode != 0.0;
        number(to_multiple(n, sig.abs(), up).unwrap_or(0.0))
    }),
    f("EVEN", 1, Some(1), |ctx, a| num1(ctx, a, |n| (n / 2.0).abs().ceil().copysign(n) * 2.0)),
    f("ODD", 1, Some(1), |ctx, a| {
        num1(ctx, a, |n| {
            if n == 0.0 {
                return 1.0;
            }
            (((n.abs() + 1.0) / 2.0).ceil() * 2.0 - 1.0).copysign(n)
        })
    }),
    // --- combinatorics ----------------------------------------------------
    f("FACT", 1, Some(1), |ctx, a| num1_checked(ctx, a, factorial)),
    f("FACTDOUBLE", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| {
            if n < -1.0 {
                return Err(CellError::Num);
            }
            let n = n.trunc() as i64;
            let mut result = 1.0f64;
            let mut i = n;
            while i > 1 {
                result *= i as f64;
                i -= 2;
            }
            if result.is_finite() {
                Ok(result)
            } else {
                Err(CellError::Num)
            }
        })
    }),
    f("COMBIN", 2, Some(2), |ctx, a| num2(ctx, a, combinations)),
    f("COMBINA", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, k| {
            let (n, k) = (n.trunc(), k.trunc());
            if n < 0.0 || k < 0.0 {
                return Err(CellError::Num);
            }
            if n == 0.0 && k == 0.0 {
                return Ok(1.0);
            }
            combinations(n + k - 1.0, k)
        })
    }),
    f("PERMUT", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, k| {
            let (n, k) = (n.trunc(), k.trunc());
            if n < 0.0 || k < 0.0 || k > n {
                return Err(CellError::Num);
            }
            Ok((0..k as u64).fold(1.0, |acc, i| acc * (n - i as f64)))
        })
    }),
    f("PERMUTATIONA", 2, Some(2), |ctx, a| {
        num2(ctx, a, |n, k| {
            let (n, k) = (n.trunc(), k.trunc());
            if n < 0.0 || k < 0.0 {
                return Err(CellError::Num);
            }
            Ok(n.powf(k))
        })
    }),
    f("MULTINOMIAL", 1, None, |ctx, a| {
        let Ok(numbers) = collect_numbers(ctx, a) else {
            return Operand::error(CellError::Value);
        };
        if numbers.iter().any(|n| *n < 0.0) {
            return Operand::error(CellError::Num);
        }
        let total: f64 = numbers.iter().map(|n| n.trunc()).sum();
        let mut result = match factorial(total) {
            Ok(v) => v,
            Err(e) => return Operand::error(e),
        };
        for n in numbers {
            match factorial(n.trunc()) {
                Ok(v) => result /= v,
                Err(e) => return Operand::error(e),
            }
        }
        number(result)
    }),
    f("GCD", 1, None, |ctx, a| match whole_numbers(ctx, a) {
        Ok(values) => number(values.into_iter().fold(0u64, gcd2) as f64),
        Err(e) => Operand::error(e),
    }),
    f("LCM", 1, None, |ctx, a| match whole_numbers(ctx, a) {
        Ok(values) => {
            let mut acc = 1u64;
            for v in values {
                if v == 0 {
                    return Operand::number(0.0);
                }
                acc = acc / gcd2(acc, v) * v;
            }
            number(acc as f64)
        }
        Err(e) => Operand::error(e),
    }),
    // --- aggregates -------------------------------------------------------
    f("SUM", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) => number(values.iter().sum()),
        Err(e) => Operand::error(e),
    }),
    f("SUMSQ", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) => number(values.iter().map(|n| n * n).sum()),
        Err(e) => Operand::error(e),
    }),
    f("PRODUCT", 1, None, |ctx, a| match collect_numbers(ctx, a) {
        Ok(values) if values.is_empty() => Operand::number(0.0),
        Ok(values) => number(values.iter().product()),
        Err(e) => Operand::error(e),
    }),
    array_fn("SUMPRODUCT", 1, None, |ctx, a| {
        let arrays: Vec<_> = a.iter().map(|op| op.to_array(ctx.wb)).collect();
        let (rows, cols) = (arrays[0].rows(), arrays[0].cols());
        if arrays.iter().any(|arr| arr.rows() != rows || arr.cols() != cols) {
            // Mismatched shapes are a #VALUE!, not a silent broadcast.
            return Operand::error(CellError::Value);
        }
        let mut total = 0.0;
        for r in 0..rows {
            for c in 0..cols {
                let mut product = 1.0;
                for arr in &arrays {
                    match arr.get(r, c) {
                        Value::Number(n) => product *= n,
                        Value::Bool(b) => product *= f64::from(b),
                        Value::Error(e) => return Operand::error(e),
                        // Text and blanks count as zero, so the term drops out.
                        _ => product = 0.0,
                    }
                }
                total += product;
            }
        }
        number(total)
    }),
    array_fn("SUMX2MY2", 2, Some(2), |ctx, a| paired_sum(ctx, a, |x, y| x * x - y * y)),
    array_fn("SUMX2PY2", 2, Some(2), |ctx, a| paired_sum(ctx, a, |x, y| x * x + y * y)),
    array_fn("SUMXMY2", 2, Some(2), |ctx, a| paired_sum(ctx, a, |x, y| (x - y) * (x - y))),
    f("SERIESSUM", 4, Some(4), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), n = arg_num(ctx, a, 1), m = arg_num(ctx, a, 2));
        let Ok(coefficients) = collect_numbers(ctx, &a[3..]) else {
            return Operand::error(CellError::Value);
        };
        let total: f64 =
            coefficients.iter().enumerate().map(|(i, c)| c * x.powf(n + i as f64 * m)).sum();
        number(total)
    }),
    // --- number bases -----------------------------------------------------
    f("BASE", 2, Some(3), |ctx, a| {
        args!(
            n = arg_num(ctx, a, 0),
            radix = arg_num(ctx, a, 1),
            min_len = opt_num(ctx, a, 2, 0.0),
        );
        if !(2.0..=36.0).contains(&radix) || n < 0.0 || n >= 2f64.powi(53) {
            return Operand::error(CellError::Num);
        }
        Operand::text(to_base(n.trunc() as u64, radix as u32, min_len as usize))
    }),
    f("DECIMAL", 2, Some(2), |ctx, a| {
        args!(text = arg_text(ctx, a, 0), radix = arg_num(ctx, a, 1));
        if !(2.0..=36.0).contains(&radix) {
            return Operand::error(CellError::Num);
        }
        match u64::from_str_radix(text.trim(), radix as u32) {
            Ok(n) => Operand::number(n as f64),
            Err(_) => Operand::error(CellError::Num),
        }
    }),
    f("ROMAN", 1, Some(2), |ctx, a| match arg_int(ctx, a, 0) {
        Ok(n) => match roman(n) {
            Ok(s) => Operand::text(s),
            Err(e) => Operand::error(e),
        },
        Err(e) => Operand::error(e),
    }),
    f("ARABIC", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0).and_then(|s| arabic(&s)) {
        Ok(n) => Operand::number(n),
        Err(e) => Operand::error(e),
    }),
    // --- trigonometry -----------------------------------------------------
    f("PI", 0, Some(0), |_, _| Operand::number(std::f64::consts::PI)),
    f("DEGREES", 1, Some(1), |ctx, a| num1(ctx, a, f64::to_degrees)),
    f("RADIANS", 1, Some(1), |ctx, a| num1(ctx, a, f64::to_radians)),
    f("SIN", 1, Some(1), |ctx, a| num1(ctx, a, f64::sin)),
    f("COS", 1, Some(1), |ctx, a| num1(ctx, a, f64::cos)),
    f("TAN", 1, Some(1), |ctx, a| num1(ctx, a, f64::tan)),
    f("COT", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n == 0.0 { Err(CellError::Div0) } else { Ok(1.0 / n.tan()) })
    }),
    f("SEC", 1, Some(1), |ctx, a| num1(ctx, a, |n| 1.0 / n.cos())),
    f("CSC", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n == 0.0 { Err(CellError::Div0) } else { Ok(1.0 / n.sin()) })
    }),
    f("ASIN", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| {
            if !(-1.0..=1.0).contains(&n) {
                Err(CellError::Num)
            } else {
                Ok(n.asin())
            }
        })
    }),
    f("ACOS", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| {
            if !(-1.0..=1.0).contains(&n) {
                Err(CellError::Num)
            } else {
                Ok(n.acos())
            }
        })
    }),
    f("ATAN", 1, Some(1), |ctx, a| num1(ctx, a, f64::atan)),
    f("ATAN2", 2, Some(2), |ctx, a| {
        num2(ctx, a, |x, y| {
            if x == 0.0 && y == 0.0 {
                Err(CellError::Div0)
            } else {
                // Excel takes x first, unlike the usual atan2(y, x).
                Ok(y.atan2(x))
            }
        })
    }),
    f("ACOT", 1, Some(1), |ctx, a| num1(ctx, a, |n| std::f64::consts::FRAC_PI_2 - n.atan())),
    f("SINH", 1, Some(1), |ctx, a| num1(ctx, a, f64::sinh)),
    f("COSH", 1, Some(1), |ctx, a| num1(ctx, a, f64::cosh)),
    f("TANH", 1, Some(1), |ctx, a| num1(ctx, a, f64::tanh)),
    f("COTH", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n == 0.0 { Err(CellError::Div0) } else { Ok(1.0 / n.tanh()) })
    }),
    f("SECH", 1, Some(1), |ctx, a| num1(ctx, a, |n| 1.0 / n.cosh())),
    f("CSCH", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n == 0.0 { Err(CellError::Div0) } else { Ok(1.0 / n.sinh()) })
    }),
    f("ASINH", 1, Some(1), |ctx, a| num1(ctx, a, f64::asinh)),
    f("ACOSH", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n < 1.0 { Err(CellError::Num) } else { Ok(n.acosh()) })
    }),
    f("ATANH", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| if n.abs() >= 1.0 { Err(CellError::Num) } else { Ok(n.atanh()) })
    }),
    f("ACOTH", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |n| {
            if n.abs() <= 1.0 {
                Err(CellError::Num)
            } else {
                Ok((1.0 / n).atanh())
            }
        })
    }),
    // --- random -----------------------------------------------------------
    volatile("RAND", 0, Some(0), |ctx, _| Operand::number(ctx.rng.next_f64())),
    volatile("RANDBETWEEN", 2, Some(2), |ctx, a| {
        args!(low = arg_num(ctx, a, 0), high = arg_num(ctx, a, 1));
        let (low, high) = (low.ceil(), high.floor());
        if low > high {
            return Operand::error(CellError::Num);
        }
        let span = high - low + 1.0;
        number(low + (ctx.rng.next_f64() * span).floor().min(span - 1.0))
    }),
];

/// The shape check and pairwise fold shared by SUMX2MY2 and its siblings.
fn paired_sum(ctx: &EvalCtx, args: &[Operand], f: impl Fn(f64, f64) -> f64) -> Operand {
    let (x, y) = (args[0].to_array(ctx.wb), args[1].to_array(ctx.wb));
    if x.rows() * x.cols() != y.rows() * y.cols() {
        return Operand::error(CellError::NA);
    }
    let mut total = 0.0;
    for (a, b) in x.values().zip(y.values()) {
        // Pairs where either side is not a number are skipped entirely.
        if let (Value::Number(a), Value::Number(b)) = (a, b) {
            total += f(*a, *b);
        }
    }
    number(total)
}
