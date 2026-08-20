//! Date and time arithmetic on spreadsheet serial numbers.
//!
//! A date is a number: day 1 is 1900-01-01, and the fractional part is the time
//! of day. The conversion is not a plain offset, because the 1900 date system
//! contains a day that never existed — Lotus 1-2-3 treated 1900 as a leap year,
//! Excel copied the bug for compatibility, and every file format since has kept
//! it. Serial 60 is "1900-02-29", and serials below it are shifted by one day
//! against the real calendar. Getting this wrong puts every date before March
//! 1900 off by a day.

use cellmoa_core::value::CellError;

/// The serial number of the day that does not exist.
const PHANTOM_LEAP_DAY: i64 = 60;

/// Days from the civil epoch (1970-01-01) — Howard Hinnant's algorithm.
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The inverse of [`days_from_civil`].
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Civil day number of serial 0 (1899-12-30).
fn epoch() -> i64 {
    days_from_civil(1899, 12, 30)
}

/// Converts a calendar date to a serial number.
pub fn serial_from_ymd(y: i64, m: u32, d: u32) -> Result<f64, CellError> {
    // 1900-02-29 is not a real date, but it is a real serial number.
    if (y, m, d) == (1900, 2, 29) {
        return Ok(PHANTOM_LEAP_DAY as f64);
    }
    let diff = days_from_civil(y, m, d) - epoch();
    let serial = if diff > PHANTOM_LEAP_DAY { diff } else { diff - 1 };
    if serial < 1 {
        // Nothing before 1900-01-01 has a serial number; serial 0 is a
        // placeholder ("1900-01-00") that no real date maps onto.
        return Err(CellError::Num);
    }
    Ok(serial as f64)
}

/// Converts a serial number to a calendar date.
pub fn ymd_from_serial(serial: f64) -> Result<(i64, u32, u32), CellError> {
    if !(0.0..2_958_466.0).contains(&serial) {
        return Err(CellError::Num);
    }
    let days = serial.floor() as i64;
    if days == 0 {
        // The placeholder day. Excel reports it as year 1900, month 1, day 0,
        // and so does every file that round-trips through it.
        return Ok((1900, 1, 0));
    }
    if days == PHANTOM_LEAP_DAY {
        return Ok((1900, 2, 29));
    }
    let shift = if days > PHANTOM_LEAP_DAY { 0 } else { 1 };
    Ok(civil_from_days(epoch() + days + shift))
}

/// Splits the fractional part of a serial into hours, minutes and seconds.
pub fn hms_from_serial(serial: f64) -> (u32, u32, u32) {
    let fraction = serial - serial.floor();
    // Round to the nearest second first: 0.5 of a day is exactly noon, but
    // arithmetic on serials rarely lands on an exact second.
    let total = (fraction * 86_400.0).round() as i64 % 86_400;
    ((total / 3600) as u32, ((total % 3600) / 60) as u32, (total % 60) as u32)
}

/// Builds a serial from a date, rolling out-of-range months and days over into
/// neighbouring months — `DATE(2024,13,1)` is January 2025.
pub fn serial_from_parts(year: i64, month: i64, day: i64) -> Result<f64, CellError> {
    // A two-digit year means 19xx, as in Excel.
    let year = if (0..1900).contains(&year) { year + 1900 } else { year };
    let (year, month) = (year + (month - 1).div_euclid(12), (month - 1).rem_euclid(12) + 1);
    let base = days_from_civil(year, month as u32, 1);
    let civil = civil_from_days(base + day - 1);
    serial_from_ymd(civil.0, civil.1, civil.2)
}

/// The last day of the month containing `serial`, offset by `months`.
pub fn end_of_month(serial: f64, months: i64) -> Result<f64, CellError> {
    let (y, m, _) = ymd_from_serial(serial)?;
    let shifted = m as i64 - 1 + months;
    let (y, m) = (y + shifted.div_euclid(12), shifted.rem_euclid(12) + 1);
    // Day 0 of the next month is the last day of this one.
    let next =
        days_from_civil(if m == 12 { y + 1 } else { y }, if m == 12 { 1 } else { m as u32 + 1 }, 1);
    let (ly, lm, ld) = civil_from_days(next - 1);
    serial_from_ymd(ly, lm, ld)
}

pub fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Day of the week, Monday = 0.
pub fn weekday_from_serial(serial: f64) -> Result<u32, CellError> {
    let (y, m, d) = ymd_from_serial(serial)?;
    // 1970-01-01 was a Thursday, which is index 3 with Monday at 0.
    Ok(((days_from_civil(y, m, d) % 7 + 7 + 3) % 7) as u32)
}

/// Days between two dates under one of the 30/360 conventions.
pub fn days_360(start: (i64, u32, u32), end: (i64, u32, u32), european: bool) -> f64 {
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
pub fn year_fraction(start: f64, end: f64, basis: i64) -> Result<f64, CellError> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_anchor_dates_of_the_1900_system() {
        assert_eq!(serial_from_ymd(1900, 1, 1).unwrap(), 1.0);
        assert_eq!(serial_from_ymd(1900, 2, 28).unwrap(), 59.0);
        assert_eq!(serial_from_ymd(1900, 3, 1).unwrap(), 61.0);
        assert_eq!(serial_from_ymd(2024, 1, 1).unwrap(), 45_292.0);
    }

    #[test]
    fn the_day_that_never_existed_still_has_a_serial() {
        // Every spreadsheet agrees that serial 60 is "1900-02-29".
        assert_eq!(serial_from_ymd(1900, 2, 29).unwrap(), 60.0);
        assert_eq!(ymd_from_serial(60.0).unwrap(), (1900, 2, 29));
        // And that it sits between two real days.
        assert_eq!(ymd_from_serial(59.0).unwrap(), (1900, 2, 28));
        assert_eq!(ymd_from_serial(61.0).unwrap(), (1900, 3, 1));
    }

    #[test]
    fn serials_round_trip_across_the_discontinuity() {
        for serial in [1.0, 31.0, 59.0, 61.0, 1000.0, 45_292.0, 50_000.0] {
            let (y, m, d) = ymd_from_serial(serial).unwrap();
            assert_eq!(serial_from_ymd(y, m, d).unwrap(), serial, "serial {serial}");
        }
    }

    #[test]
    fn dates_outside_the_system_are_rejected() {
        assert_eq!(serial_from_ymd(1899, 12, 31), Err(CellError::Num));
        assert_eq!(ymd_from_serial(-1.0), Err(CellError::Num));
        // Serial 0 is a placeholder rather than a date.
        assert_eq!(ymd_from_serial(0.0).unwrap(), (1900, 1, 0));
    }

    #[test]
    fn out_of_range_parts_roll_over() {
        // DATE(2024,13,1) is January 2025.
        assert_eq!(ymd_from_serial(serial_from_parts(2024, 13, 1).unwrap()).unwrap(), (2025, 1, 1));
        // DATE(2024,1,32) is the first of February.
        assert_eq!(ymd_from_serial(serial_from_parts(2024, 1, 32).unwrap()).unwrap(), (2024, 2, 1));
        // A zero day is the last day of the previous month.
        assert_eq!(ymd_from_serial(serial_from_parts(2024, 3, 0).unwrap()).unwrap(), (2024, 2, 29));
    }

    #[test]
    fn a_two_digit_year_means_the_twentieth_century() {
        assert_eq!(ymd_from_serial(serial_from_parts(24, 1, 1).unwrap()).unwrap(), (1924, 1, 1));
    }

    #[test]
    fn month_ends_account_for_leap_years() {
        let feb_2024 = serial_from_ymd(2024, 2, 10).unwrap();
        assert_eq!(ymd_from_serial(end_of_month(feb_2024, 0).unwrap()).unwrap(), (2024, 2, 29));
        let feb_2023 = serial_from_ymd(2023, 2, 10).unwrap();
        assert_eq!(ymd_from_serial(end_of_month(feb_2023, 0).unwrap()).unwrap(), (2023, 2, 28));
        assert_eq!(ymd_from_serial(end_of_month(feb_2024, 10).unwrap()).unwrap(), (2024, 12, 31));
        assert_eq!(ymd_from_serial(end_of_month(feb_2024, -2).unwrap()).unwrap(), (2023, 12, 31));
    }

    #[test]
    fn time_of_day_splits_out_of_the_fraction() {
        assert_eq!(hms_from_serial(0.5), (12, 0, 0));
        assert_eq!(hms_from_serial(0.0), (0, 0, 0));
        assert_eq!(hms_from_serial(45_292.75), (18, 0, 0));
    }

    #[test]
    fn weekdays_line_up_with_known_dates() {
        // 2024-01-01 was a Monday.
        assert_eq!(weekday_from_serial(serial_from_ymd(2024, 1, 1).unwrap()).unwrap(), 0);
        // 2024-01-07 was a Sunday.
        assert_eq!(weekday_from_serial(serial_from_ymd(2024, 1, 7).unwrap()).unwrap(), 6);
    }

    #[test]
    fn leap_years_follow_the_gregorian_rule() {
        assert!(is_leap_year(2024));
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2000));
    }
}
