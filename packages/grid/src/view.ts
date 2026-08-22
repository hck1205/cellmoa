/**
 * The renderer.
 *
 * Only what is on screen exists in the DOM. A grid of a million rows has the
 * same number of elements as a grid of fifty, and scrolling moves a window over
 * the data rather than creating anything — which is the only way the browser
 * survives a spreadsheet.
 *
 * This file owns the elements and the order of a render; the three pieces it
 * orchestrates each live next door, because each answers a different question
 * and changes for a different reason:
 *
 *     geometry  which rows and columns are in the window
 *     panes     the tables the cells are drawn into
 *     chrome    what the settings put on the outermost elements
 */

import { Chrome } from './chrome.js';
import type {
  CellRenderContext,
  ColHeaderCell,
  ViewModel,
  Viewport,
} from './viewModel.js';

// Re-exported because every caller has always imported them from here, and
// where a type is declared is not something a caller should have to care about.
export type { CellRenderContext, ColHeaderCell, ViewModel, Viewport };
import { fetchRange, measure, viewportOf } from './geometry.js';
import type { Metrics, ScrollState } from './geometry.js';
import { LayoutManager } from './layout.js';
import { CLASS, createElement, createPane, drawPane, placePanes } from './panes.js';
import type { Pane, PaneName } from './panes.js';
import type { SizeMap } from './sizes.js';




/** A run of rows or of columns, both ends included. */
type Span = { first: number; last: number };


/**
 * Draws a grid into a container.
 */
export class View {
  readonly root: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  /** The element holding the grid and everything around it. */
  readonly wrapper: HTMLElement;
  /** The layer floating UI is drawn in, over the grid. */
  readonly overlay: HTMLElement;
  /** The slots around the grid. */
  readonly layout: LayoutManager;

  #model: ViewModel;
  #spacer: HTMLDivElement;
  #panes: Record<PaneName, Pane>;
  #chrome: Chrome;
  #viewport: Viewport = { firstRow: 0, lastRow: -1, firstCol: 0, lastCol: -1 };
  #frame: number | null = null;
  #document: Document;

  constructor(container: HTMLElement, model: ViewModel) {
    this.#model = model;
    this.#document = container.ownerDocument;

    this.root = this.#element('div', CLASS.root);
    this.root.style.position = 'relative';
    this.root.style.overflow = 'hidden';

    this.scroller = this.#element('div', CLASS.scroller);
    this.scroller.style.position = 'absolute';
    this.scroller.style.inset = '0';
    this.scroller.style.overflow = 'auto';

    this.#spacer = this.#element('div', CLASS.spacer);
    // The spacer exists only to give the scroller something to scroll. It is
    // never drawn into.
    this.#spacer.style.position = 'relative';
    this.#spacer.style.pointerEvents = 'none';
    this.scroller.appendChild(this.#spacer);

    this.#panes = {
      main: createPane(this.#document, 'main'),
      top: createPane(this.#document, 'top'),
      left: createPane(this.#document, 'left'),
      corner: createPane(this.#document, 'corner'),
      bottom: createPane(this.#document, 'bottom'),
      bottomLeft: createPane(this.#document, 'bottomLeft'),
    };
    // Frozen panes sit above the scrolling one, so their cells win a click.
    for (const name of ['main', 'left', 'top', 'corner', 'bottom', 'bottomLeft'] as const) {
      this.root.appendChild(this.#panes[name].element);
    }
    this.root.appendChild(this.scroller);
    // The scroller is on top so it keeps the wheel and the scrollbars, but it
    // must not swallow clicks meant for the cells beneath it.
    this.scroller.style.pointerEvents = 'auto';

    // The grid sits inside a wrapper with a slot above and below it and a
    // layer over it. A toolbar or a pager that positioned itself would have to
    // know where the grid is; a slot means it does not.
    this.wrapper = this.#element('div', CLASS.wrapper);
    const slots = {
      top: this.#element('div', `${CLASS.slot} ${CLASS.slot}--top`),
      bottom: this.#element('div', `${CLASS.slot} ${CLASS.slot}--bottom`),
    };
    this.overlay = this.#element('div', CLASS.overlay);
    slots.top.hidden = true;
    slots.bottom.hidden = true;
    this.wrapper.append(slots.top, this.root, slots.bottom, this.overlay);
    this.layout = new LayoutManager(slots, this.overlay);

    container.appendChild(this.wrapper);
    // Once the wrapper is in the page, so that a grid told to stay inside its
    // parent can measure that parent on the first pass rather than the second.
    this.#chrome = new Chrome(this.root, this.wrapper, model);
    this.#chrome.apply();

    this.scroller.addEventListener('scroll', this.#onScroll);
    this.scroller.addEventListener('wheel', this.#onWheel, { passive: false });
  }

  /** The window currently drawn. */
  get viewport(): Viewport {
    return { ...this.#viewport };
  }

  /** Where the grid is scrolled to. */
  get scrollTop(): number {
    return this.scroller.scrollTop;
  }

  get scrollLeft(): number {
    return this.scroller.scrollLeft;
  }

  /** Scrolls so a cell is inside the viewport, moving as little as possible. */
  scrollTo(row: number, col: number): void {
    const metrics = measure(this.#model);

    const top = metrics.rows.offsetOf(row);
    const bottom = top + metrics.rows.sizeOf(row);
    const visibleTop = this.scroller.scrollTop + metrics.frozenHeight;
    const visibleBottom =
      this.scroller.scrollTop + this.scroller.clientHeight - metrics.headerHeight;
    if (top < visibleTop) {
      this.scroller.scrollTop = Math.max(top - metrics.frozenHeight, 0);
    } else if (bottom > visibleBottom) {
      this.scroller.scrollTop += bottom - visibleBottom;
    }

    const left = metrics.cols.offsetOf(col);
    const right = left + metrics.cols.sizeOf(col);
    const visibleLeft = this.scroller.scrollLeft + metrics.frozenWidth;
    const visibleRight =
      this.scroller.scrollLeft + this.scroller.clientWidth - metrics.headerWidth;
    if (left < visibleLeft) {
      this.scroller.scrollLeft = Math.max(left - metrics.frozenWidth, 0);
    } else if (right > visibleRight) {
      this.scroller.scrollLeft += right - visibleRight;
    }
    this.render();
  }

  /** Draws, or redraws, the visible window. */
  render(): void {
    this.#chrome.apply();
    const metrics = measure(this.#model);
    const scroll = this.#scrollState();

    this.#spacer.style.width = `${metrics.cols.total + metrics.headerWidth}px`;
    this.#spacer.style.height = `${metrics.rows.total + metrics.headerHeight}px`;

    const viewport = viewportOf(this.#model, metrics, scroll);
    this.#viewport = viewport;

    const needed = fetchRange(metrics, viewport);
    this.#model.prepare(needed.startRow, needed.endRow, needed.startCol, needed.endCol);

    const { bottomFrozen } = metrics;
    placePanes(this.#panes, metrics, scroll);

    const frozenRows: Span = { first: 0, last: metrics.fixedRows - 1 };
    const frozenCols: Span = { first: 0, last: metrics.fixedCols - 1 };
    const rows: Span = { first: viewport.firstRow, last: viewport.lastRow };
    const cols: Span = { first: viewport.firstCol, last: viewport.lastCol };

    this.#draw(this.#panes.corner, metrics, frozenRows, frozenCols, true, true);
    this.#draw(this.#panes.top, metrics, frozenRows, cols, true, false);
    this.#draw(this.#panes.left, metrics, rows, frozenCols, false, true);
    this.#draw(this.#panes.main, metrics, rows, cols, false, false);
    if (bottomFrozen) {
      this.#model.prepare(bottomFrozen.first, bottomFrozen.last, cols.first, cols.last);
      this.#draw(this.#panes.bottomLeft, metrics, bottomFrozen, frozenCols, false, true);
      this.#draw(this.#panes.bottom, metrics, bottomFrozen, cols, false, false);
    } else {
      this.#panes.bottom.body.replaceChildren();
      this.#panes.bottomLeft.body.replaceChildren();
    }
  }

  #draw(
    pane: Pane,
    metrics: Metrics,
    rows: Span,
    cols: Span,
    colHeader: boolean,
    rowHeader: boolean,
  ): void {
    const area = {
      firstRow: rows.first,
      lastRow: rows.last,
      firstCol: cols.first,
      lastCol: cols.last,
      colHeader,
      rowHeader,
    };
    drawPane(pane, area, metrics, this.#model, this.#document);
  }

  /** Releases the DOM and the listeners. */
  destroy(): void {
    this.scroller.removeEventListener('scroll', this.#onScroll);
    this.scroller.removeEventListener('wheel', this.#onWheel);
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
    }
    // The wrapper, not the grid: the grid is one of its children, and removing
    // only that would leave the slots and the overlay — with whatever a plugin
    // put in them — in the page after the grid is gone.
    this.layout.clear();
    this.wrapper.remove();
  }

  /** The cell an element belongs to, or `null` when it is not in one. */
  cellAt(target: EventTarget | null): { row: number; col: number } | null {
    let node = target as HTMLElement | null;
    while (node && node !== this.root) {
      const row = node.dataset?.row;
      const col = node.dataset?.col;
      if (row !== undefined && col !== undefined) {
        return { row: Number(row), col: Number(col) };
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * The header an element belongs to, or `null`.
   *
   * A column header carries `data-col` and no `data-row`, and a row header the
   * other way round, so `cellAt` — which needs both — reports nothing for
   * either. That is why clicking a column header reached no handler at all:
   * the grid bailed before firing `afterOnCellMouseDown`, and click-to-sort,
   * which listens for exactly that, could not be reached in a real browser.
   *
   * The missing axis is reported as `-1`, which is how the reference numbers a
   * header too.
   */
  headerAt(target: EventTarget | null): { row: number; col: number } | null {
    let node = target as HTMLElement | null;
    while (node && node !== this.root) {
      const row = node.dataset?.row;
      const col = node.dataset?.col;
      if (row !== undefined && col !== undefined) {
        // A cell, not a header. `cellAt` is the question being asked here.
        return null;
      }
      if (col !== undefined && node.tagName === 'TH') {
        return { row: -1, col: Number(col) };
      }
      if (row !== undefined && node.tagName === 'TH') {
        return { row: Number(row), col: -1 };
      }
      node = node.parentElement;
    }
    return null;
  }

  /** The rendered element for a cell, if it is on screen. */
  elementAt(row: number, col: number): HTMLTableCellElement | null {
    for (const pane of Object.values(this.#panes)) {
      const found = pane.body.querySelector<HTMLTableCellElement>(
        `td[data-row="${row}"][data-col="${col}"]`,
      );
      if (found) {
        return found;
      }
    }
    return null;
  }

  #scrollState(): ScrollState {
    return {
      top: this.scroller.scrollTop,
      left: this.scroller.scrollLeft,
      width: this.scroller.clientWidth,
      height: this.scroller.clientHeight,
    };
  }

  #onScroll = (): void => {
    // Rendering on the next frame rather than on the event coalesces the burst
    // a wheel produces into one draw.
    if (this.#frame !== null) {
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.render();
    });
  };

  #onWheel = (event: WheelEvent): void => {
    if (this.#model.preventWheel?.()) {
      event.preventDefault();
    }
  };

  #element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
  ): HTMLElementTagNameMap[K] {
    return createElement(this.#document, tag, className);
  }
}
