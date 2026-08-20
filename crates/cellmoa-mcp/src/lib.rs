//! A Model Context Protocol server for cellmoa, over stdio and HTTP.
//!
//! The tools are a thin shell over the session API, which is the same surface
//! the web grid and the desktop shell use. That is what lets an agent edit a
//! workbook a person also has open without either of them silently losing work:
//! both hold a revision, and a write made against a stale one is refused.

pub mod http;
pub mod rpc;
pub mod tools;

pub use rpc::Server;
