/**
 * Selection: what is highlighted, and where typing goes.
 *
 * Three ideas that are easy to conflate but behave differently:
 *
 * * the **highlight** is the one cell a keystroke acts on. Every selection has
 *   exactly one, and it is not always a corner — shrinking a range with
 *   shift+arrow moves the far edge while the highlight stays put.
 * * a **range** is a rectangle, remembered by the corner it started from, so
 *   that extending it later grows from the right place.
 * * a **layer** is one of several ranges held at once, which is what
 *   ctrl-clicking a second area produces.
 */

import type { Coords } from './settings.js';

/** A rectangle of cells, remembering which corner it started from. */
export class CellRange {
  /** Where the selection began — the anchor an extension grows from. */
  readonly from: Coords;
  /** Where it currently reaches. */
  readonly to: Coords;

  constructor(from: Coords, to: Coords = from) {
    this.from = { ...from };
    this.to = { ...to };
  }

  /** The topmost row, whichever corner it came from. */
  get topRow(): number {
    return Math.min(this.from.row, this.to.row);
  }

  get bottomRow(): number {
    return Math.max(this.from.row, this.to.row);
  }

  get startCol(): number {
    return Math.min(this.from.col, this.to.col);
  }

  get endCol(): number {
    return Math.max(this.from.col, this.to.col);
  }

  get rowCount(): number {
    return this.bottomRow - this.topRow + 1;
  }

  get colCount(): number {
    return this.endCol - this.startCol + 1;
  }

  get cellCount(): number {
    return this.rowCount * this.colCount;
  }

  /** Whether the range covers exactly one cell. */
  isSingle(): boolean {
    return this.cellCount === 1;
  }

  includes(coords: Coords): boolean {
    return (
      coords.row >= this.topRow &&
      coords.row <= this.bottomRow &&
      coords.col >= this.startCol &&
      coords.col <= this.endCol
    );
  }

  overlaps(other: CellRange): boolean {
    return (
      this.topRow <= other.bottomRow &&
      other.topRow <= this.bottomRow &&
      this.startCol <= other.endCol &&
      other.startCol <= this.endCol
    );
  }

  /** The range as `[topRow, startCol, bottomRow, endCol]`. */
  toArray(): [number, number, number, number] {
    return [this.topRow, this.startCol, this.bottomRow, this.endCol];
  }

  /** Every cell in the range, row by row. */
  *cells(): Generator<Coords> {
    for (let row = this.topRow; row <= this.bottomRow; row += 1) {
      for (let col = this.startCol; col <= this.endCol; col += 1) {
        yield { row, col };
      }
    }
  }

  /** The same range with its far corner somewhere else. */
  extendTo(coords: Coords): CellRange {
    return new CellRange(this.from, coords);
  }

  equals(other: CellRange): boolean {
    return (
      this.from.row === other.from.row &&
      this.from.col === other.from.col &&
      this.to.row === other.to.row &&
      this.to.col === other.to.col
    );
  }
}

/** How many areas can be selected at once. */
export type SelectionMode = 'single' | 'range' | 'multiple';

/** What was selected, for the `afterSelection` hook and for plugins. */
export interface SelectionState {
  /** The cell keystrokes act on. */
  highlight: Coords;
  /** Every selected area, most recent last. */
  ranges: CellRange[];
}

/**
 * The selection of one grid.
 *
 * Bounds are given to the constructor as functions rather than numbers because
 * a grid's size changes under it — a filter can remove the row the selection
 * was on while the selection is still live.
 */
export class Selection {
  #ranges: CellRange[] = [];
  #highlight: Coords | null = null;
  #mode: SelectionMode;
  #rowCount: () => number;
  #colCount: () => number;

  /** Whether the selection may sit on a header, which is index -1. */
  #navigableHeaders = false;

  constructor(rowCount: () => number, colCount: () => number, mode: SelectionMode = 'multiple') {
    this.#rowCount = rowCount;
    this.#colCount = colCount;
    this.#mode = mode;
  }

  /** Lets the selection reach the row and column headers. */
  setNavigableHeaders(navigable: boolean): void {
    this.#navigableHeaders = navigable;
  }

  /** Whether headers can be selected. */
  get navigableHeaders(): boolean {
    return this.#navigableHeaders;
  }

  setMode(mode: SelectionMode): void {
    this.#mode = mode;
    if (mode !== 'multiple' && this.#ranges.length > 1) {
      this.#ranges = this.#ranges.slice(-1);
    }
    if (mode === 'single') {
      const last = this.#ranges[this.#ranges.length - 1];
      if (last && !last.isSingle()) {
        this.#ranges = [new CellRange(last.from)];
      }
    }
  }

  get isEmpty(): boolean {
    return this.#ranges.length === 0;
  }

  /** The cell a keystroke acts on, or `null` when nothing is selected. */
  get highlight(): Coords | null {
    return this.#highlight ? { ...this.#highlight } : null;
  }

  /** Every selected area, most recent last. */
  get ranges(): CellRange[] {
    return [...this.#ranges];
  }

  /** The most recent area, which is the one an extension grows. */
  get last(): CellRange | null {
    return this.#ranges[this.#ranges.length - 1] ?? null;
  }

  /** The current state, as hooks receive it. */
  get state(): SelectionState | null {
    return this.#highlight ? { highlight: { ...this.#highlight }, ranges: this.ranges } : null;
  }

  /** Selects one cell, replacing whatever was selected. */
  setCell(coords: Coords): void {
    const clamped = this.#clamp(coords);
    this.#ranges = [new CellRange(clamped)];
    this.#highlight = clamped;
  }

  /** Selects a rectangle, replacing whatever was selected. */
  setRange(from: Coords, to: Coords): void {
    const start = this.#clamp(from);
    const end = this.#clamp(to);
    this.#ranges = [new CellRange(start, this.#mode === 'single' ? start : end)];
    this.#highlight = start;
  }

  /**
   * Adds another area, as ctrl-clicking does.
   *
   * In any mode but `multiple` this replaces rather than adds, so a grid
   * configured for one area cannot be talked into holding two.
   */
  addRange(from: Coords, to: Coords = from): void {
    if (this.#mode !== 'multiple') {
      this.setRange(from, to);
      return;
    }
    const start = this.#clamp(from);
    this.#ranges.push(new CellRange(start, this.#clamp(to)));
    this.#highlight = start;
  }

  /**
   * Grows the most recent area to reach `coords`, leaving the highlight where
   * it is — shift+arrow moves the far edge, not the cursor.
   */
  extendTo(coords: Coords): void {
    const target = this.#clamp(coords);
    const last = this.last;
    if (!last) {
      this.setCell(target);
      return;
    }
    if (this.#mode === 'single') {
      this.setCell(target);
      return;
    }
    this.#ranges[this.#ranges.length - 1] = last.extendTo(target);
  }

  /** Moves the highlight by a delta, collapsing the selection to one cell. */
  moveBy(rowDelta: number, colDelta: number, wrap = false): boolean {
    const current = this.#highlight;
    if (!current) {
      this.setCell({ row: 0, col: 0 });
      return true;
    }
    let row = current.row + rowDelta;
    let col = current.col + colDelta;
    const rows = this.#rowCount();
    const cols = this.#colCount();

    if (wrap) {
      // Walking off the end of a row continues on the next one, which is what
      // Tab does when `autoWrapRow` is on.
      if (col >= cols) {
        col = 0;
        row += 1;
      } else if (col < 0) {
        col = cols - 1;
        row -= 1;
      }
      if (row >= rows) {
        row = 0;
      } else if (row < 0) {
        row = rows - 1;
      }
    }
    // The headers are index -1, so how far the move may go depends on whether
    // they can be reached at all.
    const floor = this.#navigableHeaders ? -1 : 0;
    if (row < floor || col < floor || row >= rows || col >= cols) {
      return false;
    }
    this.setCell({ row, col });
    return true;
  }

  /** Selects whole rows. */
  selectRows(from: number, to: number = from): void {
    const cols = this.#colCount();
    this.setRange({ row: from, col: 0 }, { row: to, col: Math.max(cols - 1, 0) });
  }

  /** Selects whole columns. */
  selectColumns(from: number, to: number = from): void {
    const rows = this.#rowCount();
    this.setRange({ row: 0, col: from }, { row: Math.max(rows - 1, 0), col: to });
  }

  /** Selects everything. */
  selectAll(): void {
    this.setRange(
      { row: 0, col: 0 },
      { row: Math.max(this.#rowCount() - 1, 0), col: Math.max(this.#colCount() - 1, 0) },
    );
  }

  /** Clears the selection. */
  clear(): void {
    this.#ranges = [];
    this.#highlight = null;
  }

  /** Whether a cell is inside any selected area. */
  includes(coords: Coords): boolean {
    return this.#ranges.some((range) => range.includes(coords));
  }

  /** Whether every cell of a row is selected. */
  isRowSelected(row: number): boolean {
    const cols = this.#colCount();
    return this.#ranges.some(
      (range) => range.topRow <= row && row <= range.bottomRow && range.colCount >= cols,
    );
  }

  /** Whether every cell of a column is selected. */
  isColumnSelected(col: number): boolean {
    const rows = this.#rowCount();
    return this.#ranges.some(
      (range) => range.startCol <= col && col <= range.endCol && range.rowCount >= rows,
    );
  }

  /**
   * Every selected cell, with duplicates removed.
   *
   * Overlapping areas are a normal result of ctrl-clicking, and a copy that
   * emitted the overlap twice would paste wrongly.
   */
  cells(): Coords[] {
    const seen = new Set<string>();
    const out: Coords[] = [];
    for (const range of this.#ranges) {
      for (const cell of range.cells()) {
        const key = `${cell.row}:${cell.col}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cell);
        }
      }
    }
    return out;
  }

  /** Keeps a coordinate inside the grid. */
  #clamp(coords: Coords): Coords {
    const rows = Math.max(this.#rowCount(), 1);
    const cols = Math.max(this.#colCount(), 1);
    // Headers are index -1, so reaching them is a matter of how far down the
    // floor goes. A grid that cannot select its headers is one a keyboard user
    // cannot sort or resize a column in.
    const floor = this.#navigableHeaders ? -1 : 0;
    return {
      row: Math.min(Math.max(coords.row, floor), rows - 1),
      col: Math.min(Math.max(coords.col, floor), cols - 1),
    };
  }
}
