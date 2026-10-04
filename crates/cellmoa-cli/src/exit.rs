//! What the exit code means.
//!
//! A pipeline reads the code, not the message, so the code has to say which
//! kind of thing went wrong: a flag the user mistyped is a different problem
//! from a file that would not open, and both differ from a file that opened
//! and turned out to be nonsense. Collapsing all three into "2" tells a build
//! only that something failed, which is the one thing it already knew.

use std::fmt;
use std::process::ExitCode;

/// Everything ran and the answer was yes.
pub const OK: u8 = 0;
/// It ran, and the answer was no: a check failed, or a difference was found.
/// Not an error — a result the caller asked for.
pub const CHECK_FAILED: u8 = 1;

/// A failure, classified by what the caller would have to change to fix it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fault {
    /// The command line itself is wrong: an unknown flag, a missing argument,
    /// a value that is not a number. Fix the invocation.
    Usage(String),
    /// The file would not open, read, or write. Fix the filesystem.
    Io(String),
    /// The file opened and its contents are not what they claim to be. Fix
    /// the data.
    Parse(String),
    /// The format asked for is not one this build can read or write. Fix the
    /// `--to`/`--from`.
    Format(String),
}

impl Fault {
    pub fn code(&self) -> u8 {
        match self {
            Fault::Usage(_) => 2,
            Fault::Io(_) => 3,
            Fault::Parse(_) => 4,
            Fault::Format(_) => 5,
        }
    }

    /// True when the message should be followed by a pointer to `--help`.
    /// Only a usage problem is one the help text can answer; suggesting it
    /// for a missing file sends the reader somewhere unhelpful.
    pub fn is_usage(&self) -> bool {
        matches!(self, Fault::Usage(_))
    }
}

impl fmt::Display for Fault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Fault::Usage(m) | Fault::Io(m) | Fault::Parse(m) | Fault::Format(m) => f.write_str(m),
        }
    }
}

/// Reading a file, with the path in the message and the right class attached.
pub fn read(path: &str) -> Result<String, Fault> {
    std::fs::read_to_string(path).map_err(|e| {
        let message = format!("{path}: {e}");
        // "stream did not contain valid UTF-8" is not the filesystem failing.
        // The file opened and read fine; its contents are not what they were
        // taken to be, which is a 4 and not a 3.
        match e.kind() {
            std::io::ErrorKind::InvalidData => Fault::Parse(message),
            _ => Fault::Io(message),
        }
    })
}

/// Writing a file, likewise.
pub fn write(path: &str, contents: &str) -> Result<(), Fault> {
    std::fs::write(path, contents).map_err(|e| Fault::Io(format!("{path}: {e}")))
}

pub type Outcome = Result<ExitCode, Fault>;

/// The successful codes, spelled out so a command reads as what it means.
pub fn ok() -> Outcome {
    Ok(ExitCode::from(OK))
}

pub fn checked(passed: bool) -> Outcome {
    Ok(ExitCode::from(if passed { OK } else { CHECK_FAILED }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_class_has_its_own_code() {
        // A build that gates on the code can only tell these apart if they
        // differ, so this is the whole point of the type.
        let codes: Vec<u8> = [
            Fault::Usage(String::new()),
            Fault::Io(String::new()),
            Fault::Parse(String::new()),
            Fault::Format(String::new()),
        ]
        .iter()
        .map(Fault::code)
        .collect();
        assert_eq!(codes, vec![2, 3, 4, 5]);
    }

    #[test]
    fn only_a_usage_fault_points_at_the_help_text() {
        assert!(Fault::Usage("bad flag".into()).is_usage());
        assert!(!Fault::Io("no such file".into()).is_usage());
    }

    #[test]
    fn a_file_that_is_not_text_is_a_parse_fault_not_an_io_one() {
        // It opened and read; what came back was not text. Fixing that means
        // looking at the file, not at the disk.
        let path = std::env::temp_dir().join(format!("cellmoa-notutf8-{}", std::process::id()));
        std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        let fault = read(path.to_str().unwrap()).unwrap_err();
        assert_eq!(fault.code(), 4, "{fault}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_missing_file_is_an_io_fault_naming_the_path() {
        let fault = read("/nonexistent/cellmoa-test").unwrap_err();
        assert_eq!(fault.code(), 3);
        assert!(fault.to_string().contains("/nonexistent/cellmoa-test"));
    }
}
