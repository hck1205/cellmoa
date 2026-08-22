/**
 * The "working…" overlay.
 *
 * Opening a large workbook or recalculating a big sheet takes long enough to
 * need one. It is reference-counted rather than a boolean: two things can be
 * loading at once, and the first one to finish must not take the overlay away
 * from the second.
 */

import { PHRASE } from '../i18n/keys.js';
import { BasePlugin, registerPlugin } from './base.js';

export interface LoadingOptions {
  message?: string;
}

export class Loading extends BasePlugin {
  static override readonly pluginName: string = 'loading';

  #element: HTMLElement | null = null;
  #depth = 0;

  override isEnabled(): boolean {
    return this.grid.getSettings().loading !== false;
  }

  protected override onEnable(): void {
    // Nothing until something is actually loading.
  }

  protected override onDisable(): void {
    this.#depth = 0;
    this.#element?.remove();
    this.#element = null;
  }

  isVisible(): boolean {
    return this.#element !== null;
  }

  /** How many callers currently think something is loading. */
  get depth(): number {
    return this.#depth;
  }

  /** Shows the overlay, or notes another caller if it is already up. */
  show(options: LoadingOptions = {}): void {
    this.#depth += 1;
    const view = this.grid.view;
    if (!view) {
      return;
    }
    if (!this.#element) {
      const doc = view.root.ownerDocument;
      const element = doc.createElement('div');
      element.className = 'cm-loading';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      const spinner = doc.createElement('div');
      spinner.className = 'cm-loading-spinner';
      element.appendChild(spinner);
      const text = doc.createElement('div');
      text.className = 'cm-loading-message';
      element.appendChild(text);
      // The overlay layer, so the cover reaches the slots too — a pager you
      // can still click while the grid is loading is a pager that will ask for
      // a page nobody is waiting for.
      view.overlay.appendChild(element);
      this.#element = element;
    }
    this.update(options);
  }

  /**
   * Changes the message without disturbing the count.
   *
   * The default comes from the dictionary rather than from here, so a grid set
   * to another language does not cover itself with one English word at the
   * moment it has nothing else to show.
   */
  update(options: LoadingOptions): void {
    const text = this.#element?.querySelector('.cm-loading-message');
    if (text) {
      text.textContent = options.message ?? this.grid.getTranslatedPhrase(PHRASE.LOADING_TITLE);
    }
  }

  /** Notes that one caller has finished, hiding the overlay when all have. */
  hide(): void {
    this.#depth = Math.max(this.#depth - 1, 0);
    if (this.#depth === 0) {
      this.#element?.remove();
      this.#element = null;
    }
  }

  /** Runs something with the overlay up, whether it succeeds or not. */
  async during<T>(work: () => Promise<T>, options: LoadingOptions = {}): Promise<T> {
    this.show(options);
    try {
      return await work();
    } finally {
      // In `finally`, so a failure does not leave the grid covered forever.
      this.hide();
    }
  }
}

registerPlugin(Loading);
