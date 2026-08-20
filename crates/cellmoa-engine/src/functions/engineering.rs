//! Engineering functions: number bases, bitwise operations, complex numbers
//! and unit conversion.

use super::args;
use super::*;
use crate::operand::Operand;
use crate::special::{erf, erfc};

/// Reads a number written in another base, in Excel's fixed-width two's
/// complement.
///
/// The width is ten digits, and the top digit is the sign: `1111111111` in
/// binary is `-1`, not `1023`. That is why these are not simply
/// `from_str_radix`.
fn from_base(text: &str, radix: u32, digits: u32) -> Result<f64, CellError> {
    let text = text.trim();
    if text.is_empty() || text.len() > digits as usize {
        return Err(CellError::Num);
    }
    let magnitude = u64::from_str_radix(text, radix).map_err(|_| CellError::Num)?;
    let bits = digits * radix.trailing_zeros();
    let half = 1u64 << (bits - 1);
    Ok(if magnitude >= half { magnitude as f64 - (1u64 << bits) as f64 } else { magnitude as f64 })
}

/// Writes a number in another base, in Excel's fixed-width two's complement.
fn to_base(value: f64, radix: u32, digits: u32, places: Option<f64>) -> Result<String, CellError> {
    let bits = digits * radix.trailing_zeros();
    let half = (1i64 << (bits - 1)) as f64;
    let value = value.trunc();
    if value < -half || value >= half {
        return Err(CellError::Num);
    }
    let magnitude =
        if value < 0.0 { (value + (1u64 << bits) as f64) as u64 } else { value as u64 };
    let mut out = String::new();
    let mut n = magnitude;
    while n > 0 {
        let digit = (n % radix as u64) as u32;
        out.insert(0, char::from_digit(digit, radix).expect("digit fits the radix").to_ascii_uppercase());
        n /= radix as u64;
    }
    if out.is_empty() {
        out.push('0');
    }
    // A negative number is always written at full width; `places` only pads a
    // positive one.
    if value < 0.0 {
        return Ok(out);
    }
    if let Some(places) = places {
        let width = places.trunc() as usize;
        if width < out.len() || places < 0.0 {
            return Err(CellError::Num);
        }
        return Ok(format!("{out:0>width$}"));
    }
    Ok(out)
}

/// A complex number, as the `a+bi` text form a spreadsheet stores.
#[derive(Clone, Copy, PartialEq, Debug)]
struct Complex {
    re: f64,
    im: f64,
    /// `i` or `j`, preserved because Excel round-trips whichever the user used.
    suffix: char,
}

impl Complex {
    fn new(re: f64, im: f64, suffix: char) -> Complex {
        Complex { re, im, suffix }
    }

    fn parse(text: &str) -> Result<Complex, CellError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(CellError::Num);
        }
        // A plain real number is a complex number with no imaginary part.
        if let Ok(re) = text.parse::<f64>() {
            return Ok(Complex::new(re, 0.0, 'i'));
        }
        let suffix = match text.chars().last() {
            Some(c @ ('i' | 'j')) => c,
            _ => return Err(CellError::Num),
        };
        let body = &text[..text.len() - 1];
        // Split at the sign that separates the parts, skipping a leading sign
        // and any exponent sign.
        let bytes = body.as_bytes();
        let mut split = None;
        for i in (1..bytes.len()).rev() {
            if (bytes[i] == b'+' || bytes[i] == b'-')
                && !matches!(bytes[i - 1], b'e' | b'E')
            {
                split = Some(i);
                break;
            }
        }
        let (re, im_text) = match split {
            Some(i) => (body[..i].parse::<f64>().map_err(|_| CellError::Num)?, &body[i..]),
            None => (0.0, body),
        };
        // "i", "+i" and "-i" all mean a unit imaginary part.
        let im = match im_text {
            "" | "+" => 1.0,
            "-" => -1.0,
            other => other.parse::<f64>().map_err(|_| CellError::Num)?,
        };
        Ok(Complex::new(re, im, suffix))
    }

    fn text(&self) -> String {
        // A complex number's text form is data, so it keeps full precision.
        let format = |n: f64| cellmoa_core::value::format_number_exact(n);
        if self.im == 0.0 {
            return format(self.re);
        }
        let imaginary = match self.im {
            1.0 => String::new(),
            -1.0 => "-".to_string(),
            n => format(n),
        };
        if self.re == 0.0 {
            return format!("{imaginary}{}", self.suffix);
        }
        let sign = if self.im < 0.0 || imaginary.starts_with('-') { "" } else { "+" };
        format!("{}{sign}{imaginary}{}", format(self.re), self.suffix)
    }

    fn modulus(&self) -> f64 {
        self.re.hypot(self.im)
    }

    fn argument(&self) -> f64 {
        self.im.atan2(self.re)
    }

    fn mul(self, other: Complex) -> Complex {
        Complex::new(
            self.re * other.re - self.im * other.im,
            self.re * other.im + self.im * other.re,
            self.suffix,
        )
    }

    fn div(self, other: Complex) -> Result<Complex, CellError> {
        let denominator = other.re * other.re + other.im * other.im;
        if denominator == 0.0 {
            return Err(CellError::Num);
        }
        Ok(Complex::new(
            (self.re * other.re + self.im * other.im) / denominator,
            (self.im * other.re - self.re * other.im) / denominator,
            self.suffix,
        ))
    }

    fn ln(self) -> Result<Complex, CellError> {
        if self.re == 0.0 && self.im == 0.0 {
            return Err(CellError::Num);
        }
        Ok(Complex::new(self.modulus().ln(), self.argument(), self.suffix))
    }

    fn exp(self) -> Complex {
        let magnitude = self.re.exp();
        Complex::new(magnitude * self.im.cos(), magnitude * self.im.sin(), self.suffix)
    }

    fn powf(self, n: f64) -> Complex {
        // De Moivre: the polar form makes a real power straightforward.
        let modulus = self.modulus().powf(n);
        let argument = self.argument() * n;
        Complex::new(modulus * argument.cos(), modulus * argument.sin(), self.suffix)
    }
}

/// Argument `i` read as a complex number.
fn arg_complex(ctx: &EvalCtx, a: &[Operand], i: usize) -> Result<Complex, CellError> {
    Complex::parse(&arg_text(ctx, a, i)?)
}

/// A one-argument complex function.
fn complex1(ctx: &EvalCtx, a: &[Operand], f: impl Fn(Complex) -> Result<Complex, CellError>) -> Operand {
    match arg_complex(ctx, a, 0).and_then(f) {
        Ok(z) => Operand::text(z.text()),
        Err(e) => Operand::error(e),
    }
}

/// A complex function returning a real number.
fn complex_real(ctx: &EvalCtx, a: &[Operand], f: impl Fn(Complex) -> f64) -> Operand {
    match arg_complex(ctx, a, 0) {
        Ok(z) => number(f(z)),
        Err(e) => Operand::error(e),
    }
}

/// Folds a variadic list of complex arguments.
fn complex_fold(
    ctx: &EvalCtx,
    a: &[Operand],
    init: Complex,
    f: impl Fn(Complex, Complex) -> Result<Complex, CellError>,
) -> Operand {
    let mut acc = init;
    for i in 0..a.len() {
        match arg_complex(ctx, a, i).and_then(|z| f(acc, z)) {
            Ok(z) => acc = z,
            Err(e) => return Operand::error(e),
        }
    }
    // The suffix of the first argument wins, as in Excel.
    if let Ok(first) = arg_complex(ctx, a, 0) {
        acc.suffix = first.suffix;
    }
    Operand::text(acc.text())
}

/// Conversion factors to each unit's SI base, by unit symbol.
const UNITS: &[(&str, &str, f64)] = &[
    // (symbol, quantity, factor to the base unit)
    ("g", "mass", 1.0),
    ("kg", "mass", 1000.0),
    ("sg", "mass", 14_593.9029372064),
    ("lbm", "mass", 453.59237),
    ("u", "mass", 1.660_538_782e-24),
    ("ozm", "mass", 28.349523125),
    ("m", "length", 1.0),
    ("mi", "length", 1_609.344),
    ("Nmi", "length", 1_852.0),
    ("in", "length", 0.0254),
    ("ft", "length", 0.3048),
    ("yd", "length", 0.9144),
    ("ang", "length", 1e-10),
    ("ell", "length", 1.143),
    ("ly", "length", 9.460_730_472_580_8e15),
    ("pc", "length", 3.085_677_581_306_6e16),
    ("sec", "time", 1.0),
    ("s", "time", 1.0),
    ("min", "time", 60.0),
    ("hr", "time", 3600.0),
    ("day", "time", 86_400.0),
    ("yr", "time", 31_557_600.0),
    ("Pa", "pressure", 1.0),
    ("atm", "pressure", 101_325.0),
    ("mmHg", "pressure", 133.322),
    ("psi", "pressure", 6_894.757_293_168_36),
    ("N", "force", 1.0),
    ("dyn", "force", 1e-5),
    ("lbf", "force", 4.448_221_615_260_5),
    ("J", "energy", 1.0),
    ("e", "energy", 1e-7),
    ("cal", "energy", 4.1868),
    ("eV", "energy", 1.602_176_487e-19),
    ("Wh", "energy", 3600.0),
    ("BTU", "energy", 1_055.055_852_62),
    ("W", "power", 1.0),
    ("HP", "power", 745.699_871_582_27),
    ("T", "magnetism", 1.0),
    ("ga", "magnetism", 1e-4),
    ("l", "volume", 1.0),
    ("L", "volume", 1.0),
    ("tsp", "volume", 0.004_928_921_594),
    ("tbs", "volume", 0.014_786_764_781),
    ("oz", "volume", 0.029_573_529_562),
    ("cup", "volume", 0.236_588_236_5),
    ("pt", "volume", 0.473_176_473),
    ("qt", "volume", 0.946_352_946),
    ("gal", "volume", 3.785_411_784),
    ("m3", "volume", 1000.0),
    ("bit", "information", 1.0),
    ("byte", "information", 8.0),
];

/// Metric prefixes `CONVERT` accepts in front of a unit symbol.
const PREFIXES: &[(&str, f64)] = &[
    ("Y", 1e24),
    ("Z", 1e21),
    ("E", 1e18),
    ("P", 1e15),
    ("T", 1e12),
    ("G", 1e9),
    ("M", 1e6),
    ("k", 1e3),
    ("h", 1e2),
    ("e", 1e1),
    ("d", 1e-1),
    ("c", 1e-2),
    ("m", 1e-3),
    ("u", 1e-6),
    ("n", 1e-9),
    ("p", 1e-12),
    ("f", 1e-15),
    ("a", 1e-18),
    ("z", 1e-21),
    ("y", 1e-24),
];

/// Resolves a unit symbol to its quantity and factor, allowing a metric prefix.
fn unit(symbol: &str) -> Option<(&'static str, f64)> {
    if let Some(&(_, quantity, factor)) = UNITS.iter().find(|(s, _, _)| *s == symbol) {
        return Some((quantity, factor));
    }
    for &(prefix, scale) in PREFIXES {
        if let Some(rest) = symbol.strip_prefix(prefix) {
            if let Some(&(_, quantity, factor)) = UNITS.iter().find(|(s, _, _)| *s == rest) {
                return Some((quantity, factor * scale));
            }
        }
    }
    None
}

pub const FUNCTIONS: &[Function] = &[
    // --- number bases -------------------------------------------------------
    f("BIN2DEC", 1, Some(1), |ctx, a| base_in(ctx, a, 2, 10)),
    f("OCT2DEC", 1, Some(1), |ctx, a| base_in(ctx, a, 8, 10)),
    f("HEX2DEC", 1, Some(1), |ctx, a| base_in(ctx, a, 16, 10)),
    f("DEC2BIN", 1, Some(2), |ctx, a| base_out(ctx, a, 2, 10)),
    f("DEC2OCT", 1, Some(2), |ctx, a| base_out(ctx, a, 8, 10)),
    f("DEC2HEX", 1, Some(2), |ctx, a| base_out(ctx, a, 16, 10)),
    f("BIN2OCT", 1, Some(2), |ctx, a| base_convert(ctx, a, 2, 8)),
    f("BIN2HEX", 1, Some(2), |ctx, a| base_convert(ctx, a, 2, 16)),
    f("OCT2BIN", 1, Some(2), |ctx, a| base_convert(ctx, a, 8, 2)),
    f("OCT2HEX", 1, Some(2), |ctx, a| base_convert(ctx, a, 8, 16)),
    f("HEX2BIN", 1, Some(2), |ctx, a| base_convert(ctx, a, 16, 2)),
    f("HEX2OCT", 1, Some(2), |ctx, a| base_convert(ctx, a, 16, 8)),

    // --- bitwise ------------------------------------------------------------
    f("BITAND", 2, Some(2), |ctx, a| bitwise(ctx, a, |x, y| x & y)),
    f("BITOR", 2, Some(2), |ctx, a| bitwise(ctx, a, |x, y| x | y)),
    f("BITXOR", 2, Some(2), |ctx, a| bitwise(ctx, a, |x, y| x ^ y)),
    f("BITLSHIFT", 2, Some(2), |ctx, a| shift(ctx, a, true)),
    f("BITRSHIFT", 2, Some(2), |ctx, a| shift(ctx, a, false)),

    // --- comparison and error functions -------------------------------------
    f("DELTA", 1, Some(2), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), y = opt_num(ctx, a, 1, 0.0));
        Operand::number(f64::from(x == y))
    }),
    f("GESTEP", 1, Some(2), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), step = opt_num(ctx, a, 1, 0.0));
        Operand::number(f64::from(x >= step))
    }),
    f("ERF", 1, Some(2), |ctx, a| {
        args!(lower = arg_num(ctx, a, 0));
        // With an upper limit, ERF is the integral between the two points.
        match a.get(1) {
            None => number(erf(lower)),
            Some(_) => match arg_num(ctx, a, 1) {
                Ok(upper) => number(erf(upper) - erf(lower)),
                Err(e) => Operand::error(e),
            },
        }
    }),
    f("ERF.PRECISE", 1, Some(1), |ctx, a| num1(ctx, a, erf)),
    f("ERFC", 1, Some(1), |ctx, a| num1(ctx, a, erfc)),
    f("ERFC.PRECISE", 1, Some(1), |ctx, a| num1(ctx, a, erfc)),

    // --- complex numbers ----------------------------------------------------
    f("COMPLEX", 2, Some(3), |ctx, a| {
        args!(re = arg_num(ctx, a, 0), im = arg_num(ctx, a, 1));
        let suffix = match arg_text(ctx, a, 2).unwrap_or_default().as_str() {
            "" | "i" => 'i',
            "j" => 'j',
            _ => return Operand::error(CellError::Value),
        };
        Operand::text(Complex::new(re, im, suffix).text())
    }),
    f("IMREAL", 1, Some(1), |ctx, a| complex_real(ctx, a, |z| z.re)),
    f("IMAGINARY", 1, Some(1), |ctx, a| complex_real(ctx, a, |z| z.im)),
    f("IMABS", 1, Some(1), |ctx, a| complex_real(ctx, a, |z| z.modulus())),
    f("IMARGUMENT", 1, Some(1), |ctx, a| complex_real(ctx, a, |z| z.argument())),
    f("IMCONJUGATE", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| Ok(Complex::new(z.re, -z.im, z.suffix)))
    }),
    f("IMSUM", 1, None, |ctx, a| {
        complex_fold(ctx, a, Complex::new(0.0, 0.0, 'i'), |acc, z| {
            Ok(Complex::new(acc.re + z.re, acc.im + z.im, acc.suffix))
        })
    }),
    f("IMSUB", 2, Some(2), |ctx, a| {
        match (arg_complex(ctx, a, 0), arg_complex(ctx, a, 1)) {
            (Ok(x), Ok(y)) => Operand::text(Complex::new(x.re - y.re, x.im - y.im, x.suffix).text()),
            (Err(e), _) | (_, Err(e)) => Operand::error(e),
        }
    }),
    f("IMPRODUCT", 1, None, |ctx, a| {
        complex_fold(ctx, a, Complex::new(1.0, 0.0, 'i'), |acc, z| Ok(acc.mul(z)))
    }),
    f("IMDIV", 2, Some(2), |ctx, a| {
        match (arg_complex(ctx, a, 0), arg_complex(ctx, a, 1)) {
            (Ok(x), Ok(y)) => match x.div(y) {
                Ok(z) => Operand::text(z.text()),
                Err(e) => Operand::error(e),
            },
            (Err(e), _) | (_, Err(e)) => Operand::error(e),
        }
    }),
    f("IMPOWER", 2, Some(2), |ctx, a| {
        args!(n = arg_num(ctx, a, 1));
        complex1(ctx, a, move |z| Ok(z.powf(n)))
    }),
    f("IMSQRT", 1, Some(1), |ctx, a| complex1(ctx, a, |z| Ok(z.powf(0.5)))),
    f("IMEXP", 1, Some(1), |ctx, a| complex1(ctx, a, |z| Ok(z.exp()))),
    f("IMLN", 1, Some(1), |ctx, a| complex1(ctx, a, |z| z.ln())),
    f("IMLOG10", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let l = z.ln()?;
            Ok(Complex::new(l.re / std::f64::consts::LN_10, l.im / std::f64::consts::LN_10, z.suffix))
        })
    }),
    f("IMLOG2", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let l = z.ln()?;
            Ok(Complex::new(l.re / std::f64::consts::LN_2, l.im / std::f64::consts::LN_2, z.suffix))
        })
    }),
    f("IMSIN", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| Ok(Complex::new(z.re.sin() * z.im.cosh(), z.re.cos() * z.im.sinh(), z.suffix)))
    }),
    f("IMCOS", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| Ok(Complex::new(z.re.cos() * z.im.cosh(), -z.re.sin() * z.im.sinh(), z.suffix)))
    }),
    f("IMTAN", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let sin = Complex::new(z.re.sin() * z.im.cosh(), z.re.cos() * z.im.sinh(), z.suffix);
            let cos = Complex::new(z.re.cos() * z.im.cosh(), -z.re.sin() * z.im.sinh(), z.suffix);
            sin.div(cos)
        })
    }),
    f("IMSINH", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| Ok(Complex::new(z.re.sinh() * z.im.cos(), z.re.cosh() * z.im.sin(), z.suffix)))
    }),
    f("IMCOSH", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| Ok(Complex::new(z.re.cosh() * z.im.cos(), z.re.sinh() * z.im.sin(), z.suffix)))
    }),
    f("IMSEC", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let cos = Complex::new(z.re.cos() * z.im.cosh(), -z.re.sin() * z.im.sinh(), z.suffix);
            Complex::new(1.0, 0.0, z.suffix).div(cos)
        })
    }),
    f("IMCSC", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let sin = Complex::new(z.re.sin() * z.im.cosh(), z.re.cos() * z.im.sinh(), z.suffix);
            Complex::new(1.0, 0.0, z.suffix).div(sin)
        })
    }),
    f("IMCOT", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let sin = Complex::new(z.re.sin() * z.im.cosh(), z.re.cos() * z.im.sinh(), z.suffix);
            let cos = Complex::new(z.re.cos() * z.im.cosh(), -z.re.sin() * z.im.sinh(), z.suffix);
            cos.div(sin)
        })
    }),
    f("IMSECH", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let cosh = Complex::new(z.re.cosh() * z.im.cos(), z.re.sinh() * z.im.sin(), z.suffix);
            Complex::new(1.0, 0.0, z.suffix).div(cosh)
        })
    }),
    f("IMCSCH", 1, Some(1), |ctx, a| {
        complex1(ctx, a, |z| {
            let sinh = Complex::new(z.re.sinh() * z.im.cos(), z.re.cosh() * z.im.sin(), z.suffix);
            Complex::new(1.0, 0.0, z.suffix).div(sinh)
        })
    }),

    // --- unit conversion ----------------------------------------------------
    f("CONVERT", 3, Some(3), |ctx, a| {
        args!(value = arg_num(ctx, a, 0), from = arg_text(ctx, a, 1), to = arg_text(ctx, a, 2));
        let (Some((from_quantity, from_factor)), Some((to_quantity, to_factor))) =
            (unit(&from), unit(&to))
        else {
            return Operand::error(CellError::NA);
        };
        // Converting between quantities is meaningless, and Excel says so.
        if from_quantity != to_quantity {
            return Operand::error(CellError::NA);
        }
        number(value * from_factor / to_factor)
    }),
];

fn base_in(ctx: &EvalCtx, a: &[Operand], radix: u32, digits: u32) -> Operand {
    args!(text = arg_text(ctx, a, 0));
    match from_base(&text, radix, digits) {
        Ok(n) => Operand::number(n),
        Err(e) => Operand::error(e),
    }
}

fn base_out(ctx: &EvalCtx, a: &[Operand], radix: u32, digits: u32) -> Operand {
    args!(value = arg_num(ctx, a, 0));
    let places = match a.get(1) {
        Some(_) => match arg_num(ctx, a, 1) {
            Ok(p) => Some(p),
            Err(e) => return Operand::error(e),
        },
        None => None,
    };
    match to_base(value, radix, digits, places) {
        Ok(text) => Operand::text(text),
        Err(e) => Operand::error(e),
    }
}

fn base_convert(ctx: &EvalCtx, a: &[Operand], from: u32, to: u32) -> Operand {
    args!(text = arg_text(ctx, a, 0));
    let value = match from_base(&text, from, 10) {
        Ok(v) => v,
        Err(e) => return Operand::error(e),
    };
    let places = match a.get(1) {
        Some(_) => match arg_num(ctx, a, 1) {
            Ok(p) => Some(p),
            Err(e) => return Operand::error(e),
        },
        None => None,
    };
    match to_base(value, to, 10, places) {
        Ok(text) => Operand::text(text),
        Err(e) => Operand::error(e),
    }
}

/// The bitwise functions work on non-negative integers below 2^48.
fn bit_arg(ctx: &EvalCtx, a: &[Operand], i: usize) -> Result<u64, CellError> {
    let n = arg_num(ctx, a, i)?;
    if n < 0.0 || n.fract() != 0.0 || n >= 281_474_976_710_656.0 {
        return Err(CellError::Num);
    }
    Ok(n as u64)
}

fn bitwise(ctx: &EvalCtx, a: &[Operand], f: impl Fn(u64, u64) -> u64) -> Operand {
    match (bit_arg(ctx, a, 0), bit_arg(ctx, a, 1)) {
        (Ok(x), Ok(y)) => Operand::number(f(x, y) as f64),
        (Err(e), _) | (_, Err(e)) => Operand::error(e),
    }
}

fn shift(ctx: &EvalCtx, a: &[Operand], left: bool) -> Operand {
    args!(amount = arg_num(ctx, a, 1));
    let value = match bit_arg(ctx, a, 0) {
        Ok(v) => v,
        Err(e) => return Operand::error(e),
    };
    if amount.abs() > 53.0 {
        return Operand::error(CellError::Num);
    }
    // A negative shift amount shifts the other way.
    let shift_left = if amount < 0.0 { !left } else { left };
    let by = amount.abs().trunc() as u32;
    let result = if shift_left { (value << by) as f64 } else { (value >> by) as f64 };
    if result >= 281_474_976_710_656.0 {
        return Operand::error(CellError::Num);
    }
    Operand::number(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_bases_use_twos_complement_at_full_width() {
        assert_eq!(from_base("1111111111", 2, 10), Ok(-1.0));
        assert_eq!(from_base("1000000000", 2, 10), Ok(-512.0));
        assert_eq!(from_base("0111111111", 2, 10), Ok(511.0));
        assert_eq!(to_base(-1.0, 2, 10, None).unwrap(), "1111111111");
        assert_eq!(to_base(9.0, 2, 10, None).unwrap(), "1001");
        assert_eq!(to_base(9.0, 2, 10, Some(8.0)).unwrap(), "00001001");
        // A negative number ignores the padding and stays at full width.
        assert_eq!(to_base(-1.0, 2, 10, Some(4.0)).unwrap(), "1111111111");
        assert_eq!(to_base(512.0, 2, 10, None), Err(CellError::Num));
    }

    #[test]
    fn hex_and_octal_widths() {
        assert_eq!(from_base("FFFFFFFFFF", 16, 10), Ok(-1.0));
        assert_eq!(from_base("7777777777", 8, 10), Ok(-1.0));
        assert_eq!(to_base(255.0, 16, 10, None).unwrap(), "FF");
    }

    #[test]
    fn complex_numbers_round_trip_through_their_text_form() {
        for text in ["3+4i", "-3-4i", "5", "i", "-i", "2j", "1.5-2.25i"] {
            let z = Complex::parse(text).expect(text);
            assert_eq!(z.text(), text, "round trip of {text}");
        }
    }

    #[test]
    fn complex_parsing_handles_exponents_and_bare_units() {
        assert_eq!(Complex::parse("1e3+2i").unwrap().re, 1000.0);
        assert_eq!(Complex::parse("1e-3+2i").unwrap().re, 0.001);
        assert_eq!(Complex::parse("i").unwrap().im, 1.0);
        assert_eq!(Complex::parse("-i").unwrap().im, -1.0);
        assert!(Complex::parse("nonsense").is_err());
    }

    #[test]
    fn complex_arithmetic() {
        let a = Complex::parse("3+4i").unwrap();
        let b = Complex::parse("1+2i").unwrap();
        assert_eq!(a.modulus(), 5.0);
        assert_eq!(a.mul(b), Complex::new(-5.0, 10.0, 'i'));
        assert_eq!(a.div(b).unwrap(), Complex::new(2.2, -0.4, 'i'));
        assert_eq!(Complex::new(0.0, 0.0, 'i').div(b).unwrap().re, 0.0);
        assert!(a.div(Complex::new(0.0, 0.0, 'i')).is_err());
    }

    #[test]
    fn units_resolve_with_and_without_a_prefix() {
        assert_eq!(unit("m").unwrap().0, "length");
        assert_eq!(unit("km").unwrap().1, 1000.0);
        assert_eq!(unit("kg").unwrap().1, 1000.0);
        assert!(unit("nonsense").is_none());
    }
}
