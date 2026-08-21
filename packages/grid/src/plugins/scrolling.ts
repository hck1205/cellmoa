/**
 * Scrolling by dragging past the edge, and by touch.
 *
 * Both are the same idea: the pointer says where it wants to go and the view
 * follows. They are separate plugins in Handsontable because the events differ,
 * and separate here for the same reason.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** The rectangle a drag is being measured against. */
export interface Boundaries {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Scrolling the view when a selection drag reaches its edge.
 *
 * Without it, selecting more than a screenful means letting go, scrolling, and
 * starting again — which loses the selection.
 */
export class DragToScroll extends BasePlugin {
  static override readonly pluginName: string = 'dragToScroll';

  #boundaries: Boundaries | null = null;
  #callback: ((diffX: number, diffY: number) => void) | null = null;
  #listening = false;

  override isEnabled(): boolean {
    return this.grid.getSettings().dragToScroll !== false;
  }

  protected override onEnable(): void {
    this.setBoundaries();
    this.setCallback((diffX, diffY) => {
      const scroller = this.grid.view?.scroller;
      if (scroller) {
        scroller.scrollLeft += diffX;
        scroller.scrollTop += diffY;
      }
    });
    const root = this.grid.view?.root;
    if (root) {
      this.listen(root, 'mousedown', () => this.listen_());
      this.listen(root.ownerDocument, 'mouseup', () => this.unlisten());
      this.listen(root.ownerDocument, 'mousemove', (event: MouseEvent) => {
        if (this.#listening) {
          this.check(event.clientX, event.clientY);
        }
      });
    }
  }

  protected override onDisable(): void {
    this.#listening = false;
  }

  /** The rectangle the pointer is measured against. Defaults to the view. */
  setBoundaries(boundaries?: Boundaries): void {
    if (boundaries) {
      this.#boundaries = boundaries;
      return;
    }
    const root = this.grid.view?.root;
    if (!root) {
      return;
    }
    const box = root.getBoundingClientRect();
    this.#boundaries = { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  }

  /** The rectangle in force. */
  getBoundaries(): Boundaries | null {
    return this.#boundaries;
  }

  /** What to do with the overshoot. */
  setCallback(callback: (diffX: number, diffY: number) => void): void {
    this.#callback = callback;
  }

  /** Starts watching the pointer. */
  listen_(): void {
    this.setBoundaries();
    this.#listening = true;
  }

  /** Stops. */
  unlisten(): void {
    this.#listening = false;
  }

  isListening(): boolean {
    return this.#listening;
  }

  /**
   * Reports how far outside the boundaries a point is.
   *
   * Zero inside, so a pointer within the view never scrolls it — only the
   * distance past an edge moves anything, and it moves it by exactly that far.
   */
  check(x: number, y: number): void {
    const bounds = this.#boundaries;
    if (!bounds) {
      return;
    }
    let diffX = 0;
    let diffY = 0;
    if (x < bounds.left) {
      diffX = x - bounds.left;
    } else if (x > bounds.right) {
      diffX = x - bounds.right;
    }
    if (y < bounds.top) {
      diffY = y - bounds.top;
    } else if (y > bounds.bottom) {
      diffY = y - bounds.bottom;
    }
    if (diffX !== 0 || diffY !== 0) {
      this.#callback?.(diffX, diffY);
    }
  }
}

registerPlugin(DragToScroll);

/**
 * Scrolling with a finger.
 *
 * A touch drag scrolls rather than selecting, which is the opposite of what a
 * mouse drag does. That is not an inconsistency: a finger has no hover state,
 * so the only way to reach the rest of a large table is to drag it.
 */
export class TouchScroll extends BasePlugin {
  static override readonly pluginName: string = 'touchScroll';

  /** Touch scrolling follows the whole layout, not one setting. */
  static override get settingKeys(): boolean {
    return true;
  }

  #start: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;

  override isEnabled(): boolean {
    return this.grid.getSettings().touchScroll !== false;
  }

  protected override onEnable(): void {
    const root = this.grid.view?.root;
    if (!root) {
      return;
    }
    this.listen(root, 'touchstart', (event: TouchEvent) => this.#onStart(event), {
      passive: true,
    } as AddEventListenerOptions);
    this.listen(root, 'touchmove', (event: TouchEvent) => this.#onMove(event));
    this.listen(root, 'touchend', () => {
      this.#start = null;
    });
  }

  protected override onDisable(): void {
    this.#start = null;
  }

  /** Whether a touch scroll is under way. */
  isScrolling(): boolean {
    return this.#start !== null;
  }

  #onStart(event: TouchEvent): void {
    const touch = event.touches[0];
    const scroller = this.grid.view?.scroller;
    if (!touch || !scroller || event.touches.length > 1) {
      return;
    }
    this.#start = {
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    };
  }

  #onMove(event: TouchEvent): void {
    const touch = event.touches[0];
    const scroller = this.grid.view?.scroller;
    if (!touch || !scroller || !this.#start) {
      return;
    }
    // The content follows the finger, so the scroll moves the other way.
    scroller.scrollLeft = this.#start.scrollLeft - (touch.clientX - this.#start.x);
    scroller.scrollTop = this.#start.scrollTop - (touch.clientY - this.#start.y);
    event.preventDefault();
  }
}

registerPlugin(TouchScroll);
