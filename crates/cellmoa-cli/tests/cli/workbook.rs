//! The commands that open a .xlsx: eval, calc, get, export, verify, the
//! workbook form of diff, fingerprint and replay.

use super::support::*;

#[test]
fn eval_computes_a_formula() {
    let output = cellmoa(&["eval", "SUM(1,2)*3"]);
    assert_eq!(code(&output), 0);
    assert_eq!(stdout(&output).trim(), "9");
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
fn diff_without_a_key_still_compares_two_workbooks() {
    let scratch = Scratch::new("reconboth2");
    let before = scratch.join("before.xlsx");
    let after = scratch.join("after.xlsx");
    write_workbook(&before, &[(0, 0, "1")]);
    write_workbook(&after, &[(0, 0, "2")]);
    let output = cellmoa(&["diff", before.to_str().unwrap(), after.to_str().unwrap()]);
    assert_eq!(code(&output), 1, "{}", stderr(&output));
}
