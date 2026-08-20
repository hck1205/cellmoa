//! The engine: a document, the formulas parsed out of it, and the machinery
//! that keeps every computed value in step with every edit.

use crate::eval::{eval_to_value, EvalCtx};
use crate::functions;
use crate::graph::{Dep, DepGraph};
use crate::resolve::{resolve, Resolved};
use cellmoa_core::edit::{Actor, CommitKind, Document, EditError, Op};
use cellmoa_core::model::{CellAddr, CellContent, SheetId, Workbook};
use cellmoa_core::reference::CellRef;
use cellmoa_core::value::{CellError, Value};
use cellmoa_formula::ast::Expr;
use cellmoa_formula::parse;
use std::collections::BTreeMap;

/// How deep defined-name expansion may go while collecting dependencies.
const MAX_NAME_DEPTH: usize = 32;

/// What a formula reads and whether it must be recalculated unconditionally.
struct Analysis {
    deps: Vec<Dep>,
    volatile: bool,
}

/// A workbook with its formulas compiled and its dependency graph maintained.
pub struct Engine {
    pub doc: Document,
    /// Parsed formulas, keyed by cell. A formula that fails to parse is absent
    /// here and evaluates to `#NAME?`, but its source text is still kept in the
    /// document so that saving the file does not destroy it.
    asts: BTreeMap<CellAddr, Expr>,
    graph: DepGraph,
    /// Seeds the per-cell random source. Part of the document's identity: the
    /// same seed and the same edits give the same `RAND()` values.
    seed: u64,
}

impl Default for Engine {
    fn default() -> Self {
        Engine::new()
    }
}

impl Engine {
    pub fn new() -> Engine {
        Engine::from_workbook(Workbook::new())
    }

    pub fn from_workbook(workbook: Workbook) -> Engine {
        let mut engine = Engine {
            doc: Document::new(workbook),
            asts: BTreeMap::new(),
            graph: DepGraph::new(),
            seed: 0,
        };
        engine.rebuild();
        engine
    }

    /// Sets the seed behind `RAND` and `RANDBETWEEN`.
    pub fn with_seed(mut self, seed: u64) -> Engine {
        self.seed = seed;
        self
    }

    pub fn workbook(&self) -> &Workbook {
        &self.doc.workbook
    }

    pub fn revision(&self) -> u64 {
        self.doc.revision()
    }

    pub fn add_sheet(&mut self, name: impl Into<String>) -> SheetId {
        self.doc.workbook.add_sheet(name)
    }

    /// The value a cell currently shows.
    pub fn value(&self, addr: CellAddr) -> Value {
        self.doc.workbook.value(addr)
    }

    /// The formula source in a cell, without the leading `=`.
    pub fn formula(&self, addr: CellAddr) -> Option<String> {
        match self.doc.workbook.content(addr) {
            CellContent::Formula(src) => Some(src),
            _ => None,
        }
    }

    /// Writes a cell from user input, exactly as typing into it would:
    /// a leading `=` makes a formula, and anything else is parsed as a literal.
    pub fn set(&mut self, actor: Actor, addr: CellAddr, input: &str) -> Result<(), EditError> {
        self.set_content(actor, addr, parse_input(input), None)
    }

    /// Writes a literal value.
    pub fn set_value(
        &mut self,
        actor: Actor,
        addr: CellAddr,
        value: Value,
    ) -> Result<(), EditError> {
        self.set_content(actor, addr, CellContent::Literal(value), None)
    }

    /// Writes a cell, rejecting the edit if the document has moved on from
    /// `expected_revision`.
    pub fn set_checked(
        &mut self,
        actor: Actor,
        addr: CellAddr,
        input: &str,
        expected_revision: u64,
    ) -> Result<(), EditError> {
        self.set_content(actor, addr, parse_input(input), Some(expected_revision))
    }

    fn set_content(
        &mut self,
        actor: Actor,
        addr: CellAddr,
        content: CellContent,
        expected_revision: Option<u64>,
    ) -> Result<(), EditError> {
        self.doc.apply(actor, vec![Op::SetCell { addr, content }], expected_revision)?;
        self.refresh_cell(addr);
        self.recalculate_from([addr]);
        Ok(())
    }

    /// Applies several edits as one commit, then recalculates once.
    ///
    /// Doing it in one pass is not only faster: a batch that sets `A1` and `B1`
    /// where `B1` reads `A1` must not publish an intermediate value for `B1`.
    pub fn apply(
        &mut self,
        actor: Actor,
        edits: Vec<(CellAddr, &str)>,
        expected_revision: Option<u64>,
    ) -> Result<(), EditError> {
        let ops: Vec<Op> = edits
            .iter()
            .map(|(addr, input)| Op::SetCell { addr: *addr, content: parse_input(input) })
            .collect();
        self.doc.apply(actor, ops, expected_revision)?;
        let touched: Vec<CellAddr> = edits.iter().map(|(addr, _)| *addr).collect();
        for &addr in &touched {
            self.refresh_cell(addr);
        }
        self.recalculate_from(touched);
        Ok(())
    }

    /// Undoes the last commit, optionally restricted to one actor, and brings
    /// every value back in step.
    pub fn undo(&mut self, actor: Actor, only_by: Option<&str>) -> Result<(), EditError> {
        let touched = self.touched_by_undo(only_by)?;
        self.doc.undo(actor, only_by)?;
        for &addr in &touched {
            self.refresh_cell(addr);
        }
        self.recalculate_from(touched);
        Ok(())
    }

    pub fn redo(&mut self, actor: Actor, only_by: Option<&str>) -> Result<(), EditError> {
        self.doc.redo(actor, only_by)?;
        // A redo can touch any cell in the commit; rebuilding the affected
        // formulas from the whole document is simpler than tracking them and is
        // only paid on an explicit redo.
        self.rebuild();
        Ok(())
    }

    /// The cells an undo is about to change, so their formulas can be recompiled.
    fn touched_by_undo(&self, only_by: Option<&str>) -> Result<Vec<CellAddr>, EditError> {
        let commit = self
            .doc
            .commits()
            .iter()
            .rev()
            .find(|c| {
                !c.undone
                    && matches!(c.kind, CommitKind::Edit)
                    && only_by.is_none_or(|id| c.actor.id == id)
            })
            .ok_or(EditError::NothingToUndo)?;
        Ok(commit
            .ops
            .iter()
            .filter_map(|op| match op {
                Op::SetCell { addr, .. } => Some(*addr),
                _ => None,
            })
            .collect())
    }

    /// Re-reads a cell's input and updates its parsed form and its edges.
    fn refresh_cell(&mut self, addr: CellAddr) {
        match self.doc.workbook.content(addr) {
            CellContent::Formula(src) => match parse(&src) {
                Ok(expr) => {
                    let analysis = self.analyze(addr.sheet, &expr);
                    self.graph.set_deps(addr, analysis.deps, analysis.volatile);
                    self.asts.insert(addr, expr);
                }
                Err(_) => {
                    // An unparseable formula has no dependencies and always
                    // reads as #NAME?, but its text stays in the document.
                    self.graph.set_deps(addr, Vec::new(), false);
                    self.asts.remove(&addr);
                }
            },
            _ => {
                self.graph.remove(addr);
                self.asts.remove(&addr);
            }
        }
    }

    /// Recalculates everything reachable from the given cells.
    fn recalculate_from(&mut self, seeds: impl IntoIterator<Item = CellAddr>) {
        let mut seeds: Vec<CellAddr> = seeds.into_iter().collect();
        seeds.extend(self.graph.volatile_cells());
        let plan = self.graph.plan_including(seeds);
        self.run(plan);
    }

    /// Reparses every formula and recalculates the whole workbook.
    pub fn rebuild(&mut self) {
        self.asts.clear();
        self.graph = DepGraph::new();
        let formulas: Vec<CellAddr> = self
            .doc
            .workbook
            .sheets()
            .flat_map(|sheet| {
                let id = sheet.id;
                sheet
                    .iter()
                    .filter(|(_, _, cell)| cell.content.as_formula().is_some())
                    .map(move |(col, row, _)| CellAddr::new(id, col, row))
                    .collect::<Vec<_>>()
            })
            .collect();
        for addr in &formulas {
            self.refresh_cell(*addr);
        }
        let plan = self.graph.plan_including(formulas);
        self.run(plan);
    }

    fn run(&mut self, plan: crate::graph::Plan) {
        // Cycle members are settled first so that cells reading them evaluate
        // against #CYCLE! rather than against a stale value.
        for addr in plan.cycles {
            self.write_computed(addr, Value::Error(CellError::Cycle));
        }
        for addr in plan.order {
            let value = match self.asts.get(&addr) {
                Some(expr) => {
                    let expr = expr.clone();
                    let mut ctx = EvalCtx::new(
                        &self.doc.workbook,
                        addr.sheet,
                        CellRef::new(addr.col, addr.row),
                    )
                    .with_seed(self.cell_seed(addr));
                    eval_to_value(&mut ctx, &expr)
                }
                // Present in the graph but not in the AST cache: the formula
                // did not parse.
                None => Value::Error(CellError::Name),
            };
            self.write_computed(addr, value);
        }
    }

    fn write_computed(&mut self, addr: CellAddr, value: Value) {
        if let Some(sheet) = self.doc.workbook.sheet_mut(addr.sheet) {
            sheet.set_computed_value(addr.col, addr.row, value);
        }
    }

    /// A per-cell random seed derived from the workbook seed and the address,
    /// so `RAND()` is stable for a cell instead of depending on evaluation order.
    fn cell_seed(&self, addr: CellAddr) -> u64 {
        self.seed ^ ((addr.sheet as u64) << 44) ^ ((addr.row as u64) << 20) ^ (addr.col as u64)
    }

    /// Works out what a formula reads.
    fn analyze(&self, sheet: SheetId, expr: &Expr) -> Analysis {
        let mut analysis = Analysis { deps: Vec::new(), volatile: false };
        self.analyze_into(sheet, expr, &mut analysis, 0);
        analysis
    }

    fn analyze_into(&self, sheet: SheetId, expr: &Expr, out: &mut Analysis, depth: usize) {
        for r in expr.refs() {
            match resolve(&self.doc.workbook, sheet, r) {
                Resolved::Cell(addr) => out.deps.push(Dep::Cell(addr)),
                Resolved::Range { sheet, range } => out.deps.push(Dep::Range { sheet, range }),
                Resolved::Sheets { sheets, range } => {
                    out.deps.extend(sheets.into_iter().map(|s| Dep::Range { sheet: s, range }));
                }
                Resolved::Invalid => {}
            }
        }

        expr.walk(&mut |node| {
            if let Expr::Func { name, .. } = node {
                match functions::lookup(name) {
                    Some(function) if function.volatile => out.volatile = true,
                    // An unknown name is treated as volatile so that adding the
                    // function later cannot leave a stale value behind.
                    None => out.volatile = true,
                    _ => {}
                }
            }
        });

        // A name's own references are dependencies of every formula using it.
        if depth < MAX_NAME_DEPTH {
            for name in expr.names() {
                let bare = name.rsplit_once('!').map_or(name, |(_, n)| n);
                if let Some(defined) = self.doc.workbook.name(bare) {
                    if let Ok(inner) = parse(&defined.refers_to) {
                        let scope = defined.scope.unwrap_or(sheet);
                        self.analyze_into(scope, &inner, out, depth + 1);
                    }
                }
            }
        }
    }
}

/// Interprets what a user typed into a cell.
pub fn parse_input(input: &str) -> CellContent {
    if let Some(formula) = input.strip_prefix('=') {
        return CellContent::Formula(formula.to_string());
    }
    if input.is_empty() {
        return CellContent::Empty;
    }
    if input.eq_ignore_ascii_case("TRUE") {
        return CellContent::Literal(Value::Bool(true));
    }
    if input.eq_ignore_ascii_case("FALSE") {
        return CellContent::Literal(Value::Bool(false));
    }
    // A leading apostrophe forces text, which is how a user types a number that
    // should stay a string.
    if let Some(text) = input.strip_prefix('\'') {
        return CellContent::Literal(Value::Text(text.to_string()));
    }
    match input.trim().parse::<f64>() {
        Ok(n) if n.is_finite() && input.trim() == input => CellContent::Literal(Value::Number(n)),
        _ => CellContent::Literal(Value::Text(input.to_string())),
    }
}
