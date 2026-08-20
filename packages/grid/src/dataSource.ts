/**
 * The grid's view of the workbook.
 *
 * Rendering asks for a cell tens of thousands of times a second while
 * scrolling, and every one of those crossing into WebAssembly would be a
 * scroll that stutters. So the grid reads a window at a time and answers from a
 * cache, and the cache is thrown away whenever the workbook's revision moves —
 * which is the only way it can become wrong.
 */

import type { Engine, EngineResponse } from './engine.js';
import type { CellData, Coords } from './settings.js';

/** A rectangle to read. */
export interface Window {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

/** What the engine says about a sheet. */
export interface SheetInfo {
  id: number;
  name: string;
  cells: number;
  rows: number;
  cols: number;
  used: string | null;
}

/** An edit to apply. */
export interface Edit {
  row: number;
  col: number;
  /** What to type. A leading `=` makes a formula; `''` clears the cell. */
  input: string;
}

/** Why a write was refused. */
export class WriteConflict extends Error {
  /** The revision the workbook is actually at. */
  readonly revision: number;

  constructor(expected: number, actual: number) {
    super(
      `this edit was made against revision ${expected}, but the workbook is at ${actual}`,
    );
    this.name = 'WriteConflict';
    this.revision = actual;
  }
}

/** Converts a zero-based column index to letters: `0 -> A`, `26 -> AA`. */
export function columnLetters(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Converts column letters to a zero-based index. */
export function lettersToColumn(letters: string): number {
  let n = 0;
  for (const character of letters.toUpperCase()) {
    n = n * 26 + (character.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** An A1 reference for a cell. */
export function cellRef(row: number, col: number): string {
  return `${columnLetters(col)}${row + 1}`;
}

/** An A1 reference for a rectangle. */
export function rangeRef(window: Window): string {
  return `${cellRef(window.startRow, window.startCol)}:${cellRef(window.endRow, window.endCol)}`;
}

/**
 * Reads and writes one sheet of a workbook.
 */
export class DataSource {
  #engine: Engine;
  #sheet: string | null = null;
  #cells = new Map<number, CellData>();
  /** Windows already read into the cache, so a scroll back does not re-read. */
  #loaded: Window[] = [];
  #revision = -1;
  #rows = 0;
  #cols = 0;
  /** Beyond this, a cell key would lose precision as a number. */
  static readonly MAX_COLS = 16_384;

  constructor(engine: Engine, sheet?: string) {
    this.#engine = engine;
    this.#sheet = sheet ?? null;
    this.refresh();
  }

  /** The sheet being shown. */
  get sheet(): string | null {
    return this.#sheet;
  }

  /** The workbook's revision, as of the last call. */
  get revision(): number {
    return this.#revision;
  }

  /** How many rows the sheet uses. */
  get rowCount(): number {
    return this.#rows;
  }

  /** How many columns the sheet uses. */
  get colCount(): number {
    return this.#cols;
  }

  /** The sheets in the workbook. */
  sheets(): SheetInfo[] {
    const response = this.#engine.call({ op: 'sheets' });
    this.#revision = response.revision ?? this.#revision;
    return (response.sheets ?? []) as SheetInfo[];
  }

  /** Switches to another sheet. */
  selectSheet(name: string): void {
    this.#sheet = name;
    this.#invalidate();
    this.refresh();
  }

  /** Re-reads the sheet's size and drops the cache. */
  refresh(): void {
    const sheets = this.sheets();
    const sheet = this.#sheet
      ? sheets.find((s) => s.name.toLowerCase() === this.#sheet!.toLowerCase())
      : sheets[0];
    if (sheet) {
      this.#sheet = sheet.name;
      this.#rows = sheet.rows;
      this.#cols = sheet.cols;
    } else {
      this.#rows = 0;
      this.#cols = 0;
    }
    this.#invalidate();
  }

  /**
   * Makes sure a window is in the cache.
   *
   * Called by the renderer before it draws, so that the draw itself is pure
   * cache reads.
   */
  ensure(window: Window): void {
    if (window.endRow < window.startRow || window.endCol < window.startCol) {
      return;
    }
    if (this.#isLoaded(window)) {
      return;
    }
    const request: Record<string, unknown> = { op: 'read', range: rangeRef(window) };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    const response = this.#engine.send(request);
    if (!response.ok) {
      // A window past the end of the sheet is not an error worth throwing over;
      // it simply holds nothing.
      this.#loaded.push({ ...window });
      return;
    }
    this.#revision = response.revision ?? this.#revision;
    for (const cell of (response.cells ?? []) as Array<CellData & Coords>) {
      this.#cells.set(this.#key(cell.row, cell.col), {
        text: cell.text,
        value: cell.value,
        ...(cell.formula === undefined ? {} : { formula: cell.formula }),
        ...(cell.error === undefined ? {} : { error: cell.error }),
        ...(cell.style === undefined ? {} : { style: cell.style }),
      });
    }
    this.#loaded.push({ ...window });
  }

  /**
   * A cell's contents, or `null` when it holds nothing.
   *
   * Returns from the cache only. A caller that has not called `ensure` for the
   * window gets `null`, which is the right answer for an unread cell and the
   * wrong one to build a renderer on — hence `ensure` first.
   */
  get(row: number, col: number): CellData | null {
    return this.#cells.get(this.#key(row, col)) ?? null;
  }

  /** A cell's displayed text, or the empty string. */
  text(row: number, col: number): string {
    return this.get(row, col)?.text ?? '';
  }

  /** What to put in an editor: the formula if there is one, else the text. */
  editableValue(row: number, col: number): string {
    const cell = this.get(row, col);
    if (!cell) {
      return '';
    }
    return cell.formula ?? cell.text;
  }

  /**
   * Applies edits.
   *
   * `expectedRevision` is the optimistic-concurrency guard. Pass what the
   * caller last saw and a write that would overwrite an edit it has not seen is
   * refused instead.
   */
  write(edits: Edit[], expectedRevision?: number, label?: string): number {
    if (edits.length === 0) {
      return this.#revision;
    }
    const request: Record<string, unknown> = {
      op: 'write',
      cells: edits.map((edit) => ({ cell: cellRef(edit.row, edit.col), input: edit.input })),
    };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    if (expectedRevision !== undefined) {
      request.revision = expectedRevision;
    }
    if (label !== undefined) {
      request.label = label;
    }
    const response = this.#engine.send(request);
    return this.#applied(response, expectedRevision);
  }

  /** Undoes the most recent change, optionally only one actor's. */
  undo(onlyBy?: string): number {
    const request: Record<string, unknown> = { op: 'undo' };
    if (onlyBy !== undefined) {
      request.only_by = onlyBy;
    }
    return this.#applied(this.#engine.send(request));
  }

  /** Re-applies the most recently undone change. */
  redo(onlyBy?: string): number {
    const request: Record<string, unknown> = { op: 'redo' };
    if (onlyBy !== undefined) {
      request.only_by = onlyBy;
    }
    return this.#applied(this.#engine.send(request));
  }

  /** Evaluates a formula without storing it. */
  evaluate(formula: string): EngineResponse {
    const request: Record<string, unknown> = { op: 'eval', formula };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    return this.#engine.send(request);
  }

  /** Who changed a cell, and why. */
  history(row: number, col: number): Array<Record<string, unknown>> {
    const request: Record<string, unknown> = { op: 'history', cell: cellRef(row, col) };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    const response = this.#engine.send(request);
    return response.ok ? ((response.history ?? []) as Array<Record<string, unknown>>) : [];
  }

  /** Handles a response that may have changed the workbook. */
  #applied(response: EngineResponse, expected?: number): number {
    if (!response.ok) {
      if (response.code === 'revision_conflict') {
        throw new WriteConflict(expected ?? -1, (response.revision as number) ?? -1);
      }
      // Nothing to undo is a condition, not a failure; the caller sees the
      // revision it already had.
      if (response.code === 'nothing_to_undo' || response.code === 'nothing_to_redo') {
        return this.#revision;
      }
      throw new Error(response.message ?? 'the edit was refused');
    }
    const revision = (response.revision as number) ?? this.#revision;
    if (revision !== this.#revision) {
      this.#revision = revision;
      // Any edit can move any cell that reads it, so the whole cache goes.
      this.#invalidate();
      this.#resize();
    }
    return revision;
  }

  /** Re-reads the sheet's extent after a change that may have grown it. */
  #resize(): void {
    const sheets = this.sheets();
    const sheet = this.#sheet
      ? sheets.find((s) => s.name.toLowerCase() === this.#sheet!.toLowerCase())
      : sheets[0];
    if (sheet) {
      this.#rows = sheet.rows;
      this.#cols = sheet.cols;
    }
  }

  #invalidate(): void {
    this.#cells.clear();
    this.#loaded = [];
  }

  /** Whether a window is already covered by something read before. */
  #isLoaded(window: Window): boolean {
    return this.#loaded.some(
      (loaded) =>
        loaded.startRow <= window.startRow &&
        loaded.endRow >= window.endRow &&
        loaded.startCol <= window.startCol &&
        loaded.endCol >= window.endCol,
    );
  }

  /** One number per cell, so the cache is a flat map rather than a map of maps. */
  #key(row: number, col: number): number {
    return row * DataSource.MAX_COLS + col;
  }
}
