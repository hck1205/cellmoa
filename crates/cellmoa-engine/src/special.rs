// The coefficient tables below are published constants, transcribed in the form
// they are given in rather than trimmed to what an f64 can hold. Keeping them
// verbatim is what makes them checkable against their source.
#![allow(clippy::excessive_precision, clippy::inconsistent_digit_grouping)]

//! Special functions underpinning the statistical distributions.
//!
//! Everything here is written to be accurate over the range a spreadsheet
//! actually asks about, and to stay finite: a distribution that returns an
//! infinity or a NaN would put a value in a cell that no spreadsheet can hold.

/// Natural logarithm of the gamma function, by the Lanczos approximation.
///
/// Working in logarithms is what keeps the binomial and beta functions usable:
/// `170!` is near the top of what an `f64` holds, but `ln(170!)` is only about
/// 706, so combinations of large factorials cancel before they overflow.
pub fn ln_gamma(x: f64) -> f64 {
    const COEFFICIENTS: [f64; 9] = [
        0.999_999_999_999_809_93,
        676.520_368_121_885_1,
        -1259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        // Reflection, for arguments the series does not cover.
        return std::f64::consts::PI.ln()
            - (std::f64::consts::PI * x).sin().abs().ln()
            - ln_gamma(1.0 - x);
    }
    let x = x - 1.0;
    let mut series = COEFFICIENTS[0];
    for (i, c) in COEFFICIENTS.iter().enumerate().skip(1) {
        series += c / (x + i as f64);
    }
    let t = x + 7.5;
    0.5 * (2.0 * std::f64::consts::PI).ln() + (x + 0.5) * t.ln() - t + series.ln()
}

pub fn gamma(x: f64) -> f64 {
    if x < 0.5 {
        std::f64::consts::PI / ((std::f64::consts::PI * x).sin() * gamma(1.0 - x))
    } else {
        ln_gamma(x).exp()
    }
}

/// The natural logarithm of the beta function.
pub fn ln_beta(a: f64, b: f64) -> f64 {
    ln_gamma(a) + ln_gamma(b) - ln_gamma(a + b)
}

/// The error function.
pub fn erf(x: f64) -> f64 {
    1.0 - erfc(x)
}

/// The complementary error function, by a Chebyshev-fitted rational.
///
/// Computing `erfc` directly rather than as `1 - erf` matters in the tail: for
/// large `x` the subtraction would cancel away every significant digit, and the
/// normal distribution's tail probabilities live exactly there.
pub fn erfc(x: f64) -> f64 {
    let z = x.abs();
    let t = 2.0 / (2.0 + z);
    let ty = 4.0 * t - 2.0;
    const COEFFICIENTS: [f64; 28] = [
        -1.3026537197817094,
        6.419_697_923_564_902e-1,
        1.9476473204185836e-2,
        -9.561_514_786_808_631e-3,
        -9.46595344482036e-4,
        3.66839497852761e-4,
        4.2523324806907e-5,
        -2.0278578112534e-5,
        -1.624290004647e-6,
        1.303655835580e-6,
        1.5626441722e-8,
        -8.5238095915e-8,
        6.529054439e-9,
        5.059343495e-9,
        -9.91364156e-10,
        -2.27365122e-10,
        9.6467911e-11,
        2.394038e-12,
        -6.886027e-12,
        8.94487e-13,
        3.13092e-13,
        -1.12708e-13,
        3.81e-16,
        7.106e-15,
        -1.523e-15,
        -9.4e-17,
        1.21e-16,
        -2.8e-17,
    ];
    let (mut d, mut dd) = (0.0f64, 0.0f64);
    for &c in COEFFICIENTS.iter().rev().take(COEFFICIENTS.len() - 1) {
        let tmp = d;
        d = ty * d - dd + c;
        dd = tmp;
    }
    let result = t * (-z * z + 0.5 * (COEFFICIENTS[0] + ty * d) - dd).exp();
    if x >= 0.0 {
        result
    } else {
        2.0 - result
    }
}

/// The regularised lower incomplete gamma function `P(a, x)`.
pub fn gamma_p(a: f64, x: f64) -> f64 {
    if x < 0.0 || a <= 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    // The series converges quickly below the mode; above it the continued
    // fraction for Q does, so each is used where it is well behaved.
    if x < a + 1.0 {
        gamma_series(a, x)
    } else {
        1.0 - gamma_continued_fraction(a, x)
    }
}

/// The regularised upper incomplete gamma function `Q(a, x) = 1 - P(a, x)`.
pub fn gamma_q(a: f64, x: f64) -> f64 {
    1.0 - gamma_p(a, x)
}

fn gamma_series(a: f64, x: f64) -> f64 {
    let mut ap = a;
    let mut sum = 1.0 / a;
    let mut term = sum;
    for _ in 0..1000 {
        ap += 1.0;
        term *= x / ap;
        sum += term;
        if term.abs() < sum.abs() * 1e-15 {
            break;
        }
    }
    sum * (-x + a * x.ln() - ln_gamma(a)).exp()
}

fn gamma_continued_fraction(a: f64, x: f64) -> f64 {
    // Modified Lentz's method.
    const TINY: f64 = 1e-300;
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / TINY;
    let mut d = 1.0 / b;
    let mut h = d;
    for i in 1..1000 {
        let an = -(i as f64) * (i as f64 - a);
        b += 2.0;
        d = an * d + b;
        if d.abs() < TINY {
            d = TINY;
        }
        c = b + an / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() < 1e-15 {
            break;
        }
    }
    (-x + a * x.ln() - ln_gamma(a)).exp() * h
}

/// The regularised incomplete beta function `I_x(a, b)`.
pub fn beta_i(a: f64, b: f64, x: f64) -> f64 {
    if !(0.0..=1.0).contains(&x) || a <= 0.0 || b <= 0.0 {
        return f64::NAN;
    }
    if x == 0.0 || x == 1.0 {
        return x;
    }
    let front = (a * x.ln() + b * (1.0 - x).ln() - ln_beta(a, b)).exp();
    // The continued fraction converges only on one side of the mode; the
    // symmetry relation covers the other.
    if x < (a + 1.0) / (a + b + 2.0) {
        front * beta_continued_fraction(a, b, x) / a
    } else {
        1.0 - (b * (1.0 - x).ln() + a * x.ln() - ln_beta(a, b)).exp()
            * beta_continued_fraction(b, a, 1.0 - x)
            / b
    }
}

fn beta_continued_fraction(a: f64, b: f64, x: f64) -> f64 {
    const TINY: f64 = 1e-300;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < TINY {
        d = TINY;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..300 {
        let m = m as f64;
        let m2 = 2.0 * m;
        // Even step.
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < TINY {
            d = TINY;
        }
        c = 1.0 + aa / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        h *= d * c;
        // Odd step.
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < TINY {
            d = TINY;
        }
        c = 1.0 + aa / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() < 1e-15 {
            break;
        }
    }
    h
}

/// The standard normal cumulative distribution.
pub fn normal_cdf(z: f64) -> f64 {
    0.5 * erfc(-z / std::f64::consts::SQRT_2)
}

/// The standard normal density.
pub fn normal_pdf(z: f64) -> f64 {
    (-0.5 * z * z).exp() / (2.0 * std::f64::consts::PI).sqrt()
}

/// The inverse of the standard normal cumulative distribution, by Acklam's
/// rational approximation refined with one Halley step.
pub fn normal_inverse(p: f64) -> f64 {
    if !(0.0..=1.0).contains(&p) {
        return f64::NAN;
    }
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838,
        -2.549_732_539_343_734,
        4.374_664_141_464_968,
        2.938_163_982_698_783,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996,
        3.754_408_661_907_416,
    ];
    const LOW: f64 = 0.02425;
    let mut x = if p < LOW {
        let q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= 1.0 - LOW {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    // One Halley refinement takes the approximation from about 1e-9 to full
    // double precision, which matters because INV functions are round-tripped
    // against their CDF.
    let error = normal_cdf(x) - p;
    let density = normal_pdf(x);
    if density > 0.0 {
        let u = error / density;
        x -= u / (1.0 + x * u / 2.0);
    }
    x
}

/// Inverts a monotonically increasing cumulative distribution by bisection.
///
/// Bisection rather than Newton: the distributions differ in how well behaved
/// their derivatives are, and a method that cannot diverge is worth more here
/// than one that converges quickly.
pub fn invert_cdf(p: f64, mut low: f64, mut high: f64, cdf: impl Fn(f64) -> f64) -> Option<f64> {
    if !(0.0..=1.0).contains(&p) {
        return None;
    }
    // Widen the bracket until it actually contains the answer.
    let mut guard = 0;
    while cdf(high) < p {
        high *= 2.0;
        guard += 1;
        if guard > 200 || !high.is_finite() {
            return None;
        }
    }
    for _ in 0..200 {
        let mid = (low + high) / 2.0;
        if cdf(mid) < p {
            low = mid;
        } else {
            high = mid;
        }
        if (high - low).abs() < 1e-12 * high.abs().max(1.0) {
            break;
        }
    }
    Some((low + high) / 2.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tolerance: f64) -> bool {
        (a - b).abs() <= tolerance * b.abs().max(1.0)
    }

    #[test]
    fn ln_gamma_reproduces_factorials() {
        for n in 1..=20u64 {
            let factorial: f64 = (1..=n - 1).map(|i| i as f64).product::<f64>().max(1.0);
            assert!(close(ln_gamma(n as f64).exp(), factorial, 1e-10), "n={n}");
        }
    }

    #[test]
    fn erf_matches_known_values() {
        assert!(close(erf(0.0), 0.0, 1e-15));
        assert!(close(erf(1.0), 0.842_700_792_949_715, 1e-12));
        assert!(close(erf(-1.0), -0.842_700_792_949_715, 1e-12));
        assert!(close(erf(3.0), 0.999_977_909_503_001, 1e-12));
    }

    #[test]
    fn erfc_keeps_its_precision_in_the_tail() {
        // 1 - erf(6) would be zero to double precision; erfc is not.
        assert!(erfc(6.0) > 0.0);
        assert!(close(erfc(6.0), 2.151_973_671_249_891e-17, 1e-9));
    }

    #[test]
    fn the_normal_distribution_and_its_inverse_agree() {
        assert!(close(normal_cdf(0.0), 0.5, 1e-15));
        assert!(close(normal_cdf(1.96), 0.975_002_104_851_780, 1e-12));
        for p in [0.001, 0.025, 0.5, 0.9, 0.975, 0.999] {
            let z = normal_inverse(p);
            assert!(close(normal_cdf(z), p, 1e-12), "p={p}");
        }
        assert!(close(normal_inverse(0.975), 1.959_963_984_540_054, 1e-10));
    }

    #[test]
    fn the_incomplete_gamma_halves_agree() {
        for (a, x) in [(0.5, 0.3), (2.0, 1.0), (5.0, 4.0), (10.0, 20.0)] {
            assert!(close(gamma_p(a, x) + gamma_q(a, x), 1.0, 1e-12), "a={a} x={x}");
        }
        // The chi-square with 2 degrees of freedom is an exponential.
        assert!(close(gamma_p(1.0, 1.0), 1.0 - (-1.0f64).exp(), 1e-12));
    }

    #[test]
    fn the_incomplete_beta_is_symmetric() {
        for (a, b, x) in [(2.0, 3.0, 0.4), (0.5, 0.5, 0.7), (5.0, 1.0, 0.9)] {
            assert!(
                close(beta_i(a, b, x), 1.0 - beta_i(b, a, 1.0 - x), 1e-12),
                "a={a} b={b} x={x}"
            );
        }
        // I_x(1,1) is x itself.
        assert!(close(beta_i(1.0, 1.0, 0.37), 0.37, 1e-12));
    }

    #[test]
    fn bisection_inverts_a_cumulative_distribution() {
        let cdf = |x: f64| gamma_p(3.0, x);
        let x = invert_cdf(0.75, 0.0, 1.0, cdf).unwrap();
        assert!(close(cdf(x), 0.75, 1e-9));
    }
}
