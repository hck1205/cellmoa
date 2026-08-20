//! Writing a workbook out as an XLSX package.
//!
//! Only the parts this crate models are regenerated. Everything else the
//! package contained — styles, themes, drawings, printer settings — is carried
//! through untouched, so opening a file and saving it back does not quietly
//! strip formatting the engine has no opinion about.

use crate::read::dimension;
use crate::xml::Writer;
use crate::zip::Archive;
use cellmoa_core::model::{CellContent, Sheet, Workbook};
use cellmoa_core::reference::col_to_letters;
use cellmoa_core::value::{format_number, Value};
use std::collections::BTreeMap;

const NS_SPREADSHEET: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_RELATIONSHIPS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PACKAGE_RELATIONSHIPS: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships";

/// The path of the sheet part for a given index.
fn sheet_path(index: usize) -> String {
    format!("xl/worksheets/sheet{}.xml", index + 1)
}

/// Writes a workbook into an archive, preserving anything already there that
/// this crate does not generate.
pub fn write_workbook(workbook: &Workbook, preserved: &Archive) -> Archive {
    let sheets: Vec<&Sheet> = workbook.sheets().collect();
    let mut archive = Archive::new();

    archive.insert("[Content_Types].xml", content_types(sheets.len(), preserved));
    archive.insert("_rels/.rels", package_relationships());
    archive.insert("xl/workbook.xml", workbook_part(workbook, &sheets));
    archive.insert("xl/_rels/workbook.xml.rels", workbook_relationships(sheets.len(), preserved));

    // Text is pooled into the shared string table, which is how a real file
    // stores it and what keeps a column of repeated labels small.
    let mut strings = StringTable::default();
    let parts: Vec<(String, Vec<u8>)> = sheets
        .iter()
        .enumerate()
        .map(|(i, sheet)| (sheet_path(i), sheet_part(sheet, &mut strings)))
        .collect();
    archive.insert("xl/sharedStrings.xml", strings.part());
    for (path, bytes) in parts {
        archive.insert(path, bytes);
    }

    // Carry over every part that is not one of ours.
    for name in preserved.names() {
        if archive.contains(name) || is_generated(name) {
            continue;
        }
        if let Some(bytes) = preserved.get(name) {
            archive.insert(name, bytes.to_vec());
        }
    }
    archive
}

/// Whether a part is one this writer produces, and so must not be copied from
/// the original package.
///
/// Stale worksheet parts matter: saving a workbook that lost a sheet would
/// otherwise leave the old part behind, referenced by nothing.
fn is_generated(name: &str) -> bool {
    name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml")
        || name == "xl/sharedStrings.xml"
        || name == "xl/workbook.xml"
        || name == "xl/_rels/workbook.xml.rels"
        || name == "[Content_Types].xml"
        || name == "_rels/.rels"
}

/// The shared string table, built as sheets are written.
#[derive(Default)]
struct StringTable {
    index: BTreeMap<String, usize>,
    order: Vec<String>,
}

impl StringTable {
    fn intern(&mut self, text: &str) -> usize {
        if let Some(&i) = self.index.get(text) {
            return i;
        }
        let i = self.order.len();
        self.index.insert(text.to_string(), i);
        self.order.push(text.to_string());
        i
    }

    fn part(&self) -> Vec<u8> {
        let count = self.order.len().to_string();
        let mut writer = Writer::new();
        writer
            .start("sst", &[("xmlns", NS_SPREADSHEET), ("count", &count), ("uniqueCount", &count)]);
        for text in &self.order {
            writer.start("si", &[]);
            // Leading and trailing spaces are significant and are lost without
            // this attribute.
            let needs_preserve = text.starts_with(' ') || text.ends_with(' ');
            let attributes: &[(&str, &str)] =
                if needs_preserve { &[("xml:space", "preserve")] } else { &[] };
            writer.text_element("t", attributes, text);
            writer.end();
        }
        writer.finish()
    }
}

fn content_types(sheet_count: usize, preserved: &Archive) -> Vec<u8> {
    let mut writer = Writer::new();
    writer.start(
        "Types",
        &[("xmlns", "http://schemas.openxmlformats.org/package/2006/content-types")],
    );
    writer.empty(
        "Default",
        &[
            ("Extension", "rels"),
            ("ContentType", "application/vnd.openxmlformats-package.relationships+xml"),
        ],
    );
    writer.empty("Default", &[("Extension", "xml"), ("ContentType", "application/xml")]);
    writer.empty(
        "Override",
        &[
            ("PartName", "/xl/workbook.xml"),
            (
                "ContentType",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            ),
        ],
    );
    for i in 0..sheet_count {
        writer.empty(
            "Override",
            &[
                ("PartName", &format!("/{}", sheet_path(i))),
                (
                    "ContentType",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
                ),
            ],
        );
    }
    writer.empty(
        "Override",
        &[
            ("PartName", "/xl/sharedStrings.xml"),
            (
                "ContentType",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
            ),
        ],
    );
    // A preserved styles part still has to be declared, or the file will not
    // open.
    if preserved.contains("xl/styles.xml") {
        writer.empty(
            "Override",
            &[
                ("PartName", "/xl/styles.xml"),
                (
                    "ContentType",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
                ),
            ],
        );
    }
    if preserved.contains("xl/theme/theme1.xml") {
        writer.empty(
            "Override",
            &[
                ("PartName", "/xl/theme/theme1.xml"),
                ("ContentType", "application/vnd.openxmlformats-officedocument.theme+xml"),
            ],
        );
    }
    writer.finish()
}

fn package_relationships() -> Vec<u8> {
    let mut writer = Writer::new();
    writer.start("Relationships", &[("xmlns", NS_PACKAGE_RELATIONSHIPS)]);
    writer.empty(
        "Relationship",
        &[
            ("Id", "rId1"),
            ("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
            ("Target", "xl/workbook.xml"),
        ],
    );
    writer.finish()
}

fn workbook_relationships(sheet_count: usize, preserved: &Archive) -> Vec<u8> {
    let mut writer = Writer::new();
    writer.start("Relationships", &[("xmlns", NS_PACKAGE_RELATIONSHIPS)]);
    for i in 0..sheet_count {
        writer.empty(
            "Relationship",
            &[
                ("Id", &format!("rId{}", i + 1)),
                (
                    "Type",
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
                ),
                ("Target", &format!("worksheets/sheet{}.xml", i + 1)),
            ],
        );
    }
    let mut next = sheet_count + 1;
    writer.empty(
        "Relationship",
        &[
            ("Id", &format!("rId{next}")),
            (
                "Type",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
            ),
            ("Target", "sharedStrings.xml"),
        ],
    );
    next += 1;
    if preserved.contains("xl/styles.xml") {
        writer.empty(
            "Relationship",
            &[
                ("Id", &format!("rId{next}")),
                (
                    "Type",
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
                ),
                ("Target", "styles.xml"),
            ],
        );
        next += 1;
    }
    if preserved.contains("xl/theme/theme1.xml") {
        writer.empty(
            "Relationship",
            &[
                ("Id", &format!("rId{next}")),
                (
                    "Type",
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
                ),
                ("Target", "theme/theme1.xml"),
            ],
        );
    }
    writer.finish()
}

fn workbook_part(workbook: &Workbook, sheets: &[&Sheet]) -> Vec<u8> {
    let mut writer = Writer::new();
    writer.start("workbook", &[("xmlns", NS_SPREADSHEET), ("xmlns:r", NS_RELATIONSHIPS)]);
    writer.start("sheets", &[]);
    for (i, sheet) in sheets.iter().enumerate() {
        writer.empty(
            "sheet",
            &[
                ("name", &sheet.name),
                ("sheetId", &(i + 1).to_string()),
                ("r:id", &format!("rId{}", i + 1)),
            ],
        );
    }
    writer.end();

    let names: Vec<_> = workbook.names().collect();
    if !names.is_empty() {
        writer.start("definedNames", &[]);
        for name in names {
            match name.scope {
                Some(scope) => writer.text_element(
                    "definedName",
                    &[("name", &name.name), ("localSheetId", &scope.to_string())],
                    &name.refers_to,
                ),
                None => {
                    writer.text_element("definedName", &[("name", &name.name)], &name.refers_to)
                }
            };
        }
        writer.end();
    }
    writer.finish()
}

fn sheet_part(sheet: &Sheet, strings: &mut StringTable) -> Vec<u8> {
    let mut writer = Writer::new();
    writer.start("worksheet", &[("xmlns", NS_SPREADSHEET), ("xmlns:r", NS_RELATIONSHIPS)]);
    writer.empty("dimension", &[("ref", &dimension(sheet))]);
    writer.start("sheetData", &[]);

    // Cells arrive in row-major order, so a row closes as soon as the row
    // number changes.
    let mut current_row: Option<u32> = None;
    for (col, row, cell) in sheet.iter() {
        if current_row != Some(row) {
            if current_row.is_some() {
                writer.end();
            }
            writer.start("row", &[("r", &(row + 1).to_string())]);
            current_row = Some(row);
        }
        write_cell(&mut writer, col, row, cell, strings);
    }
    if current_row.is_some() {
        writer.end();
    }
    writer.finish()
}

fn write_cell(
    writer: &mut Writer,
    col: u32,
    row: u32,
    cell: &cellmoa_core::model::Cell,
    strings: &mut StringTable,
) {
    let reference = format!("{}{}", col_to_letters(col), row + 1);
    let style = cell.style.map(|s| s.to_string());

    // The type attribute describes the *value*, and for a formula cell that is
    // the cached result rather than the formula itself.
    let kind = match (&cell.content, &cell.value) {
        (CellContent::Formula(_), Value::Text(_)) => Some("str"),
        (_, Value::Text(_)) => Some("s"),
        (_, Value::Bool(_)) => Some("b"),
        (_, Value::Error(_)) => Some("e"),
        _ => None,
    };

    let mut attributes: Vec<(&str, &str)> = vec![("r", &reference)];
    if let Some(style) = style.as_deref() {
        attributes.push(("s", style));
    }
    if let Some(kind) = kind {
        attributes.push(("t", kind));
    }

    let formula = cell.content.as_formula();
    let body = match &cell.value {
        Value::Blank => None,
        Value::Number(n) => Some(format_number(*n)),
        Value::Bool(b) => Some(if *b { "1".into() } else { "0".into() }),
        Value::Error(e) => Some(e.as_str().to_string()),
        Value::Text(text) => Some(match formula {
            // A formula's text result is written inline; a literal goes into
            // the shared table.
            Some(_) => text.clone(),
            None => strings.intern(text).to_string(),
        }),
    };

    if formula.is_none() && body.is_none() {
        writer.empty("c", &attributes);
        return;
    }
    writer.start("c", &attributes);
    if let Some(source) = formula {
        writer.text_element("f", &[], source);
    }
    if let Some(body) = body {
        writer.text_element("v", &[], &body);
    }
    writer.end();
}
