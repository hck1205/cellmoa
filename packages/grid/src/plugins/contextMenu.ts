/**
 * The right-click menu.
 *
 * The settings are Handsontable's in every form they take: `true` for the
 * defaults, an array of keys to pick from them, or an object with `items` to
 * add commands of your own. What a key resolves to depends on which plugins are
 * running, so a menu never offers a command that would do nothing.
 */

import { Menu, SEPARATOR } from '../menu.js';
import type { MenuItem, MenuSelection } from '../menu.js';
import { BasePlugin, registerPlugin } from './base.js';
import { DEFAULT_CONTEXT_MENU, ITEM, predefinedItems } from './menuItems.js';

export interface ContextMenuSettings {
  items?: string[] | Record<string, Partial<MenuItem>>;
  callback?: (key: string, selection: MenuSelection[], event: Event) => void;
  uiContainer?: HTMLElement;
}

/**
 * Turns whatever the settings said into a list of items.
 *
 * A key that names nothing is dropped rather than shown as a dead entry: which
 * commands exist depends on which plugins are on, and a menu listing `copy`
 * when the clipboard plugin is off would be a lie.
 */
export function buildMenu(
  settings: unknown,
  available: Record<string, MenuItem>,
  defaults: string[],
): MenuItem[] {
  const resolveKeys = (keys: string[]): MenuItem[] =>
    keys
      .map((key) => (key === SEPARATOR ? { key: SEPARATOR } : available[key]))
      .filter((item): item is MenuItem => item !== undefined);

  if (settings === true || settings === undefined) {
    return resolveKeys(defaults);
  }
  if (Array.isArray(settings)) {
    return resolveKeys(settings as string[]);
  }
  if (typeof settings === 'object' && settings !== null) {
    const items = (settings as ContextMenuSettings).items;
    if (Array.isArray(items)) {
      return resolveKeys(items);
    }
    if (items && typeof items === 'object') {
      // An object keeps its own order, and an entry may either name a built-in
      // command or define a new one outright.
      return Object.entries(items).map(([key, overrides]) => ({
        ...(available[key] ?? { key }),
        ...overrides,
        key,
      }));
    }
    return resolveKeys(defaults);
  }
  return [];
}

export class ContextMenu extends BasePlugin {
  static override readonly pluginName: string = 'contextMenu';

  #menu: Menu | null = null;

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().contextMenu;
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
      afterCommand: (key) => this.grid.hooks.run('afterContextMenuExecute', undefined, key),
    });
    this.listen(root, 'contextmenu', (event: MouseEvent) => this.#onContextMenu(event));
  }

  protected override onDisable(): void {
    this.close();
    this.#menu = null;
  }

  /** The items this menu would show right now. */
  getItems(): MenuItem[] {
    return buildMenu(
      this.grid.getSettings().contextMenu,
      predefinedItems(this.grid),
      DEFAULT_CONTEXT_MENU,
    );
  }

  /** Opens the menu at a point. */
  open(x: number, y: number): void {
    const items = this.getItems();
    const shown = items.length > 0 ? items : [predefinedItems(this.grid)[ITEM.noItems]!];
    if (this.grid.hooks.allows('beforeContextMenuShow', shown) === false) {
      return;
    }
    this.#menu?.open(shown, x, y, this.options<ContextMenuSettings>().uiContainer);
    this.grid.hooks.run('afterContextMenuShow', undefined, shown);
  }

  /** Takes it down. */
  close(): void {
    if (this.#menu?.isOpen) {
      this.#menu.close();
      this.grid.hooks.run('afterContextMenuHide', undefined);
    }
  }

  /** Runs a command by key, as choosing it would. */
  executeCommand(key: string, event: Event = new Event('command')): void {
    const item = this.getItems().find((entry) => entry.key === key);
    if (item) {
      this.#menu?.execute(item, event);
      this.options<ContextMenuSettings>().callback?.(key, this.grid.getMenuSelection(), event);
    }
  }

  /** The menu element, for a caller that wants to inspect it. */
  get menu(): Menu | null {
    return this.#menu;
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
