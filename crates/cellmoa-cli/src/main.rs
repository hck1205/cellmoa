//! The cellmoa command line.
//!
//! Every capability of the engine is reachable from here, because that is what
//! makes a spreadsheet something a pipeline can run: recalculate a workbook,
//! check its results, compare two versions, fingerprint one, replay a journal.
//! Exit codes are the contract — 0 for success, 1 for a failed check or a
//! difference found, 2 for a usage or I/O problem — so a build can gate on the
//! result without parsing any output.

mod args;
mod commands;

use args::Args;
use std::process::ExitCode;

/// Options that take a value rather than standing alone.
const VALUE_FLAGS: &[&str] = &["out", "expect", "sheet", "format", "seed", "now", "onto", "cell"];

const USAGE: &str = "\
cellmoa — a spreadsheet engine for the command line

usage: cellmoa <command> [arguments]

  calc <file> [--out <file>] [--seed <n>] [--now <serial>]
        Recalculate a workbook and report what it holds.

  eval <formula> [--file <file>] [--sheet <name>]
        Evaluate one formula, optionally against a workbook.

  get <file> <cell|range> [--sheet <name>]
        Print the value of a cell or range.

  export <file> [--format csv|json] [--sheet <name>]
        Write a sheet out as CSV or JSON.

  verify <file> --expect <spec.json> [--json]
        Check a workbook against expectations. Exit 1 if any fail.

  diff <before> <after> [--json]
        Compare two workbooks. Exit 1 if they differ.

  fingerprint <file> [--json]
        Print the workbook's content fingerprints.

  replay <journal.json> [--onto <file>] [--out <file>]
        Rebuild a workbook by replaying a recorded journal.

  functions [--json]
        List the built-in functions.

Exit codes: 0 success, 1 check failed or difference found, 2 usage or I/O error.
";

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.is_empty() || arguments[0] == "--help" || arguments[0] == "-h" {
        print!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    if arguments[0] == "--version" {
        println!("cellmoa {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    let args = match Args::parse(arguments, VALUE_FLAGS) {
        Ok(args) => args,
        Err(e) => return fail(&e.to_string()),
    };

    match commands::run(&args) {
        Ok(code) => code,
        Err(message) => fail(&message),
    }
}

fn fail(message: &str) -> ExitCode {
    eprintln!("cellmoa: {message}");
    eprintln!("try `cellmoa --help`");
    ExitCode::from(2)
}
