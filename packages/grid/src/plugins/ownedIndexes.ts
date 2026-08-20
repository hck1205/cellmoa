/**
 * Keeping track of which rows or columns a plugin took out of view.
 *
 * Several plugins hide or trim indexes, and they overlap: a filter trims rows,
 * a pager trims the rest of them, a fold hides a column group. Each has to be
 * able to give back what it took without giving back what someone else took —
 * and "untrim everything, then re-trim mine" is the mistake that makes a filter
 * come undone whenever the page changes.
 *
 * So a plugin owns a set, and the only indexes it ever releases are the ones in
 * it.
 */

import type { IndexMapper } from '../indexMapper.js';

/** Whether the indexes leave the visual space entirely, or merely stop being drawn. */
export type Concealment = 'trim' | 'hide';

export class OwnedIndexes {
  #map: () => IndexMapper;
  #how: Concealment;
  #owned = new Set<number>();

  /**
   * `map` is a function rather than the map itself: a grid replaces its index
   * maps when the sheet changes shape, and a plugin holding the old one would
   * be releasing indexes into a map nobody is reading.
   */
  constructor(map: () => IndexMapper, how: Concealment) {
    this.#map = map;
    this.#how = how;
  }

  /** How many indexes this plugin is concealing. */
  get size(): number {
    return this.#owned.size;
  }

  /** The physical indexes it is concealing. */
  get indexes(): number[] {
    return [...this.#owned];
  }

  /** Whether this plugin is the one concealing an index. */
  owns(index: number): boolean {
    return this.#owned.has(index);
  }

  /**
   * Conceals exactly this set, releasing whatever it held that is not in it.
   *
   * Computing the whole set each time rather than adding and removing is
   * deliberate: an index can be concealed for two reasons at once — two nested
   * folds, a page and a filter — and reversing one reason must not reveal what
   * the other is concealing.
   */
  set(indexes: Iterable<number>): void {
    const wanted = new Set(indexes);
    const released = [...this.#owned].filter((index) => !wanted.has(index));
    if (released.length > 0) {
      this.#apply('release', released);
    }
    if (wanted.size > 0) {
      this.#apply('conceal', [...wanted]);
    }
    this.#owned = wanted;
  }

  /** Gives everything back. */
  clear(): void {
    if (this.#owned.size > 0) {
      this.#apply('release', [...this.#owned]);
      this.#owned.clear();
    }
  }

  #apply(action: 'conceal' | 'release', indexes: number[]): void {
    const map = this.#map();
    if (this.#how === 'trim') {
      if (action === 'conceal') {
        map.trim(indexes);
      } else {
        map.untrim(indexes);
      }
    } else if (action === 'conceal') {
      map.hide(indexes);
    } else {
      map.unhide(indexes);
    }
  }
}
