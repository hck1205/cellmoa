/**
 * Resolving a setting through the layers it can be given at.
 *
 * Split from `settings.ts`, which declares what the settings *are*. This is the
 * machinery that answers "what is in force for this cell", and the two are
 * different jobs: one is read by everything, the other only by the grid.
 */

import { CellMap } from './cellMap.js';
import { DEFAULT_SETTINGS } from './settings.js';
import type { GridSettings } from './settings.js';

/**
 * Resolves settings through the four layers.
 *
 * Kept as a class rather than a bare function because resolution is on the hot
 * path — every rendered cell asks for its settings — and the per-cell answers
 * are worth caching between renders.
 */
export class MetaManager {
  #global: GridSettings;
  #table: GridSettings = {};
  #columns = new Map<number, GridSettings>();
  #cells = new CellMap<GridSettings>();
  /** Cleared whenever anything above the cell layer changes. */
  #cache = new CellMap<GridSettings>();

  constructor(defaults: GridSettings = DEFAULT_SETTINGS) {
    this.#global = { ...defaults };
  }

  /** The settings given for the grid as a whole. */
  get table(): GridSettings {
    return this.#table;
  }

  /** Applies grid-wide settings, replacing what was there before. */
  update(settings: GridSettings): void {
    Object.assign(this.#table, settings);
    if (Array.isArray(settings.columns)) {
      this.#columns.clear();
      settings.columns.forEach((column, index) => this.#columns.set(index, { ...column }));
    }
    // `cell` is a list of per-cell overrides given up front.
    if (Array.isArray(settings.cell)) {
      for (const entry of settings.cell) {
        const { row, col, ...rest } = entry;
        this.setCell(row, col, rest);
      }
    }
    this.#cache.clear();
  }

  /** Settings for one column. */
  setColumn(index: number, settings: GridSettings): void {
    this.#columns.set(index, { ...(this.#columns.get(index) ?? {}), ...settings });
    this.#cache.clear();
  }

  /** Settings for one cell. */
  setCell(row: number, col: number, settings: GridSettings): void {
    this.#cells.set(row, col, { ...(this.#cells.get(row, col) ?? {}), ...settings });
    this.#cache.delete(row, col);
  }

  /** Removes one setting from a cell, so it inherits again. */
  removeCell(row: number, col: number, name?: string): void {
    if (name === undefined) {
      this.#cells.delete(row, col);
    } else {
      const existing = this.#cells.get(row, col);
      if (existing) {
        delete existing[name];
      }
    }
    this.#cache.delete(row, col);
  }

  /**
   * Moves the per-cell overrides when rows or columns are inserted or deleted.
   *
   * Without this a comment or a `readOnly` would stay at row 5 while the cell
   * it described moved to row 6 — the note would end up on someone else's
   * number, which is worse than losing it.
   */
  shift(axis: 'row' | 'col', at: number, count: number): void {
    const moved = new CellMap<GridSettings>();
    for (const [row, col, settings] of this.#cells) {
      const index = axis === 'row' ? row : col;
      let target = index;
      if (index >= at) {
        if (count < 0 && index < at - count) {
          // The cell itself was deleted, and so is anything said about it.
          continue;
        }
        target = index + count;
      }
      if (axis === 'row') {
        moved.set(target, col, settings);
      } else {
        moved.set(row, target, settings);
      }
    }
    this.#cells = moved;
    this.#cache.clear();
  }

  /** Forgets every per-cell override. */
  clearCells(): void {
    this.#cells.clear();
    this.#cache.clear();
  }

  /**
   * The settings in force for one cell.
   *
   * The layers are merged narrowest-last, so a value set on the cell beats one
   * set on the column, which beats one set on the grid.
   */
  forCell(row: number, col: number): GridSettings {
    const cached = this.#cache.get(row, col);
    if (cached) {
      return cached;
    }
    const resolved: GridSettings = { ...this.#global, ...this.#table };

    const columns = this.#table.columns;
    if (typeof columns === 'function') {
      Object.assign(resolved, columns(col) ?? {});
    }
    const column = this.#columns.get(col);
    if (column) {
      Object.assign(resolved, column);
    }
    // The `cells` function is consulted after the column so that it can
    // override a column-wide decision for one row.
    if (typeof this.#table.cells === 'function') {
      Object.assign(resolved, this.#table.cells(row, col) ?? {});
    }
    const cell = this.#cells.get(row, col);
    if (cell) {
      Object.assign(resolved, cell);
    }

    this.#cache.set(row, col, resolved);
    return resolved;
  }

  /** The settings in force for a column, without consulting any row. */
  forColumn(col: number): GridSettings {
    const resolved: GridSettings = { ...this.#global, ...this.#table };
    const columns = this.#table.columns;
    if (typeof columns === 'function') {
      Object.assign(resolved, columns(col) ?? {});
    }
    Object.assign(resolved, this.#columns.get(col) ?? {});
    return resolved;
  }

  /** Invalidates the per-cell cache. */
  invalidate(): void {
    this.#cache.clear();
  }
}
