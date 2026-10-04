/**
 * The menu on the column header.
 *
 * The same menu machinery as the context menu — literally the same, since both
 * extend `MenuPlugin` — opened from a button on each column header rather than
 * by right-clicking, and defaulting to the commands that are about a column.
 * Opening it selects the column, because that is what the commands in it act
 * on.
 */

import { registerPlugin } from './base.js';
import { MenuPlugin } from './menuPlugin.js';
import type { MenuSettings } from './menuPlugin.js';
import { DEFAULT_DROPDOWN_MENU } from './menuItems.js';

export type DropdownMenuSettings = MenuSettings;

export class DropdownMenu extends MenuPlugin {
  static override readonly pluginName: string = 'dropdownMenu';

  protected override readonly setting = 'dropdownMenu';
  protected override readonly defaults = DEFAULT_DROPDOWN_MENU;
  protected override readonly hookPrefix = 'DropdownMenu';

  protected override onMenuEnable(): void {
    this.addHook(
      'afterGetColHeader', (col: number, th: HTMLTableCellElement, level: number) => {
        // Only on the bottom row of the header: the levels above are groups,
        // and a column command has nothing to say about a group.
        if (level !== this.grid.countColHeaderLevels() - 1 || col < 0) {
          return;
        }
        const button = th.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'cm-dropdown';
        button.textContent = '▾';
        button.addEventListener('mousedown', (event) => {
          event.stopPropagation();
          event.preventDefault();
          this.openForColumn(col, button);
        });
        th.appendChild(button);
      },
    );
    this.grid.render();
  }

  protected override onMenuDisable(): void {
    // The buttons are drawn by the hook, so dropping them is a redraw.
    this.grid.render();
  }

  /** Opens the menu below a column's button, selecting that column first. */
  openForColumn(col: number, anchor?: HTMLElement): void {
    this.grid.selectColumns(col);
    const box = anchor?.getBoundingClientRect();
    this.open(box?.left ?? 0, box?.bottom ?? 0);
  }
}

registerPlugin(DropdownMenu);
