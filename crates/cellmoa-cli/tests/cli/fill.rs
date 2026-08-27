//! `fill`: loading a CSV into a template.

use super::support::*;

#[test]
fn fill_writes_the_csv_into_the_template_and_leaves_the_template_alone() {
    let scratch = Scratch::new("fill");
    let source = scratch.join("t.xlsx");
    template(&source);
    let before = std::fs::read(&source).unwrap();
    let data = csv(&scratch, "d.csv", "item,amount\nRent,1200.00\nCloud,640\n");
    let out = scratch.join("filled.xlsx");

    let output = cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "tx!A1",
        "--out",
        out.to_str().unwrap(),
        "--headers",
        "-q",
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(std::fs::read(&source).unwrap(), before, "the template is not modified");
    assert_eq!(cell_of(&out, "tx!A1"), "Rent");
    assert_eq!(cell_of(&out, "tx!B1"), "1200");
}

#[test]
fn a_field_that_looks_like_a_formula_is_stored_as_text() {
    // The CSV came from somewhere else. If a field in it can become a live
    // formula, whoever wrote the file decides what the document computes.
    let scratch = Scratch::new("fillinject");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(&scratch, "d.csv", "a\n\"=HYPERLINK(\"\"http://evil\"\",\"\"click\"\")\"\n");
    let out = scratch.join("filled.xlsx");

    let output = cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "tx!A1",
        "--out",
        out.to_str().unwrap(),
        "--headers",
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert!(stderr(&output).contains("1 field(s) began like a formula"), "{}", stderr(&output));

    // A formula would have evaluated; the text is still the text.
    assert_eq!(cell_of(&out, "tx!A1"), "=HYPERLINK(\"http://evil\",\"click\")");
    let exported =
        stdout(&cellmoa(&["export", out.to_str().unwrap(), "--format", "json", "--sheet", "tx"]));
    let parsed: serde_json::Value = serde_json::from_str(&exported).unwrap();
    let injected = parsed["cells"].as_array().unwrap().iter().find(|c| c["cell"] == "A1").unwrap();
    assert!(injected.get("formula").is_none(), "stored as a formula: {injected}");
}

#[test]
fn strict_parsing_keeps_the_shapes_that_are_unambiguous_and_texts_the_rest() {
    let scratch = Scratch::new("fillstrict");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(
        &scratch,
        "d.csv",
        "v\n1200.00\n640\n-500\n02138\n\"$1,200.00\"\n1.5\n12345678901234567890\n",
    );
    let out = scratch.join("filled.xlsx");
    let output = cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "tx!A1",
        "--out",
        out.to_str().unwrap(),
        "--headers",
        "--json",
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let report: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(report["numbers"], 3, "1200.00, 640 and -500");
    assert_eq!(report["text"], 4, "a zip code, money punctuation, one decimal, a long id");

    // A zip code keeps its leading zero and a long id keeps its digits.
    assert_eq!(cell_of(&out, "tx!A4"), "02138");
    assert_eq!(cell_of(&out, "tx!A7"), "12345678901234567890");
}

#[test]
fn clear_empties_the_data_and_keeps_the_formulas_that_make_it_a_template() {
    // Clearing the formulas would leave the second fill computing nothing.
    let scratch = Scratch::new("fillclear");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(&scratch, "d.csv", "item,amount\nRent,10\n");
    let out = scratch.join("filled.xlsx");

    let output = cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "tx!A1",
        "--out",
        out.to_str().unwrap(),
        "--headers",
        "--clear",
        "-q",
    ]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(cell_of(&out, "tx!A2"), "", "the template's old row is gone");
    // The formula survived and recalculated against what was just written.
    assert_eq!(cell_of(&out, "tx!B10"), "10");
}

#[test]
fn without_clear_the_template_rows_below_the_fill_remain() {
    let scratch = Scratch::new("fillnoclear");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(&scratch, "d.csv", "item,amount\nRent,10\n");
    let out = scratch.join("filled.xlsx");
    cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "tx!A1",
        "--out",
        out.to_str().unwrap(),
        "--headers",
        "-q",
    ]);
    assert_eq!(cell_of(&out, "tx!A2"), "old", "untouched rows stay");
}

#[test]
fn the_target_may_name_a_sheet_or_default_to_the_first() {
    let scratch = Scratch::new("filltarget");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(&scratch, "d.csv", "x\n7\n");
    let out = scratch.join("filled.xlsx");
    cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "C5",
        "--out",
        out.to_str().unwrap(),
        "--headers",
        "-q",
    ]);
    assert_eq!(cell_of(&out, "tx!C5"), "7");
}

#[test]
fn fill_reports_what_it_did_as_json() {
    let scratch = Scratch::new("filljson");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(&scratch, "d.csv", "a,b\n1,two\n");
    let out = scratch.join("filled.xlsx");
    let output = cellmoa(&[
        "fill",
        source.to_str().unwrap(),
        "--csv",
        data.to_str().unwrap(),
        "--target",
        "tx!A1",
        "--out",
        out.to_str().unwrap(),
        "--headers",
        "--json",
    ]);
    let report: serde_json::Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(report["rows"], 1);
    assert_eq!(report["cells"], 2);
    assert_eq!(report["numbers"], 1);
    assert_eq!(report["sheet"], "tx");
}

#[test]
fn fill_reports_the_documented_exit_codes() {
    let scratch = Scratch::new("fillcodes");
    let source = scratch.join("t.xlsx");
    template(&source);
    let data = csv(&scratch, "d.csv", "a\n1\n");
    let out = scratch.join("filled.xlsx");
    let s = source.to_str().unwrap();
    let d = data.to_str().unwrap();
    let o = out.to_str().unwrap();

    // 2: the command line is wrong.
    assert_eq!(code(&cellmoa(&["fill", s, "--csv", d, "--out", o])), 2, "no --target");
    assert_eq!(code(&cellmoa(&["fill", s, "--csv", d, "--target", "A1"])), 2, "no --out");
    assert_eq!(
        code(&cellmoa(&["fill", s, "--csv", d, "--target", "sideways", "--out", o])),
        2,
        "the target is not a cell"
    );
    // 3: the filesystem.
    assert_eq!(
        code(&cellmoa(&["fill", s, "--csv", "/nonexistent/x.csv", "--target", "A1", "--out", o])),
        3
    );
    // 4: it opened and was not what it claimed to be.
    let binary = scratch.join("binary.csv");
    std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
    assert_eq!(
        code(&cellmoa(&[
            "fill",
            s,
            "--csv",
            binary.to_str().unwrap(),
            "--target",
            "A1",
            "--out",
            o
        ])),
        4
    );
}
