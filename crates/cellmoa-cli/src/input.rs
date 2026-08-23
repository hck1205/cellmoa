//! Getting tabular data in, from a file or from a pipe.
//!
//! Two commands need this and needed it slightly differently, which is how
//! there came to be two copies: one that could read a path and one that only
//! read stdin. The difference between them is a single argument, so it is an
//! argument now.

use crate::args::Args;
use crate::exit::Fault;
use crate::tabular::{Format, Reading, Table};

/// Reads `--delimiter`, accepting either one character or a name. The names
/// exist because `--delimiter tab` survives a shell and `--delimiter '\t'`
/// depends on which one you are using.
pub fn delimiter(args: &Args) -> Result<Option<char>, Fault> {
    let Some(text) = args.value("delimiter") else { return Ok(None) };
    let mut characters = text.chars();
    if let (Some(only), None) = (characters.next(), characters.next()) {
        return Ok(Some(only));
    }
    match text {
        "tab" => Ok(Some('\t')),
        "comma" => Ok(Some(',')),
        "pipe" => Ok(Some('|')),
        "semicolon" => Ok(Some(';')),
        other => Err(Fault::Usage(format!(
            "`--delimiter {other}` should be one character, or tab, comma, pipe or semicolon"
        ))),
    }
}

/// Reads a table from `path`, or from stdin when `path` is `None` or `-`.
///
/// The format comes from `--from` when given. Otherwise a filename may imply
/// it, but a pipe carries no name, so there `--from` is required rather than
/// guessed — guessing wrong turns a TSV into one wide column without saying
/// anything.
pub fn table(args: &Args, path: Option<&str>) -> Result<Table, Fault> {
    let path = path.filter(|p| *p != "-");
    let format = match args.value("from") {
        Some(named) => Format::parse(named)?,
        None => match path {
            Some(path) => Format::from_extension(path).ok_or_else(|| {
                Fault::Usage(format!(
                    "cannot tell the format of {path:?} from its name; pass `--from`"
                ))
            })?,
            None => {
                return Err(Fault::Usage("reading from stdin needs `--from <format>`".to_string()))
            }
        },
    };

    let text = match path {
        Some(path) => crate::exit::read(path)?,
        None => {
            use std::io::Read;
            let mut text = String::new();
            std::io::stdin()
                .read_to_string(&mut text)
                .map_err(|e| Fault::Io(format!("stdin: {e}")))?;
            text
        }
    };
    crate::tabular::read(
        &text,
        Reading { format, headers: args.has("headers"), delimiter: delimiter(args)? },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Args {
        Args::parse_with(line.split_whitespace().map(String::from), &["delimiter", "from"], &[])
            .unwrap()
    }

    #[test]
    fn one_character_is_taken_as_itself() {
        assert_eq!(delimiter(&args("convert --delimiter ;")).unwrap(), Some(';'));
    }

    #[test]
    fn a_named_delimiter_saves_fighting_the_shell() {
        assert_eq!(delimiter(&args("convert --delimiter tab")).unwrap(), Some('\t'));
        assert_eq!(delimiter(&args("convert --delimiter pipe")).unwrap(), Some('|'));
    }

    #[test]
    fn no_delimiter_means_the_format_decides() {
        assert_eq!(delimiter(&args("convert")).unwrap(), None);
    }

    #[test]
    fn a_word_that_is_not_a_delimiter_name_is_rejected() {
        let fault = delimiter(&args("convert --delimiter wat")).unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("one character"), "{fault}");
    }

    #[test]
    fn a_format_that_cannot_be_guessed_from_a_name_asks_rather_than_picking() {
        let fault = table(&args("convert"), Some("archive.parquet")).unwrap_err();
        assert_eq!(fault.code(), 2);
        assert!(fault.to_string().contains("--from"), "{fault}");
    }

    #[test]
    fn stdin_with_no_format_asks_too() {
        let fault = table(&args("convert"), None).unwrap_err();
        assert!(fault.to_string().contains("--from"), "{fault}");
    }
}
