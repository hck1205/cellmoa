//! What every test here needs: a scratch directory, a way to run the
//! binary, and the fixtures the command tests share.

use cellmoa_core::model::{Cell, CellContent};
use cellmoa_core::value::Value;
use cellmoa_xlsx::Package;
use std::path::PathBuf;

// Re-exported so a sibling module can write `use super::support::*` and have
// everything a test needs, rather than repeating the same six imports.
pub(crate) use cellmoa_core::model::Workbook;
pub(crate) use std::path::Path;
pub(crate) use std::process::{Command, Output};

/// A directory this test can write into, removed when the test finishes.
pub(crate) struct Scratch(PathBuf);

impl Scratch {
    pub(crate) fn new(name: &str) -> Scratch {
        let path = std::env::temp_dir().join(format!("cellmoa-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch directory");
        Scratch(path)
    }

    pub(crate) fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn cellmoa(arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_cellmoa"))
        .args(arguments)
        .output()
        .expect("the binary should run")
}

/// Runs a command with `input` on its stdin, the way a pipeline would.
pub(crate) fn piped(input: &str, arguments: &[&str]) -> Output {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new(env!("CARGO_BIN_EXE_cellmoa"))
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary should run");
    // A command that rejects its arguments exits without reading stdin, and
    // the write then fails with EPIPE. That is the child behaving correctly,
    // not the test failing, so a broken pipe is ignored here — treating it as
    // an error made every such test flaky under a parallel run.
    let written = child.stdin.as_mut().expect("piped").write_all(input.as_bytes());
    match written {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => {}
        Err(e) => panic!("writing to stdin: {e}"),
    }
    drop(child.stdin.take());
    child.wait_with_output().expect("the child should finish")
}

pub(crate) fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

pub(crate) fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

pub(crate) fn code(output: &Output) -> i32 {
    output.status.code().expect("the process should exit normally")
}

/// Writes a small workbook and returns its path.
pub(crate) fn write_workbook(path: &Path, cells: &[(u32, u32, &str)]) {
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

/// The worked example from the filtering section of that page.
pub(crate) const TRANSACTIONS: &str = "Status,Amount,Description, Vendor \n\
    Pending,$1200.00,Google Workspace annual,Google\n\
    Settled,-45.50,Coffee,Blue Bottle\n\
    Pending,-500,Refund issued,Acme\n\
    Pending,n/a,Unknown amount,Ghost\n";

pub(crate) fn transactions(scratch: &Scratch) -> PathBuf {
    let path = scratch.join("tx.csv");
    std::fs::write(&path, TRANSACTIONS).unwrap();
    path
}

pub(crate) fn csv(scratch: &Scratch, name: &str, text: &str) -> PathBuf {
    let path = scratch.join(name);
    std::fs::write(&path, text).unwrap();
    path
}

pub(crate) const Q3: &str = "name,amount,region\nAlice,1200,East\nBob,1200,West\nCarol,500,East\n";

pub(crate) const Q4: &str = "name,amount,region\nAlice,1200,East\nBob,1350,West\nDave,900,North\n";

pub(crate) fn report(output: &Output) -> serde_json::Value {
    serde_json::from_str(&stdout(output)).expect("the report should be JSON")
}

/// A workbook with several named sheets, for the multi-sheet cases.
pub(crate) fn write_sheets(path: &Path, sheets: &[(&str, &[&[&str]])]) {
    let mut workbook = Workbook::new();
    for (name, rows) in sheets {
        let id = workbook.add_sheet(*name);
        let sheet = workbook.sheet_mut(id).unwrap();
        for (row, cells) in rows.iter().enumerate() {
            for (col, text) in cells.iter().enumerate() {
                sheet.set(col as u32, row as u32, Cell::literal(Value::Text(text.to_string())));
            }
        }
    }
    Package::new(workbook).save(path).expect("save should succeed");
}

pub(crate) const WIDE: &str = "Name,Revenue,Quarter,Region,E,F,G,H\n\
    Alice,12345.67,Q1,East,1,2,3,4\n\
    Bob,9876.54,Q1,West,1,2,3,4\n\
    Charlie,5432.10,Q2,East,1,2,3,4\n\
    Dave,1.00,Q2,West,1,2,3,4\n";

/// A template: labels, a data area, and formulas that read it.
pub(crate) fn template(path: &Path) {
    let mut workbook = Workbook::new();
    let id = workbook.add_sheet("tx");
    let sheet = workbook.sheet_mut(id).unwrap();
    sheet.set(0, 0, Cell::literal(Value::Text("item".into())));
    sheet.set(1, 0, Cell::literal(Value::Text("amount".into())));
    sheet.set(0, 1, Cell::literal(Value::Text("old".into())));
    sheet.set(1, 1, Cell::literal(Value::Number(999.0)));
    sheet.set(0, 9, Cell::literal(Value::Text("Total".into())));
    sheet.set(
        1,
        9,
        Cell { content: CellContent::formula("SUM(B1:B8)"), value: Value::Blank, style: None },
    );
    Package::new(workbook).save(path).expect("save should succeed");
}

pub(crate) fn cell_of(path: &Path, reference: &str) -> String {
    stdout(&cellmoa(&["get", path.to_str().unwrap(), reference])).trim().to_string()
}
