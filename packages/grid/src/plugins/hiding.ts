/**
 * Hiding and trimming rows and columns.
 *
 * The two are not the same thing, and the difference is visible to the user.
 * A *hidden* row is still counted — hide row 3 and the row below is still row
 * 4 — so a reference to it keeps working. A *trimmed* row is gone from the
 * visual space entirely, which is what filtering does.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** What the `hiddenRows` and `hiddenColumns` settings may hold. */
export interface HidingSettings {
  rows?: number[];
  columns?: number[];
  indicators?: boolean;
  copyPasteEnabled?: boolean;
}

abstract class HidingPlugin extends BasePlugin {
  /** Which axis this plugin hides. */
  protected abstract get axis(): 'rows' | 'columns';

  protected get map() {
    return this.axis === 'rows' ? this.grid.rowIndex : this.grid.colIndex;
  }

  override isEnabled(): boolean {
    const settings = this.grid.getSettings()[this.pluginName];
    return settings !== undefined && settings !== false;
  }

  protected override onEnable(): void {
    const options = this.options<HidingSettings>();
    const initial = this.axis === 'rows' ? options.rows : options.columns;
    if (Array.isArray(initial) && initial.length > 0) {
      this.hide(initial);
    }
  }

  protected override onDisable(): void {
    this.map.unhide();
    this.grid.render();
  }

  /** Hides physical indexes. */
  hide(indexes: number[]): void {
    if (this.grid.hooks.allows(`beforeHide${this.#suffix()}`, indexes) === false) {
      return;
    }
    this.map.hide(indexes);
    this.grid.hooks.run(`afterHide${this.#suffix()}`, undefined, indexes);
    this.grid.render();
  }

  /** Shows them again. */
  show(indexes?: number[]): void {
    if (this.grid.hooks.allows(`beforeUnhide${this.#suffix()}`, indexes) === false) {
      return;
    }
    this.map.unhide(indexes);
    this.grid.hooks.run(`afterUnhide${this.#suffix()}`, undefined, indexes);
    this.grid.render();
  }

  /** Whether an index is hidden. */
  isHidden(index: number): boolean {
    return this.map.isHidden(index);
  }

  /** Every hidden index. */
  getHiddenIndexes(): number[] {
    return this.map.getHidden();
  }

  #suffix(): string {
    return this.axis === 'rows' ? 'Rows' : 'Columns';
  }
}

export class HiddenRows extends HidingPlugin {
  static override readonly pluginName: string = 'hiddenRows';
  protected override get axis(): 'rows' | 'columns' {
    return 'rows';
  }
}

export class HiddenColumns extends HidingPlugin {
  static override readonly pluginName: string = 'hiddenColumns';
  protected override get axis(): 'rows' | 'columns' {
    return 'columns';
  }
}

/**
 * Trimming rows: removing them from the visual space altogether.
 *
 * This is what a filter is built on. A trimmed row is not row 5 that you
 * cannot see; there is no row 5.
 */
export class TrimRows extends BasePlugin {
  static override readonly pluginName: string = 'trimRows';

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().trimRows;
    return settings !== undefined && settings !== false;
  }

  protected override onEnable(): void {
    const settings = this.grid.getSettings().trimRows;
    if (Array.isArray(settings) && settings.length > 0) {
      this.trimRows(settings);
    }
  }

  protected override onDisable(): void {
    this.untrimAll();
  }

  /** Removes rows from the visual space. */
  trimRows(rows: number[]): void {
    if (this.grid.hooks.allows('beforeTrimRow', this.getTrimmedRows(), rows) === false) {
      return;
    }
    this.grid.rowIndex.trim(rows);
    this.grid.hooks.run('afterTrimRow', undefined, this.getTrimmedRows(), rows);
    this.grid.render();
  }

  /** Puts them back. */
  untrimRows(rows: number[]): void {
    this.grid.rowIndex.untrim(rows);
    this.grid.hooks.run('afterUntrimRow', undefined, this.getTrimmedRows(), rows);
    this.grid.render();
  }

  untrimAll(): void {
    this.grid.rowIndex.untrim();
    this.grid.render();
  }

  isTrimmed(row: number): boolean {
    return this.grid.rowIndex.isTrimmed(row);
  }

  getTrimmedRows(): number[] {
    return this.grid.rowIndex.getTrimmed();
  }
}

registerPlugin(HiddenRows as never);
registerPlugin(HiddenColumns as never);
registerPlugin(TrimRows as never);
