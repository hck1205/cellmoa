/**
 * The right-click menu.
 *
 * The settings are Handsontable's in every form they take: `true` for the
 * defaults, an array of keys to pick from them, or an object with `items` to
 * add commands of your own. What a key resolves to depends on which plugins are
 * running, so a menu never offers a command that would do nothing.
 *
 * Everything it shares with the column-header menu lives in `MenuPlugin`; what
 * is left here is what makes it the *right-click* menu.
 */

import { registerPlugin } from './base.js';
import { MenuPlugin } from './menuPlugin.js';
import type { MenuSettings } from './menuPlugin.js';
import { DEFAULT_CONTEXT_MENU } from './menuItems.js';

export type ContextMenuSettings = MenuSettings;

export { buildMenu } from './buildMenu.js';

export class ContextMenu extends MenuPlugin {
  static override readonly pluginName: string = 'contextMenu';

  protected override readonly setting = 'contextMenu';
  protected override readonly defaults = DEFAULT_CONTEXT_MENU;
  protected override readonly hookPrefix = 'ContextMenu';

  protected override onMenuEnable(root: HTMLElement): void {
    this.listen(root, 'contextmenu', (event: MouseEvent) => this.#onContextMenu(event));
  }

  #onContextMenu(event: MouseEvent): void {
    const cell = (event.target as HTMLElement | null)?.closest('td');
    if (cell) {
      const row = Number(cell.dataset['row']);
      const col = Number(cell.dataset['col']);
      // Right-clicking outside the selection moves it there first, which is
      // what every spreadsheet does — the command should act on the cell the
      // pointer is over, not on whatever was selected before.
      const inside = this.grid.selection.ranges.some(
        (range) =>
          row >= range.topRow &&
          row <= range.bottomRow &&
          col >= range.startCol &&
          col <= range.endCol,
      );
      if (!inside) {
        this.grid.selectCell(row, col);
      }
    }
    event.preventDefault();
    this.open(event.pageX, event.pageY);
  }
}

registerPlugin(ContextMenu as never);
