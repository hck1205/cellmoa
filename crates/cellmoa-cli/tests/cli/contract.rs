//! The promises that hold across every command: which exit code means what,
//! which stream a line goes to, and that `--quiet` silences one without
//! touching the other.

use super::support::*;

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
fn every_command_renders_a_number_the_same_way() {
    // `calc` had its own number formatting and answered 0.30000000000000004
    // where `get` and `export`, over the identical value, answered 0.3. One
    // tool giving two answers for one number is worse than either answer.
    let scratch = Scratch::new("onenumber");
    let file = scratch.join("book.xlsx");
    write_workbook(&file, &[(0, 0, "0.1"), (1, 0, "0.2"), (2, 0, "=A1+B1")]);

    let via_get = stdout(&cellmoa(&["get", file.to_str().unwrap(), "C1"]));
    let via_calc = stdout(&piped("0.1\n0.2\n", &["calc", "=SUM(A:A)", "-f", "csv"]));
    assert_eq!(via_get.trim(), "0.3");
    assert_eq!(via_calc.trim(), via_get.trim());

    let via_export = stdout(&cellmoa(&["export", file.to_str().unwrap(), "--format", "csv"]));
    assert!(via_export.contains("0.3"), "{via_export}");
    assert!(!via_export.contains("0.30000000000000004"), "{via_export}");
}

// `diff --key` — dataset reconciliation, docs/visigrid/04-diff.md.

#[test]
fn every_command_answers_a_bad_delimiter_the_same_way() {
    // `diff` used to swallow it: `input::delimiter(args).unwrap_or(None)`
    // dropped the fault, so the flag was ignored and the run went on to report
    // a difference — exit 1, where `convert` said exit 2 for the same typo.
    // One mistake answered two ways is worse than either answer.
    let scratch = Scratch::new("delimiters");
    let left = csv(&scratch, "a.csv", "id,n\nx,1\n");
    let right = csv(&scratch, "b.csv", "id,n\nx,2\n");
    let (l, r) = (left.to_str().unwrap(), right.to_str().unwrap());

    for arguments in [
        vec!["convert", l, "-t", "csv", "--headers", "--delimiter", "wat"],
        vec!["diff", l, r, "--key", "id", "--delimiter", "wat"],
        vec!["peek", l, "--shape", "--delimiter", "wat"],
    ] {
        let command = arguments[0];
        let output = cellmoa(&arguments);
        assert_eq!(code(&output), 2, "{command}: {}", stderr(&output));
        assert!(stderr(&output).contains("one character"), "{command}: {}", stderr(&output));
    }
}
