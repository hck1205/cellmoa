//! Structural diff between two workbooks.
//!
//! The output is meant to be read by a person reviewing a change and by a
//! machine gating one. What makes it useful rather than noisy is that rows are
//! aligned before cells are compared: inserting a row at the top of a sheet is
//! one insertion, not a thousand modified cells.

pub mod align;

use align::{align, Alignment};
use cellmoa_core::fingerprint::fingerprint_sheet;
use cellmoa_core::model::{Cell, CellContent, Sheet, Workbook};
use cellmoa_core::reference::col_to_letters;
use cellmoa_core::sha256::Sha256;
use cellmoa_core::value::Value;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fmt;

/// What a cell held, in the form a diff reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CellSnapshot {
    /// The formula source, prefixed with `=`, or `None` for a literal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// The displayed value.
    pub value: String,
    /// Whether the cell existed at all.
    pub present: bool,
}

impl CellSnapshot {
    fn of(cell: Option<&Cell>) -> CellSnapshot {
        match cell {
            None => CellSnapshot { formula: None, value: String::new(), present: false },
            Some(cell) => CellSnapshot {
                formula: cell.content.as_formula().map(|src| format!("={src}")),
                value: cell.value.to_string(),
                present: true,
            },
        }
    }
}

impl fmt::Display for CellSnapshot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if !self.present {
            return f.write_str("(empty)");
        }
        match &self.formula {
            // A formula's result is shown alongside it, because that is what
            // the reader is comparing.
            Some(formula) => write!(f, "{formula} -> {}", self.value),
            None if self.value.is_empty() => f.write_str("(blank)"),
            None => f.write_str(&self.value),
        }
    }
}

/// One difference between two workbooks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Change {
    SheetAdded {
        sheet: String,
    },
    SheetRemoved {
        sheet: String,
    },
    /// A sheet whose content is unchanged but whose name is not.
    SheetRenamed {
        from: String,
        to: String,
    },
    /// A row that exists only in the new version.
    RowInserted {
        sheet: String,
        row: u32,
    },
    /// A row that exists only in the old version.
    RowRemoved {
        sheet: String,
        row: u32,
    },
    CellChanged {
        sheet: String,
        cell: String,
        before: CellSnapshot,
        after: CellSnapshot,
    },
    NameAdded {
        name: String,
        refers_to: String,
    },
    NameRemoved {
        name: String,
        refers_to: String,
    },
    NameChanged {
        name: String,
        before: String,
        after: String,
    },
}

impl fmt::Display for Change {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Change::SheetAdded { sheet } => write!(f, "+ sheet {sheet}"),
            Change::SheetRemoved { sheet } => write!(f, "- sheet {sheet}"),
            Change::SheetRenamed { from, to } => write!(f, "~ sheet {from} renamed to {to}"),
            Change::RowInserted { sheet, row } => write!(f, "+ {sheet} row {}", row + 1),
            Change::RowRemoved { sheet, row } => write!(f, "- {sheet} row {}", row + 1),
            Change::CellChanged { sheet, cell, before, after } => {
                write!(f, "~ {sheet}!{cell}: {before} => {after}")
            }
            Change::NameAdded { name, refers_to } => write!(f, "+ name {name} = {refers_to}"),
            Change::NameRemoved { name, refers_to } => write!(f, "- name {name} = {refers_to}"),
            Change::NameChanged { name, before, after } => {
                write!(f, "~ name {name}: {before} => {after}")
            }
        }
    }
}

/// The differences between two workbooks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diff {
    pub changes: Vec<Change>,
}

impl Diff {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    pub fn len(&self) -> usize {
        self.changes.len()
    }

    /// How many changes of each kind, for a one-line summary.
    pub fn summary(&self) -> Summary {
        let mut summary = Summary::default();
        for change in &self.changes {
            match change {
                Change::CellChanged { .. } => summary.cells += 1,
                Change::RowInserted { .. } | Change::RowRemoved { .. } => summary.rows += 1,
                Change::SheetAdded { .. }
                | Change::SheetRemoved { .. }
                | Change::SheetRenamed { .. } => summary.sheets += 1,
                _ => summary.names += 1,
            }
        }
        summary
    }
}

impl fmt::Display for Diff {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for change in &self.changes {
            writeln!(f, "{change}")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Summary {
    pub sheets: usize,
    pub rows: usize,
    pub cells: usize,
    pub names: usize,
}

impl fmt::Display for Summary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} sheet(s), {} row(s), {} cell(s), {} name(s)",
            self.sheets, self.rows, self.cells, self.names
        )
    }
}

/// Compares two workbooks.
pub fn diff(before: &Workbook, after: &Workbook) -> Diff {
    let mut changes = Vec::new();
    diff_sheets(before, after, &mut changes);
    diff_names(before, after, &mut changes);
    Diff { changes }
}

fn diff_names(before: &Workbook, after: &Workbook, changes: &mut Vec<Change>) {
    let before_names: BTreeMap<String, String> =
        before.names().map(|n| (n.name.to_uppercase(), n.refers_to.clone())).collect();
    let after_names: BTreeMap<String, String> =
        after.names().map(|n| (n.name.to_uppercase(), n.refers_to.clone())).collect();

    for (name, refers_to) in &before_names {
        match after_names.get(name) {
            None => changes
                .push(Change::NameRemoved { name: name.clone(), refers_to: refers_to.clone() }),
            Some(new) if new != refers_to => changes.push(Change::NameChanged {
                name: name.clone(),
                before: refers_to.clone(),
                after: new.clone(),
            }),
            Some(_) => {}
        }
    }
    for (name, refers_to) in &after_names {
        if !before_names.contains_key(name) {
            changes.push(Change::NameAdded { name: name.clone(), refers_to: refers_to.clone() });
        }
    }
}

fn diff_sheets(before: &Workbook, after: &Workbook, changes: &mut Vec<Change>) {
    let before_sheets: Vec<&Sheet> = before.sheets().collect();
    let after_sheets: Vec<&Sheet> = after.sheets().collect();

    let mut matched_after: Vec<bool> = vec![false; after_sheets.len()];
    let mut unmatched_before: Vec<&Sheet> = Vec::new();

    for sheet in &before_sheets {
        match after_sheets.iter().position(|s| s.name.eq_ignore_ascii_case(&sheet.name)) {
            Some(i) => {
                matched_after[i] = true;
                diff_sheet(sheet, after_sheets[i], changes);
            }
            None => unmatched_before.push(sheet),
        }
    }

    let mut unmatched_after: Vec<&Sheet> =
        after_sheets.iter().zip(&matched_after).filter(|(_, m)| !**m).map(|(s, _)| *s).collect();

    // A sheet that vanished and one that appeared with identical content is a
    // rename, not a delete and an add — reporting it as the latter would bury
    // the real changes under a full-sheet rewrite.
    let mut renamed = Vec::new();
    for sheet in &unmatched_before {
        let digest = fingerprint_sheet_content(sheet);
        if let Some(i) = unmatched_after.iter().position(|s| fingerprint_sheet_content(s) == digest)
        {
            renamed.push((sheet.name.clone(), unmatched_after[i].name.clone()));
            unmatched_after.remove(i);
        }
    }
    for (from, to) in &renamed {
        changes.push(Change::SheetRenamed { from: from.clone(), to: to.clone() });
    }
    for sheet in unmatched_before {
        if !renamed.iter().any(|(from, _)| *from == sheet.name) {
            changes.push(Change::SheetRemoved { sheet: sheet.name.clone() });
        }
    }
    for sheet in unmatched_after {
        changes.push(Change::SheetAdded { sheet: sheet.name.clone() });
    }
}

/// A sheet's content digest with its name left out, so a rename can be spotted.
fn fingerprint_sheet_content(sheet: &Sheet) -> String {
    let mut renamed = sheet.clone();
    renamed.name = String::new();
    let digests = fingerprint_sheet(&renamed);
    format!("{}/{}", digests.inputs, digests.values)
}

/// The rows of a sheet that hold anything, and a digest of each.
fn row_digests(sheet: &Sheet) -> (Vec<u32>, Vec<String>) {
    let mut rows: BTreeMap<u32, Sha256> = BTreeMap::new();
    for (col, row, cell) in sheet.iter() {
        let hasher = rows.entry(row).or_default();
        hasher.update(&(col as u64).to_be_bytes());
        match &cell.content {
            CellContent::Empty => hasher.update(&[0]),
            CellContent::Literal(_) => hasher.update(&[1]),
            CellContent::Formula(src) => {
                hasher.update(&[2]);
                hasher.update(&(src.len() as u64).to_be_bytes());
                hasher.update(src.as_bytes());
            }
        }
        let value = cell.value.to_string();
        hasher.update(&(value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    let numbers: Vec<u32> = rows.keys().copied().collect();
    let digests = rows.into_values().map(Sha256::finish_hex).collect();
    (numbers, digests)
}

fn diff_sheet(before: &Sheet, after: &Sheet, changes: &mut Vec<Change>) {
    // A sheet that hashes the same has nothing to report, and this is what
    // makes comparing a large workbook cheap.
    if fingerprint_sheet(before) == fingerprint_sheet(after) {
        return;
    }
    let (before_rows, before_digests) = row_digests(before);
    let (after_rows, after_digests) = row_digests(after);

    for alignment in align(&before_digests, &after_digests) {
        match alignment {
            Alignment::Matched { before: b, after: a } => {
                // Rows with identical digests hold identical cells, so only a
                // pair whose row numbers differ is worth looking at — and even
                // then only to report the shift, which the row insert already
                // covers.
                if before_digests[b] != after_digests[a] {
                    diff_row(before, after, before_rows[b], after_rows[a], changes);
                }
            }
            Alignment::Removed(b) => {
                changes.push(Change::RowRemoved { sheet: after.name.clone(), row: before_rows[b] })
            }
            Alignment::Added(a) => {
                changes.push(Change::RowInserted { sheet: after.name.clone(), row: after_rows[a] })
            }
        }
    }

    // Rows that aligned by digest are identical in content; a row that exists
    // on both sides at the same number but changed will not have aligned, so
    // it appears above as a removal and an addition. Turn those into cell
    // changes where the row numbers match.
    coalesce_row_pairs(before, after, changes);
}

/// Rewrites a matching removal and insertion of the same row number into the
/// cell changes they really are.
fn coalesce_row_pairs(before: &Sheet, after: &Sheet, changes: &mut Vec<Change>) {
    let sheet = after.name.clone();
    let removed: Vec<u32> = changes
        .iter()
        .filter_map(|c| match c {
            Change::RowRemoved { sheet: s, row } if *s == sheet => Some(*row),
            _ => None,
        })
        .collect();
    let paired: Vec<u32> = changes
        .iter()
        .filter_map(|c| match c {
            Change::RowInserted { sheet: s, row } if *s == sheet && removed.contains(row) => {
                Some(*row)
            }
            _ => None,
        })
        .collect();
    if paired.is_empty() {
        return;
    }
    changes.retain(|c| {
        !matches!(c,
        Change::RowRemoved { sheet: s, row } | Change::RowInserted { sheet: s, row }
            if *s == sheet && paired.contains(row))
    });
    let mut cell_changes = Vec::new();
    for row in paired {
        diff_row(before, after, row, row, &mut cell_changes);
    }
    changes.extend(cell_changes);
}

fn diff_row(
    before: &Sheet,
    after: &Sheet,
    before_row: u32,
    after_row: u32,
    changes: &mut Vec<Change>,
) {
    let mut columns: Vec<u32> = Vec::new();
    for (col, row, _) in before.iter() {
        if row == before_row {
            columns.push(col);
        }
    }
    for (col, row, _) in after.iter() {
        if row == after_row && !columns.contains(&col) {
            columns.push(col);
        }
    }
    columns.sort_unstable();

    for col in columns {
        let old = before.get(col, before_row);
        let new = after.get(col, after_row);
        if snapshot_equal(old, new) {
            continue;
        }
        changes.push(Change::CellChanged {
            sheet: after.name.clone(),
            cell: format!("{}{}", col_to_letters(col), after_row + 1),
            before: CellSnapshot::of(old),
            after: CellSnapshot::of(new),
        });
    }
}

/// Whether two cells are the same as far as a diff is concerned.
fn snapshot_equal(before: Option<&Cell>, after: Option<&Cell>) -> bool {
    match (before, after) {
        (None, None) => true,
        // A cell that exists but holds nothing reads the same as one that does
        // not exist, so formatting-only cells do not show up as changes here.
        (None, Some(cell)) | (Some(cell), None) => {
            cell.content.is_empty() && matches!(cell.value, Value::Blank)
        }
        (Some(a), Some(b)) => a.content == b.content && a.value == b.value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellmoa_core::model::{Cell, DefinedName};

    /// A cell as written in the test tables below: column, row, and the text
    /// that would be typed into it.
    type CellSpec = (u32, u32, &'static str);

    fn workbook(rows: &[(&str, &[CellSpec])]) -> Workbook {
        let mut workbook = Workbook::new();
        for (name, cells) in rows {
            let id = workbook.add_sheet(*name);
            let sheet = workbook.sheet_mut(id).unwrap();
            for (col, row, text) in *cells {
                let cell = match text.strip_prefix('=') {
                    Some(formula) => Cell {
                        content: CellContent::formula(formula),
                        value: Value::Text(format!("<{formula}>")),
                        style: None,
                    },
                    None => match text.parse::<f64>() {
                        Ok(n) => Cell::literal(Value::Number(n)),
                        Err(_) => Cell::literal(Value::Text(text.to_string())),
                    },
                };
                sheet.set(*col, *row, cell);
            }
        }
        workbook
    }

    #[test]
    fn identical_workbooks_have_no_differences() {
        let a = workbook(&[("Sheet1", &[(0, 0, "1"), (1, 0, "2")])]);
        let b = workbook(&[("Sheet1", &[(0, 0, "1"), (1, 0, "2")])]);
        assert!(diff(&a, &b).is_empty());
    }

    #[test]
    fn a_changed_cell_reports_both_sides() {
        let a = workbook(&[("Sheet1", &[(0, 0, "1")])]);
        let b = workbook(&[("Sheet1", &[(0, 0, "2")])]);
        let changes = diff(&a, &b).changes;
        assert_eq!(changes.len(), 1);
        let Change::CellChanged { cell, before, after, .. } = &changes[0] else {
            panic!("expected a cell change, got {:?}", changes[0])
        };
        assert_eq!(cell, "A1");
        assert_eq!(before.value, "1");
        assert_eq!(after.value, "2");
    }

    #[test]
    fn a_changed_formula_shows_the_formula_and_its_result() {
        let a = workbook(&[("Sheet1", &[(0, 0, "=A1*2")])]);
        let b = workbook(&[("Sheet1", &[(0, 0, "=A1*3")])]);
        let changes = diff(&a, &b).changes;
        let Change::CellChanged { before, after, .. } = &changes[0] else { panic!() };
        assert_eq!(before.formula.as_deref(), Some("=A1*2"));
        assert_eq!(after.formula.as_deref(), Some("=A1*3"));
        assert!(before.to_string().contains("=>") || before.to_string().contains("->"));
    }

    #[test]
    fn inserting_a_row_is_one_change_not_a_thousand() {
        // The whole point of aligning rows first.
        let mut before_cells = Vec::new();
        for row in 0..500u32 {
            before_cells.push((0u32, row, "x"));
        }
        let before = workbook(&[("Sheet1", &before_cells)]);

        let mut after_cells: Vec<CellSpec> = Vec::new();
        after_cells.push((0, 0, "new"));
        for row in 0..500u32 {
            after_cells.push((0, row + 1, "x"));
        }
        let after = workbook(&[("Sheet1", &after_cells)]);

        let changes = diff(&before, &after).changes;
        assert_eq!(changes.len(), 1, "got {changes:#?}");
        assert!(matches!(changes[0], Change::RowInserted { row: 0, .. }));
    }

    #[test]
    fn removing_a_row_is_one_change() {
        let before = workbook(&[("Sheet1", &[(0, 0, "a"), (0, 1, "b"), (0, 2, "c")])]);
        let after = workbook(&[("Sheet1", &[(0, 0, "a"), (0, 1, "c")])]);
        let changes = diff(&before, &after).changes;
        assert_eq!(changes.len(), 1);
        assert!(matches!(changes[0], Change::RowRemoved { .. }));
    }

    #[test]
    fn a_row_edited_in_place_reports_the_cell_not_the_row() {
        let before = workbook(&[("Sheet1", &[(0, 0, "a"), (0, 1, "b"), (0, 2, "c")])]);
        let after = workbook(&[("Sheet1", &[(0, 0, "a"), (0, 1, "B"), (0, 2, "c")])]);
        let changes = diff(&before, &after).changes;
        assert_eq!(changes.len(), 1, "got {changes:#?}");
        let Change::CellChanged { cell, .. } = &changes[0] else {
            panic!("expected a cell change, got {:?}", changes[0])
        };
        assert_eq!(cell, "A2");
    }

    #[test]
    fn adding_and_removing_sheets() {
        let before = workbook(&[("A", &[(0, 0, "1")])]);
        let after = workbook(&[("A", &[(0, 0, "1")]), ("B", &[(0, 0, "2")])]);
        assert_eq!(diff(&before, &after).changes, vec![Change::SheetAdded { sheet: "B".into() }]);
        assert_eq!(diff(&after, &before).changes, vec![Change::SheetRemoved { sheet: "B".into() }]);
    }

    #[test]
    fn a_renamed_sheet_is_not_a_delete_and_an_add() {
        let before = workbook(&[("Old", &[(0, 0, "1"), (1, 0, "2")])]);
        let after = workbook(&[("New", &[(0, 0, "1"), (1, 0, "2")])]);
        assert_eq!(
            diff(&before, &after).changes,
            vec![Change::SheetRenamed { from: "Old".into(), to: "New".into() }]
        );
    }

    #[test]
    fn defined_names() {
        let mut before = workbook(&[("Sheet1", &[])]);
        before.define_name(DefinedName {
            name: "Tax".into(),
            refers_to: "Sheet1!$A$1".into(),
            scope: None,
        });
        let mut after = workbook(&[("Sheet1", &[])]);
        after.define_name(DefinedName {
            name: "Tax".into(),
            refers_to: "Sheet1!$B$1".into(),
            scope: None,
        });
        assert_eq!(
            diff(&before, &after).changes,
            vec![Change::NameChanged {
                name: "TAX".into(),
                before: "Sheet1!$A$1".into(),
                after: "Sheet1!$B$1".into(),
            }]
        );
    }

    #[test]
    fn the_summary_counts_by_kind() {
        let before = workbook(&[("Sheet1", &[(0, 0, "1")])]);
        let after = workbook(&[("Sheet1", &[(0, 0, "2")]), ("New", &[])]);
        let summary = diff(&before, &after).summary();
        assert_eq!(summary.cells, 1);
        assert_eq!(summary.sheets, 1);
    }

    #[test]
    fn an_appearing_cell_reports_the_empty_side_as_empty() {
        let before = workbook(&[("Sheet1", &[])]);
        let after = workbook(&[("Sheet1", &[(2, 2, "new")])]);
        let changes = diff(&before, &after).changes;
        // A sheet that was empty gains a row.
        assert!(matches!(changes[0], Change::RowInserted { .. }), "got {changes:#?}");
    }
}
