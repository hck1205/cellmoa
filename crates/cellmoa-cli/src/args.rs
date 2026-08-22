//! Argument parsing.
//!
//! Hand-rolled rather than pulled in: the grammar is a verb, some paths and a
//! handful of flags, and owning it keeps the tool's only dependencies the
//! engine itself.

use std::collections::BTreeMap;
use std::fmt;

/// A parsed command line: the verb, its positional arguments, and its flags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub command: String,
    pub positional: Vec<String>,
    flags: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArgError {
    NoCommand,
    UnknownFlag(String),
    MissingValue(String),
}

/// Short options, and the long option each one stands for. A single-dash
/// argument that is not in this table is rejected rather than being taken as
/// a positional: `-q` silently becoming a filename is the kind of wrong that
/// looks like it worked.
pub type Aliases<'a> = &'a [(&'a str, &'a str)];

impl fmt::Display for ArgError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ArgError::NoCommand => f.write_str("no command given"),
            ArgError::UnknownFlag(flag) => write!(f, "unknown option `{flag}`"),
            ArgError::MissingValue(flag) => write!(f, "option `{flag}` needs a value"),
        }
    }
}

impl Args {
    /// Parses arguments. `value_flags` names the options that take a value;
    /// anything else beginning with `--` is a switch. `aliases` gives the
    /// long option each short option stands for.
    pub fn parse_with(
        arguments: impl IntoIterator<Item = String>,
        value_flags: &[&str],
        aliases: Aliases<'_>,
    ) -> Result<Args, ArgError> {
        let mut arguments = arguments.into_iter();
        let command = arguments.next().ok_or(ArgError::NoCommand)?;
        let mut positional = Vec::new();
        let mut flags = BTreeMap::new();

        while let Some(argument) = arguments.next() {
            let name = match argument.strip_prefix("--") {
                Some(name) => name.to_string(),
                // A bare `-` means stdin, which is a positional, not a flag.
                None => match argument.strip_prefix('-') {
                    None => {
                        positional.push(argument);
                        continue;
                    }
                    Some("") => {
                        positional.push(argument);
                        continue;
                    }
                    Some(short) => {
                        // `-o=x` and `-o x` both reach here with `short`
                        // holding everything after the dash.
                        let (short, tail) = match short.split_once('=') {
                            Some((s, v)) => (s, Some(v.to_string())),
                            None => (short, None),
                        };
                        let long = aliases
                            .iter()
                            .find(|(s, _)| *s == short)
                            .map(|(_, long)| *long)
                            .ok_or_else(|| ArgError::UnknownFlag(format!("-{short}")))?;
                        match tail {
                            Some(value) => {
                                flags.insert(long.to_string(), Some(value));
                                continue;
                            }
                            None => long.to_string(),
                        }
                    }
                },
            };
            let name = name.as_str();
            // `--flag=value` and `--flag value` are both accepted.
            if let Some((name, value)) = name.split_once('=') {
                flags.insert(name.to_string(), Some(value.to_string()));
                continue;
            }
            if value_flags.contains(&name) {
                let value = arguments.next().ok_or_else(|| ArgError::MissingValue(name.into()))?;
                flags.insert(name.to_string(), Some(value));
            } else {
                flags.insert(name.to_string(), None);
            }
        }
        Ok(Args { command, positional, flags })
    }

    pub fn has(&self, flag: &str) -> bool {
        self.flags.contains_key(flag)
    }

    pub fn value(&self, flag: &str) -> Option<&str> {
        self.flags.get(flag).and_then(|v| v.as_deref())
    }

    /// Rejects any flag that is not in the given list, so a typo is reported
    /// rather than silently ignored.
    pub fn reject_unknown(&self, known: &[&str]) -> Result<(), ArgError> {
        match self.flags.keys().find(|flag| !known.contains(&flag.as_str())) {
            Some(flag) => Err(ArgError::UnknownFlag(format!("--{flag}"))),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(line: &str) -> Result<Args, ArgError> {
        Args::parse_with(line.split_whitespace().map(String::from), &["out", "expect"], &[])
    }

    #[test]
    fn a_command_with_positional_arguments() {
        let args = parse("diff a.xlsx b.xlsx").unwrap();
        assert_eq!(args.command, "diff");
        assert_eq!(args.positional, vec!["a.xlsx", "b.xlsx"]);
    }

    #[test]
    fn switches_and_valued_options() {
        let args = parse("calc in.xlsx --json --out result.xlsx").unwrap();
        assert!(args.has("json"));
        assert_eq!(args.value("out"), Some("result.xlsx"));
        assert_eq!(args.positional, vec!["in.xlsx"]);
    }

    #[test]
    fn an_option_can_be_written_with_an_equals_sign() {
        let args = parse("calc in.xlsx --out=result.xlsx").unwrap();
        assert_eq!(args.value("out"), Some("result.xlsx"));
    }

    #[test]
    fn a_valued_option_with_nothing_after_it_is_an_error() {
        assert_eq!(parse("calc in.xlsx --out"), Err(ArgError::MissingValue("out".into())));
    }

    #[test]
    fn an_unknown_option_is_reported_rather_than_ignored() {
        let args = parse("calc in.xlsx --jsn").unwrap();
        assert_eq!(args.reject_unknown(&["json"]), Err(ArgError::UnknownFlag("--jsn".into())));
        assert_eq!(args.reject_unknown(&["json", "jsn"]), Ok(()));
    }

    #[test]
    fn a_short_option_stands_for_its_long_form() {
        let args = Args::parse_with(
            "convert data.csv -t json -q".split_whitespace().map(String::from),
            &["to"],
            &[("t", "to"), ("q", "quiet")],
        )
        .unwrap();
        assert_eq!(args.value("to"), Some("json"));
        assert!(args.has("quiet"));
        assert_eq!(args.positional, vec!["data.csv"]);
    }

    #[test]
    fn a_short_option_can_be_written_with_an_equals_sign() {
        let args = Args::parse_with(
            "convert -o=out.csv".split_whitespace().map(String::from),
            &["output"],
            &[("o", "output")],
        )
        .unwrap();
        assert_eq!(args.value("output"), Some("out.csv"));
    }

    #[test]
    fn an_unknown_short_option_is_an_error_not_a_filename() {
        // Taking `-q` as a positional would have it read as a path, and the
        // command would fail somewhere far away from the actual mistake.
        let parsed = Args::parse_with(
            "convert -q".split_whitespace().map(String::from),
            &[],
            &[("t", "to")],
        );
        assert_eq!(parsed, Err(ArgError::UnknownFlag("-q".into())));
    }

    #[test]
    fn a_bare_dash_is_stdin_and_stays_a_positional() {
        let args = Args::parse_with(
            "diff - baseline.csv".split_whitespace().map(String::from),
            &[],
            &[("q", "quiet")],
        )
        .unwrap();
        assert_eq!(args.positional, vec!["-", "baseline.csv"]);
    }

    #[test]
    fn a_negative_value_is_not_mistaken_for_an_option() {
        let args = Args::parse_with(
            "calc in.xlsx --now -1".split_whitespace().map(String::from),
            &["now"],
            &[],
        )
        .unwrap();
        assert_eq!(args.value("now"), Some("-1"));
    }

    #[test]
    fn no_arguments_at_all() {
        assert_eq!(Args::parse_with(Vec::new(), &[], &[]), Err(ArgError::NoCommand));
    }
}
