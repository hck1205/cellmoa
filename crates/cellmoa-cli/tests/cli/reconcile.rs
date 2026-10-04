//! `diff --key`: reconciling two data files.

use super::support::*;

#[test]
fn diff_reconciles_two_files_by_key() {
    let scratch = Scratch::new("recon");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let output =
        cellmoa(&["diff", left.to_str().unwrap(), right.to_str().unwrap(), "--key", "name"]);
    assert_eq!(code(&output), 1, "Carol, Dave and Bob's amount are material");

    let json = report(&output);
    assert_eq!(json["summary"]["matched"], 2);
    assert_eq!(json["summary"]["only_left"], 1);
    assert_eq!(json["summary"]["only_right"], 1);
    assert_eq!(json["summary"]["diff"], 1);
    assert_eq!(json["summary"]["diff_outside_tolerance"], 1);
}

#[test]
fn the_summary_comes_before_the_rows_it_summarises() {
    // Field order is part of the documented shape, and serde's default map is
    // sorted — which put `results` above `summary` and alphabetised both.
    let scratch = Scratch::new("reconorder");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let output =
        cellmoa(&["diff", left.to_str().unwrap(), right.to_str().unwrap(), "--key", "name"]);
    let text = stdout(&output);
    assert!(text.find("\"summary\"") < text.find("\"results\""), "{text}");
    assert!(text.find("\"left_rows\"") < text.find("\"matched\""), "{text}");
}

#[test]
fn a_difference_within_tolerance_does_not_fail_the_run() {
    // The page is explicit: --tolerance 0.01 in CI passes when the only
    // differences are rounding, with no wrapper script.
    let scratch = Scratch::new("recontol");
    let left = csv(&scratch, "e.csv", "sku,price\na,10.00\n");
    let right = csv(&scratch, "a.csv", "sku,price\na,10.005\n");
    let args = [left.to_str().unwrap(), right.to_str().unwrap()];

    let lenient = cellmoa(&["diff", args[0], args[1], "--key", "sku", "--tolerance", "0.01"]);
    assert_eq!(code(&lenient), 0);
    let json = report(&lenient);
    assert_eq!(json["summary"]["diff"], 1, "still reported");
    assert_eq!(json["summary"]["diff_outside_tolerance"], 0, "but not material");
    assert_eq!(json["results"][0]["diffs"][0]["within_tolerance"], true);

    let strict = cellmoa(&["diff", args[0], args[1], "--key", "sku"]);
    assert_eq!(code(&strict), 1, "without a tolerance the same gap is material");
}

#[test]
fn strict_exit_fails_on_any_difference_at_all() {
    let scratch = Scratch::new("reconstrict");
    let left = csv(&scratch, "e.csv", "sku,price\na,10.00\n");
    let right = csv(&scratch, "a.csv", "sku,price\na,10.005\n");
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "sku",
        "--tolerance",
        "0.01",
        "--strict-exit",
    ]);
    assert_eq!(code(&output), 1);
}

#[test]
fn no_fail_reports_the_difference_and_still_exits_zero() {
    // Agents read the summary, not the code; a non-zero exit reads to them as
    // a crash rather than as an answer.
    let scratch = Scratch::new("reconnofail");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "name",
        "--no-fail",
    ]);
    assert_eq!(code(&output), 0);
    assert_eq!(report(&output)["summary"]["only_left"], 1, "the finding is still there");
}

#[test]
fn either_side_of_a_diff_may_be_stdin() {
    let scratch = Scratch::new("reconstdin");
    let right = csv(&scratch, "q4.csv", Q4);
    let left = csv(&scratch, "q3.csv", Q3);

    let piped_left =
        piped(Q3, &["diff", "-", right.to_str().unwrap(), "--key", "name", "--no-fail"]);
    assert_eq!(code(&piped_left), 0, "{}", stderr(&piped_left));
    assert_eq!(report(&piped_left)["summary"]["matched"], 2);

    let piped_right =
        piped(Q4, &["diff", left.to_str().unwrap(), "-", "--key", "name", "--no-fail"]);
    assert_eq!(report(&piped_right)["summary"]["matched"], 2);
}

#[test]
fn both_sides_cannot_be_stdin() {
    let output = piped(Q3, &["diff", "-", "-", "--key", "name"]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
}

#[test]
fn a_key_matching_several_rows_stops_rather_than_picking_one() {
    // The page's own example. Picking a candidate would produce a
    // reconciliation that balances and is wrong.
    let scratch = Scratch::new("reconamb");
    let left = csv(&scratch, "short.csv", "id\n12\n");
    let right = csv(&scratch, "full.csv", "id\n100154612\n100154312\n");
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "id",
        "--match",
        "contains",
    ]);
    assert_eq!(code(&output), 4, "{}", stderr(&output));

    let reported = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "id",
        "--match",
        "contains",
        "--on-ambiguous",
        "report",
    ]);
    assert_eq!(code(&reported), 1);
    assert_eq!(report(&reported)["summary"]["ambiguous"], 1);
}

#[test]
fn save_ambiguous_writes_the_candidates_even_when_the_run_fails() {
    let scratch = Scratch::new("reconsave");
    let left = csv(&scratch, "short.csv", "id\n12\n");
    let right = csv(&scratch, "full.csv", "id\n100154612\n100154312\n");
    let out = scratch.join("amb.csv");
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "id",
        "--match",
        "contains",
        "--save-ambiguous",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code(&output), 4, "the run still fails");
    // The page shows exactly this row, and the file has to exist despite the
    // failure or there is nothing to review.
    let written = std::fs::read_to_string(&out).unwrap();
    assert_eq!(written, "left_key,candidate_count,candidate_keys\n12,2,100154612|100154312\n");
}

#[test]
fn a_duplicate_key_is_refused_before_matching_begins() {
    let scratch = Scratch::new("recondup");
    let left = csv(&scratch, "dup.csv", "id\na\na\n");
    let right = csv(&scratch, "one.csv", "id\na\n");
    let output = cellmoa(&["diff", left.to_str().unwrap(), right.to_str().unwrap(), "--key", "id"]);
    assert_eq!(code(&output), 3, "{}", stderr(&output));
    assert!(stderr(&output).contains("duplicate"), "{}", stderr(&output));
}

#[test]
fn a_key_transform_reconciles_ids_that_differ_only_in_decoration() {
    let scratch = Scratch::new("recontrans");
    let left = csv(&scratch, "o.csv", "id\nOrder #100154\n");
    let right = csv(&scratch, "n.csv", "id\n100154\n");
    let args = [left.to_str().unwrap(), right.to_str().unwrap()];
    assert_eq!(
        code(&cellmoa(&["diff", args[0], args[1], "--key", "id"])),
        1,
        "as written, no match"
    );
    let output = cellmoa(&["diff", args[0], args[1], "--key", "id", "--key-transform", "digits"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
}

#[test]
fn export_writes_the_rows_of_one_status_as_a_clean_csv() {
    let scratch = Scratch::new("reconexport");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let unmatched = scratch.join("unmatched.csv");
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "name",
        "--no-fail",
        "--export",
        &format!("only_left:{}", unmatched.to_str().unwrap()),
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    // Clean enough to be the left-hand side of the next pass.
    assert_eq!(
        std::fs::read_to_string(&unmatched).unwrap(),
        "name,amount,region\nCarol,500,East\n"
    );
}

#[test]
fn export_side_both_carries_metadata_and_the_right_hand_columns() {
    let scratch = Scratch::new("reconboth");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let out = scratch.join("d.csv");
    cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "name",
        "--no-fail",
        "--export",
        &format!("diff:{}", out.to_str().unwrap()),
        "--export-side",
        "both",
    ]);
    let written = std::fs::read_to_string(&out).unwrap();
    let header = written.lines().next().unwrap();
    assert!(header.starts_with("_status,_key,"), "{header}");
    assert!(header.contains("right_amount"), "{header}");
    assert!(written.contains("diff,Bob,Bob,1200,West,Bob,1350,West"), "{written}");
}

#[test]
fn only_left_and_only_right_always_export_the_side_they_exist_on() {
    // These never invert: a row that is only on the left has no right-hand
    // half to export, whatever --export-side says.
    let scratch = Scratch::new("reconnoinvert");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let out = scratch.join("ol.csv");
    cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "name",
        "--no-fail",
        "--export",
        &format!("only_left:{}", out.to_str().unwrap()),
        "--export-side",
        "right",
    ]);
    assert!(std::fs::read_to_string(&out).unwrap().contains("Carol"));
}

#[test]
fn out_csv_gives_one_row_per_disagreeing_column() {
    let scratch = Scratch::new("reconcsv");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "name",
        "--out",
        "csv",
    ]);
    let text = stdout(&output);
    assert!(text.starts_with("status,key,column,left,right,delta,within_tolerance\n"), "{text}");
    assert!(text.contains("diff,Bob,amount,1200,1350,150,false"), "{text}");
}

#[test]
fn the_summary_is_a_diagnostic_and_the_report_is_the_data() {
    let scratch = Scratch::new("reconstreams");
    let (left, right) = (csv(&scratch, "q3.csv", Q3), csv(&scratch, "q4.csv", Q4));
    let output =
        cellmoa(&["diff", left.to_str().unwrap(), right.to_str().unwrap(), "--key", "name"]);
    assert!(stderr(&output).contains("2 matched"), "{}", stderr(&output));
    assert!(!stdout(&output).contains("2 matched"), "the summary is not part of the report");

    let quiet =
        cellmoa(&["diff", left.to_str().unwrap(), right.to_str().unwrap(), "--key", "name", "-q"]);
    assert_eq!(stderr(&quiet), "");
    assert_eq!(stdout(&quiet), stdout(&output));
}

#[test]
fn compare_refuses_a_column_the_other_file_does_not_have() {
    // Silently falling back to position would compare Amount against whatever
    // sits in that slot and report a difference that is an artefact.
    let scratch = Scratch::new("reconcompare");
    let left = csv(&scratch, "l.csv", "id,amount\na,1\n");
    let right = csv(&scratch, "r.csv", "id,total\na,1\n");
    let output = cellmoa(&[
        "diff",
        left.to_str().unwrap(),
        right.to_str().unwrap(),
        "--key",
        "id",
        "--compare",
        "amount",
    ]);
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("total"), "{}", stderr(&output));
}

#[test]
fn the_two_pass_reconciliation_playbook_works_end_to_end() {
    // docs/visigrid/18-agents.md calls this the canonical pattern and says to
    // copy it verbatim, so it is worth having as one test rather than as four
    // that each pass alone: the point is that each step's output is clean
    // enough to be the next step's input.
    let scratch = Scratch::new("playbook");
    let items = csv(
        &scratch,
        "line_items.csv",
        "order_number,amount,description\n\
         INV-1001,500.00,Payment for INV-1001\n\
         INV-1002,250.00,Consulting\n\
         XX-9,75.00,ref 100154 misc\n",
    );
    let remittance = csv(
        &scratch,
        "remittance.csv",
        "Invoice,Amount\nINV-1001,500.00\nINV-1002,250.005\n100154,75.00\n",
    );
    let ledger = scratch.join("ledger.csv");
    let unmatched = scratch.join("unmatched.csv");

    // 1) Align the schemas so the two files talk about the same columns.
    let prepared = cellmoa(&[
        "convert",
        items.to_str().unwrap(),
        "-t",
        "csv",
        "--headers",
        "--rename",
        "order_number:Invoice,amount:Amount",
        "--select",
        "Invoice,Amount,description",
        "-o",
        ledger.to_str().unwrap(),
        "-q",
    ]);
    assert_eq!(code(&prepared), 0, "{}", stderr(&prepared));

    // 2) Exact pass. The 0.005 is rounding and must not count as material.
    let first = cellmoa(&[
        "diff",
        remittance.to_str().unwrap(),
        ledger.to_str().unwrap(),
        "--key",
        "Invoice",
        "--tolerance",
        "0.01",
        "--no-fail",
        "-q",
        "--export",
        &format!("only_left:{}", unmatched.to_str().unwrap()),
    ]);
    assert_eq!(code(&first), 0, "{}", stderr(&first));
    let summary = &report(&first)["summary"];
    assert_eq!(summary["matched"], 2);
    assert_eq!(summary["diff_outside_tolerance"], 0, "0.005 is inside 0.01");
    assert_eq!(summary["only_left"], 1);

    // 3) Fuzzy pass over what the first one could not place.
    let second = cellmoa(&[
        "diff",
        unmatched.to_str().unwrap(),
        ledger.to_str().unwrap(),
        "--key",
        "Invoice",
        "--match",
        "contains",
        "--contains-column",
        "description",
        "--key-transform",
        "digits",
        "--tolerance",
        "0.01",
        "--on-ambiguous",
        "report",
        "--no-fail",
        "-q",
    ]);
    assert_eq!(code(&second), 0, "{}", stderr(&second));
    assert_eq!(
        report(&second)["summary"]["matched"],
        1,
        "100154 lives inside 'ref 100154 misc' and the digits transform finds it"
    );
}

// `peek` — docs/visigrid/08-peek.md.
