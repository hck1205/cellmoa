//! The dependency graph and the order cells are recalculated in.
//!
//! Two properties matter beyond correctness. Recalculation is *incremental*:
//! changing a cell evaluates only what transitively reads it. And the order is
//! *deterministic*: every container here is ordered, so the same edit produces
//! the same evaluation sequence on every run and on every platform, which is
//! what makes a fingerprint (D2) and a replay (D4) comparable at all.

use cellmoa_core::model::{CellAddr, SheetId};
use cellmoa_core::reference::RangeRef;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// Something a formula reads.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Dep {
    Cell(CellAddr),
    Range { sheet: SheetId, range: RangeRef },
}

/// The edges of the workbook, in both directions.
///
/// Range dependencies are kept as rectangles rather than expanded into edges:
/// a formula reading `A:A` would otherwise create a million of them.
#[derive(Debug, Clone, Default)]
pub struct DepGraph {
    /// What each formula cell reads.
    deps: BTreeMap<CellAddr, Vec<Dep>>,
    /// Which formula cells read a given cell directly.
    cell_dependents: BTreeMap<CellAddr, BTreeSet<CellAddr>>,
    /// Per sheet, the range dependencies registered against it.
    range_dependents: BTreeMap<SheetId, Vec<(RangeRef, CellAddr)>>,
    /// Cells whose value can change without any input changing — `NOW()`,
    /// `RAND()`, `INDIRECT()`. They are seeded into every full recalculation.
    volatile: BTreeSet<CellAddr>,
}

impl DepGraph {
    pub fn new() -> DepGraph {
        DepGraph::default()
    }

    /// Records what a formula cell reads, replacing any previous edges.
    pub fn set_deps(&mut self, addr: CellAddr, deps: Vec<Dep>, volatile: bool) {
        self.clear_edges(addr);
        for dep in &deps {
            match dep {
                Dep::Cell(target) => {
                    self.cell_dependents.entry(*target).or_default().insert(addr);
                }
                Dep::Range { sheet, range } => {
                    self.range_dependents.entry(*sheet).or_default().push((*range, addr));
                }
            }
        }
        self.deps.insert(addr, deps);
        if volatile {
            self.volatile.insert(addr);
        } else {
            self.volatile.remove(&addr);
        }
    }

    /// Drops a cell from the graph entirely — used when a formula becomes a
    /// literal or the cell is cleared.
    pub fn remove(&mut self, addr: CellAddr) {
        self.clear_edges(addr);
        self.deps.remove(&addr);
        self.volatile.remove(&addr);
    }

    fn clear_edges(&mut self, addr: CellAddr) {
        let Some(old) = self.deps.get(&addr) else { return };
        for dep in old {
            match dep {
                Dep::Cell(target) => {
                    if let Some(set) = self.cell_dependents.get_mut(target) {
                        set.remove(&addr);
                        if set.is_empty() {
                            self.cell_dependents.remove(target);
                        }
                    }
                }
                Dep::Range { sheet, .. } => {
                    if let Some(list) = self.range_dependents.get_mut(sheet) {
                        list.retain(|(_, dependent)| *dependent != addr);
                        if list.is_empty() {
                            self.range_dependents.remove(sheet);
                        }
                    }
                }
            }
        }
    }

    pub fn is_formula(&self, addr: CellAddr) -> bool {
        self.deps.contains_key(&addr)
    }

    pub fn deps_of(&self, addr: CellAddr) -> &[Dep] {
        self.deps.get(&addr).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Every formula cell tracked by the graph, in address order.
    pub fn formula_cells(&self) -> impl Iterator<Item = CellAddr> + '_ {
        self.deps.keys().copied()
    }

    pub fn volatile_cells(&self) -> impl Iterator<Item = CellAddr> + '_ {
        self.volatile.iter().copied()
    }

    /// Formula cells that read `addr` directly.
    pub fn direct_dependents(&self, addr: CellAddr) -> BTreeSet<CellAddr> {
        let mut out = self.cell_dependents.get(&addr).cloned().unwrap_or_default();
        if let Some(ranges) = self.range_dependents.get(&addr.sheet) {
            for (range, dependent) in ranges {
                if range.contains(addr.col, addr.row) {
                    out.insert(*dependent);
                }
            }
        }
        out
    }

    /// Plans a recalculation.
    ///
    /// Returns the formula cells that must be re-evaluated, in an order where
    /// every cell comes after everything it reads, plus the cells that could
    /// not be ordered because they take part in a circular reference.
    pub fn plan(&self, seeds: impl IntoIterator<Item = CellAddr>) -> Plan {
        self.plan_over(self.affected(seeds))
    }

    /// The transitive closure of formula cells reachable from the seeds.
    fn affected(&self, seeds: impl IntoIterator<Item = CellAddr>) -> BTreeSet<CellAddr> {
        let mut seen = BTreeSet::new();
        let mut queue: VecDeque<CellAddr> = seeds.into_iter().collect();
        while let Some(node) = queue.pop_front() {
            for dependent in self.direct_dependents(node) {
                if seen.insert(dependent) {
                    queue.push_back(dependent);
                }
            }
        }
        seen
    }

    /// Like [`DepGraph::plan`], but re-evaluates the seeds themselves as well
    /// as their readers. A full recalculation and a formula edit both need
    /// this; a literal edit does not.
    pub fn plan_including(&self, seeds: impl IntoIterator<Item = CellAddr>) -> Plan {
        let seeds: Vec<CellAddr> = seeds.into_iter().collect();
        let mut affected = self.affected(seeds.iter().copied());
        affected.extend(seeds.into_iter().filter(|&a| self.is_formula(a)));
        self.plan_over(affected)
    }

    /// Orders a known set of cells so that every cell comes after everything
    /// it reads, and separates out the ones caught in a circular reference.
    ///
    /// This condenses the subgraph into strongly connected components. A plain
    /// topological sort cannot do the job: it stalls on the whole tail of the
    /// graph the moment a cycle appears, when in fact only the cycle itself is
    /// unresolvable. `C1 = ISERROR(A1)` with `A1` in a cycle still has a
    /// well-defined answer, and gets one — `A1` is assigned `#CYCLE!` and `C1`
    /// then evaluates normally against it.
    fn plan_over(&self, affected: BTreeSet<CellAddr>) -> Plan {
        let nodes: Vec<CellAddr> = affected.iter().copied().collect();
        let index_of: BTreeMap<CellAddr, usize> =
            nodes.iter().enumerate().map(|(i, &a)| (a, i)).collect();

        // Edges point from a cell to the formulas that read it, which is also
        // the direction evaluation has to travel.
        let adjacency: Vec<Vec<usize>> = nodes
            .iter()
            .map(|&node| {
                self.direct_dependents(node)
                    .into_iter()
                    .filter_map(|dependent| index_of.get(&dependent).copied())
                    .collect()
            })
            .collect();

        let components = strongly_connected_components(&adjacency);

        let mut order = Vec::with_capacity(nodes.len());
        let mut cycles = Vec::new();
        // Tarjan emits components in reverse topological order, so walking the
        // list backwards puts dependencies before the cells that read them.
        for component in components.iter().rev() {
            let self_referential =
                component.len() == 1 && adjacency[component[0]].contains(&component[0]);
            if component.len() > 1 || self_referential {
                cycles.extend(component.iter().map(|&i| nodes[i]));
            } else {
                order.push(nodes[component[0]]);
            }
        }
        cycles.sort_unstable();
        Plan { order, cycles }
    }
}

/// Tarjan's strongly-connected-components algorithm, written iteratively so
/// that a long dependency chain cannot overflow the stack — a column of a
/// hundred thousand `=A2+1` cells is an ordinary spreadsheet, not an edge case.
///
/// Components come back in reverse topological order of the condensation.
fn strongly_connected_components(adjacency: &[Vec<usize>]) -> Vec<Vec<usize>> {
    const UNVISITED: usize = usize::MAX;
    let n = adjacency.len();
    let mut index = vec![UNVISITED; n];
    let mut lowlink = vec![0usize; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut components: Vec<Vec<usize>> = Vec::new();
    let mut next_index = 0usize;

    for root in 0..n {
        if index[root] != UNVISITED {
            continue;
        }
        // Each frame is a node and how far through its successors we are.
        let mut work: Vec<(usize, usize)> = vec![(root, 0)];
        while let Some(&mut (v, ref mut cursor)) = work.last_mut() {
            if *cursor == 0 {
                index[v] = next_index;
                lowlink[v] = next_index;
                next_index += 1;
                stack.push(v);
                on_stack[v] = true;
            }

            let mut descended = false;
            while *cursor < adjacency[v].len() {
                let w = adjacency[v][*cursor];
                *cursor += 1;
                if index[w] == UNVISITED {
                    work.push((w, 0));
                    descended = true;
                    break;
                }
                if on_stack[w] {
                    lowlink[v] = lowlink[v].min(index[w]);
                }
            }
            if descended {
                continue;
            }

            if lowlink[v] == index[v] {
                let mut component = Vec::new();
                while let Some(w) = stack.pop() {
                    on_stack[w] = false;
                    component.push(w);
                    if w == v {
                        break;
                    }
                }
                component.sort_unstable();
                components.push(component);
            }

            work.pop();
            if let Some(&(parent, _)) = work.last() {
                lowlink[parent] = lowlink[parent].min(lowlink[v]);
            }
        }
    }
    components
}

/// A recalculation plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// Cells to evaluate, dependencies first.
    pub order: Vec<CellAddr>,
    /// Cells caught in a circular reference, in address order. They are given
    /// `#CYCLE!` rather than being evaluated; cells that merely *read* one of
    /// them are not listed here and evaluate against that error normally.
    pub cycles: Vec<CellAddr>,
}

impl Plan {
    pub fn is_empty(&self) -> bool {
        self.order.is_empty() && self.cycles.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellmoa_core::reference::CellRef;

    fn a(col: u32, row: u32) -> CellAddr {
        CellAddr::new(0, col, row)
    }

    fn cell_dep(col: u32, row: u32) -> Dep {
        Dep::Cell(a(col, row))
    }

    fn range_dep(spec: &str) -> Dep {
        Dep::Range { sheet: 0, range: RangeRef::parse_a1(spec).unwrap() }
    }

    #[test]
    fn a_chain_recalculates_in_dependency_order() {
        let mut g = DepGraph::new();
        // B1 = A1, C1 = B1
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);
        g.set_deps(a(2, 0), vec![cell_dep(1, 0)], false);

        let plan = g.plan([a(0, 0)]);
        assert_eq!(plan.order, vec![a(1, 0), a(2, 0)]);
        assert!(plan.cycles.is_empty());
    }

    #[test]
    fn only_the_dependent_subgraph_is_recalculated() {
        let mut g = DepGraph::new();
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);
        // An unrelated formula elsewhere must stay out of the plan.
        g.set_deps(a(5, 5), vec![cell_dep(4, 5)], false);

        assert_eq!(g.plan([a(0, 0)]).order, vec![a(1, 0)]);
    }

    #[test]
    fn a_diamond_evaluates_the_join_once_and_last() {
        let mut g = DepGraph::new();
        // B1 = A1, C1 = A1, D1 = B1 + C1
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);
        g.set_deps(a(2, 0), vec![cell_dep(0, 0)], false);
        g.set_deps(a(3, 0), vec![cell_dep(1, 0), cell_dep(2, 0)], false);

        let plan = g.plan([a(0, 0)]);
        assert_eq!(plan.order.len(), 3);
        assert_eq!(*plan.order.last().unwrap(), a(3, 0));
    }

    #[test]
    fn a_range_dependency_fires_for_any_cell_inside_it() {
        let mut g = DepGraph::new();
        g.set_deps(a(3, 0), vec![range_dep("A1:A100")], false);

        assert_eq!(g.plan([a(0, 49)]).order, vec![a(3, 0)]);
        // Outside the range, nothing to do.
        assert!(g.plan([a(1, 49)]).order.is_empty());
    }

    #[test]
    fn a_whole_column_dependency_does_not_expand_into_edges() {
        let mut g = DepGraph::new();
        let whole_col = RangeRef::new(CellRef::new(0, 0), CellRef::new(0, 1_048_575));
        g.set_deps(a(3, 0), vec![Dep::Range { sheet: 0, range: whole_col }], false);
        assert_eq!(g.plan([a(0, 999_999)]).order, vec![a(3, 0)]);
    }

    #[test]
    fn a_direct_cycle_is_reported_rather_than_ordered() {
        let mut g = DepGraph::new();
        g.set_deps(a(0, 0), vec![cell_dep(1, 0)], false);
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);

        let plan = g.plan([a(0, 0)]);
        assert!(plan.order.is_empty());
        assert_eq!(plan.cycles, vec![a(0, 0), a(1, 0)]);
    }

    #[test]
    fn a_self_reference_is_a_cycle() {
        let mut g = DepGraph::new();
        g.set_deps(a(0, 0), vec![cell_dep(0, 0)], false);
        let plan = g.plan_including([a(0, 0)]);
        assert_eq!(plan.cycles, vec![a(0, 0)]);
    }

    #[test]
    fn cells_downstream_of_a_cycle_still_evaluate() {
        let mut g = DepGraph::new();
        g.set_deps(a(0, 0), vec![cell_dep(1, 0)], false);
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);
        // C1 reads a cell inside the cycle but is not part of it.
        g.set_deps(a(2, 0), vec![cell_dep(0, 0)], false);

        let plan = g.plan([a(0, 0)]);
        assert_eq!(plan.order, vec![a(2, 0)]);
        assert_eq!(plan.cycles, vec![a(0, 0), a(1, 0)]);
    }

    #[test]
    fn a_range_that_covers_the_formula_itself_is_a_cycle() {
        let mut g = DepGraph::new();
        // A1 = SUM(A1:A5)
        g.set_deps(a(0, 0), vec![range_dep("A1:A5")], false);
        assert_eq!(g.plan_including([a(0, 0)]).cycles, vec![a(0, 0)]);
    }

    #[test]
    fn a_long_chain_does_not_overflow_the_stack() {
        let mut g = DepGraph::new();
        let depth = 100_000u32;
        for row in 1..depth {
            g.set_deps(a(0, row), vec![cell_dep(0, row - 1)], false);
        }
        let plan = g.plan([a(0, 0)]);
        assert_eq!(plan.order.len() as u32, depth - 1);
        assert_eq!(plan.order[0], a(0, 1));
        assert_eq!(*plan.order.last().unwrap(), a(0, depth - 1));
    }

    #[test]
    fn replacing_a_formula_drops_its_old_edges() {
        let mut g = DepGraph::new();
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);
        g.set_deps(a(1, 0), vec![cell_dep(9, 9)], false);

        assert!(g.plan([a(0, 0)]).order.is_empty());
        assert_eq!(g.plan([a(9, 9)]).order, vec![a(1, 0)]);
    }

    #[test]
    fn removing_a_formula_unhooks_it_from_both_directions() {
        let mut g = DepGraph::new();
        g.set_deps(a(1, 0), vec![range_dep("A1:A10")], false);
        g.remove(a(1, 0));

        assert!(g.plan([a(0, 0)]).order.is_empty());
        assert!(!g.is_formula(a(1, 0)));
    }

    #[test]
    fn the_plan_includes_the_seed_when_asked() {
        let mut g = DepGraph::new();
        g.set_deps(a(1, 0), vec![cell_dep(0, 0)], false);
        g.set_deps(a(2, 0), vec![cell_dep(1, 0)], false);

        assert_eq!(g.plan([a(1, 0)]).order, vec![a(2, 0)]);
        assert_eq!(g.plan_including([a(1, 0)]).order, vec![a(1, 0), a(2, 0)]);
    }

    #[test]
    fn volatile_cells_are_tracked_separately() {
        let mut g = DepGraph::new();
        g.set_deps(a(0, 0), vec![], true);
        g.set_deps(a(1, 0), vec![], false);
        assert_eq!(g.volatile_cells().collect::<Vec<_>>(), vec![a(0, 0)]);

        // Editing the cell into a non-volatile formula clears the flag.
        g.set_deps(a(0, 0), vec![cell_dep(5, 5)], false);
        assert_eq!(g.volatile_cells().count(), 0);
    }

    #[test]
    fn the_evaluation_order_is_identical_across_runs() {
        let build = || {
            let mut g = DepGraph::new();
            for i in 1..20u32 {
                g.set_deps(a(i, 0), vec![cell_dep(i - 1, 0), range_dep("A1:Z1")], false);
            }
            g
        };
        assert_eq!(build().plan([a(0, 0)]).order, build().plan([a(0, 0)]).order);
    }
}
