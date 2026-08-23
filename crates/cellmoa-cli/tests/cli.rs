//! End-to-end tests of the command line.
//!
//! Exit codes are the part a pipeline depends on, so they are what these check:
//! 0 for success, 1 for a check that failed or a difference found, and 2
//! through 5 for the four kinds of failure — a wrong command line, a file that
//! would not open, a file that opened as nonsense, an unsupported format.
//! Getting those wrong turns a red build green.
//!
//! The other half of the contract is which stream a line goes to. stdout is
//! the data; counts and summaries are diagnostics and belong on stderr. These
//! tests assert the stream as well as the text, because a summary on stdout
//! only shows up as a bug once someone pipes the command into another one.

use cellmoa_core::model::{Cell, CellContent, Workbook};
use cellmoa_core::value::Value;
use cellmoa_xlsx::Package;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// A directory this test can write into, removed when the test finishes.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let path = std::env::temp_dir().join(format!("cellmoa-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch directory");
        Scratch(path)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn cellmoa(arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_cellmoa"))
        .args(arguments)
        .output()
        .expect("the binary should run")
}

/// Runs a command with `input` on its stdin, the way a pipeline would.
fn piped(input: &str, arguments: &[&str]) -> Output {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new(env!("CARGO_BIN_EXE_cellmoa"))
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary should run");
    child.stdin.as_mut().expect("piped").write_all(input.as_bytes()).expect("write stdin");
    drop(child.stdin.take());
    child.wait_with_output().expect("the child should finish")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn code(output: &Output) -> i32 {
    output.status.code().expect("the process should exit normally")
}

/// Writes a small workbook and returns its path.
fn write_workbook(path: &Path, cells: &[(u32, u32, &str)]) {
    let mut workbook = Workbook::new();
    let id = workbook.add_sheet("Sheet1");
    let sheet = workbook.sheet_mut(id).unwrap();
    for (col, row, input) in cells {
        let cell = match input.strip_prefix('=') {
            Some(formula) => {
                Cell { content: CellContent::formula(formula), value: Value::Blank, style: None }
            }
            None => match input.parse::<f64>() {
                Ok(n) => Cell::literal(Value::Number(n)),
                Err(_) => Cell::literal(Value::Text(input.to_string())),
            },
        };
        sheet.set(*col, *row, cell);
    }
    Package::new(workbook).save(path).expect("save should succeed");
}

#[test]
fn help_and_version_succeed() {
    assert_eq!(code(&cellmoa(&["--help"])), 0);
    assert!(stdout(&cellmoa(&["--help"])).contains("usage: cellmoa"));
    assert_eq!(code(&cellmoa(&["--version"])), 0);
}

#[test]
fn an_unknown_command_is_a_usage_error() {
    let output = cellmoa(&["frobnicate"]);
    assert_eq!(code(&output), 2);
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown command"));
}

#[test]
fn a_typo_in_an_option_is_reported_rather_than_ignored() {
    let scratch = Scratch::new("typo");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "1")]);
    let output = cellmoa(&["calc", file.to_str().unwrap(), "--jsn"]);
    assert_eq!(code(&output), 2, "a mistyped option must not be silently dropped");
}

#[test]
fn a_missing_file_is_an_io_error_not_a_panic_and_not_a_usage_error() {
    // 3, not 2: the command line was fine, the filesystem was not. A build
    // that retries on 2 (fix the invocation) would retry this forever.
    let output = cellmoa(&["calc", "/nonexistent/nowhere.xlsx"]);
    assert_eq!(code(&output), 3, "{}", String::from_utf8_lossy(&output.stderr));
    assert!(stderr(&output).contains("nowhere.xlsx"), "the message names the file");
    assert!(!stderr(&output).contains("--help"), "help cannot fix a missing file");
}

#[test]
fn a_file_that_is_not_a_workbook_is_a_parse_error() {
    let scratch = Scratch::new("notaworkbook");
    let file = scratch.join("notes.xlsx");
    std::fs::write(&file, b"this is not a zip archive").unwrap();
    let output = cellmoa(&["calc", file.to_str().unwrap()]);
    assert_eq!(code(&output), 4, "{}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn an_unknown_export_format_is_a_format_error() {
    let scratch = Scratch::new("badformat");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "1")]);
    let output = cellmoa(&["export", file.to_str().unwrap(), "--format", "parquet"]);
    assert_eq!(code(&output), 5, "{}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn eval_computes_a_formula() {
    let output = cellmoa(&["eval", "SUM(1,2)*3"]);
    assert_eq!(code(&output), 0);
    assert_eq!(stdout(&output).trim(), "9");
}

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
fn get_reads_a_cell_and_a_range() {
    let scratch = Scratch::new("get");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "1"), (0, 1, "2")]);
    assert_eq!(stdout(&cellmoa(&["get", file.to_str().unwrap(), "A1"])).trim(), "1");
    let range = stdout(&cellmoa(&["get", file.to_str().unwrap(), "A1:A2"]));
    assert!(range.contains("A1\t1"), "{range}");
    assert!(range.contains("A2\t2"), "{range}");
}

#[test]
fn export_writes_csv_and_json() {
    let scratch = Scratch::new("export");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "1"), (1, 0, "has,comma"), (0, 1, "2")]);

    let csv = stdout(&cellmoa(&["export", file.to_str().unwrap(), "--format", "csv"]));
    // A value containing the separator has to be quoted, or the file is wrong.
    assert!(csv.contains(r#""has,comma""#), "{csv}");
    assert!(csv.starts_with("1,"), "{csv}");

    let json = stdout(&cellmoa(&["export", file.to_str().unwrap(), "--format", "json"]));
    assert!(json.contains(r#""sheet":"Sheet1""#), "{json}");
    assert!(json.contains(r#""cell":"A1""#), "{json}");
}

#[test]
fn verify_exits_one_when_a_check_fails() {
    let scratch = Scratch::new("verify");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "10"), (1, 0, "=A1*2")]);

    let passing = scratch.join("pass.json");
    std::fs::write(&passing, r#"{"expect":[{"cell":"B1","equals":20}]}"#).unwrap();
    let output =
        cellmoa(&["verify", file.to_str().unwrap(), "--expect", passing.to_str().unwrap()]);
    assert_eq!(code(&output), 0, "{}", stdout(&output));

    let failing = scratch.join("fail.json");
    std::fs::write(&failing, r#"{"expect":[{"cell":"B1","equals":99}]}"#).unwrap();
    let output =
        cellmoa(&["verify", file.to_str().unwrap(), "--expect", failing.to_str().unwrap()]);
    assert_eq!(code(&output), 1, "a failed check must not exit zero");
    assert!(stdout(&output).contains("FAILED"), "{}", stdout(&output));
}

#[test]
fn verify_reports_in_json_when_asked() {
    let scratch = Scratch::new("verify-json");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "10")]);
    let spec = scratch.join("spec.json");
    std::fs::write(&spec, r#"{"expect":[{"cell":"A1","equals":10,"label":"opening"}]}"#).unwrap();

    let output =
        cellmoa(&["verify", file.to_str().unwrap(), "--expect", spec.to_str().unwrap(), "--json"]);
    let parsed: serde_json::Value = serde_json::from_str(&stdout(&output)).expect("valid JSON");
    assert_eq!(parsed["results"][0]["passed"], serde_json::json!(true));
    assert_eq!(parsed["results"][0]["label"], serde_json::json!("opening"));
}

#[test]
fn diff_exits_one_when_the_workbooks_differ() {
    let scratch = Scratch::new("diff");
    let before = scratch.join("before.xlsx");
    let after = scratch.join("after.xlsx");
    write_workbook(&before, &[(0, 0, "1")]);
    write_workbook(&after, &[(0, 0, "1")]);

    let output = cellmoa(&["diff", before.to_str().unwrap(), after.to_str().unwrap()]);
    assert_eq!(code(&output), 0);
    // "no differences" is news about the data, not data: on stdout it would
    // arrive as a row for whatever reads the pipe.
    assert!(stderr(&output).contains("no differences"));
    assert_eq!(stdout(&output), "", "stdout carries data or nothing");

    write_workbook(&after, &[(0, 0, "2")]);
    let output = cellmoa(&["diff", before.to_str().unwrap(), after.to_str().unwrap()]);
    assert_eq!(code(&output), 1);
    assert!(stdout(&output).contains("A1"), "{}", stdout(&output));
}

#[test]
fn diff_reports_in_json_when_asked() {
    let scratch = Scratch::new("diff-json");
    let before = scratch.join("before.xlsx");
    let after = scratch.join("after.xlsx");
    write_workbook(&before, &[(0, 0, "1")]);
    write_workbook(&after, &[(0, 0, "2")]);

    let output = cellmoa(&["diff", before.to_str().unwrap(), after.to_str().unwrap(), "--json"]);
    let parsed: serde_json::Value = serde_json::from_str(&stdout(&output)).expect("valid JSON");
    assert_eq!(parsed["changes"][0]["kind"], serde_json::json!("cell_changed"));
    assert_eq!(parsed["changes"][0]["cell"], serde_json::json!("A1"));
}

#[test]
fn the_fingerprint_is_stable_and_content_addressed() {
    let scratch = Scratch::new("fingerprint");
    let first = scratch.join("first.xlsx");
    let second = scratch.join("second.xlsx");
    write_workbook(&first, &[(0, 0, "1"), (1, 1, "x")]);
    write_workbook(&second, &[(0, 0, "1"), (1, 1, "x")]);

    let a = stdout(&cellmoa(&["fingerprint", first.to_str().unwrap(), "--json"]));
    let b = stdout(&cellmoa(&["fingerprint", second.to_str().unwrap(), "--json"]));
    let a: serde_json::Value = serde_json::from_str(&a).expect("valid JSON");
    let b: serde_json::Value = serde_json::from_str(&b).expect("valid JSON");
    // Two separately written files with the same content fingerprint the same.
    assert_eq!(a["workbook"], b["workbook"]);

    write_workbook(&second, &[(0, 0, "2"), (1, 1, "x")]);
    let c = stdout(&cellmoa(&["fingerprint", second.to_str().unwrap(), "--json"]));
    let c: serde_json::Value = serde_json::from_str(&c).expect("valid JSON");
    assert_ne!(a["workbook"], c["workbook"]);
}

#[test]
fn functions_lists_the_whole_catalogue() {
    let output = cellmoa(&["functions", "--json"]);
    assert_eq!(code(&output), 0);
    let parsed: serde_json::Value = serde_json::from_str(&stdout(&output)).expect("valid JSON");
    assert!(parsed["count"].as_u64().unwrap() >= 400);
    let names: Vec<&str> = parsed["functions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"SUM"));
    assert!(names.contains(&"VLOOKUP"));
    assert!(names.contains(&"XIRR"));
}

#[test]
fn replay_rebuilds_a_workbook_from_a_journal() {
    let scratch = Scratch::new("replay");
    // A journal recorded against an empty workbook.
    let journal = scratch.join("journal.json");
    std::fs::write(
        &journal,
        r#"{
          "version": 1,
          "base": "PLACEHOLDER",
          "commits": [
            {"revision":1,"actor":{"kind":"Human","id":"u1"},"kind":"Edit",
             "ops":[{"AddSheet":{"name":"Sheet1"}}],"inverse":[],"label":null,"at":null,"undone":false},
            {"revision":2,"actor":{"kind":"Agent","id":"a1"},"kind":"Edit",
             "ops":[{"SetCell":{"addr":{"sheet":0,"row":0,"col":0},
                     "content":{"Literal":{"Number":41.0}}}}],
             "inverse":[],"label":"seed","at":null,"undone":false},
            {"revision":3,"actor":{"kind":"Agent","id":"a1"},"kind":"Edit",
             "ops":[{"SetCell":{"addr":{"sheet":0,"row":0,"col":1},
                     "content":{"Formula":"A1+1"}}}],
             "inverse":[],"label":null,"at":null,"undone":false}
          ]
        }"#,
    )
    .unwrap();

    // The base fingerprint has to match the empty workbook it replays onto.
    let empty = cellmoa_core::fingerprint::fingerprint(&Workbook::new()).workbook;
    let text = std::fs::read_to_string(&journal).unwrap().replace("PLACEHOLDER", &empty);
    std::fs::write(&journal, text).unwrap();

    let rebuilt = scratch.join("rebuilt.xlsx");
    let output =
        cellmoa(&["replay", journal.to_str().unwrap(), "--out", rebuilt.to_str().unwrap()]);
    assert_eq!(code(&output), 0, "{}", String::from_utf8_lossy(&output.stderr));
    assert!(stderr(&output).contains("replayed 3 commit(s)"), "{}", stderr(&output));

    // The formula was replayed and then recalculated.
    assert_eq!(stdout(&cellmoa(&["get", rebuilt.to_str().unwrap(), "B1"])).trim(), "42");
}

#[test]
fn replaying_onto_the_wrong_workbook_is_refused() {
    let scratch = Scratch::new("replay-wrong");
    let journal = scratch.join("journal.json");
    std::fs::write(
        &journal,
        r#"{"version":1,"base":"0000000000000000000000000000000000000000000000000000000000000000","commits":[]}"#,
    )
    .unwrap();
    let output = cellmoa(&["replay", journal.to_str().unwrap()]);
    assert_eq!(code(&output), 2);
    assert!(String::from_utf8_lossy(&output.stderr).contains("fingerprint"));
}

#[test]
fn list_functions_puts_the_names_on_stdout_and_the_tally_on_stderr() {
    // `cellmoa list-functions | wc -l` has to return the number of functions.
    // With the tally on stdout it returned that number plus one, which is the
    // kind of off-by-one nobody notices until a threshold check fires.
    let output = cellmoa(&["list-functions"]);
    assert_eq!(code(&output), 0);
    let text = stdout(&output);
    let names: Vec<&str> = text.lines().map(str::trim).collect();
    assert!(names.len() > 100, "expected the catalogue, got {} lines", names.len());
    assert!(names.iter().all(|line| !line.contains("function(s)")));
    assert!(stderr(&output).contains(&format!("{} function(s)", names.len())));
}

#[test]
fn list_functions_is_sorted_so_a_diff_of_two_runs_is_meaningful() {
    let output = cellmoa(&["list-functions"]);
    let names: Vec<String> = stdout(&output).lines().map(str::to_string).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);
}

#[test]
fn functions_still_works_under_its_old_name() {
    assert_eq!(stdout(&cellmoa(&["functions"])), stdout(&cellmoa(&["list-functions"])));
}

#[test]
fn quiet_silences_stderr_without_touching_stdout() {
    let output = cellmoa(&["list-functions"]);
    let quiet = cellmoa(&["list-functions", "--quiet"]);
    assert_eq!(stdout(&quiet), stdout(&output), "--quiet must not change the data");
    assert_eq!(stderr(&quiet), "", "--quiet silences the notes");
    assert_eq!(code(&quiet), 0);
}

#[test]
fn the_short_form_of_quiet_is_understood() {
    let quiet = cellmoa(&["list-functions", "-q"]);
    assert_eq!(code(&quiet), 0, "{}", stderr(&quiet));
    assert_eq!(stderr(&quiet), "");
}

#[test]
fn an_unknown_short_option_is_rejected_rather_than_read_as_a_path() {
    let output = cellmoa(&["list-functions", "-Z"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("-Z"));
}

#[test]
fn a_reader_that_stops_early_does_not_crash_the_writer() {
    // `cellmoa list-functions | head -5` closes the pipe after five lines.
    // `println!` panics on that, which printed a backtrace and returned 101
    // from a command that had done its job.
    use std::io::Read;
    use std::process::Stdio;
    let mut child = Command::new(env!("CARGO_BIN_EXE_cellmoa"))
        .arg("list-functions")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary should run");

    let mut first = [0u8; 16];
    child.stdout.as_mut().expect("piped").read_exact(&mut first).expect("some output");
    drop(child.stdout.take());

    let output = child.wait_with_output().expect("the child should finish");
    assert!(output.status.success(), "closing the pipe early must not fail the command");
    let complaints = String::from_utf8_lossy(&output.stderr);
    assert!(!complaints.contains("panicked"), "{complaints}");
}

// `calc <formula> --from <format>` — the form documented at
// docs/visigrid/02-calc.md. Each example on that page is a test here, because
// a worked example in a spec is a claim about behaviour.

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

/// The worked example from the filtering section of that page.
const TRANSACTIONS: &str = "Status,Amount,Description, Vendor \n\
    Pending,$1200.00,Google Workspace annual,Google\n\
    Settled,-45.50,Coffee,Blue Bottle\n\
    Pending,-500,Refund issued,Acme\n\
    Pending,n/a,Unknown amount,Ghost\n";

fn transactions(scratch: &Scratch) -> PathBuf {
    let path = scratch.join("tx.csv");
    std::fs::write(&path, TRANSACTIONS).unwrap();
    path
}

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
