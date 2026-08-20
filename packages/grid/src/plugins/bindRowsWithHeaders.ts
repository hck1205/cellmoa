/**
 * Making a row header belong to its row rather than to its position.
 *
 * Without this, moving row 3 to the top leaves the headers reading 1, 2, 3 —
 * the header numbers the *position*. With it, the header follows the row, so
 * after the move the headers read 3, 1, 2 and you can still see where each row
 * came from. Which behaviour is right depends on what the headers mean, so it
 * is a setting rather than a rule.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** How a bound header is produced. `strict` keeps the original number. */
export type BindingStrategy = 'loose' | 'strict' | ((physical: number) => string);

export class BindRowsWithHeaders extends BasePlugin {
  static override readonly pluginName: string = 'bindRowsWithHeaders';

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().bindRowsWithHeaders;
    return settings !== undefined && settings !== false;
  }

  protected override onEnable(): void {
    this.addHook('modifyRowHeader', (value: unknown, row: number) => this.headerFor(row) ?? value);
    this.grid.render();
  }

  protected override onDisable(): void {
    this.grid.render();
  }

  /** The strategy the settings ask for. */
  strategy(): BindingStrategy {
    const settings = this.grid.getSettings().bindRowsWithHeaders;
    if (typeof settings === 'function') {
      return settings as BindingStrategy;
    }
    return settings === 'loose' ? 'loose' : 'strict';
  }

  /**
   * The header a visual row should show, or `null` to leave it alone.
   *
   * `strict` shows the row's original number wherever it has been moved to.
   * `loose` renumbers by position, which is what happens without this plugin,
   * so it is offered for completeness rather than for use.
   */
  headerFor(row: number): string | null {
    const physical = this.grid.rowIndex.toPhysical(row);
    if (physical === null) {
      return null;
    }
    const strategy = this.strategy();
    if (typeof strategy === 'function') {
      return strategy(physical);
    }
    return strategy === 'strict' ? String(physical + 1) : String(row + 1);
  }
}

registerPlugin(BindRowsWithHeaders as never);
