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

/** Who is making a change. */
export interface Actor {
  kind: 'human' | 'agent' | 'script' | 'system';
  id: string;
}

/**
 * A structural change to the sheet, as the engine performs it.
 *
 * Four actions, because inserting above and inserting below differ only in
 * which index you hand over. The names a caller writes are the reference's,
 * and `normalizeAlter` turns those into these.
 */
export type AlterAction = 'insert_row' | 'remove_row' | 'insert_col' | 'remove_col';

/**
 * The action names a caller writes.
 *
 * The reference replaced `insert_row` with `insert_row_above` / `_below` and
 * `insert_col` with `insert_col_start` / `_end` in v13, and every code sample
 * written since uses the new spelling. Both are accepted: the old ones are
 * still what a v12 configuration says, and neither should silently do nothing.
 */
export type AlterRequest =
  | AlterAction
  | 'insert_row_above'
  | 'insert_row_below'
  | 'insert_col_start'
  | 'insert_col_end';

/** How far past the given index an action lands. */
export interface NormalizedAlter {
  action: AlterAction;
  /** `1` for the "below"/"end" spellings, which insert after the index. */
  offset: number;
}

/**
 * Turns a caller's action name into the engine's, and says where it lands.
 *
 * `insert_row_below` is `insert_row` one row further down — the offset is the
 * whole difference, and keeping it here means the two spellings cannot drift
 * into meaning different things.
 */
export function normalizeAlter(action: AlterRequest): NormalizedAlter | null {
  switch (action) {
    case 'insert_row':
    case 'insert_row_above':
      return { action: 'insert_row', offset: 0 };
    case 'insert_row_below':
      return { action: 'insert_row', offset: 1 };
    case 'insert_col':
    case 'insert_col_start':
      return { action: 'insert_col', offset: 0 };
    case 'insert_col_end':
      return { action: 'insert_col', offset: 1 };
    case 'remove_row':
      return { action: 'remove_row', offset: 0 };
    case 'remove_col':
      return { action: 'remove_col', offset: 0 };
    default:
      // An unknown name is a caller's mistake, and doing nothing about it is
      // how it stays a mistake. `alter` reports it rather than returning.
      return null;
  }
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

/**
 * Reads an A1 reference back into a position.
 *
 * Returns `null` for anything that is not one — a sheet-qualified reference has
 * its qualifier stripped first, and a range gives its top-left corner, but a
 * defined name or a whole-column reference has no single cell to point at and
 * says so rather than guessing.
 */
export function parseA1(reference: string): Coords | null {
  const bare = reference.includes('!')
    ? reference.slice(reference.lastIndexOf('!') + 1)
    : reference;
  const first = bare.split(':')[0] ?? '';
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(first);
  if (!match) {
    return null;
  }
  return { row: Number(match[2]) - 1, col: lettersToColumn(match[1]!) };
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
  /**
   * The blocks already read, by their id.
   *
   * Not the windows that were asked for. A window is wherever the viewport
   * happened to stop, so a list of them grows by one for every place the user
   * scrolls to and has to be searched linearly to answer "do I have this cell?"
   * — a scan that gets longer the longer the session goes on, run once per cell
   * per frame. Reads are rounded out to a fixed grid of blocks instead: the
   * question becomes a set lookup, and scrolling a screen at a time mostly
   * lands on blocks that are already there.
   */
  #loaded = new Set<number>();
  #revision = -1;
  #rows = 0;
  #cols = 0;
  /** Beyond this, a cell key would lose precision as a number. */
  static readonly MAX_COLS = 16_384;
  /**
   * How big a block is.
   *
   * Bigger blocks mean fewer, larger reads; smaller ones mean less waste at the
   * edges. A screenful is roughly 40 rows by 20 columns, so a block a little
   * larger than that makes an ordinary scroll cost one read.
   */
  static readonly BLOCK_ROWS = 64;
  static readonly BLOCK_COLS = 32;
  /**
   * How many blocks are kept.
   *
   * Nothing evicts a block on its own: the cache is dropped whole when the
   * revision moves, and a session that only reads never moves it. Scrolling
   * down a long sheet would then hold every row it had passed, so a reader
   * doing nothing worse than looking costs memory in proportion to how far it
   * looked. This many blocks is a few dozen screenfuls — far more scrollback
   * than anyone revisits, and a ceiling rather than none at all.
   */
  static readonly MAX_BLOCKS = 64;

  /** How many blocks the cache is holding. */
  get loadedBlocks(): number {
    return this.#loaded.size;
  }

  /**
   * Who this grid's edits are recorded as.
   *
   * Every write carries it. Provenance, actor-scoped undo and the marker on a
   * cell an agent touched all read the journal, and a journal that recorded
   * everything as "anonymous" would support none of them.
   */
  #actor: Actor;

  constructor(engine: Engine, sheet?: string, actor?: Actor) {
    this.#engine = engine;
    this.#sheet = sheet ?? null;
    this.#actor = actor ?? { kind: 'human', id: 'anonymous' };
    this.refresh();
  }

  /** Who edits are attributed to. */
  get actor(): Actor {
    return this.#actor;
  }

  set actor(actor: Actor) {
    this.#actor = actor;
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
    const sheets = (response.sheets ?? []) as SheetInfo[];
    this.#observed(response.revision, sheets);
    return sheets;
  }

  /** Switches to another sheet. */
  selectSheet(name: string): void {
    this.#sheet = name;
    this.refresh();
  }

  /** Re-reads the sheet's size and drops the cache. */
  refresh(): void {
    this.#adopt(this.sheets());
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
    for (const block of this.#blocksOf(window)) {
      this.#read(block);
    }
  }

  /** Reads one block, unless it is already in the cache. */
  #read(block: number): void {
    if (this.#loaded.has(block)) {
      // Putting it back moves it to the end of the set's order, which is what
      // makes that order least-recently-used: scrolling down a page and back
      // up again must not find the page it came from evicted.
      this.#loaded.delete(block);
      this.#loaded.add(block);
      return;
    }
    const window = this.#windowOf(block);
    const request: Record<string, unknown> = { op: 'read', range: rangeRef(window) };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    const response = this.#engine.send(request);
    if (!response.ok) {
      // A block past the end of the sheet is not an error worth throwing over;
      // it simply holds nothing, and asking again would not change that.
      this.#remember(block);
      return;
    }
    // Before the cells are stored, because this may drop everything read so far
    // and these cells are the ones read at the new revision.
    this.#observed(response.revision);
    for (const cell of (response.cells ?? []) as Array<CellData & Coords>) {
      this.#cells.set(this.#key(cell.row, cell.col), {
        text: cell.text,
        value: cell.value,
        ...(cell.formula === undefined ? {} : { formula: cell.formula }),
        ...(cell.error === undefined ? {} : { error: cell.error }),
        ...(cell.style === undefined ? {} : { style: cell.style }),
      });
    }
    this.#remember(block);
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
      who: this.#actor,
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
    const request: Record<string, unknown> = { op: 'undo', who: this.#actor };
    if (onlyBy !== undefined) {
      request.only_by = onlyBy;
    }
    return this.#applied(this.#engine.send(request));
  }

  /** Re-applies the most recently undone change. */
  redo(onlyBy?: string): number {
    const request: Record<string, unknown> = { op: 'redo', who: this.#actor };
    if (onlyBy !== undefined) {
      request.only_by = onlyBy;
    }
    return this.#applied(this.#engine.send(request));
  }

  /**
   * Inserts or deletes rows or columns.
   *
   * One call, one commit: the cells move and every formula in the workbook is
   * rewritten together, so there is never a moment where a formula points at
   * the wrong cell.
   */
  alter(action: AlterAction, index: number, amount = 1, label?: string): number {
    const request: Record<string, unknown> = {
      op: 'alter',
      action,
      index,
      amount,
      who: this.#actor,
    };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    if (label !== undefined) {
      request.label = label;
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

  /**
   * Who last changed each cell of a rectangle that anyone has changed.
   *
   * One call for a window rather than one per cell: the grid marks cells while
   * drawing them, and a round trip per cell would be a round trip per cell per
   * frame while scrolling.
   */
  actors(window: Window): Array<{ row: number; col: number; actor: { kind: string; id: string } }> {
    const request: Record<string, unknown> = { op: 'actors', range: rangeRef(window) };
    if (this.#sheet) {
      request.sheet = this.#sheet;
    }
    const response = this.#engine.send(request);
    return response.ok
      ? ((response.actors ?? []) as Array<{
          row: number;
          col: number;
          actor: { kind: string; id: string };
        }>)
      : [];
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
        // The refusal is itself the news that someone else got there first, so
        // the cache it invalidates goes now rather than at some later read.
        this.#observed(response.revision);
        throw new WriteConflict(expected ?? -1, (response.revision as number) ?? -1);
      }
      // Nothing to undo is a condition, not a failure; the caller sees the
      // revision it already had.
      if (response.code === 'nothing_to_undo' || response.code === 'nothing_to_redo') {
        return this.#revision;
      }
      throw new Error(response.message ?? 'the edit was refused');
    }
    this.#observed(response.revision);
    return this.#revision;
  }

  /**
   * Takes note of the revision a response came back at.
   *
   * The cache is only ever right for one revision, and this grid's own edits
   * are not the only thing that moves it: two grids on one workbook, or an
   * agent writing through the same engine, both leave this one holding cells
   * that were true a revision ago. Nothing announces that. Every response
   * carries the revision, though, so every response is a chance to notice —
   * and noticing is the whole of the invalidation policy.
   */
  #observed(revision: number | undefined, sheets?: SheetInfo[]): void {
    if (revision === undefined || revision === this.#revision) {
      return;
    }
    // Set first: the listing below comes back at this same revision, and would
    // otherwise arrive here again and recurse.
    this.#revision = revision;
    // Any edit can move any cell that reads it, so the whole cache goes.
    this.#invalidate();
    // A change made elsewhere grows the sheet as readily as one made here, so
    // the extent is re-read rather than assumed to have stayed put.
    this.#adopt(sheets ?? this.sheets());
  }

  /** Takes the sheet's name and extent from a listing. */
  #adopt(sheets: SheetInfo[]): void {
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
  }

  /** Records a block as read, making room for it first. */
  #remember(block: number): void {
    while (this.#loaded.size >= DataSource.MAX_BLOCKS) {
      this.#evict();
    }
    this.#loaded.add(block);
  }

  /** Drops the block read longest ago, and with it the cells it brought in. */
  #evict(): void {
    const oldest = this.#loaded.values().next();
    if (oldest.done) {
      return;
    }
    this.#loaded.delete(oldest.value);
    const window = this.#windowOf(oldest.value);
    for (let row = window.startRow; row <= window.endRow; row += 1) {
      for (let col = window.startCol; col <= window.endCol; col += 1) {
        this.#cells.delete(this.#key(row, col));
      }
    }
  }

  #invalidate(): void {
    this.#cells.clear();
    this.#loaded.clear();
  }

  /** The blocks a window touches. */
  *#blocksOf(window: Window): Generator<number> {
    const firstRow = Math.floor(Math.max(window.startRow, 0) / DataSource.BLOCK_ROWS);
    const lastRow = Math.floor(Math.max(window.endRow, 0) / DataSource.BLOCK_ROWS);
    const firstCol = Math.floor(Math.max(window.startCol, 0) / DataSource.BLOCK_COLS);
    const lastCol = Math.floor(Math.max(window.endCol, 0) / DataSource.BLOCK_COLS);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        yield row * DataSource.MAX_COLS + col;
      }
    }
  }

  /** The rectangle a block covers. */
  #windowOf(block: number): Window {
    const row = Math.floor(block / DataSource.MAX_COLS);
    const col = block % DataSource.MAX_COLS;
    return {
      startRow: row * DataSource.BLOCK_ROWS,
      endRow: (row + 1) * DataSource.BLOCK_ROWS - 1,
      startCol: col * DataSource.BLOCK_COLS,
      endCol: (col + 1) * DataSource.BLOCK_COLS - 1,
    };
  }

  /** One number per cell, so the cache is a flat map rather than a map of maps. */
  #key(row: number, col: number): number {
    return row * DataSource.MAX_COLS + col;
  }
}
