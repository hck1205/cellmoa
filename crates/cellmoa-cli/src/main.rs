//! The cellmoa command line.
//!
//! Every capability of the engine is reachable from here, because that is what
//! makes a spreadsheet something a pipeline can run: recalculate a workbook,
//! check its results, compare two versions, fingerprint one, replay a journal.
//!
//! Two contracts hold across every command, because a pipeline depends on both:
//!
//! - **Exit codes.** 0 succeeded, 1 ran and the answer was no (a check failed,
//!   a difference was found), and 2 through 5 name what went wrong — see
//!   `exit::Fault`. A build can gate on the code without parsing any output.
//! - **Streams.** stdout carries the data and nothing else; every count,
//!   summary, warning and error goes to stderr. That is what makes
//!   `cellmoa export … | cellmoa calc …` work: a trailing "3 sheet(s)" on
//!   stdout would arrive as another row.

mod args;
mod commands;
mod exit;
mod input;
mod peek;
mod recon;
mod reshape;
mod strict;
mod tabular;

use args::Args;
use std::process::ExitCode;

/// Options that take a value rather than standing alone.
const VALUE_FLAGS: &[&str] = &[
    "out",
    "expect",
    "sheet",
    "format",
    "seed",
    "now",
    "onto",
    "cell",
    "from",
    "into",
    "delimiter",
    "spill",
    "to",
    "where",
    "select",
    "rename",
    "key",
    "match",
    "key-transform",
    "key_transform",
    "compare",
    "tolerance",
    "on-duplicate",
    "on_duplicate",
    "on-ambiguous",
    "on_ambiguous",
    "save-ambiguous",
    "contains-column",
    "output",
    "summary",
    "export",
    "export-side",
    "header-row",
    "header_row",
    "stdin-format",
    "max-rows",
    "max_rows",
    "width-scan-rows",
    "width_scan_rows",
    "csv",
    "target",
];

/// Short options, per command, because the same letter means different things
/// in different places: `-f` is `--from` where data is being read and
/// `--format` where it is being written. One global table would have to pick
/// one, and would silently do the wrong thing for the other.
fn aliases(command: &str) -> args::Aliases<'static> {
    const COMMON: (&str, &str) = ("q", "quiet");
    match command {
        "calc" | "convert" => &[COMMON, ("f", "from"), ("t", "to"), ("o", "out")],
        _ => &[COMMON, ("f", "format"), ("o", "out")],
    }
}

const USAGE: &str = "\
cellmoa — a spreadsheet engine for the command line

usage: cellmoa <command> [arguments]

  diff <left> <right> --key <column> [--match exact|contains] [--tolerance <n>]
       [--key-transform none|trim|digits|alnum] [--compare col,...]
       [--out json|csv] [--output <file>] [--export STATUS:PATH]
       [--no-fail] [--strict-exit] [--summary stderr|json|none]
        Reconcile two data files by a key column. Either side may be `-`.

  fill <template> --csv <file> --target <cell> --out <file> [--headers]
       [--clear] [--delimiter <char>] [--json]
        Load a CSV into a template and save the result. Nothing in the CSV
        can become a formula.

  peek <file> [--shape] [--plain] [--headers] [--max-rows <n>] [--force]
       [--sheet <name|index>] [--delimiter <char>] [--width-scan-rows <n>]
        Look at a file without opening it in anything. Never writes.

  calc <formula> --from <csv|tsv|json|lines> [--headers] [--into <cell>]
       [--delimiter <char>] [--spill <csv|json>]
        Evaluate one formula against data piped in on stdin.

  convert [file] --to <csv|tsv|json|lines> [--from <format>] [--out <file>]
          [--headers] [--delimiter <char>] [--rename OLD:NEW,...]
          [--where col=value ...] [--select col,... ]
        Convert tabular data between formats. Reads stdin when no file is
        named. --rename, then --where, then --select.

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

  list-functions [--json]
        List the built-in functions, one per line, sorted.

Common options:
  -q, --quiet   Suppress the notes and summaries on stderr. stdout never
                carried them, so it is unaffected.

Exit codes:
  0  success
  1  it ran, and the answer was no: a check failed, a difference was found
  2  the command line is wrong
  3  a file would not open, read, or write
  4  a file opened and its contents are not what they claim to be
  5  the format asked for is not one this build handles

stdout is the data. Counts, summaries, warnings and errors go to stderr.
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

    let aliases = aliases(&arguments[0]);
    let args = match Args::parse_with(arguments, VALUE_FLAGS, aliases) {
        Ok(args) => args,
        Err(e) => return fail(&exit::Fault::Usage(e.to_string())),
    };

    match commands::run(&args) {
        Ok(code) => code,
        Err(fault) => fail(&fault),
    }
}

fn fail(fault: &exit::Fault) -> ExitCode {
    eprintln!("cellmoa: {fault}");
    // Only a usage problem is one the help text can answer. Pointing at it
    // for a missing file sends the reader somewhere that cannot help.
    if fault.is_usage() {
        eprintln!("try `cellmoa --help`");
    }
    ExitCode::from(fault.code())
}
