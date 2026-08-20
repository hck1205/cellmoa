/**
 * Moving rows and columns, and freezing columns.
 *
 * Like sorting, a move changes the index map rather than the data. Dragging a
 * row to the top of a grid does not rewrite a thousand cells, and undoing it
 * costs nothing.
 */

import { BasePlugin, registerPlugin } from './base.js';

abstract class ManualMove extends BasePlugin {
  protected abstract get axis(): 'row' | 'column';

  protected get map() {
    return this.axis === 'row' ? this.grid.rowIndex : this.grid.colIndex;
  }

  override isEnabled(): boolean {
    const settings = this.grid.getSettings()[this.pluginName];
    return settings === true || Array.isArray(settings);
  }

  protected override onEnable(): void {
    const settings = this.grid.getSettings()[this.pluginName];
    if (Array.isArray(settings) && settings.length > 0) {
      // An array of indexes is the order to start in.
      this.map.setSequence(settings as number[]);
    }
  }

  /**
   * Moves indexes so the first lands at `target`.
   *
   * Returns whether the move happened, so a drag handler can put the row back
   * when a hook refused it.
   */
  moveIndexes(indexes: number[], target: number): boolean {
    const capitalised = this.axis === 'row' ? 'Row' : 'Column';
    if (this.grid.hooks.allows(`before${capitalised}Move`, indexes, target) === false) {
      return false;
    }
    this.map.moveIndexes(indexes, target);
    this.grid.hooks.run(`after${capitalised}Move`, undefined, indexes, target);
    this.grid.render();
    return true;
  }

  /** The order the indexes are currently in. */
  getOrder(): number[] {
    return this.map.getSequence();
  }
}

export class ManualRowMove extends ManualMove {
  static override readonly pluginName: string = 'manualRowMove';
  protected override get axis(): 'row' | 'column' {
    return 'row';
  }
}

export class ManualColumnMove extends ManualMove {
  static override readonly pluginName: string = 'manualColumnMove';
  protected override get axis(): 'row' | 'column' {
    return 'column';
  }
}

/**
 * Freezing a column: moving it to the start and counting it as fixed.
 *
 * Freezing is a move plus a setting, not a mode of its own — which is why a
 * frozen column can still be sorted and hidden like any other.
 */
export class ManualColumnFreeze extends BasePlugin {
  static override readonly pluginName: string = 'manualColumnFreeze';

  override isEnabled(): boolean {
    return this.grid.getSettings().manualColumnFreeze === true;
  }

  protected override onEnable(): void {
    // Nothing to set up: the plugin is driven entirely by its methods.
  }

  /** Freezes a column, moving it to the end of the frozen block. */
  freezeColumn(column: number): void {
    const fixed = this.#fixedCount();
    if (column < fixed) {
      return;
    }
    if (this.grid.hooks.allows('beforeColumnFreeze', column, true) === false) {
      return;
    }
    this.grid.colIndex.moveIndexes([column], fixed);
    this.grid.updateSettings({ fixedColumnsStart: fixed + 1 }, false);
    this.grid.hooks.run('afterColumnFreeze', undefined, column, true);
    this.grid.render();
  }

  /** Unfreezes the last frozen column, moving it back out of the block. */
  unfreezeColumn(column: number): void {
    const fixed = this.#fixedCount();
    if (column >= fixed) {
      return;
    }
    if (this.grid.hooks.allows('beforeColumnUnfreeze', column, false) === false) {
      return;
    }
    // It goes just past the frozen block, which is where the user expects to
    // find it.
    this.grid.colIndex.moveIndexes([column], fixed - 1);
    this.grid.updateSettings({ fixedColumnsStart: Math.max(fixed - 1, 0) }, false);
    this.grid.hooks.run('afterColumnUnfreeze', undefined, column, false);
    this.grid.render();
  }

  #fixedCount(): number {
    const settings = this.grid.getSettings();
    return (settings.fixedColumnsStart as number) ?? (settings.fixedColumnsLeft as number) ?? 0;
  }
}

registerPlugin(ManualRowMove as never);
registerPlugin(ManualColumnMove as never);
registerPlugin(ManualColumnFreeze as never);
