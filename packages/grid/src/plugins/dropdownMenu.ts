/**
 * The menu on the column header.
 *
 * The same menu machinery as the context menu, opened from a button on each
 * column header rather than by right-clicking, and defaulting to the commands
 * that are about a column. Opening it selects the column, because that is what
 * the commands in it act on.
 */

import { Menu } from '../menu.js';
import type { MenuItem } from '../menu.js';
import { BasePlugin, registerPlugin } from './base.js';
import { buildMenu } from './contextMenu.js';
import { DEFAULT_DROPDOWN_MENU, ITEM, predefinedItems } from './menuItems.js';

export interface DropdownMenuSettings {
  items?: string[] | Record<string, Partial<MenuItem>>;
  uiContainer?: HTMLElement;
}

export class DropdownMenu extends BasePlugin {
  static override readonly pluginName: string = 'dropdownMenu';

  #menu: Menu | null = null;

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().dropdownMenu;
    return settings !== undefined && settings !== false;
  }

  protected override onEnable(): void {
    const root = this.grid.view?.root;
    if (!root) {
      return;
    }
    this.#menu = new Menu({
      document: root.ownerDocument,
      selection: () => this.grid.getMenuSelection(),
      afterCommand: (key) => this.grid.hooks.run('afterDropdownMenuExecute', undefined, key),
    });
    this.addHook(
      'afterGetColHeader',
      (_value: unknown, col: number, th: HTMLTableCellElement, level: number) => {
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

  protected override onDisable(): void {
    this.close();
    this.#menu = null;
    this.grid.render();
  }

  /** The items this menu would show right now. */
  getItems(): MenuItem[] {
    return buildMenu(
      this.grid.getSettings().dropdownMenu,
      predefinedItems(this.grid),
      DEFAULT_DROPDOWN_MENU,
    );
  }

  /** Opens the menu below a column's button, selecting that column first. */
  openForColumn(col: number, anchor?: HTMLElement): void {
    this.grid.selectColumns(col);
    const box = anchor?.getBoundingClientRect();
    this.open(box?.left ?? 0, box?.bottom ?? 0);
  }

  /** Opens it at a point. */
  open(x: number, y: number): void {
    const items = this.getItems();
    const shown = items.length > 0 ? items : [predefinedItems(this.grid)[ITEM.noItems]!];
    if (this.grid.hooks.allows('beforeDropdownMenuShow', shown) === false) {
      return;
    }
    const settings = this.settings<DropdownMenuSettings>();
    this.#menu?.open(shown, x, y, typeof settings === 'object' ? settings?.uiContainer : undefined);
    this.grid.hooks.run('afterDropdownMenuShow', undefined, shown);
  }

  close(): void {
    if (this.#menu?.isOpen) {
      this.#menu.close();
      this.grid.hooks.run('afterDropdownMenuHide', undefined);
    }
  }

  /** Runs a command by key. */
  executeCommand(key: string, event: Event = new Event('command')): void {
    const item = this.getItems().find((entry) => entry.key === key);
    if (item) {
      this.#menu?.execute(item, event);
    }
  }

  get menu(): Menu | null {
    return this.#menu;
  }
}

registerPlugin(DropdownMenu as never);
