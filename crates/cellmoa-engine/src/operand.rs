//! Operands: what an expression evaluates to before it is forced to a scalar.
//!
//! A formula fragment can produce a plain value, a *reference* to one or more
//! areas of the workbook, or an *array* computed on the fly. Keeping references
//! unmaterialised matters: `SUM(A:A)` must not build a million-element vector,
//! and it does not — iterating a reference walks only the cells that exist.

use cellmoa_core::model::{SheetId, Workbook};
use cellmoa_core::reference::{CellRef, RangeRef};
use cellmoa_core::value::{CellError, Value};

/// A rectangular area of one sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub sheet: SheetId,
    pub range: RangeRef,
}

impl Area {
    pub fn new(sheet: SheetId, range: RangeRef) -> Area {
        Area { sheet, range }
    }
}

/// A materialised rectangle of values, row-major.
#[derive(Debug, Clone, PartialEq)]
pub struct Array {
    rows: usize,
    cols: usize,
    data: Vec<Value>,
}

impl Array {
    /// Builds an array from row-major data. Panics if the length does not match
    /// the stated shape, which would be a bug in a built-in function.
    pub fn new(rows: usize, cols: usize, data: Vec<Value>) -> Array {
        assert_eq!(data.len(), rows * cols, "array data does not match its shape");
        Array { rows, cols, data }
    }

    pub fn from_rows(rows: Vec<Vec<Value>>) -> Array {
        let height = rows.len();
        let width = rows.first().map_or(0, Vec::len);
        Array::new(height, width, rows.into_iter().flatten().collect())
    }

    pub fn row(values: Vec<Value>) -> Array {
        Array::new(1, values.len(), values)
    }

    pub fn column(values: Vec<Value>) -> Array {
        Array::new(values.len(), 1, values)
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    pub fn cols(&self) -> usize {
        self.cols
    }

    pub fn get(&self, row: usize, col: usize) -> Value {
        self.data.get(row * self.cols + col).cloned().unwrap_or(Value::Error(CellError::NA))
    }

    pub fn values(&self) -> impl Iterator<Item = &Value> {
        self.data.iter()
    }
}

/// The result of evaluating part of a formula.
#[derive(Debug, Clone, PartialEq)]
pub enum Operand {
    Value(Value),
    /// One or more areas of the workbook. More than one means a union, as in
    /// `SUM((A1:A2,C1:C2))`, or a 3-D reference across sheets.
    Ref(Vec<Area>),
    Array(Array),
}

impl Operand {
    pub fn number(n: f64) -> Operand {
        Operand::Value(Value::Number(n))
    }

    pub fn text(s: impl Into<String>) -> Operand {
        Operand::Value(Value::Text(s.into()))
    }

    pub fn bool(b: bool) -> Operand {
        Operand::Value(Value::Bool(b))
    }

    pub fn error(e: CellError) -> Operand {
        Operand::Value(Value::Error(e))
    }

    pub fn blank() -> Operand {
        Operand::Value(Value::Blank)
    }

    /// The single area this operand refers to, if it refers to exactly one.
    pub fn single_area(&self) -> Option<Area> {
        match self {
            Operand::Ref(areas) if areas.len() == 1 => Some(areas[0]),
            _ => None,
        }
    }

    /// The shape this operand presents to element-wise operations.
    ///
    /// A multi-area reference has no rectangular shape, so it reports `1x1`
    /// and is scalarised — matching how Excel treats a union outside the
    /// functions that understand one.
    pub fn shape(&self) -> (usize, usize) {
        match self {
            Operand::Value(_) => (1, 1),
            Operand::Array(a) => (a.rows(), a.cols()),
            Operand::Ref(areas) => match areas.as_slice() {
                [area] => (area.range.height() as usize, area.range.width() as usize),
                _ => (1, 1),
            },
        }
    }

    /// The value at a position within this operand's shape.
    ///
    /// Reading past the end of a one-row or one-column operand repeats it,
    /// which is how Excel broadcasts a row against a column.
    pub fn value_at(&self, wb: &Workbook, row: usize, col: usize) -> Value {
        match self {
            Operand::Value(v) => v.clone(),
            Operand::Array(a) => {
                let r = if a.rows() == 1 { 0 } else { row };
                let c = if a.cols() == 1 { 0 } else { col };
                if r >= a.rows() || c >= a.cols() {
                    return Value::Error(CellError::NA);
                }
                a.get(r, c)
            }
            Operand::Ref(areas) => match areas.as_slice() {
                [area] => {
                    let r = if area.range.height() == 1 { 0 } else { row };
                    let c = if area.range.width() == 1 { 0 } else { col };
                    if r >= area.range.height() as usize || c >= area.range.width() as usize {
                        return Value::Error(CellError::NA);
                    }
                    read(
                        wb,
                        area.sheet,
                        area.range.start.col + c as u32,
                        area.range.start.row + r as u32,
                    )
                }
                _ => Value::Error(CellError::Value),
            },
        }
    }

    /// Forces the operand to a single value.
    ///
    /// A multi-cell reference used where one value is expected triggers Excel's
    /// implicit intersection: `=A1:A10` in `C5` means `A5`, because row 5 is the
    /// row the formula itself sits on. When no row or column lines up, the
    /// result is `#VALUE!`.
    pub fn to_scalar(&self, wb: &Workbook, at: CellRef) -> Value {
        match self {
            Operand::Value(v) => v.clone(),
            Operand::Array(a) => match (a.rows(), a.cols()) {
                (1, 1) => a.get(0, 0),
                _ => Value::Error(CellError::Value),
            },
            Operand::Ref(areas) => match areas.as_slice() {
                [area] => {
                    let range = &area.range;
                    if range.cell_count() == 1 {
                        return read(wb, area.sheet, range.start.col, range.start.row);
                    }
                    if range.height() == 1 && at.col >= range.start.col && at.col <= range.end.col {
                        return read(wb, area.sheet, at.col, range.start.row);
                    }
                    if range.width() == 1 && at.row >= range.start.row && at.row <= range.end.row {
                        return read(wb, area.sheet, range.start.col, at.row);
                    }
                    Value::Error(CellError::Value)
                }
                _ => Value::Error(CellError::Value),
            },
        }
    }

    /// Visits every value the operand holds, in row-major order.
    ///
    /// References yield only cells that actually exist. Every aggregate in the
    /// function library ignores blanks, so skipping them is both correct and
    /// what keeps `SUM(A:A)` proportional to the data rather than to the sheet.
    pub fn for_each(&self, wb: &Workbook, f: &mut impl FnMut(&Value)) {
        match self {
            Operand::Value(v) => f(v),
            Operand::Array(a) => a.values().for_each(f),
            Operand::Ref(areas) => {
                for area in areas {
                    let Some(sheet) = wb.sheet(area.sheet) else { continue };
                    for (_, _, cell) in sheet.iter_range(&area.range) {
                        f(&cell.value);
                    }
                }
            }
        }
    }

    /// Visits every value together with its position within the operand.
    /// Positions are relative to the operand's own top-left corner.
    pub fn for_each_positioned(&self, wb: &Workbook, f: &mut impl FnMut(usize, usize, &Value)) {
        match self {
            Operand::Value(v) => f(0, 0, v),
            Operand::Array(a) => {
                for r in 0..a.rows() {
                    for c in 0..a.cols() {
                        f(r, c, &a.get(r, c));
                    }
                }
            }
            Operand::Ref(areas) => {
                for area in areas {
                    let Some(sheet) = wb.sheet(area.sheet) else { continue };
                    for (col, row, cell) in sheet.iter_range(&area.range) {
                        f(
                            (row - area.range.start.row) as usize,
                            (col - area.range.start.col) as usize,
                            &cell.value,
                        );
                    }
                }
            }
        }
    }

    /// The first error anywhere in the operand, so functions can propagate it
    /// before doing any work.
    pub fn first_error(&self, wb: &Workbook) -> Option<CellError> {
        let mut found = None;
        self.for_each(wb, &mut |v| {
            if found.is_none() {
                found = v.as_error();
            }
        });
        found
    }

    /// Materialises the operand as an array. Callers that need positional access
    /// over a reference use this; it clamps to the area's real extent.
    pub fn to_array(&self, wb: &Workbook) -> Array {
        match self {
            Operand::Array(a) => a.clone(),
            Operand::Value(v) => Array::new(1, 1, vec![v.clone()]),
            Operand::Ref(areas) => match areas.as_slice() {
                [area] => {
                    let (h, w) = (area.range.height() as usize, area.range.width() as usize);
                    let mut data = vec![Value::Blank; h * w];
                    if let Some(sheet) = wb.sheet(area.sheet) {
                        for (col, row, cell) in sheet.iter_range(&area.range) {
                            let r = (row - area.range.start.row) as usize;
                            let c = (col - area.range.start.col) as usize;
                            data[r * w + c] = cell.value.clone();
                        }
                    }
                    Array::new(h, w, data)
                }
                _ => Array::new(1, 1, vec![Value::Error(CellError::Value)]),
            },
        }
    }
}

fn read(wb: &Workbook, sheet: SheetId, col: u32, row: u32) -> Value {
    wb.sheet(sheet).map(|s| s.value(col, row)).unwrap_or(Value::Blank)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellmoa_core::model::Cell;

    fn wb() -> Workbook {
        let mut wb = Workbook::new();
        let id = wb.add_sheet("Sheet1");
        let sheet = wb.sheet_mut(id).unwrap();
        // A1:A4 = 10, 20, 30, 40
        for (row, n) in (0..4).zip([10.0, 20.0, 30.0, 40.0]) {
            sheet.set(0, row, Cell::literal(Value::Number(n)));
        }
        // C1:E1 = 1, 2, 3
        for (col, n) in (2..5).zip([1.0, 2.0, 3.0]) {
            sheet.set(col, 0, Cell::literal(Value::Number(n)));
        }
        wb
    }

    fn area(spec: &str) -> Operand {
        Operand::Ref(vec![Area::new(0, RangeRef::parse_a1(spec).unwrap())])
    }

    #[test]
    fn implicit_intersection_picks_the_formulas_own_row() {
        let wb = wb();
        // `=A1:A4` written in C3 means A3.
        assert_eq!(area("A1:A4").to_scalar(&wb, CellRef::new(2, 2)), Value::Number(30.0));
    }

    #[test]
    fn implicit_intersection_picks_the_formulas_own_column() {
        let wb = wb();
        // `=C1:E1` written in D9 means D1.
        assert_eq!(area("C1:E1").to_scalar(&wb, CellRef::new(3, 8)), Value::Number(2.0));
    }

    #[test]
    fn implicit_intersection_fails_when_nothing_lines_up() {
        let wb = wb();
        assert_eq!(
            area("A1:A4").to_scalar(&wb, CellRef::new(2, 9)),
            Value::Error(CellError::Value)
        );
        // A rectangle can never be intersected implicitly.
        assert_eq!(
            area("A1:C4").to_scalar(&wb, CellRef::new(0, 0)),
            Value::Error(CellError::Value)
        );
    }

    #[test]
    fn a_one_cell_range_scalarises_directly() {
        let wb = wb();
        assert_eq!(area("A2").to_scalar(&wb, CellRef::new(9, 9)), Value::Number(20.0));
    }

    #[test]
    fn iterating_a_reference_visits_only_cells_that_exist() {
        let wb = wb();
        let mut seen = 0;
        // A whole column is a million cells; only four of them are there.
        area("A1:A1048576").for_each(&wb, &mut |_| seen += 1);
        assert_eq!(seen, 4);
    }

    #[test]
    fn a_union_reference_iterates_every_area() {
        let wb = wb();
        let union = Operand::Ref(vec![
            Area::new(0, RangeRef::parse_a1("A1:A2").unwrap()),
            Area::new(0, RangeRef::parse_a1("C1:E1").unwrap()),
        ]);
        let mut total = 0.0;
        union.for_each(&wb, &mut |v| total += v.coerce_number().unwrap_or(0.0));
        assert_eq!(total, 10.0 + 20.0 + 1.0 + 2.0 + 3.0);
    }

    #[test]
    fn a_single_row_broadcasts_down_and_a_single_column_across() {
        let wb = wb();
        let row = Array::row(vec![Value::Number(1.0), Value::Number(2.0)]);
        let op = Operand::Array(row);
        assert_eq!(op.value_at(&wb, 5, 1), Value::Number(2.0));

        let col = Operand::Array(Array::column(vec![Value::Number(7.0), Value::Number(8.0)]));
        assert_eq!(col.value_at(&wb, 1, 5), Value::Number(8.0));
    }

    #[test]
    fn materialising_a_range_fills_gaps_with_blanks() {
        let wb = wb();
        let arr = area("A1:B2").to_array(&wb);
        assert_eq!((arr.rows(), arr.cols()), (2, 2));
        assert_eq!(arr.get(0, 0), Value::Number(10.0));
        assert_eq!(arr.get(0, 1), Value::Blank);
    }

    #[test]
    fn positions_are_relative_to_the_operands_own_corner() {
        let wb = wb();
        let mut seen = Vec::new();
        area("A2:A3").for_each_positioned(&wb, &mut |r, c, v| seen.push((r, c, v.clone())));
        assert_eq!(seen[0], (0, 0, Value::Number(20.0)));
        assert_eq!(seen[1], (1, 0, Value::Number(30.0)));
    }

    #[test]
    fn errors_inside_a_reference_are_found_for_propagation() {
        let mut wb = wb();
        wb.sheet_mut(0).unwrap().set(0, 1, Cell::literal(Value::Error(CellError::Div0)));
        assert_eq!(area("A1:A4").first_error(&wb), Some(CellError::Div0));
        assert_eq!(area("C1:E1").first_error(&wb), None);
    }
}
