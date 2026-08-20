//! Financial functions.
//!
//! The annuity family shares one sign convention, and it is worth stating
//! because it trips people up: money paid out is negative and money received is
//! positive. `PMT` on a loan is negative because you pay it, and `PV` of a
//! savings plan is negative because you put the money in.

use super::args;
use super::*;
use crate::datetime::year_fraction;
use crate::operand::Operand;

/// Whether payments fall at the end (0) or the start (1) of each period.
fn due_at_start(kind: f64) -> f64 {
    if kind != 0.0 {
        1.0
    } else {
        0.0
    }
}

/// The future value of an annuity — the identity every other function here is
/// rearranged from.
fn future_value(rate: f64, nper: f64, pmt: f64, pv: f64, kind: f64) -> f64 {
    let at_start = due_at_start(kind);
    if rate == 0.0 {
        return -(pv + pmt * nper);
    }
    let growth = (1.0 + rate).powf(nper);
    -(pv * growth + pmt * (1.0 + rate * at_start) * (growth - 1.0) / rate)
}

fn present_value(rate: f64, nper: f64, pmt: f64, fv: f64, kind: f64) -> f64 {
    let at_start = due_at_start(kind);
    if rate == 0.0 {
        return -(fv + pmt * nper);
    }
    let growth = (1.0 + rate).powf(nper);
    -(fv + pmt * (1.0 + rate * at_start) * (growth - 1.0) / rate) / growth
}

fn payment(rate: f64, nper: f64, pv: f64, fv: f64, kind: f64) -> Result<f64, CellError> {
    if nper == 0.0 {
        return Err(CellError::Num);
    }
    let at_start = due_at_start(kind);
    if rate == 0.0 {
        return Ok(-(pv + fv) / nper);
    }
    let growth = (1.0 + rate).powf(nper);
    Ok(-(pv * growth + fv) * rate / ((1.0 + rate * at_start) * (growth - 1.0)))
}

/// The interest portion of one payment.
fn interest_payment(
    rate: f64,
    period: f64,
    nper: f64,
    pv: f64,
    fv: f64,
    kind: f64,
) -> Result<f64, CellError> {
    if period < 1.0 || period > nper {
        return Err(CellError::Num);
    }
    let pmt = payment(rate, nper, pv, fv, kind)?;
    // The balance the interest is charged on is the future value after the
    // preceding payments.
    // `future_value` already returns the balance with the sign convention
    // applied — it is negative while money is owed — so the interest charged on
    // it comes out negative too, as a payment should.
    let balance = future_value(rate, period - 1.0, pmt, pv, kind);
    let interest = balance * rate;
    Ok(if due_at_start(kind) == 1.0 {
        // With payments at the start of the period, the first one carries no
        // interest and the rest are discounted by one period.
        if period == 1.0 {
            0.0
        } else {
            interest / (1.0 + rate)
        }
    } else {
        interest
    })
}

/// Net present value of a series of cash flows, the first one period away.
fn npv(rate: f64, flows: &[f64]) -> f64 {
    flows.iter().enumerate().map(|(i, v)| v / (1.0 + rate).powi(i as i32 + 1)).sum()
}

/// Solves `f(rate) = 0` by bisection over a wide bracket.
///
/// The rate functions are solved this way rather than with Newton because a
/// cash-flow series can have a derivative that sends Newton off to a rate below
/// -100%, where the powers are not even defined.
fn solve_rate(f: impl Fn(f64) -> f64) -> Option<f64> {
    let (mut low, mut high) = (-0.999_999, 10.0);
    let (mut f_low, mut f_high) = (f(low), f(high));
    // Widen upwards while the sign has not changed; beyond a 10000% rate there
    // is nothing sensible to find.
    let mut guard = 0;
    while f_low.signum() == f_high.signum() {
        high *= 2.0;
        f_high = f(high);
        guard += 1;
        if guard > 20 || !f_high.is_finite() {
            return None;
        }
    }
    for _ in 0..200 {
        let mid = (low + high) / 2.0;
        let value = f(mid);
        if !value.is_finite() {
            return None;
        }
        if value.signum() == f_low.signum() {
            low = mid;
            f_low = value;
        } else {
            high = mid;
        }
        if (high - low).abs() < 1e-12 {
            break;
        }
    }
    Some((low + high) / 2.0)
}

/// The cash flows and dates of an `XIRR`-style call.
fn flows_and_dates(ctx: &EvalCtx, a: &[Operand]) -> Result<(Vec<f64>, Vec<f64>), CellError> {
    let values = collect_numbers(ctx, &a[..1])?;
    let dates = collect_numbers(ctx, &a[1..2])?;
    if values.len() != dates.len() || values.is_empty() {
        return Err(CellError::Num);
    }
    Ok((values, dates))
}

/// Present value of dated cash flows discounted on an actual/365 basis.
fn xnpv(rate: f64, values: &[f64], dates: &[f64]) -> f64 {
    let start = dates[0];
    values
        .iter()
        .zip(dates)
        .map(|(v, d)| v / (1.0 + rate).powf((d - start) / 365.0))
        .sum()
}

pub const FUNCTIONS: &[Function] = &[
    // --- annuities ----------------------------------------------------------
    f("FV", 3, Some(5), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            nper = arg_num(ctx, a, 1),
            pmt = arg_num(ctx, a, 2),
            pv = opt_num(ctx, a, 3, 0.0),
            kind = opt_num(ctx, a, 4, 0.0),
        );
        number(future_value(rate, nper, pmt, pv, kind))
    }),
    f("PV", 3, Some(5), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            nper = arg_num(ctx, a, 1),
            pmt = arg_num(ctx, a, 2),
            fv = opt_num(ctx, a, 3, 0.0),
            kind = opt_num(ctx, a, 4, 0.0),
        );
        number(present_value(rate, nper, pmt, fv, kind))
    }),
    f("PMT", 3, Some(5), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            nper = arg_num(ctx, a, 1),
            pv = arg_num(ctx, a, 2),
            fv = opt_num(ctx, a, 3, 0.0),
            kind = opt_num(ctx, a, 4, 0.0),
        );
        match payment(rate, nper, pv, fv, kind) {
            Ok(v) => number(v),
            Err(e) => Operand::error(e),
        }
    }),
    f("IPMT", 4, Some(6), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            period = arg_num(ctx, a, 1),
            nper = arg_num(ctx, a, 2),
            pv = arg_num(ctx, a, 3),
            fv = opt_num(ctx, a, 4, 0.0),
            kind = opt_num(ctx, a, 5, 0.0),
        );
        match interest_payment(rate, period, nper, pv, fv, kind) {
            Ok(v) => number(v),
            Err(e) => Operand::error(e),
        }
    }),
    f("PPMT", 4, Some(6), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            period = arg_num(ctx, a, 1),
            nper = arg_num(ctx, a, 2),
            pv = arg_num(ctx, a, 3),
            fv = opt_num(ctx, a, 4, 0.0),
            kind = opt_num(ctx, a, 5, 0.0),
        );
        // The principal portion is whatever the payment is not interest.
        match (payment(rate, nper, pv, fv, kind), interest_payment(rate, period, nper, pv, fv, kind))
        {
            (Ok(pmt), Ok(interest)) => number(pmt - interest),
            (Err(e), _) | (_, Err(e)) => Operand::error(e),
        }
    }),
    f("NPER", 3, Some(5), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            pmt = arg_num(ctx, a, 1),
            pv = arg_num(ctx, a, 2),
            fv = opt_num(ctx, a, 3, 0.0),
            kind = opt_num(ctx, a, 4, 0.0),
        );
        if rate == 0.0 {
            if pmt == 0.0 {
                return Operand::error(CellError::Num);
            }
            return number(-(pv + fv) / pmt);
        }
        let adjusted = pmt * (1.0 + rate * due_at_start(kind));
        let numerator = adjusted - fv * rate;
        let denominator = pv * rate + adjusted;
        // Only the ratio has to be positive for the logarithm to exist; the two
        // sides are normally both negative, because the payment and the balance
        // point in opposite directions.
        let ratio = numerator / denominator;
        if !ratio.is_finite() || ratio <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number(ratio.ln() / (1.0 + rate).ln())
    }),
    f("RATE", 3, Some(6), |ctx, a| {
        args!(
            nper = arg_num(ctx, a, 0),
            pmt = arg_num(ctx, a, 1),
            pv = arg_num(ctx, a, 2),
            fv = opt_num(ctx, a, 3, 0.0),
            kind = opt_num(ctx, a, 4, 0.0),
        );
        match solve_rate(|rate| future_value(rate, nper, pmt, pv, kind) - fv) {
            Some(rate) => number(rate),
            None => Operand::error(CellError::Num),
        }
    }),
    f("ISPMT", 4, Some(4), |ctx, a| {
        args!(
            rate = arg_num(ctx, a, 0),
            period = arg_num(ctx, a, 1),
            nper = arg_num(ctx, a, 2),
            pv = arg_num(ctx, a, 3),
        );
        if nper == 0.0 {
            return Operand::error(CellError::Num);
        }
        // Straight-line principal repayment, so the interest falls evenly.
        number(-pv * rate * (1.0 - period / nper))
    }),
    f("CUMIPMT", 6, Some(6), |ctx, a| cumulative(ctx, a, true)),
    f("CUMPRINC", 6, Some(6), |ctx, a| cumulative(ctx, a, false)),

    // --- cash flows ---------------------------------------------------------
    f("NPV", 2, None, |ctx, a| {
        args!(rate = arg_num(ctx, a, 0));
        if rate == -1.0 {
            return Operand::error(CellError::Num);
        }
        match collect_numbers(ctx, &a[1..]) {
            Ok(flows) => number(npv(rate, &flows)),
            Err(e) => Operand::error(e),
        }
    }),
    f("IRR", 1, Some(2), |ctx, a| {
        let Ok(flows) = collect_numbers(ctx, &a[..1]) else {
            return Operand::error(CellError::Value);
        };
        if flows.len() < 2 {
            return Operand::error(CellError::Num);
        }
        // The whole series is discounted, including the flow at time zero.
        match solve_rate(|rate| flows[0] + npv(rate, &flows[1..])) {
            Some(rate) => number(rate),
            None => Operand::error(CellError::Num),
        }
    }),
    f("MIRR", 3, Some(3), |ctx, a| {
        args!(finance_rate = arg_num(ctx, a, 1), reinvest_rate = arg_num(ctx, a, 2));
        let Ok(flows) = collect_numbers(ctx, &a[..1]) else {
            return Operand::error(CellError::Value);
        };
        let n = flows.len() as f64;
        if n < 2.0 {
            return Operand::error(CellError::Div0);
        }
        // Costs are discounted at the finance rate, returns compounded at the
        // reinvestment rate.
        let costs: f64 = flows
            .iter()
            .enumerate()
            .filter(|(_, v)| **v < 0.0)
            .map(|(i, v)| v / (1.0 + finance_rate).powi(i as i32))
            .sum();
        let returns: f64 = flows
            .iter()
            .enumerate()
            .filter(|(_, v)| **v > 0.0)
            .map(|(i, v)| v * (1.0 + reinvest_rate).powi((n as i32 - 1) - i as i32))
            .sum();
        if costs == 0.0 {
            return Operand::error(CellError::Div0);
        }
        number((-returns / costs).powf(1.0 / (n - 1.0)) - 1.0)
    }),
    array_fn("XNPV", 3, Some(3), |ctx, a| {
        args!(rate = arg_num(ctx, a, 0));
        match flows_and_dates(ctx, &a[1..]) {
            Ok((values, dates)) => number(xnpv(rate, &values, &dates)),
            Err(e) => Operand::error(e),
        }
    }),
    array_fn("XIRR", 2, Some(3), |ctx, a| match flows_and_dates(ctx, a) {
        Ok((values, dates)) => match solve_rate(|rate| xnpv(rate, &values, &dates)) {
            Some(rate) => number(rate),
            None => Operand::error(CellError::Num),
        },
        Err(e) => Operand::error(e),
    }),
    f("FVSCHEDULE", 2, Some(2), |ctx, a| {
        args!(principal = arg_num(ctx, a, 0));
        match collect_numbers(ctx, &a[1..2]) {
            Ok(rates) => number(rates.iter().fold(principal, |acc, r| acc * (1.0 + r))),
            Err(e) => Operand::error(e),
        }
    }),

    // --- depreciation --------------------------------------------------------
    f("SLN", 3, Some(3), |ctx, a| {
        args!(cost = arg_num(ctx, a, 0), salvage = arg_num(ctx, a, 1), life = arg_num(ctx, a, 2));
        if life == 0.0 {
            return Operand::error(CellError::Div0);
        }
        number((cost - salvage) / life)
    }),
    f("SYD", 4, Some(4), |ctx, a| {
        args!(
            cost = arg_num(ctx, a, 0),
            salvage = arg_num(ctx, a, 1),
            life = arg_num(ctx, a, 2),
            period = arg_num(ctx, a, 3),
        );
        if life <= 0.0 || period < 1.0 || period > life {
            return Operand::error(CellError::Num);
        }
        // Sum-of-years' digits: the remaining life over the triangular number.
        number((cost - salvage) * (life - period + 1.0) * 2.0 / (life * (life + 1.0)))
    }),
    f("DDB", 4, Some(5), |ctx, a| {
        args!(
            cost = arg_num(ctx, a, 0),
            salvage = arg_num(ctx, a, 1),
            life = arg_num(ctx, a, 2),
            period = arg_num(ctx, a, 3),
            factor = opt_num(ctx, a, 4, 2.0),
        );
        if life <= 0.0 || period < 1.0 || factor <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number(declining_balance(cost, salvage, life, period, factor))
    }),
    f("DB", 4, Some(5), |ctx, a| {
        args!(
            cost = arg_num(ctx, a, 0),
            salvage = arg_num(ctx, a, 1),
            life = arg_num(ctx, a, 2),
            period = arg_num(ctx, a, 3),
            month = opt_num(ctx, a, 4, 12.0),
        );
        if cost <= 0.0 || life <= 0.0 || period < 1.0 || !(1.0..=12.0).contains(&month) {
            return Operand::error(CellError::Num);
        }
        // The fixed rate is rounded to three decimals. That rounding is part
        // of DB's definition, not a shortcut — leaving it out gives numbers
        // that drift from every other spreadsheet's.
        let rate = ((1.0 - (salvage / cost).powf(1.0 / life)) * 1000.0).round() / 1000.0;
        let first = cost * rate * month / 12.0;
        if period == 1.0 {
            return number(first);
        }
        let mut total = first;
        let mut result = 0.0;
        for _ in 2..=(period.trunc() as i64) {
            result = (cost - total) * rate;
            total += result;
        }
        // The final partial period covers the rest of the last year.
        if period > life {
            result = (cost - total + result) * rate * (12.0 - month) / 12.0;
        }
        number(result)
    }),
    f("VDB", 5, Some(7), |ctx, a| {
        args!(
            cost = arg_num(ctx, a, 0),
            salvage = arg_num(ctx, a, 1),
            life = arg_num(ctx, a, 2),
            start = arg_num(ctx, a, 3),
            end = arg_num(ctx, a, 4),
            factor = opt_num(ctx, a, 5, 2.0),
        );
        let no_switch = arg_bool(ctx, a, 6).unwrap_or(false);
        if life <= 0.0 || start < 0.0 || end < start || end > life {
            return Operand::error(CellError::Num);
        }
        let mut total = 0.0;
        let mut accumulated = 0.0;
        let mut period = 1.0;
        while period <= life {
            let declining = declining_balance(cost, salvage, life, period, factor);
            // Once straight-line over the remaining life is larger, VDB
            // switches to it — unless the caller says not to.
            let straight_line = (cost - accumulated - salvage) / (life - period + 1.0);
            let amount = if !no_switch && straight_line > declining { straight_line } else { declining };
            let overlap = (period.min(end) - (period - 1.0).max(start)).max(0.0);
            total += amount * overlap;
            accumulated += amount;
            period += 1.0;
        }
        number(total)
    }),

    // --- rates ---------------------------------------------------------------
    f("EFFECT", 2, Some(2), |ctx, a| {
        args!(nominal = arg_num(ctx, a, 0), periods = arg_num(ctx, a, 1));
        if nominal <= 0.0 || periods < 1.0 {
            return Operand::error(CellError::Num);
        }
        let periods = periods.trunc();
        number((1.0 + nominal / periods).powf(periods) - 1.0)
    }),
    f("NOMINAL", 2, Some(2), |ctx, a| {
        args!(effective = arg_num(ctx, a, 0), periods = arg_num(ctx, a, 1));
        if effective <= 0.0 || periods < 1.0 {
            return Operand::error(CellError::Num);
        }
        let periods = periods.trunc();
        number(((effective + 1.0).powf(1.0 / periods) - 1.0) * periods)
    }),
    f("RRI", 3, Some(3), |ctx, a| {
        args!(nper = arg_num(ctx, a, 0), pv = arg_num(ctx, a, 1), fv = arg_num(ctx, a, 2));
        if nper <= 0.0 || pv == 0.0 {
            return Operand::error(CellError::Num);
        }
        number((fv / pv).powf(1.0 / nper) - 1.0)
    }),
    f("PDURATION", 3, Some(3), |ctx, a| {
        args!(rate = arg_num(ctx, a, 0), pv = arg_num(ctx, a, 1), fv = arg_num(ctx, a, 2));
        if rate <= 0.0 || pv <= 0.0 || fv <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number((fv.ln() - pv.ln()) / (1.0 + rate).ln())
    }),
    f("DOLLARDE", 2, Some(2), |ctx, a| {
        args!(fractional = arg_num(ctx, a, 0), fraction = arg_num(ctx, a, 1));
        if fraction < 1.0 {
            return Operand::error(CellError::Num);
        }
        let fraction = fraction.trunc();
        let whole = fractional.trunc();
        // The fractional digits are read in the given base, so 1.02 in
        // thirty-seconds is 1 + 2/32.
        let digits = fraction.log10().ceil().max(1.0);
        number(whole + (fractional - whole) * 10f64.powf(digits) / fraction)
    }),
    f("DOLLARFR", 2, Some(2), |ctx, a| {
        args!(decimal = arg_num(ctx, a, 0), fraction = arg_num(ctx, a, 1));
        if fraction < 1.0 {
            return Operand::error(CellError::Num);
        }
        let fraction = fraction.trunc();
        let whole = decimal.trunc();
        let digits = fraction.log10().ceil().max(1.0);
        number(whole + (decimal - whole) * fraction / 10f64.powf(digits))
    }),

    // --- discounted securities ------------------------------------------------
    f("DISC", 4, Some(5), |ctx, a| {
        args!(price = arg_num(ctx, a, 2), redemption = arg_num(ctx, a, 3));
        let Some(fraction) = settlement_fraction(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        if redemption <= 0.0 || fraction <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number((redemption - price) / redemption / fraction)
    }),
    f("INTRATE", 4, Some(5), |ctx, a| {
        args!(investment = arg_num(ctx, a, 2), redemption = arg_num(ctx, a, 3));
        let Some(fraction) = settlement_fraction(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        if investment <= 0.0 || fraction <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number((redemption - investment) / investment / fraction)
    }),
    f("RECEIVED", 4, Some(5), |ctx, a| {
        args!(investment = arg_num(ctx, a, 2), discount = arg_num(ctx, a, 3));
        let Some(fraction) = settlement_fraction(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        let denominator = 1.0 - discount * fraction;
        if denominator == 0.0 {
            return Operand::error(CellError::Num);
        }
        number(investment / denominator)
    }),
    f("PRICEDISC", 4, Some(5), |ctx, a| {
        args!(discount = arg_num(ctx, a, 2), redemption = arg_num(ctx, a, 3));
        let Some(fraction) = settlement_fraction(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        number(redemption * (1.0 - discount * fraction))
    }),
    f("YIELDDISC", 4, Some(5), |ctx, a| {
        args!(price = arg_num(ctx, a, 2), redemption = arg_num(ctx, a, 3));
        let Some(fraction) = settlement_fraction(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        if price <= 0.0 || fraction <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number((redemption - price) / price / fraction)
    }),
    f("ACCRINTM", 4, Some(5), |ctx, a| {
        args!(rate = arg_num(ctx, a, 2), par = arg_num(ctx, a, 3));
        let Some(fraction) = settlement_fraction(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        if rate <= 0.0 || par <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number(par * rate * fraction)
    }),
    f("TBILLPRICE", 3, Some(3), |ctx, a| {
        args!(discount = arg_num(ctx, a, 2));
        let Some(days) = tbill_days(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        if discount <= 0.0 {
            return Operand::error(CellError::Num);
        }
        // Treasury bills are quoted on a 360-day year by convention.
        number(100.0 * (1.0 - discount * days / 360.0))
    }),
    f("TBILLYIELD", 3, Some(3), |ctx, a| {
        args!(price = arg_num(ctx, a, 2));
        let Some(days) = tbill_days(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        if price <= 0.0 {
            return Operand::error(CellError::Num);
        }
        number((100.0 - price) / price * 360.0 / days)
    }),
    f("TBILLEQ", 3, Some(3), |ctx, a| {
        args!(discount = arg_num(ctx, a, 2));
        let Some(days) = tbill_days(ctx, a) else {
            return Operand::error(CellError::Num);
        };
        let denominator = 360.0 - discount * days;
        if denominator <= 0.0 {
            return Operand::error(CellError::Num);
        }
        // The bond-equivalent yield puts a discount quote on a 365-day footing.
        number(365.0 * discount / denominator)
    }),
];

/// One period of double-declining depreciation.
fn declining_balance(cost: f64, salvage: f64, life: f64, period: f64, factor: f64) -> f64 {
    let rate = factor / life;
    let mut accumulated = 0.0;
    let mut amount = 0.0;
    for _ in 1..=(period.trunc() as i64) {
        amount = ((cost - accumulated) * rate).min(cost - salvage - accumulated).max(0.0);
        accumulated += amount;
    }
    amount
}

fn cumulative(ctx: &EvalCtx, a: &[Operand], interest: bool) -> Operand {
    args!(
        rate = arg_num(ctx, a, 0),
        nper = arg_num(ctx, a, 1),
        pv = arg_num(ctx, a, 2),
        start = arg_num(ctx, a, 3),
        end = arg_num(ctx, a, 4),
        kind = arg_num(ctx, a, 5),
    );
    if rate <= 0.0 || nper <= 0.0 || pv <= 0.0 || start < 1.0 || end < start || end > nper {
        return Operand::error(CellError::Num);
    }
    let pmt = match payment(rate, nper, pv, 0.0, kind) {
        Ok(v) => v,
        Err(e) => return Operand::error(e),
    };
    let mut total = 0.0;
    for period in (start.trunc() as i64)..=(end.trunc() as i64) {
        match interest_payment(rate, period as f64, nper, pv, 0.0, kind) {
            Ok(paid) => total += if interest { paid } else { pmt - paid },
            Err(e) => return Operand::error(e),
        }
    }
    number(total)
}

/// The year fraction between the settlement and maturity dates that the
/// discounted-security functions all begin with.
fn settlement_fraction(ctx: &EvalCtx, a: &[Operand]) -> Option<f64> {
    let settlement = arg_num(ctx, a, 0).ok()?;
    let maturity = arg_num(ctx, a, 1).ok()?;
    if maturity <= settlement {
        return None;
    }
    let basis = opt_num(ctx, a, 4, 0.0).ok()?.trunc() as i64;
    year_fraction(settlement, maturity, basis).ok()
}

/// Days between settlement and maturity for a treasury bill, which must be
/// within one year.
fn tbill_days(ctx: &EvalCtx, a: &[Operand]) -> Option<f64> {
    let settlement = arg_num(ctx, a, 0).ok()?.floor();
    let maturity = arg_num(ctx, a, 1).ok()?.floor();
    let days = maturity - settlement;
    if days <= 0.0 || days > 366.0 {
        return None;
    }
    // The quote convention counts calendar days, not 30/360 ones.
    Some(days)
}
