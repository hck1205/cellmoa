/**
 * What to show when there is nothing to show.
 *
 * An empty grid and a grid whose filter matched nothing look the same and mean
 * different things, so the message says which — otherwise the answer to "where
 * did my data go?" is a blank rectangle.
 *
 * The message is a title and a description rather than one line, because those
 * two answer different questions: the title says what happened, the
 * description says what to do about it. A filter that hid everything also gets
 * a button, since the reader who caused it is the one who can undo it.
 */

import { PHRASE } from '../i18n/keys.js';
import { BasePlugin, registerPlugin } from './base.js';
import type { Filters } from './filters.js';
import type { Loading } from './loading.js';

export interface EmptyDataStateButton {
  text: string;
  type?: 'primary' | 'secondary';
  callback: () => void;
}

/** Everything the overlay says, for one reason. */
export interface EmptyDataStateMessage {
  title?: string;
  description?: string;
  buttons?: EmptyDataStateButton[];
}

export interface EmptyDataStateSettings {
  /**
   * What to say, either outright or worked out from why the grid is empty.
   *
   * The function form is what makes one setting cover both cases without the
   * caller having to write the same button twice.
   */
  message?: EmptyDataStateMessage | ((source: EmptyReason) => EmptyDataStateMessage);
  /**
   * The whole message for an empty table, as a single line.
   *
   * @deprecated Use `message`, which can also carry a description and buttons.
   */
  emptyMessage?: string;
  /**
   * The whole message for a table a filter emptied, as a single line.
   *
   * @deprecated Use `message`.
   */
  filteredMessage?: string;
  contentRenderer?: (element: HTMLElement, reason: EmptyReason) => void;
}

/** Why the table is showing nothing. */
export type EmptyReason = 'empty' | 'filtered' | 'loading';

/** The dictionary keys each reason takes its wording from. */
const PHRASES: Record<EmptyReason, { title: string; description: string }> = {
  empty: {
    title: PHRASE.EMPTY_DATA_STATE_TITLE,
    description: PHRASE.EMPTY_DATA_STATE_DESCRIPTION,
  },
  filtered: {
    title: PHRASE.EMPTY_DATA_STATE_TITLE_FILTERS,
    description: PHRASE.EMPTY_DATA_STATE_DESCRIPTION_FILTERS,
  },
  loading: {
    title: PHRASE.EMPTY_DATA_STATE_TITLE_LOADING,
    description: PHRASE.EMPTY_DATA_STATE_DESCRIPTION_LOADING,
  },
};

export class EmptyDataState extends BasePlugin {
  static override readonly pluginName: string = 'emptyDataState';

  #element: HTMLElement | null = null;
  /** The reason currently on screen, so the hooks fire on changes only. */
  #showing: EmptyReason | null = null;

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    this.addHook('afterRender', () => this.refresh());
    this.refresh();
  }

  protected override onDisable(): void {
    this.#element?.remove();
    this.#element = null;
    this.#showing = null;
  }

  /**
   * Why the table is empty, or `null` when it is not.
   *
   * Rows that exist but are trimmed away mean a filter took them: trimming is
   * what filtering does, and the distinction is the whole point of this plugin.
   * A grid that is still loading is neither — its rows are on their way, and
   * saying "no data" about data that has not arrived is simply wrong.
   */
  getReason(): EmptyReason | null {
    if (this.grid.countRows() > 0) {
      return null;
    }
    if (this.grid.getPlugin<Loading>('loading')?.isVisible()) {
      return 'loading';
    }
    return this.grid.rowIndex.getTrimmed().length > 0 ? 'filtered' : 'empty';
  }

  /** The message that would be shown. */
  getMessage(reason: EmptyReason): EmptyDataStateMessage {
    const options = this.options<EmptyDataStateSettings>();
    const legacy = reason === 'filtered' ? options.filteredMessage : options.emptyMessage;
    if (legacy !== undefined) {
      // The single-line settings were the whole message, so they replace the
      // description rather than sitting above one nobody asked for.
      return { title: legacy };
    }
    const configured =
      typeof options.message === 'function' ? options.message(reason) : options.message;
    return { ...this.#defaultMessage(reason), ...configured };
  }

  /** Puts the message up or takes it down, to match the table. */
  refresh(): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    const reason = this.getReason();
    if (reason === null) {
      this.#takeDown();
      return;
    }
    const changed = reason !== this.#showing;
    if (changed) {
      this.#takeDown();
      if (this.grid.hooks.allows('beforeEmptyDataStateShow', reason) === false) {
        return;
      }
    }
    if (!this.#element) {
      this.#element = view.root.ownerDocument.createElement('div');
      this.#element.className = 'cm-empty-state';
      view.root.appendChild(this.#element);
    }
    this.#element.dataset['reason'] = reason;
    const renderer = this.options<EmptyDataStateSettings>().contentRenderer;
    this.#element.replaceChildren();
    if (renderer) {
      renderer(this.#element, reason);
    } else {
      this.#render(this.#element, this.getMessage(reason));
    }
    if (changed) {
      this.#showing = reason;
      this.grid.hooks.run('afterEmptyDataStateShow', undefined, reason);
    }
  }

  /** What each reason says when nothing was configured. */
  #defaultMessage(reason: EmptyReason): EmptyDataStateMessage {
    const keys = PHRASES[reason];
    const message: EmptyDataStateMessage = {
      title: this.grid.getTranslatedPhrase(keys.title),
      description: this.grid.getTranslatedPhrase(keys.description),
    };
    const filters = this.grid.getPlugin<Filters>('filters');
    if (reason === 'filtered' && filters?.isPluginEnabled()) {
      // Only offered when there is something to press it: without the filters
      // plugin the button would name an action the grid cannot take.
      message.buttons = [
        {
          text: this.grid.getTranslatedPhrase(PHRASE.EMPTY_DATA_STATE_BUTTONS_FILTERS_RESET),
          type: 'secondary',
          callback: () => {
            filters.clearConditions();
            filters.filter();
          },
        },
      ];
    }
    return message;
  }

  #render(element: HTMLElement, message: EmptyDataStateMessage): void {
    const doc = element.ownerDocument;
    if (message.title !== undefined) {
      const title = doc.createElement('div');
      title.className = 'cm-empty-state-title';
      title.textContent = message.title;
      element.appendChild(title);
    }
    if (message.description !== undefined) {
      const description = doc.createElement('div');
      description.className = 'cm-empty-state-description';
      description.textContent = message.description;
      element.appendChild(description);
    }
    if (!message.buttons?.length) {
      return;
    }
    const row = doc.createElement('div');
    row.className = 'cm-empty-state-buttons';
    for (const { text, type, callback } of message.buttons) {
      const button = doc.createElement('button');
      button.type = 'button';
      if (type) {
        button.dataset['type'] = type;
      }
      button.textContent = text;
      button.addEventListener('click', callback);
      row.appendChild(button);
    }
    element.appendChild(row);
  }

  #takeDown(): void {
    if (!this.#element) {
      this.#showing = null;
      return;
    }
    if (this.grid.hooks.allows('beforeEmptyDataStateHide') === false) {
      return;
    }
    this.#element.remove();
    this.#element = null;
    this.#showing = null;
    this.grid.hooks.run('afterEmptyDataStateHide', undefined);
  }
}

registerPlugin(EmptyDataState);
