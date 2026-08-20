//! Reading an XLSX package into a workbook.

use crate::xml::{Element, Event, Reader, XmlError};
use crate::zip::{Archive, ZipError};
use cellmoa_core::model::{Cell, CellContent, DefinedName, Sheet, Workbook};
use cellmoa_core::reference::{CellRef, RangeRef};
use cellmoa_core::value::{CellError, Value};
use cellmoa_formula::ast::Expr;
use cellmoa_formula::parse;
use cellmoa_formula::translate::translate;
use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug)]
pub enum ReadError {
    Zip(ZipError),
    Xml(XmlError),
    /// The package is a ZIP but not a spreadsheet.
    NotAWorkbook(String),
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadError::Zip(e) => write!(f, "{e}"),
            ReadError::Xml(e) => write!(f, "{e}"),
            ReadError::NotAWorkbook(what) => write!(f, "not a workbook: {what}"),
        }
    }
}

impl std::error::Error for ReadError {}

impl From<ZipError> for ReadError {
    fn from(e: ZipError) -> ReadError {
        ReadError::Zip(e)
    }
}

impl From<XmlError> for ReadError {
    fn from(e: XmlError) -> ReadError {
        ReadError::Xml(e)
    }
}

/// One sheet as listed in the workbook part.
struct SheetEntry {
    name: String,
    relationship: String,
}

/// Reads a workbook out of an archive.
pub fn read_workbook(archive: &Archive) -> Result<Workbook, ReadError> {
    let workbook_part = find_workbook_part(archive)
        .ok_or_else(|| ReadError::NotAWorkbook("no workbook part".into()))?;
    let (entries, defined_names) = read_workbook_part(archive.get(&workbook_part).unwrap())?;

    let relationships = read_relationships(archive, &workbook_part)?;
    let shared_strings = read_shared_strings(archive)?;

    let mut workbook = Workbook::new();
    let base = workbook_part.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    for entry in &entries {
        let id = workbook.add_sheet(entry.name.clone());
        let Some(target) = relationships.get(&entry.relationship) else { continue };
        let path = resolve(base, target);
        let Some(part) = archive.get(&path) else { continue };
        let sheet = workbook.sheet_mut(id).expect("just added");
        read_sheet(part, &shared_strings, sheet)?;
    }
    for name in defined_names {
        workbook.define_name(name);
    }
    Ok(workbook)
}

/// Locates the workbook part through the package relationships, falling back to
/// the conventional path.
fn find_workbook_part(archive: &Archive) -> Option<String> {
    if let Some(rels) = archive.get("_rels/.rels") {
        if let Ok(relationships) = read_relationship_targets(rels) {
            for (_, (target, kind)) in relationships {
                if kind.ends_with("/officeDocument") {
                    let path = resolve("", &target);
                    if archive.contains(&path) {
                        return Some(path);
                    }
                }
            }
        }
    }
    archive.contains("xl/workbook.xml").then(|| "xl/workbook.xml".to_string())
}

/// Resolves a relationship target against the part that declared it.
fn resolve(base: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    // A target may climb out of its base directory.
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for segment in target.split('/') {
        match segment {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// The relationships declared for a part, as `id -> target`.
fn read_relationships(
    archive: &Archive,
    part: &str,
) -> Result<BTreeMap<String, String>, ReadError> {
    let rels_path = match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None => format!("_rels/{part}.rels"),
    };
    let Some(bytes) = archive.get(&rels_path) else { return Ok(BTreeMap::new()) };
    Ok(read_relationship_targets(bytes)?
        .into_iter()
        .map(|(id, (target, _))| (id, target))
        .collect())
}

/// Parses a `.rels` part into `id -> (target, type)`.
fn read_relationship_targets(bytes: &[u8]) -> Result<BTreeMap<String, (String, String)>, XmlError> {
    let mut reader = Reader::from_bytes(bytes)?;
    let mut out = BTreeMap::new();
    loop {
        match reader.next_event()? {
            Event::Start(e) if e.name == "Relationship" => {
                if let (Some(id), Some(target)) = (e.attribute("Id"), e.attribute("Target")) {
                    out.insert(
                        id.to_string(),
                        (target.to_string(), e.attribute("Type").unwrap_or_default().to_string()),
                    );
                }
            }
            Event::Eof => return Ok(out),
            _ => {}
        }
    }
}

/// Reads the sheet list and defined names out of the workbook part.
fn read_workbook_part(bytes: &[u8]) -> Result<(Vec<SheetEntry>, Vec<DefinedName>), ReadError> {
    let mut reader = Reader::from_bytes(bytes)?;
    let mut sheets = Vec::new();
    let mut names = Vec::new();
    let mut pending_name: Option<(String, Option<u32>)> = None;
    loop {
        match reader.next_event()? {
            Event::Start(e) if e.name == "sheet" => {
                let name = e.attribute("name").unwrap_or_default().to_string();
                // The relationship id carries the namespace prefix the file
                // happens to use, so it is matched by suffix.
                let relationship = e
                    .attributes()
                    .find(|(key, _)| *key == "r:id" || key.ends_with(":id") || *key == "id")
                    .map(|(_, value)| value.to_string())
                    .unwrap_or_default();
                sheets.push(SheetEntry { name, relationship });
            }
            Event::Start(e) if e.name == "definedName" => {
                let name = e.attribute("name").unwrap_or_default().to_string();
                let scope = e.attribute("localSheetId").and_then(|s| s.parse().ok());
                pending_name = Some((name, scope));
            }
            Event::Text(text) => {
                if let Some((name, scope)) = pending_name.take() {
                    if !name.is_empty() {
                        names.push(DefinedName { name, refers_to: text, scope });
                    }
                }
            }
            Event::Eof => return Ok((sheets, names)),
            _ => {}
        }
    }
}

/// Reads the shared string table, which is where most text in a workbook lives.
fn read_shared_strings(archive: &Archive) -> Result<Vec<String>, ReadError> {
    let Some(bytes) = archive.get("xl/sharedStrings.xml") else { return Ok(Vec::new()) };
    let mut reader = Reader::from_bytes(bytes)?;
    let mut strings = Vec::new();
    let mut current: Option<String> = None;
    loop {
        match reader.next_event()? {
            Event::Start(e) if e.name == "si" => current = Some(String::new()),
            // A string can be split into runs by formatting; the runs join back
            // into one value.
            Event::Start(e) if e.name == "t" => {
                let text = reader.text_of("t")?;
                if let Some(buffer) = current.as_mut() {
                    buffer.push_str(&text);
                }
            }
            // Phonetic hints sit inside `si` but are not part of the string.
            Event::Start(e) if e.name == "rPh" => reader.skip_element("rPh")?,
            Event::End(name) if name == "si" => strings.push(current.take().unwrap_or_default()),
            Event::Eof => return Ok(strings),
            _ => {}
        }
    }
}

/// A shared formula's master, kept until the cells that reference it are read.
struct SharedFormula {
    anchor: CellRef,
    expr: Expr,
}

/// Reads one worksheet part into a sheet.
fn read_sheet(bytes: &[u8], shared_strings: &[String], sheet: &mut Sheet) -> Result<(), ReadError> {
    let mut reader = Reader::from_bytes(bytes)?;
    let mut shared: BTreeMap<String, SharedFormula> = BTreeMap::new();
    let mut cell: Option<PendingCell> = None;

    loop {
        match reader.next_event()? {
            Event::Start(e) if e.name == "c" => cell = Some(PendingCell::start(&e)),
            Event::Start(e) if e.name == "f" => {
                let Some(pending) = cell.as_mut() else { continue };
                pending.read_formula(&e, &mut reader, &mut shared)?;
            }
            Event::Start(e) if e.name == "v" => {
                let text = reader.text_of("v")?;
                if let Some(pending) = cell.as_mut() {
                    pending.raw_value = Some(text);
                }
            }
            // An inline string is stored in the cell rather than in the table.
            Event::Start(e) if e.name == "is" => {
                let text = read_inline_string(&mut reader)?;
                if let Some(pending) = cell.as_mut() {
                    pending.raw_value = Some(text);
                    pending.kind = "inlineStr".to_string();
                }
            }
            Event::End(name) if name == "c" => {
                if let Some(pending) = cell.take() {
                    pending.commit(sheet, shared_strings);
                }
            }
            Event::Eof => return Ok(()),
            _ => {}
        }
    }
}

fn read_inline_string(reader: &mut Reader<'_>) -> Result<String, XmlError> {
    let mut out = String::new();
    loop {
        match reader.next_event()? {
            Event::Start(e) if e.name == "t" => out.push_str(&reader.text_of("t")?),
            Event::End(name) if name == "is" => return Ok(out),
            Event::Eof => return Ok(out),
            _ => {}
        }
    }
}

/// A cell being assembled from the several elements that describe it.
struct PendingCell {
    reference: CellRef,
    /// The `t` attribute: `n`, `s`, `str`, `b`, `e`, `inlineStr` or `d`.
    kind: String,
    style: Option<u32>,
    formula: Option<String>,
    raw_value: Option<String>,
}

impl PendingCell {
    fn start(element: &Element) -> PendingCell {
        let reference = element
            .attribute("r")
            .and_then(CellRef::parse_a1)
            // A cell with no reference is positional, which this reader does
            // not support; parking it at A1 keeps the file readable.
            .unwrap_or(CellRef::new(0, 0));
        PendingCell {
            reference,
            kind: element.attribute("t").unwrap_or("n").to_string(),
            style: element.attribute("s").and_then(|s| s.parse().ok()),
            formula: None,
            raw_value: None,
        }
    }

    /// Reads an `<f>` element, expanding a shared formula if that is what it is.
    fn read_formula(
        &mut self,
        element: &Element,
        reader: &mut Reader<'_>,
        shared: &mut BTreeMap<String, SharedFormula>,
    ) -> Result<(), ReadError> {
        let kind = element.attribute("t").unwrap_or("normal").to_string();
        let index = element.attribute("si").map(str::to_string);
        let source = reader.text_of("f")?;

        if kind == "shared" {
            match index {
                // The master carries the text; the cells that follow carry only
                // the index, and their formula is this one shifted.
                Some(index) if !source.is_empty() => {
                    if let Ok(expr) = parse(&source) {
                        shared.insert(index, SharedFormula { anchor: self.reference, expr });
                    }
                    self.formula = Some(source);
                }
                Some(index) => {
                    if let Some(master) = shared.get(&index) {
                        let dcol = self.reference.col as i64 - master.anchor.col as i64;
                        let drow = self.reference.row as i64 - master.anchor.row as i64;
                        self.formula = Some(translate(&master.expr, dcol, drow).to_string());
                    }
                }
                None => self.formula = Some(source),
            }
            return Ok(());
        }
        if !source.is_empty() {
            self.formula = Some(source);
        }
        Ok(())
    }

    fn commit(self, sheet: &mut Sheet, shared_strings: &[String]) {
        let value = decode_value(&self.kind, self.raw_value.as_deref(), shared_strings);
        let cell = match self.formula {
            Some(source) => {
                Cell { content: CellContent::Formula(source), value, style: self.style }
            }
            None => match value {
                Value::Blank => {
                    Cell { content: CellContent::Empty, value: Value::Blank, style: self.style }
                }
                value => {
                    Cell { content: CellContent::Literal(value.clone()), value, style: self.style }
                }
            },
        };
        sheet.set(self.reference.col, self.reference.row, cell);
    }
}

/// Turns a cell's raw text into a value, following its `t` attribute.
fn decode_value(kind: &str, raw: Option<&str>, shared_strings: &[String]) -> Value {
    let Some(raw) = raw else { return Value::Blank };
    match kind {
        "s" => raw
            .parse::<usize>()
            .ok()
            .and_then(|i| shared_strings.get(i))
            .map(|s| Value::Text(s.clone()))
            // An index past the end of the table means a damaged file; showing
            // the reference is more useful than showing nothing.
            .unwrap_or_else(|| Value::Text(raw.to_string())),
        "str" | "inlineStr" => Value::Text(raw.to_string()),
        "b" => Value::Bool(raw != "0"),
        "e" => CellError::parse(raw).map(Value::Error).unwrap_or(Value::Error(CellError::NA)),
        // Anything else is a number; a blank body is an empty cell.
        _ => match raw.trim() {
            "" => Value::Blank,
            text => text.parse::<f64>().map(Value::Number).unwrap_or(Value::Text(text.to_string())),
        },
    }
}

/// The used range of a sheet, as written in the `dimension` element.
pub fn dimension(sheet: &Sheet) -> String {
    match sheet.used_range() {
        Some(range) => {
            if range.cell_count() == 1 {
                range.start.to_a1()
            } else {
                range.to_a1()
            }
        }
        None => RangeRef::single(CellRef::new(0, 0)).start.to_a1(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relationship_targets_resolve_against_their_base() {
        assert_eq!(resolve("xl", "worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
        assert_eq!(resolve("xl", "/xl/styles.xml"), "xl/styles.xml");
        assert_eq!(resolve("xl/worksheets", "../sharedStrings.xml"), "xl/sharedStrings.xml");
        assert_eq!(resolve("", "xl/workbook.xml"), "xl/workbook.xml");
    }

    #[test]
    fn cell_values_decode_by_their_type_attribute() {
        let strings = vec!["hello".to_string(), "world".to_string()];
        assert_eq!(decode_value("s", Some("1"), &strings), Value::Text("world".into()));
        assert_eq!(decode_value("n", Some("3.5"), &[]), Value::Number(3.5));
        assert_eq!(decode_value("b", Some("1"), &[]), Value::Bool(true));
        assert_eq!(decode_value("b", Some("0"), &[]), Value::Bool(false));
        assert_eq!(decode_value("e", Some("#DIV/0!"), &[]), Value::Error(CellError::Div0));
        assert_eq!(decode_value("str", Some("computed"), &[]), Value::Text("computed".into()));
        assert_eq!(decode_value("n", None, &[]), Value::Blank);
    }

    #[test]
    fn a_shared_string_index_past_the_table_does_not_panic() {
        assert_eq!(decode_value("s", Some("9"), &[]), Value::Text("9".into()));
    }
}
