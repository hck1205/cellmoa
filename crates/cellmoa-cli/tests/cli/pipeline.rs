//! The commands that read a stream: `calc --from` and `convert`.

use super::support::*;

#[test]
fn calc_recalculates_the_formulas_in_a_file() {
    let scratch = Scratch::new("calc");
    let input = scratch.join("in.xlsx");
    let output_path = scratch.join("out.xlsx");
    // The formula is stored with no cached result; calc has to compute it.
    write_workbook(&input, &[(0, 0, "21"), (1, 0, "=A1*2")]);

    let output =
        cellmoa(&["calc", input.to_str().unwrap(), "--out", output_path.to_str().unwrap()]);
    assert_eq!(code(&output), 0, "{}", String::from_utf8_lossy(&output.stderr));

    let recalculated = cellmoa(&["get", output_path.to_str().unwrap(), "B1"]);
    assert_eq!(stdout(&recalculated).trim(), "42");
}

#[test]
fn calc_sums_a_column_of_piped_lines() {
    let output = piped("10\n20\n30\n", &["calc", "=SUM(A:A)", "--from", "lines"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output).trim(), "60");
}

#[test]
fn calc_excludes_the_header_row_from_the_formula() {
    // With the header left in, AVERAGE would divide by four and return 15.
    // That is a wrong answer that looks like a right one.
    let output =
        piped("amount\n10\n20\n30\n", &["calc", "=AVERAGE(A:A)", "--from", "csv", "--headers"]);
    assert_eq!(stdout(&output).trim(), "20", "{}", stderr(&output));
}

#[test]
fn calc_counts_lines() {
    let output = piped("alpha\nbeta\ngamma\n", &["calc", "=COUNTA(A:A)", "--from", "lines"]);
    assert_eq!(stdout(&output).trim(), "3");
}

#[test]
fn calc_reads_a_conditional_sum_across_columns() {
    let data = "x,2000,5\ny,500,7\nz,3000,11\n";
    let output = piped(data, &["calc", "=SUMIF(B:B, \">1000\", C:C)", "--from", "csv"]);
    assert_eq!(stdout(&output).trim(), "16", "{}", stderr(&output));
}

#[test]
fn calc_prints_an_error_token_on_stdout_and_the_reason_on_stderr() {
    let output = piped("1\n", &["calc", "=1/0", "--from", "csv"]);
    assert_eq!(code(&output), 1);
    assert_eq!(stdout(&output).trim(), "#DIV/0!", "the token is the answer");
    assert!(stderr(&output).contains("#DIV/0!"), "the reason is a diagnostic");
}

#[test]
fn calc_refuses_to_print_a_corner_of_an_array_and_says_how_big_it_is() {
    let output = piped("5\n15\n25\n", &["calc", "=FILTER(A:A, A:A>10)", "--from", "csv"]);
    assert_eq!(code(&output), 1, "{}", stderr(&output));
    assert_eq!(stdout(&output), "", "printing the first cell would look like the whole answer");
    assert!(stderr(&output).contains("2 rows by 1 column"), "{}", stderr(&output));
}

#[test]
fn calc_spills_an_array_as_csv() {
    let output =
        piped("5\n15\n25\n", &["calc", "=FILTER(A:A, A:A>10)", "--from", "csv", "--spill", "csv"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output), "15\n25\n");
}

#[test]
fn calc_spills_an_array_as_json_without_trailing_zeros() {
    let output =
        piped("5\n15\n25\n", &["calc", "=FILTER(A:A, A:A>10)", "--from", "csv", "--spill", "json"]);
    assert_eq!(stdout(&output).trim(), "[[15],[25]]", "{}", stderr(&output));
}

#[test]
fn calc_prints_numbers_raw_with_no_locale_formatting() {
    // The reader is a program. `$1,234.57` would be three fields and a lie.
    let output = piped("1234.5678\n", &["calc", "=A1", "--from", "csv"]);
    assert_eq!(stdout(&output).trim(), "1234.5678");
}

#[test]
fn calc_loads_the_data_where_into_says() {
    let output = piped("7\n", &["calc", "=C5", "--from", "csv", "--into", "C5"]);
    assert_eq!(stdout(&output).trim(), "7", "{}", stderr(&output));
}

#[test]
fn calc_reads_json_objects_using_their_keys_as_headers() {
    let output = piped(
        r#"[{"amount":10},{"amount":20}]"#,
        &["calc", "=SUM(A:A)", "--from", "json", "--headers"],
    );
    assert_eq!(stdout(&output).trim(), "30", "{}", stderr(&output));
}

#[test]
fn calc_honours_an_explicit_delimiter() {
    let output = piped("1;2\n3;4\n", &["calc", "=SUM(B:B)", "--from", "csv", "--delimiter", ";"]);
    assert_eq!(stdout(&output).trim(), "6", "{}", stderr(&output));
}

#[test]
fn calc_without_from_still_recalculates_a_workbook() {
    // The two forms share a name and are told apart by `--from`. Adding the
    // new one must not have taken the old one away.
    let scratch = Scratch::new("calcboth");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "1"), (1, 0, "=A1+1")]);
    let output = cellmoa(&["calc", file.to_str().unwrap(), "--json"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert!(stdout(&output).contains("\"cells\""), "{}", stdout(&output));
}

#[test]
fn calc_rejects_a_format_it_cannot_read() {
    let output = piped("1\n", &["calc", "=A1", "--from", "parquet"]);
    assert_eq!(code(&output), 5, "{}", stderr(&output));
}

#[test]
fn calc_rejects_an_into_that_is_not_a_cell() {
    let output = piped("1\n", &["calc", "=A1", "--from", "csv", "--into", "sideways"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
}

// `convert` — docs/visigrid/03-convert.md.

#[test]
fn convert_turns_csv_into_json_keyed_by_header() {
    let scratch = Scratch::new("convjson");
    let file = transactions(&scratch);
    let output = cellmoa(&["convert", file.to_str().unwrap(), "-t", "json", "--headers"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let parsed: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(parsed[0]["Status"], "Pending");
    assert_eq!(parsed.as_array().unwrap().len(), 4);
}

#[test]
fn convert_reads_stdin_when_told_the_format() {
    let output = piped(TRANSACTIONS, &["convert", "-f", "csv", "-t", "json", "--headers"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let parsed: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(parsed.as_array().unwrap().len(), 4);
}

#[test]
fn convert_reading_stdin_without_a_format_says_so_rather_than_guessing() {
    let output = piped(TRANSACTIONS, &["convert", "-t", "json"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("--from"), "{}", stderr(&output));
}

#[test]
fn convert_filters_rows_by_column_value() {
    let scratch = Scratch::new("convwhere");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Status=Pending",
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output).lines().count(), 4, "header plus three Pending rows");
}

#[test]
fn several_where_flags_are_an_and() {
    let scratch = Scratch::new("convand");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Status=Pending",
        "--where",
        "Amount<0",
    ]);
    let text = stdout(&output);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 2, "{}", stdout(&output));
    assert!(lines[1].contains("Refund issued"));
}

#[test]
fn a_row_a_numeric_filter_could_not_read_is_counted_on_stderr_after_the_data() {
    let scratch = Scratch::new("convskip");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Amount<0",
    ]);
    assert!(stderr(&output).contains("1 row skipped (Amount not numeric)"), "{}", stderr(&output));
    assert!(!stdout(&output).contains("skipped"), "the note is not data");
}

#[test]
fn quiet_suppresses_the_skipped_row_note_but_not_the_data() {
    let scratch = Scratch::new("convquiet");
    let file = transactions(&scratch);
    let loud = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Amount<0",
    ]);
    let quiet = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Amount<0",
        "-q",
    ]);
    assert_eq!(stdout(&quiet), stdout(&loud));
    assert_eq!(stderr(&quiet), "");
}

#[test]
fn money_punctuation_does_not_defeat_a_numeric_filter() {
    let scratch = Scratch::new("convmoney");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Amount>1000",
    ]);
    assert!(
        stdout(&output).contains("$1,200.00") || stdout(&output).contains("$1200.00"),
        "{}",
        stdout(&output)
    );
    assert_eq!(stdout(&output).lines().count(), 2);
}

#[test]
fn contains_matches_without_regard_to_case() {
    let scratch = Scratch::new("convcontains");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Description~\"google workspace\"",
    ]);
    assert_eq!(stdout(&output).lines().count(), 2, "{}", stdout(&output));
}

#[test]
fn select_picks_and_reorders_columns() {
    let scratch = Scratch::new("convselect");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--select",
        "Amount,Status",
    ]);
    assert_eq!(stdout(&output).lines().next(), Some("Amount,Status"), "{}", stdout(&output));
}

#[test]
fn rename_applies_before_where_and_select() {
    // The page fixes this order, and it is the only one in which the flags
    // read the way they are written: rename a column, then use the new name.
    let scratch = Scratch::new("convrename");
    let file = transactions(&scratch);
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--rename",
        "Status:State,Amount:Total",
        "--where",
        "State=Pending",
        "--select",
        "Total,State",
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let text = stdout(&output);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "Total,State");
    assert_eq!(lines.len(), 4, "{}", stdout(&output));
}

#[test]
fn an_unknown_column_exits_two_and_lists_the_ones_that_exist() {
    let scratch = Scratch::new("convunknown");
    let file = transactions(&scratch);
    let output =
        cellmoa(&["convert", file.to_str().unwrap(), "-t", "csv", "--headers", "--select", "Nope"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("Status"), "{}", stderr(&output));
}

#[test]
fn where_and_select_need_headers_to_resolve_a_name_against() {
    let scratch = Scratch::new("convnohead");
    let file = transactions(&scratch);
    let output =
        cellmoa(&["convert", file.to_str().unwrap(), "-t", "csv", "--where", "Status=Pending"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("--headers"), "{}", stderr(&output));
}

#[test]
fn convert_writes_to_a_file_when_asked() {
    let scratch = Scratch::new("convout");
    let file = transactions(&scratch);
    let out = scratch.join("out.json");
    let output = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "json",
        "--headers",
        "-o",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output), "", "the data went to the file, not the terminal");
    let written = std::fs::read_to_string(&out).unwrap();
    assert!(written.contains("Google Workspace"), "{written}");
}

#[test]
fn convert_infers_the_input_format_from_the_extension() {
    let scratch = Scratch::new("convinfer");
    let file = transactions(&scratch);
    let output = cellmoa(&["convert", file.to_str().unwrap(), "-t", "lines", "--headers"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output).lines().next(), Some("Status"));
}

#[test]
fn convert_refuses_a_format_it_cannot_write() {
    let scratch = Scratch::new("convbad");
    let file = transactions(&scratch);
    let output = cellmoa(&["convert", file.to_str().unwrap(), "-t", "parquet"]);
    assert_eq!(code(&output), 5, "{}", stderr(&output));
}

#[test]
fn convert_output_can_be_piped_into_calc() {
    // The page ends its filtering section with exactly this pipeline, and it
    // only works if the filtered CSV on stdout carries no summary line.
    let scratch = Scratch::new("convpipe");
    let file = transactions(&scratch);
    let filtered = cellmoa(&[
        "convert",
        file.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--where",
        "Status=Pending",
        "--select",
        "Amount",
        "-q",
    ]);
    assert_eq!(code(&filtered), 0, "{}", stderr(&filtered));
    let summed = piped(&stdout(&filtered), &["calc", "=SUM(A:A)", "-f", "csv", "--headers"]);
    assert_eq!(code(&summed), 0, "{}", stderr(&summed));
    // -500 is the only cell the engine reads as a number. "n/a" is text, and
    // so — for now — is "$1,200.00": `--where` parses money punctuation, but
    // loading a cell does not. See docs/known-defects.md. The pipeline itself
    // is what this test is for, and it works: the filtered CSV arrived with
    // no summary line mixed into it.
    assert_eq!(stdout(&summed).trim(), "-500");
}
