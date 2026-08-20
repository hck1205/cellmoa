//! The cellmoa calculation engine: reference resolution, the dependency graph,
//! incremental recalculation, and the built-in function library.

pub mod datetime;
pub mod engine;
pub mod eval;
pub mod functions;
pub mod graph;
pub mod operand;
pub mod resolve;
pub mod special;
pub mod structure;
pub mod verify;

pub use engine::Engine;
pub use eval::{eval, eval_to_value, EvalCtx};
pub use functions::{catalogue, lookup, Function};
pub use graph::{Dep, DepGraph, Plan};
pub use operand::{Area, Array, Operand};
pub use resolve::{resolve, Resolved};
pub use verify::{verify, Report, Spec};
