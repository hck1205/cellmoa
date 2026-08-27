//! `peek`: looking at a file without opening it in anything.

use super::support::*;

#[test]
fn peek_shape_reports_the_file_without_printing_it() {
    let scratch = Scratch::new("peekshape");
    let file = csv(&scratch, "wide.csv", WIDE);
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--shape", "--headers"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));

    let text = stdout(&output);
    assert!(text.contains("rows:       5"), "{text}");
    assert!(text.contains("cols:       8"), "{text}");
    assert!(text.contains("headers:    yes"), "{text}");
    assert!(text.contains("delimiter:  comma (CSV)"), "{text}");
    assert!(text.contains("columns:    Name  Revenue  Quarter  Region  ...  (+4 more)"), "{text}");
    // File row numbers: with a header consumed, the first data row is line 2.
    assert!(text.contains("row 2: Alice"), "{text}");
    assert!(!text.contains("Dave"), "the preview stops at three rows:\n{text}");
}

#[test]
fn peek_plain_lines_the_columns_up() {
    let scratch = Scratch::new("peekplain");
    let file = csv(&scratch, "small.csv", "name,n\nAlice,1\nBo,22\n");
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--plain", "--headers"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output), "name   n\nAlice  1\nBo     22\n");
}

#[test]
fn peek_never_writes_to_the_file_it_is_given() {
    let scratch = Scratch::new("peekreadonly");
    let file = csv(&scratch, "small.csv", "name,n\nAlice,1\n");
    let before = std::fs::read(&file).unwrap();
    let modified = std::fs::metadata(&file).unwrap().modified().unwrap();
    for mode in [["--shape"], ["--plain"]] {
        cellmoa(&["peek", file.to_str().unwrap(), mode[0], "--headers"]);
    }
    assert_eq!(std::fs::read(&file).unwrap(), before, "peek is read-only");
    assert_eq!(std::fs::metadata(&file).unwrap().modified().unwrap(), modified);
}

#[test]
fn max_rows_bounds_what_is_loaded_and_shape_says_so() {
    let scratch = Scratch::new("peekmax");
    let file = csv(&scratch, "wide.csv", WIDE);
    let output =
        cellmoa(&["peek", file.to_str().unwrap(), "--shape", "--headers", "--max-rows", "2"]);
    let text = stdout(&output);
    assert!(text.contains("rows:       5"), "the file still has five:\n{text}");
    assert!(text.contains("loaded:     2"), "{text}");
    assert!(text.contains("truncated:  true"), "{text}");
}

#[test]
fn asking_for_every_row_of_a_very_large_file_needs_force() {
    let scratch = Scratch::new("peekcap");
    let many: String = (0..200_002).map(|n| format!("{n}\n")).collect();
    let file = csv(&scratch, "huge.csv", &many);

    let refused = cellmoa(&["peek", file.to_str().unwrap(), "--plain", "--max-rows", "0"]);
    assert_eq!(code(&refused), 2, "{}", stderr(&refused));
    assert!(stderr(&refused).contains("--force"), "{}", stderr(&refused));

    let forced =
        cellmoa(&["peek", file.to_str().unwrap(), "--plain", "--max-rows", "0", "--force", "-q"]);
    assert_eq!(code(&forced), 0, "{}", stderr(&forced));
    assert_eq!(stdout(&forced).lines().count(), 200_002);
}

#[test]
fn the_default_row_limit_applies_without_anyone_asking() {
    let scratch = Scratch::new("peekdefault");
    let many: String = (0..6_000).map(|n| format!("{n}\n")).collect();
    let file = csv(&scratch, "many.csv", &many);
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--plain", "-q"]);
    assert_eq!(stdout(&output).lines().count(), 5_000, "a preview is bounded by default");
}

#[test]
fn peek_reads_a_workbook_and_reports_every_sheet_in_shape() {
    let scratch = Scratch::new("peekbook");
    let file = scratch.join("multi.xlsx");
    write_sheets(
        &file,
        &[("Summary", &[&["a", "b"], &["c", "d"]]), ("Raw Data", &[&["1", "2", "3"]])],
    );
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--shape"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("format:     xlsx (Excel)"), "{text}");
    assert!(text.contains("sheets:     2"), "{text}");
    assert!(text.contains("[0] \"Summary\": 2 rows x 2 cols"), "{text}");
    assert!(text.contains("[1] \"Raw Data\": 1 rows x 3 cols"), "{text}");
}

#[test]
fn a_workbook_with_several_sheets_says_which_one_it_showed() {
    // Picking the first silently would let someone conclude the others are
    // empty.
    let scratch = Scratch::new("peekhint");
    let file = scratch.join("multi.xlsx");
    write_sheets(&file, &[("Summary", &[&["a"]]), ("Data", &[&["b"]])]);
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--plain"]);
    assert!(stderr(&output).contains("2 sheets found"), "{}", stderr(&output));
    assert!(stderr(&output).contains("--sheet"), "{}", stderr(&output));
    assert_eq!(stdout(&output).trim(), "a", "the hint is not part of the data");
}

#[test]
fn sheet_selects_by_name_or_by_index() {
    let scratch = Scratch::new("peeksheet");
    let file = scratch.join("multi.xlsx");
    write_sheets(&file, &[("Summary", &[&["a"]]), ("Data", &[&["b"]])]);
    for spelling in ["Data", "data", "1"] {
        let output =
            cellmoa(&["peek", file.to_str().unwrap(), "--plain", "--sheet", spelling, "-q"]);
        assert_eq!(stdout(&output).trim(), "b", "selected by {spelling}");
    }
}

#[test]
fn an_unknown_sheet_lists_the_ones_that_exist() {
    let scratch = Scratch::new("peekbadsheet");
    let file = scratch.join("multi.xlsx");
    write_sheets(&file, &[("Summary", &[&["a"]]), ("Data", &[&["b"]])]);
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--shape", "--sheet", "Nope"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("Summary"), "{}", stderr(&output));
}

#[test]
fn headers_and_no_headers_together_are_a_contradiction_not_a_precedence_rule() {
    let scratch = Scratch::new("peekboth");
    let file = csv(&scratch, "small.csv", "a\n1\n");
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--headers", "--no-headers"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
}

#[test]
fn a_named_delimiter_is_understood() {
    let scratch = Scratch::new("peekdelim");
    let file = csv(&scratch, "euro.csv", "a;b\n1;2\n");
    let output = cellmoa(&["peek", file.to_str().unwrap(), "--plain", "--delimiter", ";", "-q"]);
    assert_eq!(stdout(&output), "a  b\n1  2\n");
}

#[test]
fn a_missing_file_is_an_io_error_here_too() {
    let output = cellmoa(&["peek", "/nonexistent/nowhere.csv", "--shape"]);
    assert_eq!(code(&output), 3, "{}", stderr(&output));
}

// `fill` — docs/visigrid/07-fill.md.
