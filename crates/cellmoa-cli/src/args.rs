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
    /// anything else beginning with `--` is a switch.
    pub fn parse(
        arguments: impl IntoIterator<Item = String>,
        value_flags: &[&str],
    ) -> Result<Args, ArgError> {
        let mut arguments = arguments.into_iter();
        let command = arguments.next().ok_or(ArgError::NoCommand)?;
        let mut positional = Vec::new();
        let mut flags = BTreeMap::new();

        while let Some(argument) = arguments.next() {
            let Some(name) = argument.strip_prefix("--") else {
                positional.push(argument);
                continue;
            };
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
        Args::parse(line.split_whitespace().map(String::from), &["out", "expect"])
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
    fn no_arguments_at_all() {
        assert_eq!(Args::parse(Vec::new(), &[]), Err(ArgError::NoCommand));
    }
}
