//! Edits, revisions, undo/redo and the provenance journal.
//!
//! Every mutation of a document goes through [`Document::apply`], which:
//!
//! 1. checks the caller's expected revision, so a stale writer is rejected
//!    rather than silently overwriting a concurrent edit (F5);
//! 2. computes the inverse of each op, which is what undo/redo replays (F4);
//! 3. appends a [`Commit`] to the journal, which is both the audit trail (D5)
//!    and the replay log (D4).
//!
//! Core never reads the clock. Timestamps are supplied by the caller and are
//! excluded from replay, so replaying a journal reproduces a document exactly.

use crate::model::{Cell, CellAddr, CellContent, DefinedName, SheetId, Workbook};
use crate::value::Value;
use std::fmt;

/// Who made an edit. Recorded on every commit so that an agent's changes can be
/// told apart from a person's — which is what makes agent-scoped undo possible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActorKind {
    Human,
    Agent,
    Script,
    /// The engine itself, e.g. a structural rewrite following a row insert.
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Actor {
    pub kind: ActorKind,
    /// A stable identifier: a user id, an agent session id, a script name.
    pub id: String,
}

impl Actor {
    pub fn human(id: impl Into<String>) -> Actor {
        Actor { kind: ActorKind::Human, id: id.into() }
    }

    pub fn agent(id: impl Into<String>) -> Actor {
        Actor { kind: ActorKind::Agent, id: id.into() }
    }

    pub fn script(id: impl Into<String>) -> Actor {
        Actor { kind: ActorKind::Script, id: id.into() }
    }

    pub fn system() -> Actor {
        Actor { kind: ActorKind::System, id: "system".into() }
    }
}

/// A single reversible mutation.
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    SetCell { addr: CellAddr, content: CellContent },
    AddSheet { name: String },
    RemoveSheet { sheet: SheetId },
    RestoreSheet { sheet: SheetId },
    RenameSheet { sheet: SheetId, name: String },
    DefineName { name: String, refers_to: String, scope: Option<SheetId> },
    RemoveName { name: String },
}

/// Why a commit exists. Undo and redo are recorded as commits of their own so
/// the journal stays append-only and the audit trail shows the reversal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitKind {
    Edit,
    /// Reverses the commit at this index.
    Undo(usize),
    /// Re-applies the commit at this index.
    Redo(usize),
}

/// One atomic, reversible group of ops.
#[derive(Debug, Clone)]
pub struct Commit {
    /// The revision the document reached when this commit was applied.
    pub revision: u64,
    pub actor: Actor,
    pub kind: CommitKind,
    pub ops: Vec<Op>,
    /// Ops that undo `ops`, in the order they must be applied.
    pub inverse: Vec<Op>,
    /// Optional human-readable description, e.g. "fill Q3 forecast".
    pub label: Option<String>,
    /// Epoch milliseconds, supplied by the caller. Ignored by replay and by the
    /// fingerprint so that the same edits always produce the same document.
    pub at: Option<i64>,
    /// Set once this commit has been undone and not yet redone.
    pub undone: bool,
}

impl Commit {
    /// Whether this commit touched a given cell — the primitive behind
    /// "who last changed this cell, and why".
    pub fn touches(&self, addr: CellAddr) -> bool {
        self.ops.iter().any(|op| matches!(op, Op::SetCell { addr: a, .. } if *a == addr))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    /// The caller edited from a revision that is no longer current. Carries the
    /// current revision so the caller can rebase and retry.
    RevisionConflict { expected: u64, actual: u64 },
    UnknownSheet(SheetId),
    NothingToUndo,
    NothingToRedo,
}

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EditError::RevisionConflict { expected, actual } => write!(
                f,
                "revision conflict: edit was made against revision {expected}, document is at {actual}"
            ),
            EditError::UnknownSheet(id) => write!(f, "unknown sheet id {id}"),
            EditError::NothingToUndo => f.write_str("nothing to undo"),
            EditError::NothingToRedo => f.write_str("nothing to redo"),
        }
    }
}

impl std::error::Error for EditError {}

/// A workbook plus its edit history.
///
/// Import and export deal in a bare [`Workbook`]; everything that mutates a
/// document in place goes through a `Document` so the history is never bypassed.
#[derive(Debug, Clone)]
pub struct Document {
    pub workbook: Workbook,
    commits: Vec<Commit>,
    undo_stack: Vec<usize>,
    /// Pairs of `(original commit, the undo commit that reversed it)`. Redo
    /// replays the undo commit's own inverse rather than the original ops,
    /// because re-running an op is not always the same as reversing its
    /// reversal — re-running `AddSheet` would append a second sheet instead of
    /// bringing the tombstoned one back.
    redo_stack: Vec<(usize, usize)>,
}

impl Default for Document {
    fn default() -> Self {
        Document::new(Workbook::new())
    }
}

impl Document {
    pub fn new(workbook: Workbook) -> Document {
        Document { workbook, commits: Vec::new(), undo_stack: Vec::new(), redo_stack: Vec::new() }
    }

    pub fn revision(&self) -> u64 {
        self.workbook.revision()
    }

    /// The full journal, oldest first.
    pub fn commits(&self) -> &[Commit] {
        &self.commits
    }

    /// Commits that touched a cell, oldest first — the provenance of that cell.
    pub fn history_of(&self, addr: CellAddr) -> impl Iterator<Item = &Commit> {
        self.commits.iter().filter(move |c| c.touches(addr))
    }

    /// Applies a group of ops atomically.
    ///
    /// `expected_revision` is the optimistic-concurrency guard: pass the
    /// revision the edit was computed against, and the write is rejected if the
    /// document has moved on. Pass `None` to force the write through.
    pub fn apply(
        &mut self,
        actor: Actor,
        ops: Vec<Op>,
        expected_revision: Option<u64>,
    ) -> Result<&Commit, EditError> {
        self.apply_full(actor, ops, expected_revision, CommitKind::Edit, None, None)
    }

    /// [`Document::apply`] with a label and timestamp for the audit trail.
    pub fn apply_labeled(
        &mut self,
        actor: Actor,
        ops: Vec<Op>,
        expected_revision: Option<u64>,
        label: impl Into<String>,
        at: Option<i64>,
    ) -> Result<&Commit, EditError> {
        self.apply_full(actor, ops, expected_revision, CommitKind::Edit, Some(label.into()), at)
    }

    fn apply_full(
        &mut self,
        actor: Actor,
        ops: Vec<Op>,
        expected_revision: Option<u64>,
        kind: CommitKind,
        label: Option<String>,
        at: Option<i64>,
    ) -> Result<&Commit, EditError> {
        if let Some(expected) = expected_revision {
            let actual = self.workbook.revision();
            if expected != actual {
                return Err(EditError::RevisionConflict { expected, actual });
            }
        }

        // Each inverse is computed against the state immediately before its
        // own op, not against the state before the whole commit — otherwise
        // two `AddSheet`s in one commit would both invert to the same id.
        // Applying the inverses in reverse order then unwinds correctly.
        let mut inverse = Vec::with_capacity(ops.len());
        for op in &ops {
            inverse.push(self.invert(op)?);
            self.perform(op);
        }
        inverse.reverse();

        let revision = self.workbook.bump_revision();
        let index = self.commits.len();
        self.commits.push(Commit {
            revision,
            actor,
            kind,
            ops,
            inverse,
            label,
            at,
            undone: false,
        });
        if matches!(kind, CommitKind::Edit) {
            self.undo_stack.push(index);
            // A fresh edit invalidates the redo branch, as in any editor.
            self.redo_stack.clear();
        }
        Ok(&self.commits[index])
    }

    /// Undoes the most recent undoable commit, optionally restricted to one
    /// actor. Restricting is what lets an agent's changes be rolled back
    /// without disturbing edits the user made in the meantime (F4).
    pub fn undo(&mut self, actor: Actor, only_by: Option<&str>) -> Result<&Commit, EditError> {
        let pos = self
            .undo_stack
            .iter()
            .rposition(|&i| {
                !self.commits[i].undone
                    && only_by.is_none_or(|id| self.commits[i].actor.id == id)
            })
            .ok_or(EditError::NothingToUndo)?;
        let index = self.undo_stack.remove(pos);
        let inverse = self.commits[index].inverse.clone();
        self.commits[index].undone = true;
        let undo_index = self.commits.len();
        self.redo_stack.push((index, undo_index));
        self.apply_full(actor, inverse, None, CommitKind::Undo(index), None, None)
    }

    /// Re-applies the most recently undone commit, optionally restricted to one
    /// actor.
    pub fn redo(&mut self, actor: Actor, only_by: Option<&str>) -> Result<&Commit, EditError> {
        let pos = self
            .redo_stack
            .iter()
            .rposition(|&(orig, _)| {
                self.commits[orig].undone
                    && only_by.is_none_or(|id| self.commits[orig].actor.id == id)
            })
            .ok_or(EditError::NothingToRedo)?;
        let (orig, undo_index) = self.redo_stack.remove(pos);
        let ops = self.commits[undo_index].inverse.clone();
        self.commits[orig].undone = false;
        self.undo_stack.push(orig);
        self.apply_full(actor, ops, None, CommitKind::Redo(orig), None, None)
    }

    /// Rebuilds a workbook by replaying a journal from empty.
    ///
    /// Because ops carry no timestamps or environment, the result depends only
    /// on the journal — this is the guarantee replay (D4) and fingerprint
    /// comparison (D2) are built on.
    pub fn replay(commits: &[Commit]) -> Workbook {
        let mut doc = Document::new(Workbook::new());
        for commit in commits {
            for op in &commit.ops {
                doc.perform(op);
            }
            doc.workbook.bump_revision();
        }
        doc.workbook
    }

    /// Computes the op that reverses `op` against the current state.
    fn invert(&self, op: &Op) -> Result<Op, EditError> {
        Ok(match op {
            Op::SetCell { addr, .. } => {
                let content = self.workbook.content(*addr);
                Op::SetCell { addr: *addr, content }
            }
            Op::AddSheet { .. } => {
                // The new sheet always lands at the end, so its id is known
                // before the op runs.
                Op::RemoveSheet { sheet: self.workbook.sheet_count() as SheetId }
            }
            Op::RemoveSheet { sheet } => Op::RestoreSheet { sheet: *sheet },
            Op::RestoreSheet { sheet } => Op::RemoveSheet { sheet: *sheet },
            Op::RenameSheet { sheet, .. } => {
                let name = self
                    .workbook
                    .sheet(*sheet)
                    .ok_or(EditError::UnknownSheet(*sheet))?
                    .name
                    .clone();
                Op::RenameSheet { sheet: *sheet, name }
            }
            Op::DefineName { name, .. } => match self.workbook.name(name) {
                Some(prev) => Op::DefineName {
                    name: prev.name.clone(),
                    refers_to: prev.refers_to.clone(),
                    scope: prev.scope,
                },
                None => Op::RemoveName { name: name.clone() },
            },
            Op::RemoveName { name } => match self.workbook.name(name) {
                Some(prev) => Op::DefineName {
                    name: prev.name.clone(),
                    refers_to: prev.refers_to.clone(),
                    scope: prev.scope,
                },
                // Removing a name that is not there is a no-op, and so is its
                // inverse.
                None => Op::RemoveName { name: name.clone() },
            },
        })
    }

    fn perform(&mut self, op: &Op) {
        match op {
            Op::SetCell { addr, content } => {
                let Some(sheet) = self.workbook.sheet_mut(addr.sheet) else { return };
                let cell = match content {
                    CellContent::Empty => Cell { content: CellContent::Empty, value: Value::Blank },
                    CellContent::Literal(v) => Cell::literal(v.clone()),
                    CellContent::Formula(src) => Cell::formula(src.clone()),
                };
                sheet.set(addr.col, addr.row, cell);
            }
            Op::AddSheet { name } => {
                self.workbook.add_sheet(name.clone());
            }
            Op::RemoveSheet { sheet } => {
                self.workbook.remove_sheet(*sheet);
            }
            Op::RestoreSheet { sheet } => {
                self.workbook.restore_sheet(*sheet);
            }
            Op::RenameSheet { sheet, name } => {
                self.workbook.rename_sheet(*sheet, name.clone());
            }
            Op::DefineName { name, refers_to, scope } => {
                self.workbook.define_name(DefinedName {
                    name: name.clone(),
                    refers_to: refers_to.clone(),
                    scope: *scope,
                });
            }
            Op::RemoveName { name } => {
                self.workbook.remove_name(name);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> Document {
        let mut wb = Workbook::new();
        wb.add_sheet("Sheet1");
        Document::new(wb)
    }

    fn set(col: u32, row: u32, v: i64) -> Op {
        Op::SetCell {
            addr: CellAddr::new(0, col, row),
            content: CellContent::Literal(Value::number(v as f64)),
        }
    }

    #[test]
    fn a_stale_writer_is_rejected_with_the_current_revision() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], Some(0)).unwrap();
        let err = d.apply(Actor::agent("a1"), vec![set(0, 0, 2)], Some(0)).unwrap_err();
        assert_eq!(err, EditError::RevisionConflict { expected: 0, actual: 1 });
        // The rejected write left nothing behind.
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(1));
        assert_eq!(d.revision(), 1);
    }

    #[test]
    fn a_rebased_writer_succeeds() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], Some(0)).unwrap();
        d.apply(Actor::agent("a1"), vec![set(0, 0, 2)], Some(1)).unwrap();
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(2));
    }

    #[test]
    fn undo_restores_the_previous_content() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], None).unwrap();
        d.apply(Actor::human("u1"), vec![set(0, 0, 2)], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(1));
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::Blank);
        d.redo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(1));
    }

    #[test]
    fn an_agents_edits_can_be_undone_without_touching_the_users() {
        let mut d = doc();
        d.apply(Actor::agent("agent-7"), vec![set(0, 0, 10)], None).unwrap();
        d.apply(Actor::human("u1"), vec![set(1, 0, 99)], None).unwrap();

        d.undo(Actor::human("u1"), Some("agent-7")).unwrap();

        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::Blank);
        assert_eq!(d.workbook.value(CellAddr::new(0, 1, 0)), Value::number(99));
    }

    #[test]
    fn overlapping_writes_in_one_commit_unwind_in_reverse() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], None).unwrap();
        d.apply(Actor::human("u1"), vec![set(0, 0, 2), set(0, 0, 3)], None).unwrap();
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(3));
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(1));
    }

    #[test]
    fn undo_and_redo_are_themselves_recorded() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.commits().len(), 2);
        assert_eq!(d.commits()[1].kind, CommitKind::Undo(0));
        // Every commit advances the revision, undos included.
        assert_eq!(d.revision(), 2);
    }

    #[test]
    fn a_new_edit_drops_the_redo_branch() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();
        d.apply(Actor::human("u1"), vec![set(0, 0, 5)], None).unwrap();
        assert_eq!(d.redo(Actor::human("u1"), None).unwrap_err(), EditError::NothingToRedo);
    }

    #[test]
    fn cell_history_answers_who_changed_this() {
        let mut d = doc();
        d.apply_labeled(Actor::human("u1"), vec![set(0, 0, 1)], None, "seed", Some(1)).unwrap();
        d.apply_labeled(Actor::agent("a1"), vec![set(0, 0, 2)], None, "forecast", Some(2)).unwrap();
        d.apply(Actor::human("u1"), vec![set(5, 5, 3)], None).unwrap();

        let hits: Vec<_> = d
            .history_of(CellAddr::new(0, 0, 0))
            .map(|c| (c.actor.id.as_str(), c.label.as_deref()))
            .collect();
        assert_eq!(hits, vec![("u1", Some("seed")), ("a1", Some("forecast"))]);
    }

    #[test]
    fn replaying_the_journal_reproduces_the_document() {
        let mut d = doc();
        d.apply(Actor::system(), vec![Op::AddSheet { name: "Sheet1".into() }], None).unwrap();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1), set(1, 0, 2)], None).unwrap();
        d.apply(Actor::agent("a1"), vec![set(0, 0, 7)], None).unwrap();
        d.undo(Actor::human("u1"), Some("a1")).unwrap();

        let replayed = Document::replay(d.commits());
        for (col, row) in [(0u32, 0u32), (1, 0)] {
            let addr = CellAddr::new(0, col, row);
            assert_eq!(replayed.value(addr), d.workbook.value(addr));
        }
        assert_eq!(replayed.revision(), d.revision());
    }

    #[test]
    fn two_sheets_added_in_one_commit_both_unwind() {
        let mut d = doc();
        d.apply(
            Actor::human("u1"),
            vec![Op::AddSheet { name: "A".into() }, Op::AddSheet { name: "B".into() }],
            None,
        )
        .unwrap();
        assert_eq!(d.workbook.sheets().count(), 3);
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 1);
    }

    #[test]
    fn adding_a_sheet_is_reversible() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![Op::AddSheet { name: "Data".into() }], None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 2);
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 1);
        d.redo(Actor::human("u1"), None).unwrap();
        // Redo brings back the same sheet rather than appending another one.
        assert_eq!(d.workbook.sheet_by_name("Data").map(|s| s.id), Some(1));
        assert_eq!(d.workbook.sheets().count(), 2);
    }

    #[test]
    fn renaming_a_sheet_is_reversible() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![Op::RenameSheet { sheet: 0, name: "Q1".into() }], None)
            .unwrap();
        assert_eq!(d.workbook.sheet(0).unwrap().name, "Q1");
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.sheet(0).unwrap().name, "Sheet1");
    }

    #[test]
    fn defined_names_are_reversible() {
        let mut d = doc();
        let define = |to: &str| Op::DefineName {
            name: "Tax".into(),
            refers_to: to.into(),
            scope: None,
        };
        d.apply(Actor::human("u1"), vec![define("Sheet1!$A$1")], None).unwrap();
        d.apply(Actor::human("u1"), vec![define("Sheet1!$B$1")], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.name("Tax").unwrap().refers_to, "Sheet1!$A$1");
        d.undo(Actor::human("u1"), None).unwrap();
        assert!(d.workbook.name("Tax").is_none());
    }
}
