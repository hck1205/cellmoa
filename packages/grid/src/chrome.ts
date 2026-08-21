/**
 * Everything the settings put on the grid's outermost elements.
 *
 * The theme, the language direction, the ARIA role, the size — none of which
 * has anything to do with which rows are on screen, and all of which changes
 * for its own reasons. It is kept apart from the drawing so that a change of
 * theme cannot be mistaken for a change of window.
 */

import { CLASS } from './panes.js';
import type { ViewModel } from './viewModel.js';

/** Marks a class as one the settings put there, so a later change can take it off. */
const CUSTOM_CLASS_MARK = 'cm-custom-';

export class Chrome {
  #root: HTMLElement;
  #wrapper: HTMLElement;
  #model: ViewModel;
  /** The custom properties the current theme set, so the next one can clear them. */
  #properties: string[] = [];

  constructor(root: HTMLElement, wrapper: HTMLElement, model: ViewModel) {
    this.#root = root;
    this.#wrapper = wrapper;
    this.#model = model;
  }

  /**
   * Puts the language direction, the theme and the ARIA role on the root.
   *
   * Re-applied on every render rather than once at construction, because all
   * three are settings and settings change.
   */
  apply(): void {
    this.#applySize();
    const direction = this.#model.direction?.() ?? 'ltr';
    this.#root.dir = direction;
    this.#root.classList.toggle(`${CLASS.root}--rtl`, direction === 'rtl');

    // Off with the last theme's classes and properties before the next one's
    // go on: a theme that set a colour the new one does not would otherwise
    // leave that colour behind.
    for (const existing of [...this.#root.classList]) {
      if (existing.startsWith('cm-theme-') || existing.startsWith('ht-theme-') ||
          existing.startsWith('cm-density-')) {
        this.#root.classList.remove(existing);
      }
    }
    for (const property of [...this.#properties]) {
      this.#root.style.removeProperty(property);
    }
    this.#properties = [];

    const theme = this.#model.theme?.();
    if (theme) {
      this.#root.classList.add(...theme.classNames);
      for (const [name, value] of Object.entries(theme.properties)) {
        const property = `--ht-${name}`;
        this.#root.style.setProperty(property, value);
        this.#properties.push(property);
      }
    }
    // A marker class records which classes came from the settings, so changing
    // the setting takes exactly those off again and leaves the grid's own —
    // and anything the page added itself — alone.
    for (const existing of [...this.#root.classList]) {
      if (existing.startsWith(CUSTOM_CLASS_MARK)) {
        this.#root.classList.remove(existing, existing.slice(CUSTOM_CLASS_MARK.length));
      }
    }
    for (const name of this.#model.tableClassName?.() ?? []) {
      this.#root.classList.add(name, `${CUSTOM_CLASS_MARK}${name}`);
    }
    if (this.#model.ariaTags?.() !== false) {
      this.#root.setAttribute('role', 'grid');
      this.#root.setAttribute('aria-rowcount', String(this.#model.rowCount()));
      this.#root.setAttribute('aria-colcount', String(this.#model.colCount()));
    } else {
      this.#root.removeAttribute('role');
      this.#root.removeAttribute('aria-rowcount');
      this.#root.removeAttribute('aria-colcount');
    }
  }

  /**
   * Sizes the wrapper from the settings.
   *
   * Unset means the container decides, which is what a page laying the grid out
   * with CSS expects. `preventOverflow` caps the grid at its parent instead, for
   * a parent that has a size of its own and means it.
   */
  #applySize(): void {
    const size = this.#model.size?.();
    if (!size) {
      return;
    }
    this.#wrapper.style.width = size.width ?? '';
    this.#wrapper.style.height = size.height ?? '';
    const parent = this.#wrapper.parentElement;
    if (size.preventOverflow && parent) {
      const limit = size.preventOverflow === 'horizontal' ? 'maxWidth' : 'maxHeight';
      const from = size.preventOverflow === 'horizontal' ? parent.clientWidth : parent.clientHeight;
      this.#wrapper.style[limit] = `${from}px`;
    } else {
      this.#wrapper.style.maxWidth = '';
      this.#wrapper.style.maxHeight = '';
    }
  }
}
