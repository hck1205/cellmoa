/**
 * The areas around the grid.
 *
 * A grid is rarely alone on the page: there is a toolbar above it, a pager
 * below it, a dialog over it. Left to themselves, each of those would position
 * itself and they would fight — so the grid owns four areas and hands them out.
 *
 *     top      a slot, ordered
 *     grid     the table itself, not a slot
 *     bottom   a slot, ordered
 *     overlay  floating UI, not a slot
 *
 * The manager owns the placement. A caller registers an element and says which
 * side it belongs on; where exactly it lands is not its business, which is what
 * lets the `layout` setting reorder things the caller never knew about.
 */

/** The two slots a caller may register into. */
export type SlotSide = 'top' | 'bottom';

export interface SlotOptions {
  side?: SlotSide;
  /** Lower comes first. Ties keep registration order. */
  weight?: number;
}

/** How the slots are ordered, as the `layout` setting gives it. */
export interface LayoutSettings {
  top?: string[];
  bottom?: string[];
}

interface Entry {
  key: string;
  element: HTMLElement;
  weight: number;
  /** Registration order, so equal weights stay stable. */
  sequence: number;
}

export const SLOT_ELEMENT_CLASS = 'cm-slot-element';

/**
 * Owns the elements around the grid.
 *
 * The DOM is rebuilt from the ordered list rather than patched, because the
 * order can change from three directions — a new registration, a weight, the
 * `layout` setting — and reconciling those in place is how elements end up in
 * two places at once.
 */
export class LayoutManager {
  #slots: Record<SlotSide, HTMLElement>;
  #overlay: HTMLElement;
  #entries: Record<SlotSide, Entry[]> = { top: [], bottom: [] };
  #order: LayoutSettings = {};
  #sequence = 0;

  constructor(slots: Record<SlotSide, HTMLElement>, overlay: HTMLElement) {
    this.#slots = slots;
    this.#overlay = overlay;
  }

  /** The element for a slot. */
  getSlot(side: SlotSide): HTMLElement {
    return this.#slots[side];
  }

  /** The layer floating UI is drawn in. */
  getOverlay(): HTMLElement {
    return this.#overlay;
  }

  /** Puts an element in a slot. Registering a key again replaces it. */
  register(key: string, element: HTMLElement, options: SlotOptions = {}): void {
    const side = options.side ?? 'bottom';
    this.unregister(key, side);
    element.classList.add(SLOT_ELEMENT_CLASS);
    element.dataset['slotKey'] = key;
    this.#entries[side].push({
      key,
      element,
      weight: options.weight ?? 100,
      sequence: (this.#sequence += 1),
    });
    this.#lay(side);
  }

  /** Takes it out again, detaching it from the DOM. */
  unregister(key: string, side: SlotSide = 'bottom'): void {
    const before = this.#entries[side].length;
    this.#entries[side] = this.#entries[side].filter((entry) => {
      if (entry.key !== key) {
        return true;
      }
      entry.element.remove();
      return false;
    });
    if (this.#entries[side].length !== before) {
      this.#lay(side);
    }
  }

  /** Whether a key is registered. */
  has(key: string, side: SlotSide = 'bottom'): boolean {
    return this.#entries[side].some((entry) => entry.key === key);
  }

  /** The keys in a slot, in the order they are drawn. */
  getKeys(side: SlotSide): string[] {
    return this.#ordered(side).map((entry) => entry.key);
  }

  /** Applies the `layout` setting. */
  setOrder(order: LayoutSettings): void {
    this.#order = order;
    this.#lay('top');
    this.#lay('bottom');
  }

  /** Empties both slots. */
  clear(): void {
    for (const side of ['top', 'bottom'] as const) {
      for (const entry of this.#entries[side]) {
        entry.element.remove();
      }
      this.#entries[side] = [];
      this.#lay(side);
    }
  }

  /**
   * The entries of a slot, in order.
   *
   * Keys the setting names come first, in the order it names them; everything
   * else follows by weight. That way a caller can pin the two things it cares
   * about without having to know what else is in the slot.
   */
  #ordered(side: SlotSide): Entry[] {
    const named = this.#order[side] ?? [];
    const rank = new Map(named.map((key, index) => [key, index]));
    const listed = this.#entries[side]
      .filter((entry) => rank.has(entry.key))
      .sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
    const rest = this.#entries[side]
      .filter((entry) => !rank.has(entry.key))
      .sort((a, b) => a.weight - b.weight || a.sequence - b.sequence);
    return [...listed, ...rest];
  }

  #lay(side: SlotSide): void {
    const slot = this.#slots[side];
    const ordered = this.#ordered(side);
    slot.replaceChildren(...ordered.map((entry) => entry.element));
    // An empty slot must not take up a line of its own.
    slot.hidden = ordered.length === 0;
  }
}
