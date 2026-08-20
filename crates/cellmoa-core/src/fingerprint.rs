//! Content fingerprints for workbooks.
//!
//! A fingerprint answers "is this the same spreadsheet?" without comparing
//! files. Two files that differ only in how they were saved — a different
//! timestamp in the archive, parts in a different order, a recalculation that
//! changed nothing — must fingerprint the same. Two that differ in a single
//! cell must not.
//!
//! Three digests are produced, because "the same" means different things:
//!
//! * `inputs` covers what a person put in — formulas, literals, formatting,
//!   names. It answers "has anyone edited this?"
//! * `values` covers what the sheet shows. It answers "did the results move?"
//!   A formula rewritten to compute the same thing leaves it unchanged.
//! * `workbook` covers both, and is the document's identity.

use crate::model::{CellContent, Sheet, Workbook};
use crate::sha256::Sha256;
use crate::value::Value;

/// The fingerprints of one sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetFingerprint {
    pub name: String,
    pub inputs: String,
    pub values: String,
}

/// The fingerprints of a workbook.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    /// What was entered: formulas, literals, formats and names.
    pub inputs: String,
    /// What the sheets show.
    pub values: String,
    /// Both together — the document's identity.
    pub workbook: String,
    /// Per sheet, so a comparison can skip the ones that match.
    pub sheets: Vec<SheetFingerprint>,
}

/// Feeds a hasher unambiguously.
///
/// Every field is written with its length, so no two different documents can
/// produce the same byte stream by concatenating differently — a sheet called
/// `ab` with a cell `c` must not hash like a sheet `a` with a cell `bc`.
struct Canonical {
    hasher: Sha256,
}

impl Canonical {
    fn new(domain: &str) -> Canonical {
        let mut canonical = Canonical { hasher: Sha256::new() };
        // The domain tag keeps the digests of different questions distinct even
        // when the content underneath happens to be identical.
        canonical.text(domain);
        canonical
    }

    fn tag(&mut self, tag: u8) -> &mut Canonical {
        self.hasher.update(&[tag]);
        self
    }

    fn integer(&mut self, value: u64) -> &mut Canonical {
        self.hasher.update(&value.to_be_bytes());
        self
    }

    fn text(&mut self, value: &str) -> &mut Canonical {
        self.integer(value.len() as u64);
        self.hasher.update(value.as_bytes());
        self
    }

    fn number(&mut self, value: f64) -> &mut Canonical {
        // Negative zero compares equal to zero, so it must hash the same.
        let value = if value == 0.0 { 0.0 } else { value };
        self.hasher.update(&value.to_bits().to_be_bytes());
        self
    }

    fn value(&mut self, value: &Value) -> &mut Canonical {
        match value {
            Value::Blank => self.tag(0),
            Value::Number(n) => self.tag(1).number(*n),
            Value::Text(s) => self.tag(2).text(s),
            Value::Bool(b) => self.tag(3).integer(u64::from(*b)),
            Value::Error(e) => self.tag(4).text(e.as_str()),
        }
    }

    fn finish(self) -> String {
        self.hasher.finish_hex()
    }
}

/// Computes the fingerprints of a workbook.
pub fn fingerprint(workbook: &Workbook) -> Fingerprint {
    let mut inputs = Canonical::new("cellmoa/inputs/1");
    let mut values = Canonical::new("cellmoa/values/1");
    let mut sheets = Vec::new();

    // Sheet order is part of the document, so it is hashed as a sequence.
    for sheet in workbook.sheets() {
        let digests = fingerprint_sheet(sheet);
        inputs.text(&digests.inputs);
        values.text(&digests.values);
        sheets.push(digests);
    }

    // Defined names belong to the inputs; they are written by a person and are
    // not something a recalculation can change.
    // A marker between the sheets and the names, so a sheet cannot be
    // mistaken for a name.
    inputs.tag(0xFF);
    for name in workbook.names() {
        inputs.text(&name.name).text(&name.refers_to);
        match name.scope {
            Some(scope) => inputs.tag(1).integer(scope as u64),
            None => inputs.tag(0),
        };
    }

    let inputs = inputs.finish();
    let values = values.finish();
    let mut workbook_digest = Canonical::new("cellmoa/workbook/1");
    workbook_digest.text(&inputs).text(&values);
    Fingerprint { inputs, values, workbook: workbook_digest.finish(), sheets }
}

/// Computes the fingerprints of one sheet.
pub fn fingerprint_sheet(sheet: &Sheet) -> SheetFingerprint {
    let mut inputs = Canonical::new("cellmoa/sheet-inputs/1");
    let mut values = Canonical::new("cellmoa/sheet-values/1");
    inputs.text(&sheet.name);
    values.text(&sheet.name);

    // Cells iterate in row-major order regardless of how they were written, so
    // the same sheet built two different ways hashes the same.
    for (col, row, cell) in sheet.iter() {
        // A cell that shows nothing and holds nothing contributes nothing, so
        // that clearing a cell and never touching it are the same document.
        if !matches!(cell.content, CellContent::Empty) || cell.style.is_some() {
            inputs.integer(col as u64).integer(row as u64);
            match &cell.content {
                CellContent::Empty => inputs.tag(0),
                CellContent::Literal(v) => inputs.tag(1).value(v),
                CellContent::Formula(src) => inputs.tag(2).text(src),
            };
            match cell.style {
                Some(style) => inputs.tag(1).integer(style as u64),
                None => inputs.tag(0),
            };
        }
        if !cell.value.is_blank() {
            values.integer(col as u64).integer(row as u64).value(&cell.value);
        }
    }

    SheetFingerprint { name: sheet.name.clone(), inputs: inputs.finish(), values: values.finish() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Cell, CellAddr, DefinedName};

    fn workbook_with(build: impl Fn(&mut Workbook)) -> Workbook {
        let mut workbook = Workbook::new();
        workbook.add_sheet("Sheet1");
        build(&mut workbook);
        workbook
    }

    fn set(workbook: &mut Workbook, col: u32, row: u32, cell: Cell) {
        workbook.sheet_mut(0).unwrap().set(col, row, cell);
    }

    #[test]
    fn the_same_content_built_in_a_different_order_fingerprints_the_same() {
        let first = workbook_with(|w| {
            set(w, 0, 0, Cell::literal(Value::Number(1.0)));
            set(w, 5, 5, Cell::literal(Value::Text("x".into())));
            set(w, 1, 0, Cell::formula("A1*2"));
        });
        let second = workbook_with(|w| {
            set(w, 5, 5, Cell::literal(Value::Text("x".into())));
            set(w, 1, 0, Cell::formula("A1*2"));
            set(w, 0, 0, Cell::literal(Value::Number(1.0)));
        });
        assert_eq!(fingerprint(&first).workbook, fingerprint(&second).workbook);
    }

    #[test]
    fn the_revision_and_the_edit_history_do_not_affect_it() {
        use crate::edit::{Actor, Document, Op};
        let mut document = Document::new(workbook_with(|_| {}));
        document
            .apply(
                Actor::human("u"),
                vec![Op::SetCell {
                    addr: CellAddr::new(0, 0, 0),
                    content: CellContent::Literal(Value::Number(1.0)),
                }],
                None,
            )
            .unwrap();
        let after_one_edit = fingerprint(&document.workbook).workbook;

        // Set it to something else and back again: a different history, the
        // same document.
        for value in [2.0, 1.0] {
            document
                .apply(
                    Actor::agent("a"),
                    vec![Op::SetCell {
                        addr: CellAddr::new(0, 0, 0),
                        content: CellContent::Literal(Value::Number(value)),
                    }],
                    None,
                )
                .unwrap();
        }
        assert_eq!(document.revision(), 3);
        assert_eq!(fingerprint(&document.workbook).workbook, after_one_edit);
    }

    #[test]
    fn changing_one_cell_changes_the_fingerprint() {
        let before =
            fingerprint(&workbook_with(|w| set(w, 0, 0, Cell::literal(Value::Number(1.0)))));
        let after =
            fingerprint(&workbook_with(|w| set(w, 0, 0, Cell::literal(Value::Number(2.0)))));
        assert_ne!(before.workbook, after.workbook);
        assert_ne!(before.inputs, after.inputs);
        assert_ne!(before.values, after.values);
    }

    #[test]
    fn a_rewritten_formula_that_computes_the_same_leaves_the_values_digest_alone() {
        let make = |source: &str| {
            workbook_with(|w| {
                set(
                    w,
                    0,
                    0,
                    Cell {
                        content: CellContent::formula(source),
                        value: Value::Number(4.0),
                        style: None,
                    },
                )
            })
        };
        let before = fingerprint(&make("2*2"));
        let after = fingerprint(&make("SUM(2,2)"));
        assert_eq!(before.values, after.values, "the results did not move");
        assert_ne!(before.inputs, after.inputs, "but the document was edited");
        assert_ne!(before.workbook, after.workbook);
    }

    #[test]
    fn clearing_a_cell_returns_to_the_original_fingerprint() {
        let empty = fingerprint(&workbook_with(|_| {})).workbook;
        let mut workbook = workbook_with(|w| set(w, 3, 3, Cell::literal(Value::Number(9.0))));
        assert_ne!(fingerprint(&workbook).workbook, empty);
        workbook.sheet_mut(0).unwrap().clear(3, 3);
        assert_eq!(fingerprint(&workbook).workbook, empty);
    }

    #[test]
    fn formatting_counts_as_an_edit_but_not_as_a_result() {
        let plain = workbook_with(|w| set(w, 0, 0, Cell::literal(Value::Number(1.0))));
        let formatted =
            workbook_with(|w| set(w, 0, 0, Cell::literal(Value::Number(1.0)).with_style(Some(3))));
        let (a, b) = (fingerprint(&plain), fingerprint(&formatted));
        assert_ne!(a.inputs, b.inputs);
        assert_eq!(a.values, b.values);
    }

    #[test]
    fn adjacent_names_cannot_be_confused_with_each_other() {
        // Without length prefixes these two would hash identically.
        let first = workbook_with(|w| {
            w.rename_sheet(0, "ab");
            set(w, 0, 0, Cell::literal(Value::Text("c".into())));
        });
        let second = workbook_with(|w| {
            w.rename_sheet(0, "a");
            set(w, 0, 0, Cell::literal(Value::Text("bc".into())));
        });
        assert_ne!(fingerprint(&first).workbook, fingerprint(&second).workbook);
    }

    #[test]
    fn sheet_order_is_part_of_the_document() {
        let mut first = Workbook::new();
        first.add_sheet("A");
        first.add_sheet("B");
        let mut second = Workbook::new();
        second.add_sheet("B");
        second.add_sheet("A");
        assert_ne!(fingerprint(&first).workbook, fingerprint(&second).workbook);
    }

    #[test]
    fn per_sheet_digests_let_a_comparison_skip_what_matches() {
        let build = |value: f64| {
            let mut workbook = Workbook::new();
            workbook.add_sheet("Untouched");
            let changing = workbook.add_sheet("Changing");
            workbook.sheet_mut(0).unwrap().set(0, 0, Cell::literal(Value::Number(1.0)));
            workbook.sheet_mut(changing).unwrap().set(0, 0, Cell::literal(Value::Number(value)));
            workbook
        };
        let (before, after) = (fingerprint(&build(1.0)), fingerprint(&build(2.0)));
        assert_eq!(before.sheets[0], after.sheets[0]);
        assert_ne!(before.sheets[1], after.sheets[1]);
    }

    #[test]
    fn defined_names_are_part_of_the_inputs() {
        let plain = fingerprint(&workbook_with(|_| {}));
        let named = fingerprint(&workbook_with(|w| {
            w.define_name(DefinedName {
                name: "Tax".into(),
                refers_to: "Sheet1!$A$1".into(),
                scope: None,
            });
        }));
        assert_ne!(plain.inputs, named.inputs);
        assert_eq!(plain.values, named.values);
    }

    #[test]
    fn negative_zero_hashes_like_zero() {
        let positive = workbook_with(|w| set(w, 0, 0, Cell::literal(Value::Number(0.0))));
        let negative = workbook_with(|w| set(w, 0, 0, Cell::literal(Value::Number(-0.0))));
        assert_eq!(fingerprint(&positive).workbook, fingerprint(&negative).workbook);
    }

    #[test]
    fn a_digest_is_a_full_length_hex_sha256() {
        let digest = fingerprint(&workbook_with(|_| {})).workbook;
        assert_eq!(digest.len(), 64);
        assert!(digest.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
