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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ActorKind {
    Human,
    Agent,
    Script,
    /// The engine itself, e.g. a structural rewrite following a row insert.
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
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
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CommitKind {
    Edit,
    /// Reverses the commit at this index.
    Undo(usize),
    /// Re-applies the commit at this index.
    Redo(usize),
}

/// One atomic, reversible group of ops.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
    RevisionConflict {
        expected: u64,
        actual: u64,
    },
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
    /// Fingerprint of the workbook this document started from.
    ///
    /// A journal is a list of changes, not a document. Replaying it onto the
    /// wrong starting point would produce a plausible but wrong result, so the
    /// starting point is recorded and checked.
    base: String,
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
        Document {
            base: crate::fingerprint::fingerprint(&workbook).workbook,
            workbook,
            commits: Vec::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    /// The fingerprint of the workbook this document started from.
    pub fn base_fingerprint(&self) -> &str {
        &self.base
    }

    pub fn revision(&self) -> u64 {
        self.workbook.revision()
    }

    /// The full journal, oldest first.
    pub fn commits(&self) -> &[Commit] {
        &self.commits
    }

    /// The commits undo would take back, in the order it would take them —
    /// the last is the next to go.
    ///
    /// This is not the same as "every commit not yet undone": undoing pushes a
    /// commit of its own, and that one is not itself undoable.
    pub fn undoable(&self) -> impl Iterator<Item = &Commit> {
        self.undo_stack.iter().map(move |&i| &self.commits[i])
    }

    /// The commits redo would put back, likewise last-first.
    pub fn redoable(&self) -> impl Iterator<Item = &Commit> {
        self.redo_stack.iter().map(move |&(original, _)| &self.commits[original])
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
            match self.invert(op) {
                Ok(reversal) => {
                    inverse.push(reversal);
                    self.perform(op);
                }
                // A commit is all or nothing. Rolling the earlier ops back is
                // what makes that true: leaving them applied would put changes
                // in the document that no commit records and no undo can reach.
                Err(err) => {
                    for reversal in inverse.iter().rev() {
                        self.perform(reversal);
                    }
                    return Err(err);
                }
            }
        }
        inverse.reverse();

        let revision = self.workbook.bump_revision();
        let index = self.commits.len();
        self.commits.push(Commit { revision, actor, kind, ops, inverse, label, at, undone: false });
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
                !self.commits[i].undone && only_by.is_none_or(|id| self.commits[i].actor.id == id)
            })
            .ok_or(EditError::NothingToUndo)?;
        let index = self.undo_stack[pos];
        let inverse = self.commits[index].inverse.clone();
        let undo_index = self.commits.len();
        // The books are only closed once the reversal has actually been
        // applied. An inverse that can no longer be computed must leave the
        // history exactly as it was, not a commit marked undone that is still
        // in force and a redo entry pointing at a commit that was never
        // written.
        self.apply_full(actor, inverse, None, CommitKind::Undo(index), None, None)?;
        self.undo_stack.remove(pos);
        self.commits[index].undone = true;
        self.redo_stack.push((index, undo_index));
        Ok(&self.commits[undo_index])
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
        let (orig, undo_index) = self.redo_stack[pos];
        let ops = self.commits[undo_index].inverse.clone();
        let redo_index = self.commits.len();
        self.apply_full(actor, ops, None, CommitKind::Redo(orig), None, None)?;
        self.redo_stack.remove(pos);
        self.commits[orig].undone = false;
        self.undo_stack.push(orig);
        Ok(&self.commits[redo_index])
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
            // The inverse puts the sheet back into the state it is in now,
            // rather than assuming the op is about to change that state.
            // Removing a sheet that is already gone changes nothing, and the
            // reversal of a no-op has to be a no-op too — the naive opposite
            // would resurrect a sheet some earlier commit deleted, or delete a
            // live one this commit never touched.
            Op::RemoveSheet { sheet } | Op::RestoreSheet { sheet } => {
                match self.workbook.sheet(*sheet) {
                    Some(_) => Op::RestoreSheet { sheet: *sheet },
                    None => Op::RemoveSheet { sheet: *sheet },
                }
            }
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
                // An edit replaces the input but leaves the cell's format in
                // place, exactly as typing into a formatted cell does.
                let style = sheet.get(addr.col, addr.row).and_then(|c| c.style);
                let cell = match content {
                    CellContent::Empty => {
                        Cell { content: CellContent::Empty, value: Value::Blank, style }
                    }
                    CellContent::Literal(v) => Cell::literal(v.clone()).with_style(style),
                    CellContent::Formula(src) => Cell::formula(src.clone()).with_style(style),
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
    fn a_journal_survives_a_trip_through_json() {
        let mut d = doc();
        d.apply_labeled(Actor::agent("a1"), vec![set(0, 0, 7)], None, "forecast", Some(99))
            .unwrap();
        d.apply(Actor::human("u1"), vec![Op::AddSheet { name: "Data".into() }], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();

        let journal = Journal::of(&d);
        let text = serde_json::to_string(&journal).expect("journal should serialise");
        let restored: Journal = serde_json::from_str(&text).expect("journal should parse");

        assert_eq!(restored.version, JOURNAL_VERSION);
        // Replayed onto the same starting point the document had.
        let mut base = Workbook::new();
        base.add_sheet("Sheet1");
        let replayed = restored.replay_onto(base).expect("the base should match");
        assert_eq!(
            replayed.value(CellAddr::new(0, 0, 0)),
            d.workbook.value(CellAddr::new(0, 0, 0))
        );
        assert_eq!(replayed.sheets().count(), d.workbook.sheets().count());
        // The audit trail comes back too, not just the final state.
        assert_eq!(restored.commits[0].actor.id, "a1");
        assert_eq!(restored.commits[0].label.as_deref(), Some("forecast"));
        assert_eq!(restored.commits[0].at, Some(99));
    }

    #[test]
    fn replaying_the_journal_reproduces_the_document() {
        let mut d = doc();
        d.apply(Actor::system(), vec![Op::AddSheet { name: "Sheet1".into() }], None).unwrap();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1), set(1, 0, 2)], None).unwrap();
        d.apply(Actor::agent("a1"), vec![set(0, 0, 7)], None).unwrap();
        d.undo(Actor::human("u1"), Some("a1")).unwrap();

        // Replayed onto the same starting point: a workbook with Sheet1 in it.
        let mut base = Workbook::new();
        base.add_sheet("Sheet1");
        let replayed = Journal::of(&d).replay_onto(base).expect("the base should match");
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
    fn replaying_onto_the_wrong_document_is_refused() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], None).unwrap();
        let journal = Journal::of(&d);

        // A workbook that is not what the journal was recorded against.
        let mut different = Workbook::new();
        different.add_sheet("Something Else");
        assert!(matches!(journal.replay_onto(different), Err(ReplayError::BaseMismatch { .. })));
    }

    #[test]
    fn a_journal_from_an_incompatible_version_is_refused() {
        let mut journal = Journal::of(&doc());
        journal.version = 999;
        assert_eq!(journal.replay().unwrap_err(), ReplayError::UnsupportedVersion(999));
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
    fn removing_a_sheet_is_reversible() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![set(0, 0, 1)], None).unwrap();
        d.apply(Actor::human("u1"), vec![Op::RemoveSheet { sheet: 0 }], None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 0);
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 1);
        // The cells came back with the sheet.
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::number(1));
        d.redo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 0);
    }

    #[test]
    fn undoing_a_removal_that_removed_nothing_leaves_the_sheet_alone() {
        let mut d = doc();
        d.apply(Actor::human("u1"), vec![Op::RemoveSheet { sheet: 0 }], None).unwrap();
        // The sheet is already gone, so this commit changes nothing.
        d.apply(Actor::agent("a1"), vec![Op::RemoveSheet { sheet: 0 }], None).unwrap();
        d.undo(Actor::human("u1"), Some("a1")).unwrap();
        assert_eq!(d.workbook.sheets().count(), 0, "undoing a no-op resurrected the sheet");
    }

    #[test]
    fn undoing_a_restore_that_restored_nothing_leaves_the_sheet_alone() {
        let mut d = doc();
        // Sheet1 is already live, so this commit changes nothing.
        d.apply(Actor::human("u1"), vec![Op::RestoreSheet { sheet: 0 }], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.sheets().count(), 1, "undoing a no-op deleted a live sheet");
    }

    #[test]
    fn a_commit_that_cannot_be_inverted_applies_none_of_itself() {
        let mut d = doc();
        let err = d
            .apply(
                Actor::human("u1"),
                vec![
                    set(0, 0, 1),
                    Op::AddSheet { name: "Data".into() },
                    Op::RenameSheet { sheet: 99, name: "Nope".into() },
                ],
                None,
            )
            .unwrap_err();
        assert_eq!(err, EditError::UnknownSheet(99));
        // The first two ops ran before the third was refused; none of it may
        // survive, because nothing records that they happened.
        assert_eq!(d.workbook.value(CellAddr::new(0, 0, 0)), Value::Blank);
        assert_eq!(d.workbook.sheets().count(), 1);
        assert_eq!(d.revision(), 0);
        assert!(d.commits().is_empty());
    }

    #[test]
    fn an_undo_that_cannot_be_computed_leaves_the_history_intact() {
        let mut d = doc();
        d.apply(Actor::agent("a1"), vec![Op::RenameSheet { sheet: 0, name: "Q1".into() }], None)
            .unwrap();
        d.apply(Actor::human("u1"), vec![Op::RemoveSheet { sheet: 0 }], None).unwrap();

        // The rename cannot be reversed while the sheet is tombstoned.
        assert_eq!(d.undo(Actor::human("u1"), Some("a1")).unwrap_err(), EditError::UnknownSheet(0));

        assert_eq!(d.commits().len(), 2);
        assert!(!d.commits()[0].undone);
        assert_eq!(d.undoable().count(), 2);
        assert_eq!(d.redo(Actor::human("u1"), None).unwrap_err(), EditError::NothingToRedo);
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
        let define =
            |to: &str| Op::DefineName { name: "Tax".into(), refers_to: to.into(), scope: None };
        d.apply(Actor::human("u1"), vec![define("Sheet1!$A$1")], None).unwrap();
        d.apply(Actor::human("u1"), vec![define("Sheet1!$B$1")], None).unwrap();
        d.undo(Actor::human("u1"), None).unwrap();
        assert_eq!(d.workbook.name("Tax").unwrap().refers_to, "Sheet1!$A$1");
        d.undo(Actor::human("u1"), None).unwrap();
        assert!(d.workbook.name("Tax").is_none());
    }
}

/// A journal that can be written to a file and replayed.
///
/// Replay is only meaningful if the log is complete and self-contained: no
/// timestamps are consulted and no environment is read, so applying the commits
/// in order to the recorded starting point reproduces the document exactly.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Journal {
    /// The format version, so an older log can be recognised rather than
    /// misread.
    pub version: u32,
    /// Fingerprint of the workbook the first commit was applied to.
    pub base: String,
    pub commits: Vec<Commit>,
}

/// Why a replay could not be trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayError {
    /// The journal was recorded against a different starting point.
    BaseMismatch { expected: String, actual: String },
    /// The journal was written by an incompatible version.
    UnsupportedVersion(u32),
}

impl fmt::Display for ReplayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReplayError::BaseMismatch { expected, actual } => write!(
                f,
                "this journal was recorded against a workbook fingerprinted {expected}, \
                 but the one given fingerprints {actual}"
            ),
            ReplayError::UnsupportedVersion(v) => write!(f, "unsupported journal version {v}"),
        }
    }
}

impl std::error::Error for ReplayError {}

/// The journal format this build writes.
pub const JOURNAL_VERSION: u32 = 1;

impl Journal {
    pub fn of(document: &Document) -> Journal {
        Journal {
            version: JOURNAL_VERSION,
            base: document.base_fingerprint().to_string(),
            commits: document.commits().to_vec(),
        }
    }

    /// Replays the journal onto the workbook it was recorded against.
    ///
    /// The starting point is checked first: a journal applied to the wrong
    /// document would produce something plausible and wrong, which is the one
    /// outcome an audit trail must never have.
    pub fn replay_onto(&self, base: Workbook) -> Result<Workbook, ReplayError> {
        if self.version != JOURNAL_VERSION {
            return Err(ReplayError::UnsupportedVersion(self.version));
        }
        let actual = crate::fingerprint::fingerprint(&base).workbook;
        if actual != self.base {
            return Err(ReplayError::BaseMismatch { expected: self.base.clone(), actual });
        }
        let mut document = Document::new(base);
        for commit in &self.commits {
            for op in &commit.ops {
                document.perform(op);
            }
            document.workbook.bump_revision();
        }
        Ok(document.workbook)
    }

    /// Replays onto an empty workbook, for a journal that records a document
    /// built from nothing.
    pub fn replay(&self) -> Result<Workbook, ReplayError> {
        self.replay_onto(Workbook::new())
    }
}
