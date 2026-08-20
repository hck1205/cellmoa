//! The workbook document model.
//!
//! Cells are stored in a `BTreeMap` rather than a hash map so that iteration is
//! row-major and stable across runs. Every feature that hashes or replays a
//! document (D2, D4) depends on that order being a property of the model rather
//! than an accident of allocation.

use crate::reference::{CellRef, RangeRef};
use crate::value::Value;
use std::collections::BTreeMap;

/// Index of a sheet within its workbook. Stable for the sheet's lifetime;
/// renaming a sheet does not change it.
pub type SheetId = u32;

/// A fully qualified cell address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CellAddr {
    pub sheet: SheetId,
    /// Row first, so the derived ordering is row-major within a sheet.
    pub row: u32,
    pub col: u32,
}

impl CellAddr {
    pub const fn new(sheet: SheetId, col: u32, row: u32) -> CellAddr {
        CellAddr { sheet, row, col }
    }

    pub const fn cell_ref(&self) -> CellRef {
        CellRef::new(self.col, self.row)
    }
}

/// What the user typed into a cell, as opposed to what it currently shows.
#[derive(Debug, Clone, PartialEq)]
pub enum CellContent {
    /// The cell is empty. Distinct from a cell holding an empty string.
    Empty,
    /// A literal value entered directly.
    Literal(Value),
    /// A formula, stored as source text without the leading `=`.
    ///
    /// The parsed form lives in the engine's AST cache; keeping the source here
    /// means a workbook can be loaded, diffed and re-saved without the parser,
    /// and that an unparseable formula round-trips instead of being dropped.
    Formula(String),
}

impl CellContent {
    pub fn formula(src: impl Into<String>) -> CellContent {
        CellContent::Formula(src.into())
    }

    pub fn is_empty(&self) -> bool {
        matches!(self, CellContent::Empty)
    }

    pub fn as_formula(&self) -> Option<&str> {
        match self {
            CellContent::Formula(s) => Some(s),
            _ => None,
        }
    }
}

/// A cell: its input, and the value that input last evaluated to.
#[derive(Debug, Clone, PartialEq)]
pub struct Cell {
    pub content: CellContent,
    /// The last computed value. For a literal this mirrors the content; for a
    /// formula it is the engine's output, cached so that reads do not evaluate.
    pub value: Value,
}

impl Cell {
    pub fn literal(value: Value) -> Cell {
        Cell { content: CellContent::Literal(value.clone()), value }
    }

    pub fn formula(src: impl Into<String>) -> Cell {
        // Until the engine evaluates it, an unevaluated formula reads as blank.
        Cell { content: CellContent::formula(src), value: Value::Blank }
    }
}

/// One sheet of a workbook.
#[derive(Debug, Clone)]
pub struct Sheet {
    pub id: SheetId,
    pub name: String,
    /// Deleted sheets are tombstoned rather than removed from the workbook, so
    /// that [`SheetId`]s stay stable and a delete can be undone (F4) without
    /// rewriting every reference that pointed past it.
    pub removed: bool,
    cells: BTreeMap<(u32, u32), Cell>,
}

impl Sheet {
    pub fn new(id: SheetId, name: impl Into<String>) -> Sheet {
        Sheet { id, name: name.into(), removed: false, cells: BTreeMap::new() }
    }

    pub fn get(&self, col: u32, row: u32) -> Option<&Cell> {
        self.cells.get(&(row, col))
    }

    /// The cell's current value, or `Blank` if it has never been written.
    pub fn value(&self, col: u32, row: u32) -> Value {
        self.get(col, row).map(|c| c.value.clone()).unwrap_or(Value::Blank)
    }

    pub fn content(&self, col: u32, row: u32) -> CellContent {
        self.get(col, row).map(|c| c.content.clone()).unwrap_or(CellContent::Empty)
    }

    /// Writes a cell. Writing `Empty` removes it, so an emptied cell leaves no
    /// trace in the map and two documents that differ only by such a write
    /// still fingerprint the same.
    pub fn set(&mut self, col: u32, row: u32, cell: Cell) {
        if cell.content.is_empty() && cell.value.is_blank() {
            self.cells.remove(&(row, col));
        } else {
            self.cells.insert((row, col), cell);
        }
    }

    pub fn clear(&mut self, col: u32, row: u32) {
        self.cells.remove(&(row, col));
    }

    /// Updates only the cached value, leaving the input alone. The engine calls
    /// this after evaluating; it is not an edit and does not bump the revision.
    pub fn set_computed_value(&mut self, col: u32, row: u32, value: Value) {
        if let Some(cell) = self.cells.get_mut(&(row, col)) {
            cell.value = value;
        } else if !value.is_blank() {
            self.cells.insert((row, col), Cell { content: CellContent::Empty, value });
        }
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    pub fn cell_count(&self) -> usize {
        self.cells.len()
    }

    /// All non-empty cells in row-major order, as `(col, row, cell)`.
    pub fn iter(&self) -> impl Iterator<Item = (u32, u32, &Cell)> {
        self.cells.iter().map(|(&(row, col), cell)| (col, row, cell))
    }

    /// Non-empty cells inside `range`, in row-major order.
    pub fn iter_range<'a>(
        &'a self,
        range: &'a RangeRef,
    ) -> impl Iterator<Item = (u32, u32, &'a Cell)> + 'a {
        self.cells
            .range((range.start.row, range.start.col)..=(range.end.row, range.end.col))
            .filter(move |(&(_, col), _)| col >= range.start.col && col <= range.end.col)
            .map(|(&(row, col), cell)| (col, row, cell))
    }

    /// The smallest range covering every non-empty cell, or `None` if the sheet
    /// is empty. This is the "used range" that export and diff walk.
    pub fn used_range(&self) -> Option<RangeRef> {
        let mut it = self.cells.keys();
        let &(first_row, first_col) = it.next()?;
        let (mut min_col, mut max_col) = (first_col, first_col);
        let mut max_row = first_row;
        for &(row, col) in it {
            min_col = min_col.min(col);
            max_col = max_col.max(col);
            max_row = max_row.max(row);
        }
        Some(RangeRef::new(CellRef::new(min_col, first_row), CellRef::new(max_col, max_row)))
    }
}

/// A named range or named constant, as defined in the Name Manager.
#[derive(Debug, Clone, PartialEq)]
pub struct DefinedName {
    pub name: String,
    /// The formula the name expands to, without a leading `=`.
    pub refers_to: String,
    /// `None` for a workbook-global name, or the sheet it is scoped to.
    pub scope: Option<SheetId>,
}

/// A workbook: sheets, defined names, and the revision counter that guards
/// concurrent edits.
#[derive(Debug, Clone)]
pub struct Workbook {
    sheets: Vec<Sheet>,
    names: BTreeMap<String, DefinedName>,
    revision: u64,
}

impl Default for Workbook {
    fn default() -> Self {
        Workbook::new()
    }
}

impl Workbook {
    /// An empty workbook with no sheets. Callers add the first sheet
    /// explicitly, because import and `new document` want different names.
    pub fn new() -> Workbook {
        Workbook { sheets: Vec::new(), names: BTreeMap::new(), revision: 0 }
    }

    /// The current revision. Every applied edit increments it by one; callers
    /// use it for optimistic concurrency (see `cellmoa_core::edit`).
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Bumps the revision. Only the edit layer should call this.
    pub(crate) fn bump_revision(&mut self) -> u64 {
        self.revision += 1;
        self.revision
    }

    pub fn add_sheet(&mut self, name: impl Into<String>) -> SheetId {
        let id = self.sheets.len() as SheetId;
        self.sheets.push(Sheet::new(id, name));
        id
    }

    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    /// The live sheet with this id, or `None` if it is missing or deleted.
    pub fn sheet(&self, id: SheetId) -> Option<&Sheet> {
        self.sheets.get(id as usize).filter(|s| !s.removed)
    }

    pub fn sheet_mut(&mut self, id: SheetId) -> Option<&mut Sheet> {
        self.sheets.get_mut(id as usize).filter(|s| !s.removed)
    }

    /// Reaches a sheet regardless of its tombstone, for undo and audit paths.
    pub fn sheet_including_removed_mut(&mut self, id: SheetId) -> Option<&mut Sheet> {
        self.sheets.get_mut(id as usize)
    }

    /// Looks a live sheet up by name. Sheet names are case-insensitive in Excel.
    pub fn sheet_by_name(&self, name: &str) -> Option<&Sheet> {
        self.sheets.iter().find(|s| !s.removed && s.name.eq_ignore_ascii_case(name))
    }

    /// Tombstones a sheet. Returns `false` if it was already gone.
    pub fn remove_sheet(&mut self, id: SheetId) -> bool {
        match self.sheets.get_mut(id as usize) {
            Some(sheet) if !sheet.removed => {
                sheet.removed = true;
                true
            }
            _ => false,
        }
    }

    /// Brings a tombstoned sheet back, with its cells intact.
    pub fn restore_sheet(&mut self, id: SheetId) -> bool {
        match self.sheets.get_mut(id as usize) {
            Some(sheet) if sheet.removed => {
                sheet.removed = false;
                true
            }
            _ => false,
        }
    }

    pub fn sheet_id_by_name(&self, name: &str) -> Option<SheetId> {
        self.sheet_by_name(name).map(|s| s.id)
    }

    /// Live sheets, in workbook order.
    pub fn sheets(&self) -> impl Iterator<Item = &Sheet> {
        self.sheets.iter().filter(|s| !s.removed)
    }

    pub fn rename_sheet(&mut self, id: SheetId, name: impl Into<String>) -> bool {
        match self.sheets.get_mut(id as usize) {
            Some(sheet) => {
                sheet.name = name.into();
                true
            }
            None => false,
        }
    }

    /// Reads a cell's value through a qualified address.
    pub fn value(&self, addr: CellAddr) -> Value {
        self.sheet(addr.sheet).map(|s| s.value(addr.col, addr.row)).unwrap_or(Value::Blank)
    }

    pub fn content(&self, addr: CellAddr) -> CellContent {
        self.sheet(addr.sheet).map(|s| s.content(addr.col, addr.row)).unwrap_or(CellContent::Empty)
    }

    pub fn define_name(&mut self, name: DefinedName) -> Option<DefinedName> {
        self.names.insert(name.name.to_uppercase(), name)
    }

    pub fn name(&self, name: &str) -> Option<&DefinedName> {
        self.names.get(&name.to_uppercase())
    }

    pub fn remove_name(&mut self, name: &str) -> Option<DefinedName> {
        self.names.remove(&name.to_uppercase())
    }

    /// Defined names in a stable order.
    pub fn names(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.values()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Workbook {
        let mut wb = Workbook::new();
        let s = wb.add_sheet("Sheet1");
        let sheet = wb.sheet_mut(s).unwrap();
        sheet.set(1, 2, Cell::literal(Value::number(10)));
        sheet.set(0, 0, Cell::literal(Value::text("hi")));
        sheet.set(3, 1, Cell::formula("A1+1"));
        wb
    }

    #[test]
    fn cells_iterate_row_major_regardless_of_insertion_order() {
        let wb = sample();
        let coords: Vec<_> = wb.sheet(0).unwrap().iter().map(|(c, r, _)| (c, r)).collect();
        assert_eq!(coords, vec![(0, 0), (3, 1), (1, 2)]);
    }

    #[test]
    fn used_range_covers_every_written_cell() {
        let wb = sample();
        assert_eq!(wb.sheet(0).unwrap().used_range().unwrap().to_a1(), "A1:D3");
        assert_eq!(Sheet::new(0, "x").used_range(), None);
    }

    #[test]
    fn range_iteration_stays_inside_the_column_bounds() {
        let mut sheet = Sheet::new(0, "s");
        for (col, row) in [(0, 0), (5, 0), (0, 1), (5, 1)] {
            sheet.set(col, row, Cell::literal(Value::number(1)));
        }
        let range = RangeRef::parse_a1("A1:A2").unwrap();
        let hit: Vec<_> = sheet.iter_range(&range).map(|(c, r, _)| (c, r)).collect();
        assert_eq!(hit, vec![(0, 0), (0, 1)]);
    }

    #[test]
    fn writing_an_empty_cell_removes_it() {
        let mut sheet = Sheet::new(0, "s");
        sheet.set(0, 0, Cell::literal(Value::number(1)));
        sheet.set(0, 0, Cell { content: CellContent::Empty, value: Value::Blank });
        assert_eq!(sheet.cell_count(), 0);
    }

    #[test]
    fn removing_a_sheet_keeps_ids_stable_and_is_reversible() {
        let mut wb = sample();
        let second = wb.add_sheet("Sheet2");
        assert!(wb.remove_sheet(0));
        assert!(wb.sheet(0).is_none());
        assert_eq!(wb.sheets().count(), 1);
        // The surviving sheet keeps the id it was given.
        assert_eq!(second, 1);
        assert!(wb.restore_sheet(0));
        assert_eq!(wb.sheet(0).unwrap().cell_count(), 3);
    }

    #[test]
    fn sheet_and_name_lookup_ignore_case() {
        let mut wb = sample();
        assert_eq!(wb.sheet_id_by_name("sheet1"), Some(0));
        wb.define_name(DefinedName {
            name: "Tax".into(),
            refers_to: "Sheet1!$A$1".into(),
            scope: None,
        });
        assert_eq!(wb.name("TAX").unwrap().refers_to, "Sheet1!$A$1");
    }

    #[test]
    fn computed_values_do_not_touch_the_input() {
        let mut wb = sample();
        let sheet = wb.sheet_mut(0).unwrap();
        sheet.set_computed_value(3, 1, Value::number(42));
        assert_eq!(sheet.value(3, 1), Value::number(42));
        assert_eq!(sheet.content(3, 1), CellContent::formula("A1+1"));
    }
}
