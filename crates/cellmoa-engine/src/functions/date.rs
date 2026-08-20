//! Date and time functions.

use super::args;
use super::*;
use crate::datetime::*;
use crate::operand::Operand;

/// Argument `i` read as a date serial.
fn arg_serial(ctx: &EvalCtx, a: &[Operand], i: usize) -> Result<f64, CellError> {
    let n = arg_num(ctx, a, i)?;
    if n < 0.0 {
        return Err(CellError::Num);
    }
    Ok(n)
}

/// The extra dates a `NETWORKDAYS` or `WORKDAY` call excludes.
fn holidays(ctx: &EvalCtx, a: &[Operand], from: usize) -> Vec<i64> {
    let mut out = Vec::new();
    for operand in a.iter().skip(from) {
        operand.for_each(ctx.wb, &mut |v| {
            if let Value::Number(n) = v {
                out.push(n.floor() as i64);
            }
        });
    }
    out
}

/// Which days of the week are the weekend, as a Monday-first mask.
///
/// The argument is either one of Excel's numeric codes or a seven-character
/// string of `0`/`1` starting on Monday.
fn weekend_mask(value: &Value) -> Result<[bool; 7], CellError> {
    if let Value::Text(spec) = value {
        if spec.len() == 7 && spec.bytes().all(|b| b == b'0' || b == b'1') {
            let mut mask = [false; 7];
            for (i, b) in spec.bytes().enumerate() {
                mask[i] = b == b'1';
            }
            if mask.iter().all(|d| *d) {
                // A week with no working days would never terminate.
                return Err(CellError::Value);
            }
            return Ok(mask);
        }
        return Err(CellError::Value);
    }
    let code = value.coerce_number().unwrap_or(1.0).trunc() as i64;
    let mut mask = [false; 7];
    // Codes 1-7 are two-day weekends rolling forward from Saturday/Sunday;
    // codes 11-17 are the single-day weekends starting at Sunday.
    match code {
        1 => mask[5..7].copy_from_slice(&[true, true]),
        2..=7 => {
            let start = (code as usize + 4) % 7;
            mask[start] = true;
            mask[(start + 1) % 7] = true;
        }
        11..=17 => mask[(code as usize - 11 + 6) % 7] = true,
        _ => return Err(CellError::Num),
    }
    Ok(mask)
}

fn is_working_day(serial: i64, mask: &[bool; 7], holidays: &[i64]) -> bool {
    let Ok(weekday) = weekday_from_serial(serial as f64) else { return false };
    !mask[weekday as usize] && !holidays.contains(&serial)
}

/// Days between two dates under one of the 30/360 conventions.
fn days_360(start: (i64, u32, u32), end: (i64, u32, u32), european: bool) -> f64 {
    let (y1, m1, mut d1) = start;
    let (y2, m2, mut d2) = end;
    if european {
        d1 = d1.min(30);
        d2 = d2.min(30);
    } else {
        // The US convention only pulls the end date back when the start date
        // was also at the end of a month.
        if d1 == 31 {
            d1 = 30;
        }
        if d2 == 31 && d1 == 30 {
            d2 = 30;
        }
    }
    ((y2 - y1) * 360 + (m2 as i64 - m1 as i64) * 30 + (d2 as i64 - d1 as i64)) as f64
}

/// The year fraction between two dates under one of the day-count bases.
fn year_fraction(start: f64, end: f64, basis: i64) -> Result<f64, CellError> {
    let (a, b) = if start <= end { (start, end) } else { (end, start) };
    let (sy, sm, sd) = ymd_from_serial(a)?;
    let (ey, em, ed) = ymd_from_serial(b)?;
    Ok(match basis {
        0 => days_360((sy, sm, sd), (ey, em, ed), false) / 360.0,
        1 => {
            // Actual days over the average length of the years spanned.
            let years = (ey - sy + 1) as f64;
            let leap_days: i64 = (sy..=ey).filter(|y| is_leap_year(*y)).count() as i64;
            let average = (365.0 * years + leap_days as f64) / years;
            (b.floor() - a.floor()) / average
        }
        2 => (b.floor() - a.floor()) / 360.0,
        3 => (b.floor() - a.floor()) / 365.0,
        4 => days_360((sy, sm, sd), (ey, em, ed), true) / 360.0,
        _ => return Err(CellError::Num),
    })
}

pub const FUNCTIONS: &[Function] = &[
    f("DATE", 3, Some(3), |ctx, a| {
        args!(y = arg_num(ctx, a, 0), m = arg_num(ctx, a, 1), d = arg_num(ctx, a, 2));
        match serial_from_parts(y.trunc() as i64, m.trunc() as i64, d.trunc() as i64) {
            Ok(serial) => Operand::number(serial),
            Err(e) => Operand::error(e),
        }
    }),
    f("TIME", 3, Some(3), |ctx, a| {
        args!(h = arg_num(ctx, a, 0), m = arg_num(ctx, a, 1), s = arg_num(ctx, a, 2));
        let seconds = h.trunc() * 3600.0 + m.trunc() * 60.0 + s.trunc();
        if seconds < 0.0 {
            return Operand::error(CellError::Num);
        }
        // Times past midnight wrap, so TIME(25,0,0) is 1:00. Taking the
        // remainder in whole seconds before dividing keeps that identical to
        // TIME(1,0,0) rather than a rounding error away from it.
        Operand::number((seconds as i64 % 86_400) as f64 / 86_400.0)
    }),
    volatile("TODAY", 0, Some(0), |ctx, _| match ctx.now {
        Some(now) => Operand::number(now.floor()),
        None => Operand::error(CellError::NA),
    }),
    volatile("NOW", 0, Some(0), |ctx, _| match ctx.now {
        Some(now) => Operand::number(now),
        None => Operand::error(CellError::NA),
    }),
    f("YEAR", 1, Some(1), |ctx, a| date_part(ctx, a, |(y, _, _)| y as f64)),
    f("MONTH", 1, Some(1), |ctx, a| date_part(ctx, a, |(_, m, _)| m as f64)),
    f("DAY", 1, Some(1), |ctx, a| date_part(ctx, a, |(_, _, d)| d as f64)),
    f("HOUR", 1, Some(1), |ctx, a| time_part(ctx, a, |(h, _, _)| h as f64)),
    f("MINUTE", 1, Some(1), |ctx, a| time_part(ctx, a, |(_, m, _)| m as f64)),
    f("SECOND", 1, Some(1), |ctx, a| time_part(ctx, a, |(_, _, s)| s as f64)),
    f("WEEKDAY", 1, Some(2), |ctx, a| {
        args!(serial = arg_serial(ctx, a, 0), kind = opt_num(ctx, a, 1, 1.0));
        let Ok(monday_based) = weekday_from_serial(serial) else {
            return Operand::error(CellError::Num);
        };
        // Everything is computed from a Monday-first index and then shifted
        // into whichever numbering the caller asked for.
        let sunday_based = (monday_based + 1) % 7;
        let result = match kind.trunc() as i64 {
            1 => sunday_based as f64 + 1.0,
            2 => monday_based as f64 + 1.0,
            3 => monday_based as f64,
            11 => monday_based as f64 + 1.0,
            n @ 12..=17 => ((monday_based + 7 - (n as u32 - 11)) % 7) as f64 + 1.0,
            _ => return Operand::error(CellError::Num),
        };
        Operand::number(result)
    }),
    f("WEEKNUM", 1, Some(2), |ctx, a| {
        args!(serial = arg_serial(ctx, a, 0), kind = opt_num(ctx, a, 1, 1.0));
        let Ok((year, _, _)) = ymd_from_serial(serial) else {
            return Operand::error(CellError::Num);
        };
        let Ok(jan1) = serial_from_ymd(year, 1, 1) else {
            return Operand::error(CellError::Num);
        };
        let Ok(first_weekday) = weekday_from_serial(jan1) else {
            return Operand::error(CellError::Num);
        };
        // Week 1 is the week containing 1 January; the numbering only differs
        // in which day starts a week.
        let start_offset = match kind.trunc() as i64 {
            1 | 17 => (first_weekday + 1) % 7,
            2 | 11 => first_weekday,
            n @ 12..=16 => (first_weekday + 7 - (n as u32 - 11)) % 7,
            21 => return iso_week(serial),
            _ => return Operand::error(CellError::Num),
        };
        let day_of_year = serial - jan1;
        Operand::number(((day_of_year + start_offset as f64) / 7.0).floor() + 1.0)
    }),
    f("ISOWEEKNUM", 1, Some(1), |ctx, a| {
        args!(serial = arg_serial(ctx, a, 0));
        iso_week(serial)
    }),
    f("EDATE", 2, Some(2), |ctx, a| {
        args!(serial = arg_serial(ctx, a, 0), months = arg_num(ctx, a, 1));
        let Ok((y, m, d)) = ymd_from_serial(serial) else {
            return Operand::error(CellError::Num);
        };
        // The day is clamped to the target month's length: one month after
        // 31 January is 28 or 29 February, not 3 March.
        let shifted = m as i64 - 1 + months.trunc() as i64;
        let (ty, tm) = (y + shifted.div_euclid(12), shifted.rem_euclid(12) as u32 + 1);
        let last = match end_of_month(serial_from_ymd(ty, tm, 1).unwrap_or(1.0), 0) {
            Ok(serial) => ymd_from_serial(serial).map(|(_, _, d)| d).unwrap_or(28),
            Err(e) => return Operand::error(e),
        };
        match serial_from_ymd(ty, tm, d.min(last)) {
            Ok(serial) => Operand::number(serial),
            Err(e) => Operand::error(e),
        }
    }),
    f("EOMONTH", 2, Some(2), |ctx, a| {
        args!(serial = arg_serial(ctx, a, 0), months = arg_num(ctx, a, 1));
        match end_of_month(serial, months.trunc() as i64) {
            Ok(serial) => Operand::number(serial),
            Err(e) => Operand::error(e),
        }
    }),
    f("DAYS", 2, Some(2), |ctx, a| {
        args!(end = arg_serial(ctx, a, 0), start = arg_serial(ctx, a, 1));
        Operand::number(end.floor() - start.floor())
    }),
    f("DAYS360", 2, Some(3), |ctx, a| {
        args!(start = arg_serial(ctx, a, 0), end = arg_serial(ctx, a, 1));
        let european = arg_bool(ctx, a, 2).unwrap_or(false);
        let (Ok(s), Ok(e)) = (ymd_from_serial(start), ymd_from_serial(end)) else {
            return Operand::error(CellError::Num);
        };
        Operand::number(days_360(s, e, european))
    }),
    f("YEARFRAC", 2, Some(3), |ctx, a| {
        args!(
            start = arg_serial(ctx, a, 0),
            end = arg_serial(ctx, a, 1),
            basis = opt_num(ctx, a, 2, 0.0)
        );
        match year_fraction(start, end, basis.trunc() as i64) {
            Ok(v) => number(v),
            Err(e) => Operand::error(e),
        }
    }),
    f("DATEDIF", 3, Some(3), |ctx, a| {
        args!(
            start = arg_serial(ctx, a, 0),
            end = arg_serial(ctx, a, 1),
            unit = arg_text(ctx, a, 2)
        );
        if end < start {
            return Operand::error(CellError::Num);
        }
        let (Ok((sy, sm, sd)), Ok((ey, em, ed))) = (ymd_from_serial(start), ymd_from_serial(end))
        else {
            return Operand::error(CellError::Num);
        };
        // Whole months elapsed, backing off one if the day of month has not
        // come round yet.
        let whole_months = (ey - sy) * 12 + (em as i64 - sm as i64) - i64::from(ed < sd);
        Operand::number(match unit.to_uppercase().as_str() {
            "D" => end.floor() - start.floor(),
            "M" => whole_months as f64,
            "Y" => (whole_months / 12) as f64,
            // The remainder after whole years, in months.
            "YM" => (whole_months % 12) as f64,
            // Days ignoring months and years.
            "MD" => {
                let anchor = if ed >= sd {
                    serial_from_ymd(ey, em, sd)
                } else {
                    let previous = em as i64 - 1;
                    let (py, pm) = if previous == 0 { (ey - 1, 12) } else { (ey, previous as u32) };
                    serial_from_ymd(py, pm, sd)
                };
                match anchor {
                    Ok(anchor) => end.floor() - anchor,
                    Err(e) => return Operand::error(e),
                }
            }
            // Days ignoring years.
            "YD" => {
                let years = whole_months / 12;
                match serial_from_ymd(sy + years, sm, sd) {
                    Ok(anchor) => end.floor() - anchor,
                    Err(e) => return Operand::error(e),
                }
            }
            _ => return Operand::error(CellError::Num),
        })
    }),
    f("NETWORKDAYS", 2, None, |ctx, a| network_days(ctx, a, Value::Number(1.0), 2)),
    f("NETWORKDAYS.INTL", 2, None, |ctx, a| {
        let weekend = arg(ctx, a, 2);
        network_days(ctx, a, weekend, 3)
    }),
    f("WORKDAY", 2, None, |ctx, a| workday(ctx, a, Value::Number(1.0), 2)),
    f("WORKDAY.INTL", 2, None, |ctx, a| {
        let weekend = arg(ctx, a, 2);
        workday(ctx, a, weekend, 3)
    }),
    f("DATEVALUE", 1, Some(1), |ctx, a| {
        args!(text = arg_text(ctx, a, 0));
        match parse_date_text(&text) {
            Some(serial) => Operand::number(serial),
            None => Operand::error(CellError::Value),
        }
    }),
    f("TIMEVALUE", 1, Some(1), |ctx, a| {
        args!(text = arg_text(ctx, a, 0));
        match parse_time_text(&text) {
            Some(fraction) => Operand::number(fraction),
            None => Operand::error(CellError::Value),
        }
    }),
];

fn date_part(ctx: &EvalCtx, a: &[Operand], pick: impl Fn((i64, u32, u32)) -> f64) -> Operand {
    args!(serial = arg_serial(ctx, a, 0));
    match ymd_from_serial(serial) {
        Ok(parts) => Operand::number(pick(parts)),
        Err(e) => Operand::error(e),
    }
}

fn time_part(ctx: &EvalCtx, a: &[Operand], pick: impl Fn((u32, u32, u32)) -> f64) -> Operand {
    args!(serial = arg_serial(ctx, a, 0));
    Operand::number(pick(hms_from_serial(serial)))
}

/// The ISO-8601 week number: weeks start on Monday, and week 1 is the one
/// containing the first Thursday of the year.
fn iso_week(serial: f64) -> Operand {
    let Ok((year, _, _)) = ymd_from_serial(serial) else {
        return Operand::error(CellError::Num);
    };
    let week_of = |year: i64| -> Option<f64> {
        let jan4 = serial_from_ymd(year, 1, 4).ok()?;
        let jan4_weekday = weekday_from_serial(jan4).ok()? as f64;
        // The Monday of the week containing 4 January starts week 1.
        let week1_monday = jan4 - jan4_weekday;
        Some(((serial.floor() - week1_monday) / 7.0).floor() + 1.0)
    };
    match week_of(year) {
        // A date in the first days of January can belong to the last week of
        // the previous year, and one at the very end of December to week 1 of
        // the next.
        Some(week) if week < 1.0 => match week_of(year - 1) {
            Some(week) => Operand::number(week),
            None => Operand::error(CellError::Num),
        },
        Some(week) if week > 52.0 => match week_of(year + 1) {
            Some(next) if next >= 1.0 => Operand::number(next),
            _ => Operand::number(week),
        },
        Some(week) => Operand::number(week),
        None => Operand::error(CellError::Num),
    }
}

fn network_days(ctx: &EvalCtx, a: &[Operand], weekend: Value, holiday_from: usize) -> Operand {
    args!(start = arg_serial(ctx, a, 0), end = arg_serial(ctx, a, 1));
    let mask = match weekend_mask(&weekend) {
        Ok(mask) => mask,
        Err(e) => return Operand::error(e),
    };
    let holidays = holidays(ctx, a, holiday_from);
    let (from, to, sign) = if start <= end {
        (start.floor() as i64, end.floor() as i64, 1.0)
    } else {
        (end.floor() as i64, start.floor() as i64, -1.0)
    };
    let count = (from..=to).filter(|d| is_working_day(*d, &mask, &holidays)).count();
    Operand::number(sign * count as f64)
}

fn workday(ctx: &EvalCtx, a: &[Operand], weekend: Value, holiday_from: usize) -> Operand {
    args!(start = arg_serial(ctx, a, 0), days = arg_num(ctx, a, 1));
    let mask = match weekend_mask(&weekend) {
        Ok(mask) => mask,
        Err(e) => return Operand::error(e),
    };
    let holidays = holidays(ctx, a, holiday_from);
    let step: i64 = if days >= 0.0 { 1 } else { -1 };
    let mut remaining = days.trunc().abs() as i64;
    let mut cursor = start.floor() as i64;
    while remaining > 0 {
        cursor += step;
        if cursor < 0 {
            return Operand::error(CellError::Num);
        }
        if is_working_day(cursor, &mask, &holidays) {
            remaining -= 1;
        }
    }
    Operand::number(cursor as f64)
}

/// Reads the date formats a spreadsheet accepts in text: ISO, and the
/// slash-separated forms.
fn parse_date_text(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    let parts: Vec<&str> = trimmed.split(['-', '/', '.']).collect();
    let numbers: Option<Vec<i64>> = parts.iter().map(|p| p.trim().parse::<i64>().ok()).collect();
    let numbers = numbers?;
    let (y, m, d) = match numbers.as_slice() {
        // A four-digit leading number is a year, otherwise it is a month.
        [y, m, d] if *y > 31 => (*y, *m, *d),
        [m, d, y] => (*y, *m, *d),
        _ => return None,
    };
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if (0..1900).contains(&y) { y + if y < 30 { 2000 } else { 1900 } } else { y };
    serial_from_ymd(y, m as u32, d as u32).ok()
}

fn parse_time_text(text: &str) -> Option<f64> {
    let trimmed = text.trim().to_uppercase();
    let (body, offset) = match trimmed.strip_suffix("PM").map(str::trim) {
        Some(body) => (body.to_string(), 12.0),
        None => (trimmed.trim_end_matches("AM").trim().to_string(), 0.0),
    };
    let parts: Vec<&str> = body.split(':').collect();
    let h: f64 = parts.first()?.trim().parse().ok()?;
    let m: f64 = parts.get(1).map_or(Some(0.0), |p| p.trim().parse().ok())?;
    let s: f64 = parts.get(2).map_or(Some(0.0), |p| p.trim().parse().ok())?;
    if !(0.0..60.0).contains(&m) || !(0.0..60.0).contains(&s) {
        return None;
    }
    // 12 PM is noon, not midnight plus twelve hours.
    let hours = if offset > 0.0 && h == 12.0 { 12.0 } else { h + offset };
    Some(((hours * 3600.0 + m * 60.0 + s) / 86_400.0).fract())
}
