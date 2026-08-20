//! The cellmoa calculation engine: reference resolution, the dependency graph,
//! incremental recalculation, and the built-in function library.

pub mod graph;
pub mod resolve;

pub use graph::{Dep, DepGraph, Plan};
pub use resolve::{resolve, Resolved};
