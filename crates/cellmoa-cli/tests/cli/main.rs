//! End-to-end tests of the command line.
//!
//! Exit codes are the part a pipeline depends on, so they are what these check:
//! 0 for success, 1 for a check that failed or a difference found, and 2
//! through 5 for the four kinds of failure — a wrong command line, a file that
//! would not open, a file that opened as nonsense, an unsupported format.
//! Getting those wrong turns a red build green.
//!
//! The other half of the contract is which stream a line goes to. stdout is
//! the data; counts and summaries are diagnostics and belong on stderr. These
//! tests assert the stream as well as the text, because a summary on stdout
//! only shows up as a bug once someone pipes the command into another one.

mod contract;
mod fill;
mod peek;
mod pipeline;
mod reconcile;
mod support;
mod workbook;
