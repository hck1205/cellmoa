/**
 * The renderer.
 *
 * Only what is on screen exists in the DOM. A grid of a million rows has the
 * same number of elements as a grid of fifty, and scrolling moves a window over
 * the data rather than creating anything — which is the only way the browser
 * survives a spreadsheet.
 *
 * The layout is four panes, so that frozen rows and columns stay put while the
 * middle scrolls:
 *
 *     corner │ top      (frozen rows)
 *     ───────┼──────────
 *     left   │ main
 *     (frozen columns)
 */

import { columnLetters } from './dataSource.js';
import { LayoutManager } from './layout.js';
import type { SizeMap } from './sizes.js';

/** What the view needs to know to draw a cell. */
export interface CellRenderContext {
  row: number;
  col: number;
  /** The element to fill in. It is reused between renders. */
  td: HTMLTableCellElement;
}

/**
 * One cell in the column header.
 *
 * A header can be more than one row deep — a group label spanning several
 * columns above the columns themselves — so a cell carries its own span and
 * knows which level it is on.
 */
export interface ColHeaderCell {
  /** The leftmost column this cell sits above. */
  col: number;
  /** How many columns it spans. */
  colspan: number;
  /** Which header row it is on, 0 at the top. */
  level: number;
  label: string;
}

/** Everything the view reads from the grid. */
export interface ViewModel {
  rowCount(): number;
  colCount(): number;
  rowSizes(): SizeMap;
  colSizes(): SizeMap;
  fixedRowsTop(): number;
  fixedColumnsStart(): number;
  /** Whether headers are drawn, and what they say. */
  rowHeader(row: number): string | null;
  /**
   * The column header, as rows of cells covering `firstCol`..`lastCol`.
   *
   * An empty array means no column header at all. One row of one-column cells
   * is the ordinary case; more rows are a nested header.
   */
  colHeaderRows(firstCol: number, lastCol: number): ColHeaderCell[][];
  rowHeaderWidth(): number;
  /** The whole column-header area, however many levels deep it is. */
  colHeaderHeight(): number;
  /** One level of it, so a nested header can give its rows different heights. */
  colHeaderLevelHeight?(level: number): number;
  /** Called after a header cell is built, so a plugin can decorate it. */
  renderColHeader?(th: HTMLTableCellElement, cell: ColHeaderCell): void;
  /** The same for a row header. */
  renderRowHeader?(th: HTMLTableCellElement, row: number): void;
  /**
   * ARIA roles and indexes on the table, its rows and its cells.
   *
   * A grid built out of `<div>`s and absolute positions is invisible to a
   * screen reader without them: what the eye reads as a table is, to anything
   * that cannot see it, a pile of unrelated boxes.
   */
  ariaTags?(): boolean;
  /** `rtl` mirrors the layout, for languages written right to left. */
  direction?(): 'ltr' | 'rtl';
  /** How many rows are frozen at the bottom. */
  fixedRowsBottom?(): number;
  /** Swallow the wheel, for a page that scrolls the grid itself. */
  preventWheel?(): boolean;
  /**
   * The theme, as the classes it wants and the properties it sets.
   *
   * Properties as well as classes, so a theme registered at run time works
   * without the page having loaded a stylesheet for it.
   */
  theme?(): { classNames: string[]; properties: Record<string, string> } | null;
  /** Extra class names for the grid's own elements. */
  tableClassName?(): string[];
  /**
   * The size the grid should take, as CSS.
   *
   * `null` means "whatever the container is", which is the default and the only
   * thing that works when the page decides the layout.
   */
  size?(): { width: string | null; height: string | null; preventOverflow: 'horizontal' | 'vertical' | false };
  /** Called before drawing, so the data for the window can be fetched. */
  prepare(startRow: number, endRow: number, startCol: number, endCol: number): void;
  /** Fills in one cell. */
  renderCell(context: CellRenderContext): void;
  /** Extra rows and columns to draw beyond the viewport, to smooth scrolling. */
  /**
   * How many rows and columns to draw beyond the viewport.
   *
   * `all` draws every one there is — which is what a page that wants to print
   * the grid, or search it with the browser's own find, has to have, and what
   * makes a large grid unusable if switched on by accident.
   */
  overscan(): { rows: number | 'all'; cols: number | 'all' };
}

/** Marks a class as one the settings put there, so a later change can take it off. */
const CUSTOM_CLASS_MARK = 'cm-custom-';

/** Which pane an element belongs to. */
type PaneName = 'main' | 'top' | 'left' | 'corner' | 'bottom' | 'bottomLeft';

interface Pane {
  name: PaneName;
  element: HTMLDivElement;
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
}

/** The visible window, in indexes. */
export interface Viewport {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
}

const CLASS = {
  root: 'cm-grid',
  wrapper: 'cm-wrapper',
  slot: 'cm-slot',
  overlay: 'cm-overlay',
  scroller: 'cm-scroller',
  spacer: 'cm-spacer',
  pane: 'cm-pane',
  header: 'cm-header',
  rowHeader: 'cm-row-header',
  colHeader: 'cm-col-header',
  corner: 'cm-corner',
  cell: 'cm-cell',
};

/**
 * Draws a grid into a container.
 */
export class View {
  readonly root: HTMLDivElement;
  readonly scroller: HTMLDivElement;

  #model: ViewModel;
  #spacer: HTMLDivElement;
  #panes: Record<PaneName, Pane>;
  #viewport: Viewport = { firstRow: 0, lastRow: -1, firstCol: 0, lastCol: -1 };
  #frame: number | null = null;
  /** The custom properties the current theme set, so the next one can clear them. */
  #themeProperties: string[] = [];
  #document: Document;

  constructor(container: HTMLElement, model: ViewModel) {
    this.#model = model;
    this.#document = container.ownerDocument;

    this.root = this.#element('div', CLASS.root);
    this.#applyChrome();
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
      main: this.#createPane('main'),
      top: this.#createPane('top'),
      left: this.#createPane('left'),
      corner: this.#createPane('corner'),
      bottom: this.#createPane('bottom'),
      bottomLeft: this.#createPane('bottomLeft'),
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
    this.scroller.addEventListener('scroll', this.#onScroll);
    this.scroller.addEventListener(
      'wheel',
      (event) => {
        if (this.#model.preventWheel?.()) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
  }

  /** The element holding the grid and everything around it. */
  readonly wrapper!: HTMLElement;
  /** The layer floating UI is drawn in, over the grid. */
  readonly overlay!: HTMLElement;
  /** The slots around the grid. */
  readonly layout!: LayoutManager;

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
    const rows = this.#model.rowSizes();
    const cols = this.#model.colSizes();
    const headerWidth = this.#model.rowHeaderWidth();
    const headerHeight = this.#model.colHeaderHeight();
    const frozenHeight = this.#frozenHeight();
    const frozenWidth = this.#frozenWidth();

    const top = rows.offsetOf(row);
    const bottom = top + rows.sizeOf(row);
    const visibleTop = this.scroller.scrollTop + frozenHeight;
    const visibleBottom = this.scroller.scrollTop + this.scroller.clientHeight - headerHeight;
    if (top < visibleTop) {
      this.scroller.scrollTop = Math.max(top - frozenHeight, 0);
    } else if (bottom > visibleBottom) {
      this.scroller.scrollTop += bottom - visibleBottom;
    }

    const left = cols.offsetOf(col);
    const right = left + cols.sizeOf(col);
    const visibleLeft = this.scroller.scrollLeft + frozenWidth;
    const visibleRight = this.scroller.scrollLeft + this.scroller.clientWidth - headerWidth;
    if (left < visibleLeft) {
      this.scroller.scrollLeft = Math.max(left - frozenWidth, 0);
    } else if (right > visibleRight) {
      this.scroller.scrollLeft += right - visibleRight;
    }
    this.render();
  }

  /** Draws, or redraws, the visible window. */
  render(): void {
    this.#applyChrome();
    const rows = this.#model.rowSizes();
    const cols = this.#model.colSizes();
    const headerWidth = this.#model.rowHeaderWidth();
    const headerHeight = this.#model.colHeaderHeight();
    const fixedRows = Math.min(this.#model.fixedRowsTop(), this.#model.rowCount());
    const fixedCols = Math.min(this.#model.fixedColumnsStart(), this.#model.colCount());

    this.#spacer.style.width = `${cols.total + headerWidth}px`;
    this.#spacer.style.height = `${rows.total + headerHeight}px`;

    const frozenHeight = this.#frozenHeight();
    const frozenWidth = this.#frozenWidth();

    // The scrolling pane starts after the frozen rows and columns, and its
    // window is measured from where the frozen area ends.
    const viewHeight = Math.max(this.scroller.clientHeight - headerHeight - frozenHeight, 0);
    const viewWidth = Math.max(this.scroller.clientWidth - headerWidth - frozenWidth, 0);
    const overscan = this.#model.overscan();

    const rowRange = rows.rangeAt(this.scroller.scrollTop + frozenHeight, viewHeight);
    const colRange = cols.rangeAt(this.scroller.scrollLeft + frozenWidth, viewWidth);

    const firstRow =
      overscan.rows === 'all' ? fixedRows : Math.max(rowRange.first - overscan.rows, fixedRows);
    const lastRow =
      overscan.rows === 'all'
        ? this.#model.rowCount() - 1
        : Math.min(rowRange.last + overscan.rows, this.#model.rowCount() - 1);
    const firstCol =
      overscan.cols === 'all' ? fixedCols : Math.max(colRange.first - overscan.cols, fixedCols);
    const lastCol =
      overscan.cols === 'all'
        ? this.#model.colCount() - 1
        : Math.min(colRange.last + overscan.cols, this.#model.colCount() - 1);

    this.#viewport = { firstRow, lastRow, firstCol, lastCol };

    // One fetch covers every pane, so the frozen rows do not cost a second
    // round trip to the engine.
    this.#model.prepare(
      Math.min(firstRow, 0),
      Math.max(lastRow, fixedRows - 1),
      Math.min(firstCol, 0),
      Math.max(lastCol, fixedCols - 1),
    );

    const bottomFrozen = this.#bottomRange();
    this.#layoutPanes(headerWidth, headerHeight, frozenWidth, frozenHeight, bottomFrozen);

    this.#drawPane(this.#panes.corner, 0, fixedRows - 1, 0, fixedCols - 1, true, true);
    this.#drawPane(this.#panes.top, 0, fixedRows - 1, firstCol, lastCol, true, false);
    this.#drawPane(this.#panes.left, firstRow, lastRow, 0, fixedCols - 1, false, true);
    this.#drawPane(this.#panes.main, firstRow, lastRow, firstCol, lastCol, false, false);
    if (bottomFrozen) {
      this.#model.prepare(bottomFrozen.first, bottomFrozen.last, firstCol, lastCol);
      this.#drawPane(
        this.#panes.bottomLeft,
        bottomFrozen.first,
        bottomFrozen.last,
        0,
        fixedCols - 1,
        false,
        true,
      );
      this.#drawPane(
        this.#panes.bottom,
        bottomFrozen.first,
        bottomFrozen.last,
        firstCol,
        lastCol,
        false,
        false,
      );
    } else {
      this.#panes.bottom.body.replaceChildren();
      this.#panes.bottomLeft.body.replaceChildren();
    }
  }

  /**
   * The rows frozen at the bottom, or `null` when none are.
   *
   * They come off the end of the sheet, not off the top, so the range moves
   * whenever the sheet grows — which is what makes a totals row stay under the
   * data rather than under wherever row 20 happens to be.
   */
  #bottomRange(): { first: number; last: number } | null {
    const count = Math.min(this.#model.fixedRowsBottom?.() ?? 0, this.#model.rowCount());
    if (count <= 0) {
      return null;
    }
    return { first: this.#model.rowCount() - count, last: this.#model.rowCount() - 1 };
  }

  /** How tall the bottom frozen area is. */
  #bottomHeight(): number {
    const range = this.#bottomRange();
    if (!range) {
      return 0;
    }
    const rows = this.#model.rowSizes();
    let total = 0;
    for (let row = range.first; row <= range.last; row += 1) {
      total += rows.sizeOf(row);
    }
    return total;
  }

  /** Releases the DOM and the listeners. */
  destroy(): void {
    this.scroller.removeEventListener('scroll', this.#onScroll);
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

  #frozenHeight(): number {
    const rows = this.#model.rowSizes();
    const fixed = Math.min(this.#model.fixedRowsTop(), this.#model.rowCount());
    return rows.offsetOf(fixed);
  }

  #frozenWidth(): number {
    const cols = this.#model.colSizes();
    const fixed = Math.min(this.#model.fixedColumnsStart(), this.#model.colCount());
    return cols.offsetOf(fixed);
  }

  #layoutPanes(
    headerWidth: number,
    headerHeight: number,
    frozenWidth: number,
    frozenHeight: number,
    bottomFrozen: { first: number; last: number } | null,
  ): void {
    const place = (
      pane: Pane,
      left: number,
      top: number,
      width: string,
      height: string,
    ): void => {
      const style = pane.element.style;
      style.position = 'absolute';
      style.left = `${left}px`;
      style.top = `${top}px`;
      style.width = width;
      style.height = height;
      style.overflow = 'hidden';
    };
    place(this.#panes.corner, 0, 0, `${headerWidth + frozenWidth}px`, `${headerHeight + frozenHeight}px`);
    place(this.#panes.top, headerWidth + frozenWidth, 0, 'auto', `${headerHeight + frozenHeight}px`);
    place(this.#panes.left, 0, headerHeight + frozenHeight, `${headerWidth + frozenWidth}px`, 'auto');
    place(this.#panes.main, headerWidth + frozenWidth, headerHeight + frozenHeight, 'auto', 'auto');
    const bottomHeight = bottomFrozen ? this.#bottomHeight() : 0;
    const bottomTop = Math.max(this.scroller.clientHeight - bottomHeight, 0);
    place(this.#panes.bottomLeft, 0, bottomTop, `${headerWidth + frozenWidth}px`, `${bottomHeight}px`);
    place(this.#panes.bottom, headerWidth + frozenWidth, bottomTop, 'auto', `${bottomHeight}px`);
    this.#panes.bottom.element.hidden = !bottomFrozen;
    this.#panes.bottomLeft.element.hidden = !bottomFrozen;

    // Only the panes that scroll get an offset; the corner never moves.
    this.#panes.top.table.style.transform = `translateX(${-this.scroller.scrollLeft}px)`;
    this.#panes.left.table.style.transform = `translateY(${-this.scroller.scrollTop}px)`;
    this.#panes.main.table.style.transform =
      `translate(${-this.scroller.scrollLeft}px, ${-this.scroller.scrollTop}px)`;
    // The bottom panes hold rows from the end of the sheet, so their contents
    // are offset by where those rows actually sit rather than by the scroll.
    if (bottomFrozen) {
      const rows = this.#model.rowSizes();
      const offset = rows.offsetOf(bottomFrozen.first) - headerHeight;
      this.#panes.bottom.table.style.transform =
        `translate(${-this.scroller.scrollLeft}px, ${-offset}px)`;
      this.#panes.bottomLeft.table.style.transform = `translateY(${-offset}px)`;
    }
  }

  /**
   * Draws one pane.
   *
   * Rows are positioned absolutely rather than laid out by the table, so a
   * pane that starts at row 5000 does not need 5000 empty rows above it.
   */
  #drawPane(
    pane: Pane,
    firstRow: number,
    lastRow: number,
    firstCol: number,
    lastCol: number,
    withColHeader: boolean,
    withRowHeader: boolean,
  ): void {
    const rows = this.#model.rowSizes();
    const cols = this.#model.colSizes();
    const headerWidth = this.#model.rowHeaderWidth();
    const headerHeight = this.#model.colHeaderHeight();

    pane.body.replaceChildren();
    pane.table.style.position = 'absolute';
    pane.table.style.left = '0';
    pane.table.style.top = '0';

    if (withColHeader && headerHeight > 0) {
      const levels = this.#model.colHeaderRows(firstCol, lastCol);
      levels.forEach((cells, level) => {
        const tr = this.#element('tr', CLASS.header) as unknown as HTMLTableRowElement;
        tr.style.height = `${
          this.#model.colHeaderLevelHeight?.(level) ?? headerHeight / Math.max(levels.length, 1)
        }px`;
        tr.dataset.level = String(level);
        if (this.#model.ariaTags?.() !== false) {
          tr.setAttribute('role', 'row');
        }
        if (withRowHeader && headerWidth > 0) {
          const corner = this.#element('th', CLASS.corner);
          corner.style.width = `${headerWidth}px`;
          // The corner is one cell however deep the header is, so it spans the
          // remaining rows rather than being repeated on each of them.
          if (level === 0 && levels.length > 1) {
            corner.rowSpan = levels.length;
          }
          if (level === 0 || levels.length === 1) {
            tr.appendChild(corner);
          }
        }
        for (const cell of cells) {
          const th = this.#element('th', CLASS.colHeader);
          if (this.#model.ariaTags?.() !== false) {
            th.setAttribute('role', 'columnheader');
            th.setAttribute('aria-colindex', String(cell.col + 1));
          }
          let width = 0;
          for (let col = cell.col; col < cell.col + cell.colspan; col += 1) {
            width += cols.sizeOf(col);
          }
          th.style.width = `${width}px`;
          th.dataset.col = String(cell.col);
          th.dataset.level = String(cell.level);
          if (cell.colspan > 1) {
            th.colSpan = cell.colspan;
          }
          th.textContent = cell.label !== '' ? cell.label : columnLetters(cell.col);
          this.#model.renderColHeader?.(th, cell);
          tr.appendChild(th);
        }
        pane.body.appendChild(tr);
      });
    }

    const aria = this.#model.ariaTags?.() !== false;
    for (let row = firstRow; row <= lastRow; row += 1) {
      const tr = this.#document.createElement('tr');
      tr.style.height = `${rows.sizeOf(row)}px`;
      tr.dataset.row = String(row);
      if (aria) {
        tr.setAttribute('role', 'row');
        // One-based, and counted in the whole table rather than in the window
        // being drawn: a screen reader announcing "row 1 of 12" while the user
        // is at row 400 would be worse than saying nothing.
        tr.setAttribute('aria-rowindex', String(row + 1));
      }
      // Each pane draws its own slice, so the row is placed by its own offset
      // within that slice rather than by its index in the sheet.
      tr.style.position = 'absolute';
      tr.style.top = `${rows.offsetOf(row) + (withColHeader ? 0 : headerHeight)}px`;
      tr.style.left = '0';

      if (withRowHeader && headerWidth > 0) {
        const th = this.#element('th', CLASS.rowHeader);
        if (aria) {
          th.setAttribute('role', 'rowheader');
        }
        th.style.width = `${headerWidth}px`;
        th.dataset.row = String(row);
        th.textContent = this.#model.rowHeader(row) ?? String(row + 1);
        this.#model.renderRowHeader?.(th, row);
        tr.appendChild(th);
      }
      for (let col = firstCol; col <= lastCol; col += 1) {
        const td = this.#document.createElement('td');
        td.className = CLASS.cell;
        td.style.width = `${cols.sizeOf(col)}px`;
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        if (aria) {
          td.setAttribute('role', 'gridcell');
          td.setAttribute('aria-colindex', String(col + 1));
        }
        this.#model.renderCell({ row, col, td });
        tr.appendChild(td);
      }
      pane.body.appendChild(tr);
    }

    // The header row is in normal flow; the data rows are absolute, so the
    // table needs an explicit height to hold them.
    pane.table.style.height = `${rows.total + headerHeight}px`;
    pane.table.style.width = `${cols.total + headerWidth}px`;
  }

  /**
   * Puts the language direction, the theme and the ARIA role on the root.
   *
   * Re-applied on every render rather than once at construction, because all
   * three are settings and settings change.
   */
  #applyChrome(): void {
    this.#applySize();
    const direction = this.#model.direction?.() ?? 'ltr';
    this.root.dir = direction;
    this.root.classList.toggle(`${CLASS.root}--rtl`, direction === 'rtl');

    // Off with the last theme's classes and properties before the next one's
    // go on: a theme that set a colour the new one does not would otherwise
    // leave that colour behind.
    for (const existing of [...this.root.classList]) {
      if (existing.startsWith('cm-theme-') || existing.startsWith('ht-theme-') ||
          existing.startsWith('cm-density-')) {
        this.root.classList.remove(existing);
      }
    }
    for (const property of [...this.#themeProperties]) {
      this.root.style.removeProperty(property);
    }
    this.#themeProperties = [];

    const theme = this.#model.theme?.();
    if (theme) {
      this.root.classList.add(...theme.classNames);
      for (const [name, value] of Object.entries(theme.properties)) {
        const property = `--ht-${name}`;
        this.root.style.setProperty(property, value);
        this.#themeProperties.push(property);
      }
    }
    // A marker class records which classes came from the settings, so changing
    // the setting takes exactly those off again and leaves the grid's own —
    // and anything the page added itself — alone.
    for (const existing of [...this.root.classList]) {
      if (existing.startsWith(CUSTOM_CLASS_MARK)) {
        this.root.classList.remove(existing, existing.slice(CUSTOM_CLASS_MARK.length));
      }
    }
    for (const name of this.#model.tableClassName?.() ?? []) {
      this.root.classList.add(name, `${CUSTOM_CLASS_MARK}${name}`);
    }
    if (this.#model.ariaTags?.() !== false) {
      this.root.setAttribute('role', 'grid');
      this.root.setAttribute('aria-rowcount', String(this.#model.rowCount()));
      this.root.setAttribute('aria-colcount', String(this.#model.colCount()));
    } else {
      this.root.removeAttribute('role');
      this.root.removeAttribute('aria-rowcount');
      this.root.removeAttribute('aria-colcount');
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
    if (!size || !this.wrapper) {
      return;
    }
    this.wrapper.style.width = size.width ?? '';
    this.wrapper.style.height = size.height ?? '';
    const parent = this.wrapper.parentElement;
    if (size.preventOverflow && parent) {
      const limit = size.preventOverflow === 'horizontal' ? 'maxWidth' : 'maxHeight';
      const from = size.preventOverflow === 'horizontal' ? parent.clientWidth : parent.clientHeight;
      this.wrapper.style[limit] = `${from}px`;
    } else {
      this.wrapper.style.maxWidth = '';
      this.wrapper.style.maxHeight = '';
    }
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

  #createPane(name: PaneName): Pane {
    const element = this.#element('div', `${CLASS.pane} ${CLASS.pane}--${name}`);
    const table = this.#document.createElement('table');
    table.className = 'cm-table';
    const body = this.#document.createElement('tbody');
    table.appendChild(body);
    element.appendChild(table);
    return { name, element, table, body };
  }

  #element(tag: string, className: string): HTMLDivElement & HTMLTableCellElement {
    const element = this.#document.createElement(tag);
    element.className = className;
    return element as HTMLDivElement & HTMLTableCellElement;
  }
}
