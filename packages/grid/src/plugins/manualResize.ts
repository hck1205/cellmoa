/**
 * Resizing rows and columns by dragging, and measuring them automatically.
 */

import { BasePlugin, registerPlugin } from './base.js';

abstract class ManualResize extends BasePlugin {
  protected abstract get axis(): 'row' | 'column';

  protected get sizes() {
    return this.axis === 'row' ? this.grid.rowSizes : this.grid.columnSizes;
  }

  override isEnabled(): boolean {
    const settings = this.grid.getSettings()[this.pluginName];
    return settings === true || Array.isArray(settings);
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
 * Sizing a column to its widest cell.
 *
 * Measured from the text rather than from the DOM: laying every cell out to
 * ask the browser how wide it is would cost a reflow per column, and the
 * estimate below is close enough to be useful and cheap enough to run on every
 * change.
 */
export class AutoColumnSize extends BasePlugin {
  static override readonly pluginName: string = 'autoColumnSize';

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
    const settings = this.grid.getSettings().autoColumnSize;
    const options = typeof settings === 'object' ? (settings as Record<string, number>) : {};
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

registerPlugin(ManualRowResize as never);
registerPlugin(ManualColumnResize as never);
registerPlugin(AutoColumnSize as never);
