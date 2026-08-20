//! Statistical distributions.
//!
//! Excel carries two names for most of these: the pre-2010 spelling
//! (`NORMDIST`) and the dotted one (`NORM.DIST`). Both are registered, because a
//! workbook saved by an older version still contains the old names and must
//! keep calculating.

use super::args;
use super::*;
use crate::operand::Operand;
use crate::special::*;

/// `ln(n choose k)`, computed in logarithms so that large binomials do not
/// overflow on the way to a probability that is perfectly representable.
fn ln_choose(n: f64, k: f64) -> f64 {
    ln_gamma(n + 1.0) - ln_gamma(k + 1.0) - ln_gamma(n - k + 1.0)
}

fn binomial_pmf(k: f64, n: f64, p: f64) -> f64 {
    if p == 0.0 {
        return f64::from(k == 0.0);
    }
    if p == 1.0 {
        return f64::from(k == n);
    }
    (ln_choose(n, k) + k * p.ln() + (n - k) * (1.0 - p).ln()).exp()
}

fn binomial_cdf(k: f64, n: f64, p: f64) -> f64 {
    if k < 0.0 {
        return 0.0;
    }
    if k >= n {
        return 1.0;
    }
    // The regularised incomplete beta gives the whole tail in one evaluation
    // rather than summing k+1 terms.
    beta_i(n - k, k + 1.0, 1.0 - p)
}

/// Student's t cumulative distribution.
fn t_cdf(x: f64, df: f64) -> f64 {
    let half = 0.5 * beta_i(df / 2.0, 0.5, df / (df + x * x));
    if x >= 0.0 {
        1.0 - half
    } else {
        half
    }
}

fn t_pdf(x: f64, df: f64) -> f64 {
    let normaliser = ln_gamma((df + 1.0) / 2.0) - ln_gamma(df / 2.0) - 0.5 * (df * std::f64::consts::PI).ln();
    (normaliser - (df + 1.0) / 2.0 * (1.0 + x * x / df).ln()).exp()
}

fn f_cdf(x: f64, d1: f64, d2: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    beta_i(d1 / 2.0, d2 / 2.0, d1 * x / (d1 * x + d2))
}

fn f_pdf(x: f64, d1: f64, d2: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let ln = 0.5 * (d1 * (d1 * x).ln() + d2 * d2.ln() - (d1 + d2) * (d1 * x + d2).ln())
        - x.ln()
        - ln_beta(d1 / 2.0, d2 / 2.0);
    ln.exp()
}

fn chisq_pdf(x: f64, df: f64) -> f64 {
    if x < 0.0 {
        return 0.0;
    }
    ((df / 2.0 - 1.0) * x.ln() - x / 2.0 - (df / 2.0) * 2f64.ln() - ln_gamma(df / 2.0)).exp()
}

fn gamma_pdf(x: f64, alpha: f64, beta: f64) -> f64 {
    if x < 0.0 {
        return 0.0;
    }
    ((alpha - 1.0) * x.ln() - x / beta - alpha * beta.ln() - ln_gamma(alpha)).exp()
}

/// Reads the trailing `cumulative` flag every distribution takes.
fn cumulative(ctx: &EvalCtx, a: &[Operand], i: usize) -> Result<bool, CellError> {
    arg_bool(ctx, a, i)
}

/// Wraps a probability, rejecting anything the maths could not produce.
fn probability(p: f64) -> Operand {
    if p.is_finite() {
        Operand::number(p.clamp(0.0, 1.0))
    } else {
        Operand::error(CellError::Num)
    }
}

pub const FUNCTIONS: &[Function] = &[
    // --- gamma ------------------------------------------------------------
    f("GAMMALN", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |x| if x <= 0.0 { Err(CellError::Num) } else { Ok(ln_gamma(x)) })
    }),
    f("GAMMALN.PRECISE", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |x| if x <= 0.0 { Err(CellError::Num) } else { Ok(ln_gamma(x)) })
    }),
    f("GAMMA", 1, Some(1), |ctx, a| {
        num1_checked(ctx, a, |x| {
            // The gamma function has poles at zero and the negative integers.
            if x <= 0.0 && x.fract() == 0.0 {
                return Err(CellError::Num);
            }
            Ok(gamma(x))
        })
    }),

    // --- normal -----------------------------------------------------------
    f("NORM.DIST", 4, Some(4), |ctx, a| normal_dist(ctx, a)),
    f("NORMDIST", 4, Some(4), |ctx, a| normal_dist(ctx, a)),
    f("NORM.INV", 3, Some(3), |ctx, a| normal_inv(ctx, a)),
    f("NORMINV", 3, Some(3), |ctx, a| normal_inv(ctx, a)),
    f("NORM.S.DIST", 2, Some(2), |ctx, a| {
        args!(z = arg_num(ctx, a, 0), cdf = cumulative(ctx, a, 1));
        Operand::number(if cdf { normal_cdf(z) } else { normal_pdf(z) })
    }),
    f("NORMSDIST", 1, Some(1), |ctx, a| {
        args!(z = arg_num(ctx, a, 0));
        Operand::number(normal_cdf(z))
    }),
    f("NORM.S.INV", 1, Some(1), |ctx, a| standard_normal_inv(ctx, a)),
    f("NORMSINV", 1, Some(1), |ctx, a| standard_normal_inv(ctx, a)),
    f("PHI", 1, Some(1), |ctx, a| num1(ctx, a, normal_pdf)),
    f("GAUSS", 1, Some(1), |ctx, a| num1(ctx, a, |z| normal_cdf(z) - 0.5)),
    f("LOGNORM.DIST", 4, Some(4), |ctx, a| lognormal_dist(ctx, a)),
    f("LOGNORMDIST", 3, Some(3), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), mean = arg_num(ctx, a, 1), sd = arg_num(ctx, a, 2));
        if x <= 0.0 || sd <= 0.0 {
            return Operand::error(CellError::Num);
        }
        probability(normal_cdf((x.ln() - mean) / sd))
    }),
    f("LOGNORM.INV", 3, Some(3), |ctx, a| lognormal_inv(ctx, a)),
    f("LOGINV", 3, Some(3), |ctx, a| lognormal_inv(ctx, a)),

    // --- discrete ---------------------------------------------------------
    f("BINOM.DIST", 4, Some(4), |ctx, a| binom_dist(ctx, a)),
    f("BINOMDIST", 4, Some(4), |ctx, a| binom_dist(ctx, a)),
    f("BINOM.DIST.RANGE", 3, Some(4), |ctx, a| {
        args!(n = arg_num(ctx, a, 0), p = arg_num(ctx, a, 1), from = arg_num(ctx, a, 2));
        let to = opt_num(ctx, a, 3, from).unwrap_or(from);
        if !(0.0..=1.0).contains(&p) || from < 0.0 || to < from || to > n {
            return Operand::error(CellError::Num);
        }
        let total: f64 =
            (from.trunc() as i64..=to.trunc() as i64).map(|k| binomial_pmf(k as f64, n, p)).sum();
        probability(total)
    }),
    f("BINOM.INV", 3, Some(3), |ctx, a| binom_inv(ctx, a)),
    f("CRITBINOM", 3, Some(3), |ctx, a| binom_inv(ctx, a)),
    f("NEGBINOM.DIST", 4, Some(5), |ctx, a| negbinom(ctx, a, true)),
    f("NEGBINOMDIST", 3, Some(3), |ctx, a| negbinom(ctx, a, false)),
    f("HYPGEOM.DIST", 5, Some(5), |ctx, a| hypgeom(ctx, a, true)),
    f("HYPGEOMDIST", 4, Some(4), |ctx, a| hypgeom(ctx, a, false)),
    f("POISSON.DIST", 3, Some(3), |ctx, a| poisson(ctx, a)),
    f("POISSON", 3, Some(3), |ctx, a| poisson(ctx, a)),

    // --- continuous --------------------------------------------------------
    f("EXPON.DIST", 3, Some(3), |ctx, a| exponential(ctx, a)),
    f("EXPONDIST", 3, Some(3), |ctx, a| exponential(ctx, a)),
    f("WEIBULL.DIST", 4, Some(4), |ctx, a| weibull(ctx, a)),
    f("WEIBULL", 4, Some(4), |ctx, a| weibull(ctx, a)),
    f("GAMMA.DIST", 4, Some(4), |ctx, a| gamma_dist(ctx, a)),
    f("GAMMADIST", 4, Some(4), |ctx, a| gamma_dist(ctx, a)),
    f("GAMMA.INV", 3, Some(3), |ctx, a| gamma_inv(ctx, a)),
    f("GAMMAINV", 3, Some(3), |ctx, a| gamma_inv(ctx, a)),
    f("BETA.DIST", 4, Some(6), |ctx, a| beta_dist(ctx, a)),
    f("BETADIST", 3, Some(5), |ctx, a| {
        // The legacy form has no cumulative flag and is always cumulative.
        args!(x = arg_num(ctx, a, 0), alpha = arg_num(ctx, a, 1), beta = arg_num(ctx, a, 2));
        let lower = opt_num(ctx, a, 3, 0.0).unwrap_or(0.0);
        let upper = opt_num(ctx, a, 4, 1.0).unwrap_or(1.0);
        if alpha <= 0.0 || beta <= 0.0 || upper <= lower {
            return Operand::error(CellError::Num);
        }
        let scaled = (x - lower) / (upper - lower);
        if !(0.0..=1.0).contains(&scaled) {
            return Operand::error(CellError::Num);
        }
        probability(beta_i(alpha, beta, scaled))
    }),
    f("BETA.INV", 3, Some(5), |ctx, a| beta_inv(ctx, a)),
    f("BETAINV", 3, Some(5), |ctx, a| beta_inv(ctx, a)),

    // --- test distributions -------------------------------------------------
    f("CHISQ.DIST", 3, Some(3), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1), cdf = cumulative(ctx, a, 2));
        if x < 0.0 || df < 1.0 {
            return Operand::error(CellError::Num);
        }
        if cdf {
            probability(gamma_p(df / 2.0, x / 2.0))
        } else {
            number(chisq_pdf(x, df))
        }
    }),
    f("CHISQ.DIST.RT", 2, Some(2), |ctx, a| chisq_rt(ctx, a)),
    f("CHIDIST", 2, Some(2), |ctx, a| chisq_rt(ctx, a)),
    f("CHISQ.INV", 2, Some(2), |ctx, a| {
        args!(p = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
        if !(0.0..=1.0).contains(&p) || df < 1.0 {
            return Operand::error(CellError::Num);
        }
        match invert_cdf(p, 0.0, 1.0, |x| gamma_p(df / 2.0, x / 2.0)) {
            Some(x) => number(x),
            None => Operand::error(CellError::Num),
        }
    }),
    f("CHISQ.INV.RT", 2, Some(2), |ctx, a| chisq_inv_rt(ctx, a)),
    f("CHIINV", 2, Some(2), |ctx, a| chisq_inv_rt(ctx, a)),
    f("F.DIST", 4, Some(4), |ctx, a| {
        args!(
            x = arg_num(ctx, a, 0),
            d1 = arg_num(ctx, a, 1),
            d2 = arg_num(ctx, a, 2),
            cdf = cumulative(ctx, a, 3),
        );
        if x < 0.0 || d1 < 1.0 || d2 < 1.0 {
            return Operand::error(CellError::Num);
        }
        if cdf {
            probability(f_cdf(x, d1, d2))
        } else {
            number(f_pdf(x, d1, d2))
        }
    }),
    f("F.DIST.RT", 3, Some(3), |ctx, a| f_rt(ctx, a)),
    f("FDIST", 3, Some(3), |ctx, a| f_rt(ctx, a)),
    f("F.INV", 3, Some(3), |ctx, a| {
        args!(p = arg_num(ctx, a, 0), d1 = arg_num(ctx, a, 1), d2 = arg_num(ctx, a, 2));
        match invert_cdf(p, 0.0, 1.0, |x| f_cdf(x, d1, d2)) {
            Some(x) => number(x),
            None => Operand::error(CellError::Num),
        }
    }),
    f("F.INV.RT", 3, Some(3), |ctx, a| f_inv_rt(ctx, a)),
    f("FINV", 3, Some(3), |ctx, a| f_inv_rt(ctx, a)),
    f("T.DIST", 3, Some(3), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1), cdf = cumulative(ctx, a, 2));
        if df < 1.0 {
            return Operand::error(CellError::Num);
        }
        if cdf {
            probability(t_cdf(x, df))
        } else {
            number(t_pdf(x, df))
        }
    }),
    f("T.DIST.RT", 2, Some(2), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
        if df < 1.0 {
            return Operand::error(CellError::Num);
        }
        probability(1.0 - t_cdf(x, df))
    }),
    f("T.DIST.2T", 2, Some(2), |ctx, a| t_two_tailed(ctx, a)),
    f("TDIST", 3, Some(3), |ctx, a| {
        args!(x = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1), tails = arg_num(ctx, a, 2));
        if x < 0.0 || df < 1.0 || !(1.0..=2.0).contains(&tails) {
            return Operand::error(CellError::Num);
        }
        let right = 1.0 - t_cdf(x, df);
        probability(right * tails.trunc())
    }),
    f("T.INV", 2, Some(2), |ctx, a| t_inv(ctx, a)),
    f("T.INV.2T", 2, Some(2), |ctx, a| t_inv_two_tailed(ctx, a)),
    f("TINV", 2, Some(2), |ctx, a| t_inv_two_tailed(ctx, a)),

    // --- confidence and tests ------------------------------------------------
    f("CONFIDENCE.NORM", 3, Some(3), |ctx, a| confidence_norm(ctx, a)),
    f("CONFIDENCE", 3, Some(3), |ctx, a| confidence_norm(ctx, a)),
    f("CONFIDENCE.T", 3, Some(3), |ctx, a| {
        args!(alpha = arg_num(ctx, a, 0), sd = arg_num(ctx, a, 1), n = arg_num(ctx, a, 2));
        if !(0.0..1.0).contains(&alpha) || sd <= 0.0 || n < 2.0 {
            return Operand::error(CellError::Num);
        }
        let df = n.trunc() - 1.0;
        match invert_cdf(1.0 - alpha / 2.0, 0.0, 10.0, |x| t_cdf(x, df)) {
            Some(t) => number(t * sd / n.trunc().sqrt()),
            None => Operand::error(CellError::Num),
        }
    }),
    array_fn("Z.TEST", 2, Some(3), |ctx, a| z_test(ctx, a)),
    array_fn("ZTEST", 2, Some(3), |ctx, a| z_test(ctx, a)),
    array_fn("CHISQ.TEST", 2, Some(2), |ctx, a| chisq_test(ctx, a)),
    array_fn("CHITEST", 2, Some(2), |ctx, a| chisq_test(ctx, a)),
    array_fn("F.TEST", 2, Some(2), |ctx, a| f_test(ctx, a)),
    array_fn("FTEST", 2, Some(2), |ctx, a| f_test(ctx, a)),
    array_fn("T.TEST", 4, Some(4), |ctx, a| t_test(ctx, a)),
    array_fn("TTEST", 4, Some(4), |ctx, a| t_test(ctx, a)),
    array_fn("PROB", 3, Some(4), |ctx, a| {
        let values = a[0].to_array(ctx.wb);
        let probabilities = a[1].to_array(ctx.wb);
        args!(lower = arg_num(ctx, a, 2));
        let upper = opt_num(ctx, a, 3, lower).unwrap_or(lower);
        let mut total = 0.0;
        let mut mass = 0.0;
        for (v, p) in values.values().zip(probabilities.values()) {
            let (Value::Number(v), Value::Number(p)) = (v, p) else { continue };
            mass += p;
            if *v >= lower && *v <= upper {
                total += p;
            }
        }
        // The probabilities have to be a distribution, or the answer is
        // meaningless rather than merely imprecise.
        if (mass - 1.0).abs() > 1e-9 {
            return Operand::error(CellError::Num);
        }
        probability(total)
    }),
];

fn normal_dist(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(
        x = arg_num(ctx, a, 0),
        mean = arg_num(ctx, a, 1),
        sd = arg_num(ctx, a, 2),
        cdf = cumulative(ctx, a, 3),
    );
    if sd <= 0.0 {
        return Operand::error(CellError::Num);
    }
    let z = (x - mean) / sd;
    if cdf {
        probability(normal_cdf(z))
    } else {
        number(normal_pdf(z) / sd)
    }
}

fn normal_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), mean = arg_num(ctx, a, 1), sd = arg_num(ctx, a, 2));
    if sd <= 0.0 || !(0.0..1.0).contains(&p) || p == 0.0 {
        return Operand::error(CellError::Num);
    }
    number(mean + sd * normal_inverse(p))
}

fn standard_normal_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0));
    if p <= 0.0 || p >= 1.0 {
        return Operand::error(CellError::Num);
    }
    number(normal_inverse(p))
}

fn lognormal_dist(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(
        x = arg_num(ctx, a, 0),
        mean = arg_num(ctx, a, 1),
        sd = arg_num(ctx, a, 2),
        cdf = cumulative(ctx, a, 3),
    );
    if x <= 0.0 || sd <= 0.0 {
        return Operand::error(CellError::Num);
    }
    let z = (x.ln() - mean) / sd;
    if cdf {
        probability(normal_cdf(z))
    } else {
        number(normal_pdf(z) / (x * sd))
    }
}

fn lognormal_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), mean = arg_num(ctx, a, 1), sd = arg_num(ctx, a, 2));
    if !(0.0..1.0).contains(&p) || p == 0.0 || sd <= 0.0 {
        return Operand::error(CellError::Num);
    }
    number((mean + sd * normal_inverse(p)).exp())
}

fn binom_dist(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(
        k = arg_num(ctx, a, 0),
        n = arg_num(ctx, a, 1),
        p = arg_num(ctx, a, 2),
        cdf = cumulative(ctx, a, 3),
    );
    let (k, n) = (k.trunc(), n.trunc());
    if k < 0.0 || k > n || !(0.0..=1.0).contains(&p) {
        return Operand::error(CellError::Num);
    }
    probability(if cdf { binomial_cdf(k, n, p) } else { binomial_pmf(k, n, p) })
}

fn binom_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(n = arg_num(ctx, a, 0), p = arg_num(ctx, a, 1), alpha = arg_num(ctx, a, 2));
    if !(0.0..=1.0).contains(&p) || !(0.0..=1.0).contains(&alpha) || n < 0.0 {
        return Operand::error(CellError::Num);
    }
    // The smallest number of successes whose cumulative probability reaches
    // alpha.
    let n = n.trunc();
    let mut cumulative = 0.0;
    for k in 0..=(n as i64) {
        cumulative += binomial_pmf(k as f64, n, p);
        if cumulative >= alpha {
            return Operand::number(k as f64);
        }
    }
    Operand::number(n)
}

fn negbinom(ctx: &EvalCtx, a: &[Operand], has_cumulative: bool) -> Operand {
    args!(failures = arg_num(ctx, a, 0), successes = arg_num(ctx, a, 1), p = arg_num(ctx, a, 2));
    let cdf = has_cumulative && arg_bool(ctx, a, 3).unwrap_or(false);
    if failures < 0.0 || successes < 1.0 || !(0.0..=1.0).contains(&p) {
        return Operand::error(CellError::Num);
    }
    let pmf = |f: f64| {
        (ln_choose(f + successes - 1.0, successes - 1.0)
            + successes * p.ln()
            + f * (1.0 - p).ln())
        .exp()
    };
    probability(if cdf {
        (0..=failures.trunc() as i64).map(|f| pmf(f as f64)).sum()
    } else {
        pmf(failures.trunc())
    })
}

fn hypgeom(ctx: &EvalCtx, a: &[Operand], has_cumulative: bool) -> Operand {
    args!(
        drawn_successes = arg_num(ctx, a, 0),
        drawn = arg_num(ctx, a, 1),
        successes = arg_num(ctx, a, 2),
        population = arg_num(ctx, a, 3),
    );
    let cdf = has_cumulative && arg_bool(ctx, a, 4).unwrap_or(false);
    let (k, n, big_k, big_n) =
        (drawn_successes.trunc(), drawn.trunc(), successes.trunc(), population.trunc());
    if k < 0.0 || k > n || n > big_n || big_k > big_n || k > big_k {
        return Operand::error(CellError::Num);
    }
    let pmf = |k: f64| {
        if k > big_k || n - k > big_n - big_k {
            return 0.0;
        }
        (ln_choose(big_k, k) + ln_choose(big_n - big_k, n - k) - ln_choose(big_n, n)).exp()
    };
    probability(if cdf {
        (0..=k as i64).map(|i| pmf(i as f64)).sum()
    } else {
        pmf(k)
    })
}

fn poisson(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(k = arg_num(ctx, a, 0), lambda = arg_num(ctx, a, 1), cdf = cumulative(ctx, a, 2));
    let k = k.trunc();
    if k < 0.0 || lambda < 0.0 {
        return Operand::error(CellError::Num);
    }
    probability(if cdf {
        // The upper incomplete gamma is the Poisson tail exactly.
        gamma_q(k + 1.0, lambda)
    } else {
        (k * lambda.ln() - lambda - ln_gamma(k + 1.0)).exp()
    })
}

fn exponential(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(x = arg_num(ctx, a, 0), lambda = arg_num(ctx, a, 1), cdf = cumulative(ctx, a, 2));
    if x < 0.0 || lambda <= 0.0 {
        return Operand::error(CellError::Num);
    }
    if cdf {
        probability(1.0 - (-lambda * x).exp())
    } else {
        number(lambda * (-lambda * x).exp())
    }
}

fn weibull(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(
        x = arg_num(ctx, a, 0),
        alpha = arg_num(ctx, a, 1),
        beta = arg_num(ctx, a, 2),
        cdf = cumulative(ctx, a, 3),
    );
    if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
        return Operand::error(CellError::Num);
    }
    let scaled = (x / beta).powf(alpha);
    if cdf {
        probability(1.0 - (-scaled).exp())
    } else {
        number(alpha / beta * (x / beta).powf(alpha - 1.0) * (-scaled).exp())
    }
}

fn gamma_dist(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(
        x = arg_num(ctx, a, 0),
        alpha = arg_num(ctx, a, 1),
        beta = arg_num(ctx, a, 2),
        cdf = cumulative(ctx, a, 3),
    );
    if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
        return Operand::error(CellError::Num);
    }
    if cdf {
        probability(gamma_p(alpha, x / beta))
    } else {
        number(gamma_pdf(x, alpha, beta))
    }
}

fn gamma_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), alpha = arg_num(ctx, a, 1), beta = arg_num(ctx, a, 2));
    if !(0.0..=1.0).contains(&p) || alpha <= 0.0 || beta <= 0.0 {
        return Operand::error(CellError::Num);
    }
    match invert_cdf(p, 0.0, 1.0, |x| gamma_p(alpha, x / beta)) {
        Some(x) => number(x),
        None => Operand::error(CellError::Num),
    }
}

fn beta_dist(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(
        x = arg_num(ctx, a, 0),
        alpha = arg_num(ctx, a, 1),
        beta = arg_num(ctx, a, 2),
        cdf = cumulative(ctx, a, 3),
    );
    let lower = opt_num(ctx, a, 4, 0.0).unwrap_or(0.0);
    let upper = opt_num(ctx, a, 5, 1.0).unwrap_or(1.0);
    if alpha <= 0.0 || beta <= 0.0 || upper <= lower {
        return Operand::error(CellError::Num);
    }
    let scaled = (x - lower) / (upper - lower);
    if !(0.0..=1.0).contains(&scaled) {
        return Operand::error(CellError::Num);
    }
    if cdf {
        probability(beta_i(alpha, beta, scaled))
    } else {
        let density = ((alpha - 1.0) * scaled.ln() + (beta - 1.0) * (1.0 - scaled).ln()
            - ln_beta(alpha, beta))
        .exp();
        number(density / (upper - lower))
    }
}

fn beta_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), alpha = arg_num(ctx, a, 1), beta = arg_num(ctx, a, 2));
    let lower = opt_num(ctx, a, 3, 0.0).unwrap_or(0.0);
    let upper = opt_num(ctx, a, 4, 1.0).unwrap_or(1.0);
    if !(0.0..=1.0).contains(&p) || alpha <= 0.0 || beta <= 0.0 || upper <= lower {
        return Operand::error(CellError::Num);
    }
    // The support is bounded, so the bracket is known exactly.
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..200 {
        let mid = (low + high) / 2.0;
        if beta_i(alpha, beta, mid) < p {
            low = mid;
        } else {
            high = mid;
        }
    }
    number(lower + (upper - lower) * (low + high) / 2.0)
}

fn chisq_rt(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(x = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
    if x < 0.0 || df < 1.0 {
        return Operand::error(CellError::Num);
    }
    probability(gamma_q(df / 2.0, x / 2.0))
}

fn chisq_inv_rt(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
    if !(0.0..=1.0).contains(&p) || df < 1.0 {
        return Operand::error(CellError::Num);
    }
    match invert_cdf(1.0 - p, 0.0, 1.0, |x| gamma_p(df / 2.0, x / 2.0)) {
        Some(x) => number(x),
        None => Operand::error(CellError::Num),
    }
}

fn f_rt(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(x = arg_num(ctx, a, 0), d1 = arg_num(ctx, a, 1), d2 = arg_num(ctx, a, 2));
    if x < 0.0 || d1 < 1.0 || d2 < 1.0 {
        return Operand::error(CellError::Num);
    }
    probability(1.0 - f_cdf(x, d1, d2))
}

fn f_inv_rt(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), d1 = arg_num(ctx, a, 1), d2 = arg_num(ctx, a, 2));
    match invert_cdf(1.0 - p, 0.0, 1.0, |x| f_cdf(x, d1, d2)) {
        Some(x) => number(x),
        None => Operand::error(CellError::Num),
    }
}

fn t_two_tailed(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(x = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
    if x < 0.0 || df < 1.0 {
        return Operand::error(CellError::Num);
    }
    probability(2.0 * (1.0 - t_cdf(x, df)))
}

fn t_inv(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
    if !(0.0..1.0).contains(&p) || p == 0.0 || df < 1.0 {
        return Operand::error(CellError::Num);
    }
    // The t distribution is symmetric, so only the upper half is searched and
    // the sign is put back afterwards.
    let upper = p.max(1.0 - p);
    match invert_cdf(upper, 0.0, 10.0, |x| t_cdf(x, df)) {
        Some(x) => number(if p < 0.5 { -x } else { x }),
        None => Operand::error(CellError::Num),
    }
}

fn t_inv_two_tailed(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(p = arg_num(ctx, a, 0), df = arg_num(ctx, a, 1));
    if !(0.0..=1.0).contains(&p) || p == 0.0 || df < 1.0 {
        return Operand::error(CellError::Num);
    }
    match invert_cdf(1.0 - p / 2.0, 0.0, 10.0, |x| t_cdf(x, df)) {
        Some(x) => number(x),
        None => Operand::error(CellError::Num),
    }
}

fn confidence_norm(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(alpha = arg_num(ctx, a, 0), sd = arg_num(ctx, a, 1), n = arg_num(ctx, a, 2));
    if !(0.0..1.0).contains(&alpha) || alpha == 0.0 || sd <= 0.0 || n < 1.0 {
        return Operand::error(CellError::Num);
    }
    number(normal_inverse(1.0 - alpha / 2.0) * sd / n.trunc().sqrt())
}

fn z_test(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(mu = arg_num(ctx, a, 1));
    let Ok(values) = collect_numbers(ctx, &a[..1]) else {
        return Operand::error(CellError::Value);
    };
    if values.is_empty() {
        return Operand::error(CellError::Num);
    }
    let n = values.len() as f64;
    let sample_mean = values.iter().sum::<f64>() / n;
    let sd = match opt_num(ctx, a, 2, f64::NAN) {
        Ok(v) if v.is_finite() => v,
        _ => {
            let m = sample_mean;
            (values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (n - 1.0)).sqrt()
        }
    };
    if sd <= 0.0 {
        return Operand::error(CellError::Div0);
    }
    probability(1.0 - normal_cdf((sample_mean - mu) / (sd / n.sqrt())))
}

fn chisq_test(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    let observed = a[0].to_array(ctx.wb);
    let expected = a[1].to_array(ctx.wb);
    if observed.rows() != expected.rows() || observed.cols() != expected.cols() {
        return Operand::error(CellError::NA);
    }
    let mut statistic = 0.0;
    for (o, e) in observed.values().zip(expected.values()) {
        let (Value::Number(o), Value::Number(e)) = (o, e) else { continue };
        if *e == 0.0 {
            return Operand::error(CellError::Div0);
        }
        statistic += (o - e).powi(2) / e;
    }
    // A single row or column has one dimension of freedom, not two.
    let df = if observed.rows() == 1 || observed.cols() == 1 {
        (observed.rows() * observed.cols()) as f64 - 1.0
    } else {
        ((observed.rows() - 1) * (observed.cols() - 1)) as f64
    };
    if df < 1.0 {
        return Operand::error(CellError::NA);
    }
    probability(gamma_q(df / 2.0, statistic / 2.0))
}

/// Sample mean and unbiased variance of an operand's numbers.
fn sample_stats(ctx: &EvalCtx, operand: &Operand) -> Option<(f64, f64, f64)> {
    let values = collect_numbers(ctx, std::slice::from_ref(operand)).ok()?;
    if values.len() < 2 {
        return None;
    }
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n - 1.0);
    Some((n, mean, variance))
}

fn f_test(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    let (Some((n1, _, v1)), Some((n2, _, v2))) =
        (sample_stats(ctx, &a[0]), sample_stats(ctx, &a[1]))
    else {
        return Operand::error(CellError::Div0);
    };
    if v1 == 0.0 || v2 == 0.0 {
        return Operand::error(CellError::Div0);
    }
    // The two-tailed p-value, computed from whichever ratio exceeds one so the
    // tail is the upper one.
    let (ratio, d1, d2) =
        if v1 > v2 { (v1 / v2, n1 - 1.0, n2 - 1.0) } else { (v2 / v1, n2 - 1.0, n1 - 1.0) };
    probability(2.0 * (1.0 - f_cdf(ratio, d1, d2)))
}

fn t_test(ctx: &EvalCtx, a: &[Operand]) -> Operand {
    args!(tails = arg_num(ctx, a, 2), kind = arg_num(ctx, a, 3));
    if !(1.0..=2.0).contains(&tails) || !(1.0..=3.0).contains(&kind) {
        return Operand::error(CellError::Num);
    }
    let (Some((n1, m1, v1)), Some((n2, m2, v2))) =
        (sample_stats(ctx, &a[0]), sample_stats(ctx, &a[1]))
    else {
        return Operand::error(CellError::Div0);
    };
    let (t, df) = match kind.trunc() as i64 {
        1 => {
            // Paired: the test is on the differences, so the samples must line
            // up element by element.
            let (x, y) = (a[0].to_array(ctx.wb), a[1].to_array(ctx.wb));
            let mut differences = Vec::new();
            for (a, b) in x.values().zip(y.values()) {
                if let (Value::Number(a), Value::Number(b)) = (a, b) {
                    differences.push(a - b);
                }
            }
            if differences.len() < 2 {
                return Operand::error(CellError::NA);
            }
            let n = differences.len() as f64;
            let mean = differences.iter().sum::<f64>() / n;
            let variance =
                differences.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
            if variance == 0.0 {
                return Operand::error(CellError::Div0);
            }
            (mean / (variance / n).sqrt(), n - 1.0)
        }
        2 => {
            // Equal variances: pool them.
            let df = n1 + n2 - 2.0;
            let pooled = ((n1 - 1.0) * v1 + (n2 - 1.0) * v2) / df;
            if pooled == 0.0 {
                return Operand::error(CellError::Div0);
            }
            ((m1 - m2) / (pooled * (1.0 / n1 + 1.0 / n2)).sqrt(), df)
        }
        _ => {
            // Welch's test, with the Satterthwaite degrees of freedom.
            let se = v1 / n1 + v2 / n2;
            if se == 0.0 {
                return Operand::error(CellError::Div0);
            }
            let df = se * se
                / ((v1 / n1).powi(2) / (n1 - 1.0) + (v2 / n2).powi(2) / (n2 - 1.0));
            ((m1 - m2) / se.sqrt(), df)
        }
    };
    probability(tails.trunc() * (1.0 - t_cdf(t.abs(), df)))
}
