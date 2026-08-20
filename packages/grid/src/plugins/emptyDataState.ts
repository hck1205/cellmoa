/**
 * What to show when there is nothing to show.
 *
 * An empty grid and a grid whose filter matched nothing look the same and mean
 * different things, so the message says which — otherwise the answer to "where
 * did my data go?" is a blank rectangle.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface EmptyDataStateSettings {
  /** Shown when the table itself has no rows. */
  emptyMessage?: string;
  /** Shown when rows exist but none survived the filter. */
  filteredMessage?: string;
  contentRenderer?: (element: HTMLElement, reason: EmptyReason) => void;
}

/** Why the table is showing nothing. */
export type EmptyReason = 'empty' | 'filtered';

export const DEFAULT_EMPTY_MESSAGE = 'No data';
export const DEFAULT_FILTERED_MESSAGE = 'No results found';

export class EmptyDataState extends BasePlugin {
  static override readonly pluginName: string = 'emptyDataState';

  #element: HTMLElement | null = null;

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().emptyDataState;
    return settings === true || (typeof settings === 'object' && settings !== null);
  }

  protected override onEnable(): void {
    this.addHook('afterRender', () => this.refresh());
    this.refresh();
  }

  protected override onDisable(): void {
    this.#element?.remove();
    this.#element = null;
  }

  /**
   * Why the table is empty, or `null` when it is not.
   *
   * Rows that exist but are trimmed away mean a filter took them: trimming is
   * what filtering does, and the distinction is the whole point of this plugin.
   */
  getReason(): EmptyReason | null {
    if (this.grid.countRows() > 0) {
      return null;
    }
    return this.grid.rowIndex.getTrimmed().length > 0 ? 'filtered' : 'empty';
  }

  /** The message that would be shown. */
  getMessage(reason: EmptyReason): string {
    const settings = this.settings<EmptyDataStateSettings | boolean>();
    const options = typeof settings === 'object' ? settings : {};
    return reason === 'filtered'
      ? (options.filteredMessage ?? DEFAULT_FILTERED_MESSAGE)
      : (options.emptyMessage ?? DEFAULT_EMPTY_MESSAGE);
  }

  /** Puts the message up or takes it down, to match the table. */
  refresh(): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    const reason = this.getReason();
    if (reason === null) {
      this.#element?.remove();
      this.#element = null;
      return;
    }
    if (!this.#element) {
      this.#element = view.root.ownerDocument.createElement('div');
      this.#element.className = 'cm-empty-state';
      view.root.appendChild(this.#element);
    }
    this.#element.dataset['reason'] = reason;
    const settings = this.settings<EmptyDataStateSettings | boolean>();
    const renderer = typeof settings === 'object' ? settings.contentRenderer : undefined;
    if (renderer) {
      this.#element.replaceChildren();
      renderer(this.#element, reason);
    } else {
      this.#element.textContent = this.getMessage(reason);
    }
  }
}

registerPlugin(EmptyDataState as never);
