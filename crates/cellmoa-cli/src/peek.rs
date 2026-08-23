//! Looking at a file without opening it in anything.
//!
//! `peek` answers the questions you ask before you do any work: how many rows
//! is this, what are the columns called, what does the top of it look like.
//! It never writes to the file it is given.
//!
//! Two rules run through the whole module. Row numbers are **file** row
//! numbers, 1-based, so `row 2` means the second line of the file and stays
//! true whether or not `--headers` consumed the first one — an internal index
//! would send someone to the wrong line of a 100,000-row export. And nothing
//! is loaded without a bound: a preview that exhausts memory is worse than no
//! preview, so the caps below only lift when asked.

use crate::exit::Fault;
use crate::tabular::{self, Format, Reading, Table};

/// Rows above which loading everything needs `--force`.
pub const ROW_CAP: usize = 200_000;
/// Cells above which loading a workbook sheet needs `--force`.
pub const CELL_CAP: usize = 10_000_000;
/// Rows loaded when `--max-rows` says nothing.
pub const DEFAULT_MAX_ROWS: usize = 5_000;
/// Rows measured to size the columns. Scanning every row of a large file to
/// decide a column width costs more than the widths are worth.
pub const DEFAULT_WIDTH_SCAN: usize = 500;

/// One sheet's worth of what was loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    pub name: String,
    pub table: Table,
    /// Rows in the file, which is more than were loaded when truncated.
    pub total_rows: usize,
    pub truncated: bool,
}

impl Preview {
    pub fn columns(&self) -> usize {
        self.table.width()
    }

    /// The file row number a loaded row came from. Row 1 is the first line of
    /// the file; a consumed header row means the data starts at 2.
    pub fn file_row(&self, index: usize) -> usize {
        let header_offset = usize::from(self.table.headers.is_some());
        index + 1 + header_offset
    }
}

/// Everything `peek` learned about a file.
#[derive(Debug, Clone)]
pub struct Peeked {
    pub path: String,
    pub format: Format,
    pub sheets: Vec<Preview>,
    pub delimiter: Option<char>,
}

/// How much to load.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// `None` means every row, which is what triggers the caps.
    pub max_rows: Option<usize>,
    pub force: bool,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits { max_rows: Some(DEFAULT_MAX_ROWS), force: false }
    }
}

/// Reads a delimited file, stopping at the row limit.
pub fn read_text(
    path: &str,
    text: &str,
    format: Format,
    headers: bool,
    delimiter: Option<char>,
    limits: Limits,
) -> Result<Peeked, Fault> {
    let table = tabular::read(text, Reading { format, headers, delimiter })?;
    let total_rows = table.rows.len() + usize::from(table.headers.is_some());

    // The cap is about what gets held in memory, so it applies to a request
    // for everything, not to a caller who already named a bound.
    if limits.max_rows.is_none() && total_rows > ROW_CAP && !limits.force {
        return Err(Fault::Usage(format!(
            "{path} has {total_rows} rows, above the {ROW_CAP} row limit; \
             pass `--max-rows <n>` for a preview, or `--force` to load it all"
        )));
    }

    let mut table = table;
    let truncated = match limits.max_rows {
        Some(limit) if table.rows.len() > limit => {
            table.rows.truncate(limit);
            true
        }
        _ => false,
    };

    Ok(Peeked {
        path: path.to_string(),
        format,
        delimiter,
        sheets: vec![Preview { name: String::new(), table, total_rows, truncated }],
    })
}

/// Renders the `--shape` report: the answer to "what am I about to open".
pub fn shape(peeked: &Peeked) -> String {
    let mut out = String::new();
    out.push_str(&format!("file:       {}\n", peeked.path));

    // A workbook's shape is a list of sheets; a flat file's is one set of
    // numbers. Reporting both the same way would leave one of them padded
    // with fields that mean nothing.
    // A named sheet means the file came from a workbook, even if there is
    // only one of them.
    let from_workbook = peeked.sheets.iter().any(|s| !s.name.is_empty());
    if peeked.sheets.len() > 1 || from_workbook {
        out.push_str(&format!("format:     {}\n", describe(peeked.format)));
        out.push_str(&format!("sheets:     {}\n\n", peeked.sheets.len()));
        for (index, sheet) in peeked.sheets.iter().enumerate() {
            out.push_str(&format!(
                "  [{index}] {:?}: {} rows x {} cols\n",
                sheet.name,
                sheet.total_rows,
                sheet.columns()
            ));
        }
        return out;
    }

    let Some(sheet) = peeked.sheets.first() else { return out };
    out.push_str(&format!("rows:       {}\n", sheet.total_rows));
    out.push_str(&format!("loaded:     {}\n", sheet.table.rows.len()));
    out.push_str(&format!("truncated:  {}\n", sheet.truncated));
    out.push_str(&format!("cols:       {}\n", sheet.columns()));
    out.push_str(&format!(
        "headers:    {}\n",
        if sheet.table.headers.is_some() { "yes" } else { "no" }
    ));
    out.push_str(&format!("delimiter:  {}\n", delimiter_name(peeked)));

    if let Some(headers) = &sheet.table.headers {
        out.push('\n');
        out.push_str(&format!("columns:    {}\n", elided(headers, 4, true)));
    }
    if !sheet.table.rows.is_empty() {
        if sheet.table.headers.is_none() {
            out.push('\n');
        }
        out.push_str("preview:\n");
        for (index, row) in sheet.table.rows.iter().take(3).enumerate() {
            out.push_str(&format!("  row {}: {}\n", sheet.file_row(index), elided(row, 4, false)));
        }
    }
    out
}

/// The first few of a list, with the rest either counted or just marked.
///
/// The column list counts what it left out, because knowing there are eight
/// more columns is the point of asking. A preview row only marks it: the row
/// has the same number of columns as the header above it, so repeating the
/// count on every line says nothing new.
fn elided(values: &[String], keep: usize, count_rest: bool) -> String {
    let shown: Vec<&str> = values.iter().take(keep).map(String::as_str).collect();
    let mut text = shown.join("  ");
    if values.len() > keep {
        text.push_str("  ...");
        if count_rest {
            text.push_str(&format!("  (+{} more)", values.len() - keep));
        }
    }
    text
}

fn describe(format: Format) -> &'static str {
    match format {
        Format::Csv => "csv (Comma-separated)",
        Format::Tsv => "tsv (Tab-separated)",
        Format::Json => "json (JSON)",
        Format::Lines => "lines (Lines)",
        Format::Xlsx => "xlsx (Excel)",
    }
}

fn delimiter_name(peeked: &Peeked) -> String {
    let actual = peeked.delimiter.unwrap_or(match peeked.format {
        Format::Tsv => '\t',
        _ => ',',
    });
    let name = match actual {
        ',' => "comma",
        '\t' => "tab",
        '|' => "pipe",
        ';' => "semicolon",
        _ => "custom",
    };
    // "comma (CSV)" — the delimiter, then the format that implied it.
    let format = describe(peeked.format).split_whitespace().next().unwrap_or("csv").to_uppercase();
    format!("{name} ({format})")
}

/// The width each column should be drawn at.
///
/// Measured over the first `scan` rows rather than all of them: the point is a
/// table that lines up, and the thousandth row rarely changes that while
/// scanning for it costs a pass over the whole file.
pub fn widths(sheet: &Preview, scan: usize, cap: usize) -> Vec<usize> {
    let columns = sheet.columns();
    let mut widths = vec![0usize; columns];
    let scanned = if scan == 0 { sheet.table.rows.len() } else { scan };
    for row in sheet.table.headers.iter().chain(sheet.table.rows.iter().take(scanned)) {
        for (index, cell) in row.iter().enumerate().take(columns) {
            widths[index] = widths[index].max(cell.chars().count());
        }
    }
    widths.iter().map(|w| (*w).min(cap).max(1)).collect()
}

/// Cuts a cell to fit, marking that something was cut.
///
/// The marker matters: a silently trimmed value reads as the whole value, and
/// `Wideget Corporati` looks like a company that exists.
pub fn fit(cell: &str, width: usize) -> String {
    let length = cell.chars().count();
    if length <= width {
        return format!("{cell:<width$}");
    }
    if width <= 2 {
        return "..".chars().take(width).collect();
    }
    let kept: String = cell.chars().take(width - 2).collect();
    format!("{kept}..")
}

/// Renders the `--plain` table.
pub fn plain(peeked: &Peeked, scan: usize, cap: usize) -> String {
    let mut out = String::new();
    let many = peeked.sheets.len() > 1;
    for sheet in &peeked.sheets {
        if many {
            out.push_str(&format!("--- {} ---\n", sheet.name));
        }
        let widths = widths(sheet, scan, cap);
        if let Some(headers) = &sheet.table.headers {
            out.push_str(&line(headers, &widths));
        }
        for row in &sheet.table.rows {
            out.push_str(&line(row, &widths));
        }
        if many {
            out.push('\n');
        }
    }
    out
}

fn line(row: &[String], widths: &[usize]) -> String {
    let cells: Vec<String> = widths
        .iter()
        .enumerate()
        .map(|(index, width)| fit(row.get(index).map(String::as_str).unwrap_or(""), *width))
        .collect();
    format!("{}\n", cells.join("  ").trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peek(text: &str, headers: bool, limits: Limits) -> Peeked {
        read_text("data.csv", text, Format::Csv, headers, None, limits).unwrap()
    }

    fn only(peeked: &Peeked) -> &Preview {
        &peeked.sheets[0]
    }

    #[test]
    fn shape_counts_the_rows_in_the_file_not_the_rows_loaded() {
        let text = (1..=10).map(|n| format!("{n}\n")).collect::<String>();
        let peeked = peek(&text, false, Limits { max_rows: Some(3), force: false });
        assert_eq!(only(&peeked).total_rows, 10);
        assert_eq!(only(&peeked).table.rows.len(), 3);
        assert!(only(&peeked).truncated);

        let report = shape(&peeked);
        assert!(report.contains("rows:       10"), "{report}");
        assert!(report.contains("loaded:     3"), "{report}");
        assert!(report.contains("truncated:  true"), "{report}");
    }

    #[test]
    fn a_header_row_counts_towards_the_files_rows() {
        // The file has three lines whether or not one of them is a header.
        let peeked = peek("a,b\n1,2\n3,4\n", true, Limits::default());
        assert_eq!(only(&peeked).total_rows, 3);
        assert_eq!(only(&peeked).table.rows.len(), 2);
    }

    #[test]
    fn row_numbers_are_file_row_numbers_so_a_header_shifts_the_data_to_two() {
        let with = peek("a\n1\n2\n", true, Limits::default());
        assert_eq!(only(&with).file_row(0), 2, "the first data row is line 2");
        let without = peek("1\n2\n", false, Limits::default());
        assert_eq!(only(&without).file_row(0), 1);
    }

    #[test]
    fn shape_names_the_columns_and_shows_the_first_three_rows() {
        let peeked = peek(
            "Name,Revenue\nAlice,12345.67\nBob,9876.54\nCarol,1\nDave,2\n",
            true,
            Limits::default(),
        );
        let report = shape(&peeked);
        assert!(report.contains("columns:    Name  Revenue"), "{report}");
        assert!(report.contains("row 2: Alice"), "{report}");
        assert!(report.contains("row 4: Carol"), "{report}");
        assert!(!report.contains("Dave"), "only three rows of preview:\n{report}");
    }

    #[test]
    fn a_long_column_list_is_counted_rather_than_printed() {
        let headers: String =
            (1..=8).map(|n| format!("c{n}")).collect::<Vec<_>>().join(",") + "\n1,2,3,4,5,6,7,8\n";
        let report = shape(&peek(&headers, true, Limits::default()));
        assert!(report.contains("(+4 more)"), "{report}");
    }

    #[test]
    fn asking_for_every_row_of_a_huge_file_needs_force() {
        let text = (0..ROW_CAP + 1).map(|n| format!("{n}\n")).collect::<String>();
        let fault = read_text(
            "huge.csv",
            &text,
            Format::Csv,
            false,
            None,
            Limits { max_rows: None, force: false },
        )
        .unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("--force"), "{fault}");

        let forced = read_text(
            "huge.csv",
            &text,
            Format::Csv,
            false,
            None,
            Limits { max_rows: None, force: true },
        );
        assert!(forced.is_ok(), "--force lifts it");
    }

    #[test]
    fn a_named_row_limit_never_trips_the_cap() {
        // The caller already bounded it; the guard is for "give me everything".
        let text = (0..ROW_CAP + 1).map(|n| format!("{n}\n")).collect::<String>();
        let peeked = read_text(
            "huge.csv",
            &text,
            Format::Csv,
            false,
            None,
            Limits { max_rows: Some(10), force: false },
        )
        .unwrap();
        assert_eq!(peeked.sheets[0].table.rows.len(), 10);
    }

    #[test]
    fn a_cell_too_wide_is_cut_with_a_visible_marker() {
        // Without the marker `Wideget Corporati` reads as a company name.
        assert_eq!(fit("Wideget Corporation", 10), "Wideget ..");
        assert_eq!(fit("short", 10), "short     ", "short cells are padded to line up");
        assert_eq!(fit("exactly10!", 10), "exactly10!");
    }

    #[test]
    fn a_column_is_as_wide_as_its_widest_scanned_cell_up_to_the_cap() {
        let peeked = peek("a,b\nlonger-value,x\n1,2\n", true, Limits::default());
        assert_eq!(widths(only(&peeked), 500, 40), vec!["longer-value".len(), 1]);
        assert_eq!(widths(only(&peeked), 500, 5), vec![5, 1], "the cap wins");
    }

    #[test]
    fn only_the_scanned_rows_decide_a_width() {
        let peeked = peek("a\nx\nenormously-long-value\n", true, Limits::default());
        assert_eq!(widths(only(&peeked), 1, 80), vec![1], "row two was never measured");
        assert_eq!(
            widths(only(&peeked), 0, 80),
            vec!["enormously-long-value".len()],
            "0 scans all"
        );
    }

    #[test]
    fn plain_lines_the_columns_up() {
        let peeked = peek("name,n\nAlice,1\nBo,22\n", true, Limits::default());
        assert_eq!(plain(&peeked, 500, 40), "name   n\nAlice  1\nBo     22\n");
    }

    #[test]
    fn plain_pads_a_short_row_rather_than_shifting_the_next_column() {
        let peeked = peek("a,b\n1\n2,3\n", true, Limits::default());
        let text = plain(&peeked, 500, 40);
        assert_eq!(text.lines().nth(1), Some("1"), "trailing blanks are trimmed, not shifted");
        assert_eq!(text.lines().nth(2), Some("2  3"));
    }

    #[test]
    fn peek_never_reports_a_delimiter_it_was_not_given() {
        let comma = peek("a,b\n", true, Limits::default());
        assert!(shape(&comma).contains("delimiter:  comma"), "{}", shape(&comma));
        let semi =
            read_text("x.csv", "a;b\n", Format::Csv, true, Some(';'), Limits::default()).unwrap();
        assert!(shape(&semi).contains("delimiter:  semicolon"), "{}", shape(&semi));
    }

    #[test]
    fn an_empty_file_has_a_shape_rather_than_an_error() {
        let peeked = peek("", false, Limits::default());
        let report = shape(&peeked);
        assert!(report.contains("rows:       0"), "{report}");
        assert!(!report.contains("preview:"), "nothing to preview:\n{report}");
    }
}
