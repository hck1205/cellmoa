//! A1-style cell and range references.
//!
//! References carry their absolute/relative flags because that distinction
//! survives a round trip through XLSX and decides how a formula shifts when it
//! is copied or when rows and columns are inserted.

use crate::value::CellError;
use std::fmt;

/// Number of columns in a sheet (`A` through `XFD`).
pub const MAX_COLS: u32 = 16_384;
/// Number of rows in a sheet.
pub const MAX_ROWS: u32 = 1_048_576;

/// A single cell reference. `col` and `row` are zero-based; `A1` is `(0, 0)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CellRef {
    pub col: u32,
    pub row: u32,
    pub col_abs: bool,
    pub row_abs: bool,
}

impl CellRef {
    /// A relative reference, the form `A1` takes when typed without `$`.
    pub const fn new(col: u32, row: u32) -> CellRef {
        CellRef { col, row, col_abs: false, row_abs: false }
    }

    pub const fn absolute(col: u32, row: u32) -> CellRef {
        CellRef { col, row, col_abs: true, row_abs: true }
    }

    /// Whether the reference lands inside the sheet's bounds.
    pub const fn in_bounds(&self) -> bool {
        self.col < MAX_COLS && self.row < MAX_ROWS
    }

    /// The `(col, row)` pair with the absolute flags dropped — the identity of
    /// the cell being pointed at.
    pub const fn coord(&self) -> (u32, u32) {
        (self.col, self.row)
    }

    /// Moves the reference by a delta, honouring the absolute flags. This is
    /// the copy/fill rule: `$A1` copied one column right still points at `A`.
    ///
    /// Returns `Err(#REF!)` when the result would fall off the sheet, which is
    /// exactly what Excel puts in the cell.
    pub fn offset(&self, dcol: i64, drow: i64) -> Result<CellRef, CellError> {
        let col = if self.col_abs { self.col as i64 } else { self.col as i64 + dcol };
        let row = if self.row_abs { self.row as i64 } else { self.row as i64 + drow };
        if col < 0 || row < 0 || col >= MAX_COLS as i64 || row >= MAX_ROWS as i64 {
            return Err(CellError::Ref);
        }
        Ok(CellRef { col: col as u32, row: row as u32, ..*self })
    }

    /// Renders the reference in A1 notation, including any `$` markers.
    pub fn to_a1(&self) -> String {
        let mut s = String::new();
        if self.col_abs {
            s.push('$');
        }
        s.push_str(&col_to_letters(self.col));
        if self.row_abs {
            s.push('$');
        }
        s.push_str(&(self.row + 1).to_string());
        s
    }

    /// Parses A1 notation such as `B7`, `$B$7` or `b7`. The sheet qualifier is
    /// not handled here — see [`crate::reference::parse_sheet_qualified`].
    pub fn parse_a1(s: &str) -> Option<CellRef> {
        let bytes = s.as_bytes();
        let mut i = 0;
        let col_abs = bytes.get(i) == Some(&b'$');
        if col_abs {
            i += 1;
        }
        let letters_start = i;
        while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
            i += 1;
        }
        if i == letters_start {
            return None;
        }
        let col = letters_to_col(&s[letters_start..i])?;
        let row_abs = bytes.get(i) == Some(&b'$');
        if row_abs {
            i += 1;
        }
        let digits_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i != bytes.len() || digits_start == i {
            return None;
        }
        let row1: u32 = s[digits_start..i].parse().ok()?;
        if row1 == 0 || row1 > MAX_ROWS {
            return None;
        }
        Some(CellRef { col, row: row1 - 1, col_abs, row_abs })
    }
}

impl fmt::Display for CellRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_a1())
    }
}

/// A rectangular range. `start` is the top-left corner after normalisation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RangeRef {
    pub start: CellRef,
    pub end: CellRef,
}

impl RangeRef {
    pub fn new(start: CellRef, end: CellRef) -> RangeRef {
        RangeRef { start, end }.normalized()
    }

    /// A range covering exactly one cell.
    pub fn single(cell: CellRef) -> RangeRef {
        RangeRef { start: cell, end: cell }
    }

    /// Reorders the corners so `start` is top-left. `B4:A1` and `A1:B4` mean
    /// the same area, and downstream code should not have to check.
    pub fn normalized(self) -> RangeRef {
        let (c0, c1) = (self.start.col.min(self.end.col), self.start.col.max(self.end.col));
        let (r0, r1) = (self.start.row.min(self.end.row), self.start.row.max(self.end.row));
        RangeRef {
            start: CellRef { col: c0, row: r0, ..self.start },
            end: CellRef { col: c1, row: r1, ..self.end },
        }
    }

    pub const fn width(&self) -> u32 {
        self.end.col - self.start.col + 1
    }

    pub const fn height(&self) -> u32 {
        self.end.row - self.start.row + 1
    }

    /// Cell count, as `u64` because a full-column range holds a million cells
    /// and a full-sheet range overflows `u32`.
    pub const fn cell_count(&self) -> u64 {
        self.width() as u64 * self.height() as u64
    }

    pub const fn contains(&self, col: u32, row: u32) -> bool {
        col >= self.start.col && col <= self.end.col && row >= self.start.row && row <= self.end.row
    }

    pub fn intersects(&self, other: &RangeRef) -> bool {
        self.start.col <= other.end.col
            && other.start.col <= self.end.col
            && self.start.row <= other.end.row
            && other.start.row <= self.end.row
    }

    /// The overlapping area of two ranges, or `None` when they are disjoint.
    /// This backs the intersection operator (a space between two references).
    pub fn intersection(&self, other: &RangeRef) -> Option<RangeRef> {
        if !self.intersects(other) {
            return None;
        }
        Some(RangeRef {
            start: CellRef::new(
                self.start.col.max(other.start.col),
                self.start.row.max(other.start.row),
            ),
            end: CellRef::new(self.end.col.min(other.end.col), self.end.row.min(other.end.row)),
        })
    }

    /// Walks the range in row-major order. The order is fixed rather than
    /// incidental: replay (D4) and fingerprints (D2) compare these sequences.
    pub fn iter(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        (self.start.row..=self.end.row)
            .flat_map(move |r| (self.start.col..=self.end.col).map(move |c| (c, r)))
    }

    pub fn offset(&self, dcol: i64, drow: i64) -> Result<RangeRef, CellError> {
        Ok(RangeRef { start: self.start.offset(dcol, drow)?, end: self.end.offset(dcol, drow)? })
    }

    pub fn to_a1(&self) -> String {
        format!("{}:{}", self.start.to_a1(), self.end.to_a1())
    }

    /// Parses `A1:B4`, and also a bare `A1` as a one-cell range.
    pub fn parse_a1(s: &str) -> Option<RangeRef> {
        match s.split_once(':') {
            Some((a, b)) => Some(RangeRef::new(CellRef::parse_a1(a)?, CellRef::parse_a1(b)?)),
            None => Some(RangeRef::single(CellRef::parse_a1(s)?)),
        }
    }
}

impl fmt::Display for RangeRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_a1())
    }
}

/// Converts a zero-based column index to letters: `0 -> A`, `26 -> AA`.
pub fn col_to_letters(col: u32) -> String {
    let mut n = col as u64 + 1;
    let mut out = Vec::new();
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        out.push(b'A' + rem);
        n = (n - 1) / 26;
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII only")
}

/// Converts column letters to a zero-based index. Returns `None` past `XFD`.
pub fn letters_to_col(letters: &str) -> Option<u32> {
    if letters.is_empty() || letters.len() > 3 {
        return None;
    }
    let mut n: u32 = 0;
    for b in letters.bytes() {
        if !b.is_ascii_alphabetic() {
            return None;
        }
        let d = (b.to_ascii_uppercase() - b'A') as u32 + 1;
        n = n.checked_mul(26)?.checked_add(d)?;
    }
    (n <= MAX_COLS).then(|| n - 1)
}

/// Splits an optional sheet qualifier off a reference, handling the quoted form
/// that names with spaces or punctuation require: `'Q1 Sales'!A1`.
///
/// Returns `(sheet_name, rest)`.
pub fn parse_sheet_qualified(s: &str) -> (Option<String>, &str) {
    if let Some(rest) = s.strip_prefix('\'') {
        // Inside quotes a literal apostrophe is doubled, per the XLSX grammar.
        let mut name = String::new();
        let mut chars = rest.char_indices();
        while let Some((i, c)) = chars.next() {
            if c == '\'' {
                if rest[i + 1..].starts_with('\'') {
                    name.push('\'');
                    chars.next();
                    continue;
                }
                return match rest[i + 1..].strip_prefix('!') {
                    Some(tail) => (Some(name), tail),
                    None => (None, s),
                };
            }
            name.push(c);
        }
        return (None, s);
    }
    match s.split_once('!') {
        Some((name, rest)) if !name.is_empty() && !name.contains([':', '\'']) => {
            (Some(name.to_string()), rest)
        }
        _ => (None, s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_letters_round_trip() {
        for (idx, letters) in [(0, "A"), (25, "Z"), (26, "AA"), (701, "ZZ"), (702, "AAA")] {
            assert_eq!(col_to_letters(idx), letters);
            assert_eq!(letters_to_col(letters), Some(idx));
        }
        assert_eq!(col_to_letters(MAX_COLS - 1), "XFD");
        assert_eq!(letters_to_col("XFD"), Some(MAX_COLS - 1));
        assert_eq!(letters_to_col("XFE"), None);
    }

    #[test]
    fn a1_parsing_keeps_absolute_flags() {
        let r = CellRef::parse_a1("$B$7").unwrap();
        assert_eq!((r.col, r.row, r.col_abs, r.row_abs), (1, 6, true, true));
        assert_eq!(r.to_a1(), "$B$7");
        let r = CellRef::parse_a1("b7").unwrap();
        assert_eq!(r.to_a1(), "B7");
        assert_eq!(CellRef::parse_a1("A0"), None);
        assert_eq!(CellRef::parse_a1("A1B"), None);
        assert_eq!(CellRef::parse_a1("1A"), None);
    }

    #[test]
    fn absolute_parts_do_not_shift_on_copy() {
        let r = CellRef::parse_a1("$A1").unwrap();
        let moved = r.offset(3, 2).unwrap();
        assert_eq!(moved.to_a1(), "$A3");
    }

    #[test]
    fn shifting_off_the_sheet_is_a_ref_error() {
        assert_eq!(CellRef::new(0, 0).offset(-1, 0), Err(CellError::Ref));
    }

    #[test]
    fn ranges_normalise_their_corners() {
        let r = RangeRef::parse_a1("B4:A1").unwrap();
        assert_eq!(r.to_a1(), "A1:B4");
        assert_eq!(r.cell_count(), 8);
        assert_eq!(r.iter().next(), Some((0, 0)));
        assert_eq!(r.iter().last(), Some((1, 3)));
    }

    #[test]
    fn range_intersection_backs_the_space_operator() {
        let a = RangeRef::parse_a1("A1:C3").unwrap();
        let b = RangeRef::parse_a1("B2:D4").unwrap();
        assert_eq!(a.intersection(&b).unwrap().to_a1(), "B2:C3");
        let c = RangeRef::parse_a1("E1:F2").unwrap();
        assert_eq!(a.intersection(&c), None);
    }

    #[test]
    fn sheet_qualifiers_split_off_including_quoted_names() {
        assert_eq!(parse_sheet_qualified("Sheet1!A1"), (Some("Sheet1".into()), "A1"));
        assert_eq!(parse_sheet_qualified("'Q1 Sales'!A1"), (Some("Q1 Sales".into()), "A1"));
        assert_eq!(parse_sheet_qualified("'It''s'!A1"), (Some("It's".into()), "A1"));
        assert_eq!(parse_sheet_qualified("A1"), (None, "A1"));
    }
}
