//! Reading tabular data that arrives as text.
//!
//! The engine works in workbooks, but a pipeline works in CSV, TSV, JSON and
//! bare lines. This turns the second into the first, so that a formula can be
//! evaluated against whatever came down the pipe.
//!
//! Everything here is deliberately literal: a field is the text that was
//! there, and deciding whether "0012" is a number is the workbook's job, not
//! the reader's. A reader that guessed would silently turn a zip code into an
//! integer somewhere between the file and the answer.

use crate::exit::Fault;

/// The shapes this build can read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Csv,
    Tsv,
    /// One value per line, in a single column.
    Lines,
    /// An array of objects, or an array of arrays.
    Json,
    /// An Excel workbook. Bytes rather than text, and possibly several
    /// sheets, so it is read through the engine rather than by `read` below.
    Xlsx,
}

impl Format {
    pub fn parse(name: &str) -> Result<Format, Fault> {
        match name.to_ascii_lowercase().as_str() {
            "csv" => Ok(Format::Csv),
            "tsv" => Ok(Format::Tsv),
            "lines" => Ok(Format::Lines),
            "json" => Ok(Format::Json),
            "xlsx" => Ok(Format::Xlsx),
            other => Err(Fault::Format(format!(
                "unknown format `{other}`; this build reads csv, tsv, json, lines and xlsx"
            ))),
        }
    }

    /// The format a filename suggests. `None` when the extension says nothing,
    /// which is a question for the caller rather than a default.
    // Used by `convert`, which infers the format from the path when neither
    // `--from` nor `--to` names one.
    #[allow(dead_code)]
    pub fn from_extension(path: &str) -> Option<Format> {
        let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
        match extension.as_str() {
            "csv" => Some(Format::Csv),
            "tsv" | "tab" => Some(Format::Tsv),
            "json" => Some(Format::Json),
            "txt" => Some(Format::Lines),
            "xlsx" => Some(Format::Xlsx),
            _ => None,
        }
    }

    fn default_delimiter(self) -> char {
        match self {
            Format::Tsv => '\t',
            _ => ',',
        }
    }
}

/// A rectangle of text, plus the header row when one was named.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Table {
    pub headers: Option<Vec<String>>,
    pub rows: Vec<Vec<String>>,
}

impl Table {
    /// The widest row, counting the headers. Used by the writers, which need a
    /// rectangle even when the input was ragged.
    #[allow(dead_code)]
    pub fn width(&self) -> usize {
        let widest = self.rows.iter().map(Vec::len).max().unwrap_or(0);
        widest.max(self.headers.as_ref().map_or(0, Vec::len))
    }
}

/// How to read a particular piece of text.
#[derive(Debug, Clone, Copy)]
pub struct Reading {
    pub format: Format,
    pub headers: bool,
    pub delimiter: Option<char>,
}

/// Reads text into a table.
pub fn read(text: &str, how: Reading) -> Result<Table, Fault> {
    let rows = match how.format {
        Format::Csv | Format::Tsv => {
            split_delimited(text, how.delimiter.unwrap_or(how.format.default_delimiter()))
        }
        Format::Lines => text.lines().map(|line| vec![line.to_string()]).collect(),
        Format::Json => read_json(text)?,
        // A workbook is bytes and may hold several sheets, neither of which
        // this function can represent. Saying so beats returning one empty
        // table that looks like an answer.
        Format::Xlsx => {
            return Err(Fault::Format(
                "a workbook is not text; open it as a file rather than reading it from a pipe"
                    .to_string(),
            ))
        }
    };
    Ok(split_headers(rows, how.headers))
}

/// Peels the first row off as headers when asked. A header row is not data:
/// leaving it in makes `=AVERAGE(A:A)` average the word "amount" along with
/// the numbers under it, which reads as a silent wrong answer rather than an
/// error.
fn split_headers(mut rows: Vec<Vec<String>>, headers: bool) -> Table {
    if !headers || rows.is_empty() {
        return Table { headers: None, rows };
    }
    let first = rows.remove(0);
    Table { headers: Some(first), rows }
}

/// Splits delimited text, honouring RFC 4180 quoting: a field may be wrapped
/// in double quotes, inside which the delimiter, newlines and doubled quotes
/// are literal.
fn split_delimited(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = text.chars().peekable();
    // True once anything at all has been seen on this row, so that a trailing
    // newline does not add a phantom empty row while a genuine blank line in
    // the middle of a file still does.
    let mut started = false;

    while let Some(c) = characters.next() {
        started = true;
        if quoted {
            if c == '"' {
                if characters.peek() == Some(&'"') {
                    characters.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => quoted = true,
            c if c == delimiter => row.push(std::mem::take(&mut field)),
            '\r' => {
                if characters.peek() == Some(&'\n') {
                    characters.next();
                }
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
                started = false;
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
                started = false;
            }
            c => field.push(c),
        }
    }
    if started || !field.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// Reads JSON that is either an array of objects or an array of arrays.
///
/// An array of objects carries its own column names, so they become the first
/// row and the caller's `--headers` decides whether they are treated as such.
/// Keys are taken from the union of every object, in first-seen order, so a
/// row that omits a field lines up with the rows that have it rather than
/// shifting everything left.
fn read_json(text: &str) -> Result<Vec<Vec<String>>, Fault> {
    let parsed: serde_json::Value =
        serde_json::from_str(text).map_err(|e| Fault::Parse(format!("not JSON: {e}")))?;
    let items = parsed
        .as_array()
        .ok_or_else(|| Fault::Parse("expected a JSON array at the top level".to_string()))?;

    if items.iter().all(serde_json::Value::is_array) {
        return Ok(items
            .iter()
            .map(|row| row.as_array().expect("checked").iter().map(scalar_text).collect())
            .collect());
    }

    let mut columns: Vec<String> = Vec::new();
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            Fault::Parse("expected an array of objects or an array of arrays".to_string())
        })?;
        for key in object.keys() {
            if !columns.iter().any(|k| k == key) {
                columns.push(key.clone());
            }
        }
    }

    let mut rows = vec![columns.clone()];
    for item in items {
        let object = item.as_object().expect("checked above");
        rows.push(
            columns.iter().map(|key| object.get(key).map_or(String::new(), scalar_text)).collect(),
        );
    }
    Ok(rows)
}

/// Renders a JSON scalar as the text a cell would hold. Nested structures keep
/// their JSON form rather than becoming "[object Object]", so nothing is lost
/// silently.
fn scalar_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Renders a table in the given format.
///
/// A header row that was peeled off on the way in is put back on the way out,
/// so `--headers` is about how the first row is *understood*, not about
/// discarding it. JSON is the exception: there the headers become the object
/// keys rather than a row of their own.
pub fn write(table: &Table, format: Format, delimiter: Option<char>) -> Result<String, Fault> {
    Ok(match format {
        Format::Csv | Format::Tsv => {
            let delimiter = delimiter.unwrap_or(format.default_delimiter());
            let mut out = String::new();
            for row in table.headers.iter().chain(table.rows.iter()) {
                let fields: Vec<String> =
                    row.iter().map(|field| quoted(field, delimiter)).collect();
                out.push_str(&fields.join(&delimiter.to_string()));
                out.push('\n');
            }
            out
        }
        // Inherently one column: the first is the one that survives.
        Format::Lines => {
            let mut out = String::new();
            for row in table.headers.iter().chain(table.rows.iter()) {
                out.push_str(row.first().map(String::as_str).unwrap_or(""));
                out.push('\n');
            }
            out
        }
        Format::Json => write_json(table),
        // Returning an empty string here would write a zero-byte file and
        // call it a success.
        Format::Xlsx => {
            return Err(Fault::Format(
                "writing .xlsx is not implemented yet; use csv, tsv, json or lines".to_string(),
            ))
        }
    })
}

/// Writes JSON with the columns in the order they appear.
///
/// The order is not decoration: `--select 'Status,Amount'` asks for one. This
/// relies on serde_json's `preserve_order`, which the workspace turns on for
/// exactly this reason — without it an object is a sorted map and the flag's
/// answer comes back alphabetised.
fn write_json(table: &Table) -> String {
    let rows: Vec<serde_json::Value> = table
        .rows
        .iter()
        .map(|row| match &table.headers {
            Some(headers) => serde_json::Value::Object(
                headers
                    .iter()
                    .enumerate()
                    .map(|(index, name)| {
                        let cell = row.get(index).cloned().unwrap_or_default();
                        (name.clone(), serde_json::Value::String(cell))
                    })
                    .collect(),
            ),
            None => serde_json::Value::Array(
                row.iter().map(|c| serde_json::Value::String(c.clone())).collect(),
            ),
        })
        .collect();
    format!("{}\n", serde_json::to_string_pretty(&rows).unwrap_or_default())
}

/// Quotes a field when leaving it bare would change the shape of the output.
fn quoted(field: &str, delimiter: char) -> String {
    if field.contains([delimiter, '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(text: &str, format: Format, headers: bool) -> Table {
        read(text, Reading { format, headers, delimiter: None }).unwrap()
    }

    #[test]
    fn plain_csv() {
        let table = rows("a,b\n1,2\n", Format::Csv, false);
        assert_eq!(table.rows, vec![vec!["a", "b"], vec!["1", "2"]]);
        assert_eq!(table.headers, None);
    }

    #[test]
    fn headers_come_off_the_top_and_are_not_data() {
        let table = rows("amount\n10\n20\n30\n", Format::Csv, true);
        assert_eq!(table.headers, Some(vec!["amount".to_string()]));
        assert_eq!(table.rows, vec![vec!["10"], vec!["20"], vec!["30"]]);
    }

    #[test]
    fn a_quoted_field_may_hold_the_delimiter_a_newline_and_a_quote() {
        let table = rows("\"a,b\",\"line\nbreak\",\"say \"\"hi\"\"\"\n", Format::Csv, false);
        assert_eq!(table.rows, vec![vec!["a,b", "line\nbreak", "say \"hi\""]]);
    }

    #[test]
    fn a_trailing_newline_does_not_add_an_empty_row() {
        assert_eq!(rows("1\n2\n", Format::Csv, false).rows.len(), 2);
        assert_eq!(rows("1\n2", Format::Csv, false).rows.len(), 2);
    }

    #[test]
    fn a_blank_line_in_the_middle_is_a_row() {
        // Dropping it would shift every row below it up by one, which changes
        // what `A5` means without saying so.
        assert_eq!(rows("1\n\n3\n", Format::Csv, false).rows, vec![vec!["1"], vec![""], vec!["3"]]);
    }

    #[test]
    fn carriage_returns_do_not_survive_into_the_data() {
        let table = rows("a,b\r\n1,2\r\n", Format::Csv, false);
        assert_eq!(table.rows, vec![vec!["a", "b"], vec!["1", "2"]]);
    }

    #[test]
    fn tsv_splits_on_tabs() {
        assert_eq!(rows("a\tb\n", Format::Tsv, false).rows, vec![vec!["a", "b"]]);
    }

    #[test]
    fn lines_is_one_column() {
        assert_eq!(
            rows("alpha\nbeta\n", Format::Lines, false).rows,
            vec![vec!["alpha"], vec!["beta"]]
        );
    }

    #[test]
    fn a_comma_in_a_line_is_not_a_delimiter() {
        assert_eq!(rows("a,b\n", Format::Lines, false).rows, vec![vec!["a,b"]]);
    }

    #[test]
    fn json_objects_become_a_header_row_and_data() {
        let table = rows(r#"[{"a":1,"b":"x"},{"a":2,"b":"y"}]"#, Format::Json, true);
        assert_eq!(table.headers, Some(vec!["a".to_string(), "b".to_string()]));
        assert_eq!(table.rows, vec![vec!["1", "x"], vec!["2", "y"]]);
    }

    #[test]
    fn a_missing_key_leaves_a_gap_rather_than_shifting_the_row() {
        let table = rows(r#"[{"a":1,"b":2},{"a":3}]"#, Format::Json, true);
        assert_eq!(table.rows, vec![vec!["1", "2"], vec!["3", ""]]);
    }

    #[test]
    fn a_key_that_only_a_later_object_has_still_gets_a_column() {
        let table = rows(r#"[{"a":1},{"a":2,"b":9}]"#, Format::Json, true);
        assert_eq!(table.headers, Some(vec!["a".to_string(), "b".to_string()]));
        assert_eq!(table.rows, vec![vec!["1", ""], vec!["2", "9"]]);
    }

    #[test]
    fn json_arrays_are_taken_as_rows() {
        let table = rows(r#"[[1,2],[3,4]]"#, Format::Json, false);
        assert_eq!(table.rows, vec![vec!["1", "2"], vec!["3", "4"]]);
    }

    #[test]
    fn a_json_null_is_an_empty_cell_not_the_word_null() {
        let table = rows(r#"[{"a":null}]"#, Format::Json, true);
        assert_eq!(table.rows, vec![vec![""]]);
    }

    #[test]
    fn malformed_json_is_a_parse_fault() {
        let fault =
            read("{oops", Reading { format: Format::Json, headers: false, delimiter: None })
                .unwrap_err();
        assert_eq!(fault.code(), 4);
    }

    #[test]
    fn an_unknown_format_name_is_a_format_fault() {
        assert_eq!(Format::parse("parquet").unwrap_err().code(), 5);
    }

    #[test]
    fn an_extension_suggests_a_format_but_only_when_it_says_something() {
        assert_eq!(Format::from_extension("a/b.csv"), Some(Format::Csv));
        assert_eq!(Format::from_extension("a/b.TSV"), Some(Format::Tsv));
        assert_eq!(Format::from_extension("data"), None);
        assert_eq!(Format::from_extension("a/b.parquet"), None);
    }
}

#[cfg(test)]
mod writing {
    use super::*;

    fn table(headers: Option<&[&str]>, rows: &[&[&str]]) -> Table {
        Table {
            headers: headers.map(|h| h.iter().map(|s| s.to_string()).collect()),
            rows: rows.iter().map(|r| r.iter().map(|c| c.to_string()).collect()).collect(),
        }
    }

    #[test]
    fn csv_puts_the_header_row_back() {
        let t = table(Some(&["a", "b"]), &[&["1", "2"]]);
        assert_eq!(write(&t, Format::Csv, None).unwrap(), "a,b\n1,2\n");
    }

    #[test]
    fn csv_quotes_a_field_that_would_change_the_shape() {
        let t = table(None, &[&["a,b", "say \"hi\"", "two\nlines"]]);
        assert_eq!(
            write(&t, Format::Csv, None).unwrap(),
            "\"a,b\",\"say \"\"hi\"\"\",\"two\nlines\"\n"
        );
    }

    #[test]
    fn a_comma_is_not_special_in_a_tsv() {
        let t = table(None, &[&["a,b"]]);
        assert_eq!(write(&t, Format::Tsv, None).unwrap(), "a,b\n");
    }

    #[test]
    fn an_explicit_delimiter_is_what_gets_quoted_against() {
        let t = table(None, &[&["a;b"]]);
        assert_eq!(write(&t, Format::Csv, Some(';')).unwrap(), "\"a;b\"\n");
    }

    #[test]
    fn json_with_headers_is_objects_keyed_by_column_name() {
        let t = table(Some(&["a", "b"]), &[&["1", "x"]]);
        let text = write(&t, Format::Json, None).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed, serde_json::json!([{"a": "1", "b": "x"}]));
    }

    #[test]
    fn json_keys_come_out_in_column_order_not_alphabetical_order() {
        // `--select 'Status,Amount'` asks for an order. Going through a sorted
        // map returned Amount first, which is the opposite of what was asked.
        let t = table(Some(&["Status", "Amount"]), &[&["Pending", "12"]]);
        let text = write(&t, Format::Json, None).unwrap();
        let status = text.find("\"Status\"").expect("Status present");
        let amount = text.find("\"Amount\"").expect("Amount present");
        assert!(status < amount, "{text}");
    }

    #[test]
    fn json_escapes_what_needs_escaping() {
        let t = table(Some(&["a\"b"]), &[&["line\nbreak \\ \"quoted\""]]);
        let parsed: serde_json::Value =
            serde_json::from_str(&write(&t, Format::Json, None).unwrap()).unwrap();
        assert_eq!(parsed[0]["a\"b"], serde_json::json!("line\nbreak \\ \"quoted\""));
    }

    #[test]
    fn an_empty_table_is_an_empty_json_array() {
        let t = table(Some(&["a"]), &[]);
        let parsed: serde_json::Value =
            serde_json::from_str(&write(&t, Format::Json, None).unwrap()).unwrap();
        assert_eq!(parsed, serde_json::json!([]));
    }

    #[test]
    fn json_without_headers_is_arrays() {
        let t = table(None, &[&["1", "x"]]);
        let parsed: serde_json::Value =
            serde_json::from_str(&write(&t, Format::Json, None).unwrap()).unwrap();
        assert_eq!(parsed, serde_json::json!([["1", "x"]]));
    }

    #[test]
    fn a_short_row_gets_empty_cells_rather_than_missing_keys() {
        let t = table(Some(&["a", "b"]), &[&["1"]]);
        let parsed: serde_json::Value =
            serde_json::from_str(&write(&t, Format::Json, None).unwrap()).unwrap();
        assert_eq!(parsed, serde_json::json!([{"a": "1", "b": ""}]));
    }

    #[test]
    fn lines_writes_the_first_column() {
        let t = table(None, &[&["a", "ignored"], &["b", "ignored"]]);
        assert_eq!(write(&t, Format::Lines, None).unwrap(), "a\nb\n");
    }

    #[test]
    fn a_round_trip_through_csv_preserves_the_awkward_cases() {
        let original = table(Some(&["a", "b"]), &[&["x,y", "say \"hi\""], &["", "plain"]]);
        let text = write(&original, Format::Csv, None).unwrap();
        let back =
            read(&text, Reading { format: Format::Csv, headers: true, delimiter: None }).unwrap();
        assert_eq!(back, original);
    }
}
