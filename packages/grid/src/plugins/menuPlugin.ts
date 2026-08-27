/**
 * What the two menus have in common, which is nearly everything.
 *
 * The right-click menu and the column-header menu differ in what opens them,
 * which setting configures them, and which commands they default to. Every
 * other part — building the item list, filtering hidden entries, opening,
 * closing, running a command by key — was written twice, and the two copies had
 * already drifted: only one of them honoured the `callback` setting.
 */

import { Menu, resolve } from '../menu.js';
import type { MenuItem, MenuSelection } from '../menu.js';
import { BasePlugin } from './base.js';
import { ITEM, predefinedItems } from './menuItems.js';
import { buildMenu } from './buildMenu.js';

/** The settings both menus accept. */
export interface MenuSettings {
  items?: string[] | Record<string, Partial<MenuItem>>;
  callback?: (key: string, selection: MenuSelection[], event: Event) => void;
  uiContainer?: HTMLElement;
}

/**
 * A menu plugin, less the part that opens it.
 *
 * A subclass says which setting it reads, which commands it defaults to, and
 * what its hooks are called. It does not get to have its own idea of what
 * "the items right now" means, because the two having different ideas is the
 * bug this class exists to prevent.
 */
export abstract class MenuPlugin extends BasePlugin {
  /** The setting name, which is also this plugin's name. */
  protected abstract readonly setting: string;
  /** The keys shown when the settings do not choose. */
  protected abstract readonly defaults: string[];
  /** The hook family: `ContextMenu` gives `beforeContextMenuShow`, and so on. */
  protected abstract readonly hookPrefix: string;

  #menu: Menu | null = null;

  override isEnabled(): boolean {
    const settings = (this.grid.getSettings() as Record<string, unknown>)[this.setting];
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
      afterCommand: (key) => this.grid.hooks.notify(`after${this.hookPrefix}Execute`, key),
    });
    this.onMenuEnable(root);
  }

  protected override onDisable(): void {
    this.close();
    this.#menu = null;
    this.onMenuDisable();
  }

  /** Where the subclass binds whatever opens it. */
  protected abstract onMenuEnable(root: HTMLElement): void;

  /** Anything the subclass has to undo. Most have nothing. */
  protected onMenuDisable(): void {}

  /**
   * The items this menu would show right now.
   *
   * Hidden ones are left out here rather than only at draw time, so a command
   * the settings forbid cannot be reached through `executeCommand` either.
   */
  getItems(): MenuItem[] {
    return buildMenu(
      (this.grid.getSettings() as Record<string, unknown>)[this.setting],
      predefinedItems(this.grid),
      this.defaults,
    ).filter((item) => !resolve(item.hidden, false));
  }

  /** Opens the menu at a point. */
  open(x: number, y: number): void {
    const items = this.getItems();
    // A menu with nothing in it says so rather than opening empty.
    const shown = items.length > 0 ? items : [predefinedItems(this.grid)[ITEM.noItems]!];
    if (this.grid.hooks.allows(`before${this.hookPrefix}Show`, shown) === false) {
      return;
    }
    this.#menu?.open(shown, x, y, this.options<MenuSettings>().uiContainer);
    this.grid.hooks.notify(`after${this.hookPrefix}Show`, shown);
  }

  /** Takes it down. */
  close(): void {
    if (this.#menu?.isOpen) {
      this.#menu.close();
      this.grid.hooks.notify(`after${this.hookPrefix}Hide`);
    }
  }

  /** Runs a command by key, as choosing it would. */
  executeCommand(key: string, event: Event = new Event('command')): void {
    const item = this.getItems().find((entry) => entry.key === key);
    if (!item) {
      return;
    }
    this.#menu?.execute(item, event);
    this.options<MenuSettings>().callback?.(key, this.grid.getMenuSelection(), event);
  }

  /** The menu element, for a caller that wants to inspect it. */
  get menu(): Menu | null {
    return this.#menu;
  }
}
