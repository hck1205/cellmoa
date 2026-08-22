/**
 * Hiding and trimming rows and columns.
 *
 * The two are not the same thing, and the difference is visible to the user.
 * A *hidden* row is still counted — hide row 3 and the row below is still row
 * 4 — so a reference to it keeps working. A *trimmed* row is gone from the
 * visual space entirely, which is what filtering does.
 */

import { BasePlugin, registerPlugin } from './base.js';
import { OwnedIndexes } from './ownedIndexes.js';

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
    if (options.indicators === true) {
      // A hidden row leaves no gap, so without a mark on the headers on either
      // side of it there is nothing on screen to say anything is missing.
      this.addHook(
        this.axis === 'rows' ? 'afterGetRowHeader' : 'afterGetColHeader',
        (_value: unknown, index: number, th: HTMLTableCellElement) =>
          this.#markNeighbour(index, th),
      );
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

  /**
   * Marks a header that sits next to something hidden.
   *
   * The classes go on the header rather than on the cells because the header is
   * the one element a hidden index has a neighbour on in both directions, and
   * because a mark on every cell of the row would read as a selection.
   */
  #markNeighbour(index: number, th: HTMLTableCellElement): void {
    if (!th || index < 0) {
      return;
    }
    const count = this.axis === 'rows' ? this.grid.countRows() : this.grid.countCols();
    const hidden = (at: number): boolean =>
      this.axis === 'rows' ? this.grid.isRowHidden(at) : this.grid.isColumnHidden(at);
    if (index > 0 && hidden(index - 1)) {
      th.classList.add('cm-after-hidden');
    }
    if (index < count - 1 && hidden(index + 1)) {
      th.classList.add('cm-before-hidden');
    }
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

  /** The rows this plugin is holding out of the visual space. */
  readonly #trimmed = new OwnedIndexes(() => this.grid.rowIndex, 'trim');

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
    // Straight to the set rather than through `untrimAll`: a plugin being taken
    // down has to give its rows back, and a hook that vetoed it would leave the
    // grid holding rows nobody owns any more.
    this.#trimmed.clear();
    this.grid.render();
  }

  /** Removes rows from the visual space. */
  trimRows(rows: number[]): void {
    if (this.grid.hooks.allows('beforeTrimRow', this.getTrimmedRows(), rows) === false) {
      return;
    }
    this.#trimmed.set([...this.#trimmed.indexes, ...rows]);
    this.grid.hooks.run('afterTrimRow', undefined, this.getTrimmedRows(), rows);
    this.grid.render();
  }

  /** Puts them back. */
  untrimRows(rows: number[]): void {
    if (this.grid.hooks.allows('beforeUntrimRow', this.getTrimmedRows(), rows) === false) {
      return;
    }
    const wanted = new Set(rows);
    this.#trimmed.set(this.#trimmed.indexes.filter((row) => !wanted.has(row)));
    this.grid.hooks.run('afterUntrimRow', undefined, this.getTrimmedRows(), rows);
    this.grid.render();
  }

  /**
   * Puts back everything this plugin trimmed.
   *
   * Everything *this plugin* trimmed, not everything trimmed: a filter and a
   * pager trim rows of their own, and handing those back here would leave them
   * believing they still had them.
   */
  untrimAll(): void {
    const released = this.getTrimmedRows();
    if (this.grid.hooks.allows('beforeUntrimRow', released, released) === false) {
      return;
    }
    this.#trimmed.clear();
    this.grid.hooks.run('afterUntrimRow', undefined, this.getTrimmedRows(), released);
    this.grid.render();
  }

  isTrimmed(row: number): boolean {
    return this.#trimmed.owns(row);
  }

  getTrimmedRows(): number[] {
    return this.#trimmed.indexes.sort((a, b) => a - b);
  }
}

registerPlugin(HiddenRows);
registerPlugin(HiddenColumns);
registerPlugin(TrimRows);
