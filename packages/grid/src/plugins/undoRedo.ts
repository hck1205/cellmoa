/**
 * Undo and redo.
 *
 * Handsontable keeps its own stack of actions in the browser. This grid does
 * not: every change is a commit in the engine's journal, and undo walks that.
 * The difference matters, because the journal also records *who* made each
 * change — so undo can be scoped to one actor, and a person can take back what
 * an agent did without disturbing the edits they made in the meantime.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** One end of the journal, as a toolbar needs to see it. */
export interface NextChange {
  revision: number;
  label: string | null;
  actor: { kind: string; id: string };
}

/** What undo and redo would do next. */
export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  undoByActor: Array<{ actor: string; count: number }>;
  redoByActor: Array<{ actor: string; count: number }>;
  nextUndo: NextChange | null;
  nextRedo: NextChange | null;
}

export class UndoRedo extends BasePlugin {
  static override readonly pluginName: string = 'undoRedo';

  /** The setting is `undo`, not the plugin's own name. */
  static override get settingKeys(): string[] {
    return ['undo'];
  }

  override isEnabled(): boolean {
    return this.grid.getSettings().undo !== false;
  }

  protected override onEnable(): void {
    // The keyboard shortcuts live in the grid itself, because undo has to work
    // whether or not this plugin was asked for.
  }

  /** Takes back the last change. */
  undo(): void {
    this.grid.undo();
  }

  /** Puts it back. */
  redo(): void {
    this.grid.redo();
  }

  /** Takes back the last change made by one actor. */
  undoBy(actor: string): void {
    this.grid.undoBy(actor);
  }

  /** Puts that one back. */
  redoBy(actor: string): void {
    this.grid.redoBy(actor);
  }

  /** What undo and redo would do next, and for whom. */
  getState(): UndoState {
    const response = this.grid.engine.call({ op: 'undo_state' });
    return {
      canUndo: response['canUndo'] === true,
      canRedo: response['canRedo'] === true,
      undoCount: (response['undoCount'] as number) ?? 0,
      redoCount: (response['redoCount'] as number) ?? 0,
      undoByActor: (response['undoByActor'] as UndoState['undoByActor']) ?? [],
      redoByActor: (response['redoByActor'] as UndoState['redoByActor']) ?? [],
      nextUndo: (response['nextUndo'] as NextChange | null) ?? null,
      nextRedo: (response['nextRedo'] as NextChange | null) ?? null,
    };
  }

  isUndoAvailable(): boolean {
    return this.getState().canUndo;
  }

  isRedoAvailable(): boolean {
    return this.getState().canRedo;
  }

  /** How many changes the given actor could still take back. */
  countUndoableBy(actor: string): number {
    return this.getState().undoByActor.find((entry) => entry.actor === actor)?.count ?? 0;
  }

  /**
   * Handsontable's `clear()` empties its action stack.
   *
   * There is no equivalent here and there should not be: the journal is the
   * audit trail, and a feature that quietly erased part of it would make every
   * guarantee built on top of it — replay, provenance, verify — untrue. The
   * method exists so ported code compiles, and it throws rather than pretending.
   */
  clear(): never {
    throw new Error(
      'the edit journal cannot be cleared: replay, provenance and verify all read it',
    );
  }
}

registerPlugin(UndoRedo);
