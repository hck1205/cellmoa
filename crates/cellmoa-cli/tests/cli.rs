//! End-to-end tests of the command line.
//!
//! Exit codes are the part a pipeline depends on, so they are what these check:
//! 0 for success, 1 for a check that failed or a difference found, 2 for a
//! usage error. Getting those wrong turns a red build green.

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

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
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
fn a_missing_file_is_a_usage_error_not_a_panic() {
    let output = cellmoa(&["calc", "/nonexistent/nowhere.xlsx"]);
    assert_eq!(code(&output), 2);
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
    assert!(stdout(&output).contains("no differences"));

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
    assert!(stdout(&output).contains("replayed 3 commit(s)"), "{}", stdout(&output));

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
