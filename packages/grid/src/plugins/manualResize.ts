/**
 * Resizing rows and columns by dragging, and measuring them automatically.
 */

import { DEFAULT_ROW_HEADER_WIDTH, DEFAULT_ROW_HEIGHT } from '../settings.js';
import { BasePlugin, registerPlugin } from './base.js';

abstract class ManualResize extends BasePlugin {
  protected abstract get axis(): 'row' | 'column';

  protected get sizes() {
    return this.axis === 'row' ? this.grid.rowSizes : this.grid.columnSizes;
  }

  override isEnabled(): boolean {
    const settings = this.grid.getSettings()[this.pluginName];
    // `manualResize` is Handsontable's name for both axes at once.
    return settings === true || Array.isArray(settings) ||
      this.grid.getSettings().manualResize === true;
  }

  protected override onEnable(): void {
    const settings = this.grid.getSettings()[this.pluginName];
    if (Array.isArray(settings)) {
      this.sizes.setSizes(settings.map((size, index) => [index, size as number]));
    }
  }

  /** Resizes one index. Passing `null` restores the default. */
  setSize(index: number, size: number | null): void {
    const capitalised = this.axis === 'row' ? 'Row' : 'Column';
    if (this.grid.hooks.allows(`before${capitalised}Resize`, size, index) === false) {
      return;
    }
    // Through the grid rather than straight to the size map, so the width is
    // recorded as chosen and automatic sizing leaves it alone.
    if (this.axis === 'row') {
      this.grid.setRowHeight(index, size);
    } else {
      this.grid.setColWidth(index, size);
    }
    this.grid.hooks.run(`after${capitalised}Resize`, undefined, size, index);
  }

  /** The sizes that differ from the default, for saving a layout. */
  getManualSizes(): Array<[number, number]> {
    return this.sizes.overrides();
  }

  /** Forgets every resize. */
  clearManualSizes(): void {
    for (const [index] of this.sizes.overrides()) {
      if (this.axis === 'row') {
        this.grid.setRowHeight(index, null);
      } else {
        this.grid.setColWidth(index, null);
      }
    }
  }
}

export class ManualRowResize extends ManualResize {
  static override readonly pluginName: string = 'manualRowResize';
  protected override get axis(): 'row' | 'column' {
    return 'row';
  }
}

export class ManualColumnResize extends ManualResize {
  static override readonly pluginName: string = 'manualColumnResize';
  protected override get axis(): 'row' | 'column' {
    return 'column';
  }
}

/**
 * Sizing a row to its tallest cell.
 *
 * A row grows only when something in it wraps or holds a line break — the
 * ordinary case is one line, and measuring every cell to conclude that would
 * cost more than it saves.
 */
export class AutoRowSize extends BasePlugin {
  static override readonly pluginName: string = 'autoRowSize';

  /** Sizing reads the widths, the heights and the data, so any change may move it. */
  static override get settingKeys(): boolean {
    return true;
  }

  /** Rows this plugin sized itself. */
  #measured = new Set<number>();

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().autoRowSize;
    return settings !== false && settings !== undefined;
  }

  protected override onEnable(): void {
    this.addHook('afterChange', () => this.recalculate());
    this.recalculate();
  }

  protected override onDisable(): void {
    for (const row of this.#measured) {
      this.grid.rowSizes.setSize(row, null);
    }
    this.#measured.clear();
  }

  /** How many lines the tallest cell in a row takes. */
  countLines(row: number): number {
    let lines = 1;
    for (let col = 0; col < this.grid.countCols(); col += 1) {
      const value = this.grid.getDataAtCell(row, col);
      lines = Math.max(lines, value.split('\n').length);
    }
    return lines;
  }

  /** The height a row needs. */
  calculateRowHeight(row: number): number {
    return this.countLines(row) * DEFAULT_ROW_HEIGHT;
  }

  /** Resizes every row that has not been resized by hand. */
  recalculate(): void {
    const options = this.options<{ minimumHeight: number; maximumHeight: number }>();
    const min = options.minimumHeight ?? DEFAULT_ROW_HEIGHT;
    const max = options.maximumHeight ?? 400;
    for (let row = 0; row < this.grid.countRows(); row += 1) {
      if (this.grid.isRowHeightManual(row)) {
        continue;
      }
      const height = Math.min(Math.max(this.calculateRowHeight(row), min), max);
      this.grid.rowSizes.setSize(row, height);
      this.#measured.add(row);
    }
    this.grid.render();
  }
}

registerPlugin(AutoRowSize);

/**
 * Spreading the columns to fill the container.
 *
 * `last` gives the leftover width to the last column; `all` shares it out in
 * proportion to what each column already had, so a wide column stays wide.
 * Neither ever shrinks a column below what it was — stretching is about using
 * space that would otherwise be blank.
 */
export class StretchColumns extends BasePlugin {
  static override readonly pluginName: string = 'stretchColumns';

  /** Sizing reads the widths, the heights and the data, so any change may move it. */
  static override get settingKeys(): boolean {
    return true;
  }

  /**
   * The widths the columns had before any stretching.
   *
   * Kept separately from the size map, and this is the whole difficulty: if the
   * stretch were computed from the current widths, each pass would stretch the
   * result of the last one and the columns would run away across the screen.
   */
  #natural = new Map<number, number>();

  override isEnabled(): boolean {
    const mode = this.mode();
    return mode === 'last' || mode === 'all';
  }

  /** Which strategy the settings ask for. */
  mode(): 'none' | 'last' | 'all' {
    const setting = this.grid.getSettings().stretchH ?? this.grid.getSettings().stretchColumns;
    return setting === 'last' || setting === 'all' ? setting : 'none';
  }

  protected override onEnable(): void {
    this.addHook('afterRender', () => this.recalculate());
    this.recalculate();
  }

  protected override onDisable(): void {
    this.#restore();
  }

  /** The extra width this plugin gave a column, or `null` if it gave none. */
  getColumnWidth(column: number): number | null {
    return this.#natural.has(column) ? this.grid.getColWidth(column) : null;
  }

  /** Works out the stretched widths and applies them. */
  recalculate(): void {
    const available = this.grid.view?.root.clientWidth ?? 0;
    const columns = this.grid.countCols();
    if (available === 0 || columns === 0) {
      return;
    }
    const natural: number[] = [];
    for (let column = 0; column < columns; column += 1) {
      natural.push(this.#natural.get(column) ?? this.grid.getColWidth(column));
    }
    const headerWidth = this.grid.hasRowHeaders() ? DEFAULT_ROW_HEADER_WIDTH : 0;
    const total = natural.reduce((sum, width) => sum + width, 0);
    const spare = available - headerWidth - total;
    if (spare <= 0) {
      // No room to stretch into: put back whatever the columns were.
      this.#restore();
      return;
    }
    if (this.mode() === 'last') {
      const last = columns - 1;
      this.#apply(last, natural[last] ?? 0, (natural[last] ?? 0) + spare);
    } else {
      for (let column = 0; column < columns; column += 1) {
        const width = natural[column] ?? 0;
        const share = total === 0 ? spare / columns : (spare * width) / total;
        this.#apply(column, width, width + share);
      }
    }
  }

  #apply(column: number, natural: number, stretched: number): void {
    if (!this.#natural.has(column)) {
      this.#natural.set(column, natural);
    }
    this.grid.columnSizes.setSize(column, Math.floor(stretched));
  }

  #restore(): void {
    for (const [column, width] of this.#natural) {
      this.grid.columnSizes.setSize(column, width);
    }
    this.#natural.clear();
  }
}

registerPlugin(StretchColumns);

/**
 * Sizing a column to its widest cell.
 *
 * Measured from the text rather than from the DOM: laying every cell out to
 * ask the browser how wide it is would cost a reflow per column, and the
 * estimate below is close enough to be useful and cheap enough to run on every
 * change.
 */
export class AutoColumnSize extends BasePlugin {
  static override readonly pluginName: string = 'autoColumnSize';

  /** Sizing reads the widths, the heights and the data, so any change may move it. */
  static override get settingKeys(): boolean {
    return true;
  }

  /** How wide one character is, roughly, at the default font. */
  static readonly CHARACTER_WIDTH = 7;
  static readonly PADDING = 12;

  /** Columns this plugin sized itself, so it can undo them cleanly. */
  #measured = new Set<number>();

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().autoColumnSize;
    return settings !== false && settings !== undefined;
  }

  protected override onEnable(): void {
    this.addHook('afterChange', () => this.recalculate());
    this.recalculate();
  }

  protected override onDisable(): void {
    for (const column of this.#measured) {
      this.grid.columnSizes.setSize(column, null);
    }
    this.#measured.clear();
  }

  /** The width a column needs to show its widest value. */
  calculateColumnWidth(column: number): number {
    let widest = 0;
    const rows = Math.min(this.grid.countRows(), 1000);
    for (let row = 0; row < rows; row += 1) {
      widest = Math.max(widest, this.grid.getDataAtCell(row, column).length);
    }
    if (this.grid.hasColHeaders()) {
      widest = Math.max(widest, this.grid.getColHeader(column).length);
    }
    return widest * AutoColumnSize.CHARACTER_WIDTH + AutoColumnSize.PADDING;
  }

  /** Resizes every column that has not been resized by hand. */
  recalculate(): void {
    const options = this.options<{ minimumWidth: number; maximumWidth: number }>();
    const min = options.minimumWidth ?? 30;
    const max = options.maximumWidth ?? 400;
    for (let column = 0; column < this.grid.countCols(); column += 1) {
      // A column someone chose the width of keeps it; the grid records that,
      // because the size map alone cannot say who set a size.
      if (this.grid.isColumnWidthManual(column)) {
        continue;
      }
      const width = Math.min(Math.max(this.calculateColumnWidth(column), min), max);
      this.grid.columnSizes.setSize(column, width);
      this.#measured.add(column);
    }
    this.grid.render();
  }
}

registerPlugin(ManualRowResize);
registerPlugin(ManualColumnResize);
registerPlugin(AutoColumnSize);
