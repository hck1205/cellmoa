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
  colHeaderHeight(): number;
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
  /** A theme name, applied as a class on the root. */
  themeName?(): string | null;
  /** Called before drawing, so the data for the window can be fetched. */
  prepare(startRow: number, endRow: number, startCol: number, endCol: number): void;
  /** Fills in one cell. */
  renderCell(context: CellRenderContext): void;
  /** Extra rows and columns to draw beyond the viewport, to smooth scrolling. */
  overscan(): number;
}

/** Which pane an element belongs to. */
type PaneName = 'main' | 'top' | 'left' | 'corner';

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
    };
    // Frozen panes sit above the scrolling one, so their cells win a click.
    for (const name of ['main', 'left', 'top', 'corner'] as const) {
      this.root.appendChild(this.#panes[name].element);
    }
    this.root.appendChild(this.scroller);
    // The scroller is on top so it keeps the wheel and the scrollbars, but it
    // must not swallow clicks meant for the cells beneath it.
    this.scroller.style.pointerEvents = 'auto';

    container.appendChild(this.root);
    this.scroller.addEventListener('scroll', this.#onScroll);
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

    const firstRow = Math.max(rowRange.first - overscan, fixedRows);
    const lastRow = Math.min(rowRange.last + overscan, this.#model.rowCount() - 1);
    const firstCol = Math.max(colRange.first - overscan, fixedCols);
    const lastCol = Math.min(colRange.last + overscan, this.#model.colCount() - 1);

    this.#viewport = { firstRow, lastRow, firstCol, lastCol };

    // One fetch covers every pane, so the frozen rows do not cost a second
    // round trip to the engine.
    this.#model.prepare(
      Math.min(firstRow, 0),
      Math.max(lastRow, fixedRows - 1),
      Math.min(firstCol, 0),
      Math.max(lastCol, fixedCols - 1),
    );

    this.#layoutPanes(headerWidth, headerHeight, frozenWidth, frozenHeight);

    this.#drawPane(this.#panes.corner, 0, fixedRows - 1, 0, fixedCols - 1, true, true);
    this.#drawPane(this.#panes.top, 0, fixedRows - 1, firstCol, lastCol, true, false);
    this.#drawPane(this.#panes.left, firstRow, lastRow, 0, fixedCols - 1, false, true);
    this.#drawPane(this.#panes.main, firstRow, lastRow, firstCol, lastCol, false, false);
  }

  /** Releases the DOM and the listeners. */
  destroy(): void {
    this.scroller.removeEventListener('scroll', this.#onScroll);
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
    }
    this.root.remove();
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
    // Only the panes that scroll get an offset; the corner never moves.
    this.#panes.top.table.style.transform = `translateX(${-this.scroller.scrollLeft}px)`;
    this.#panes.left.table.style.transform = `translateY(${-this.scroller.scrollTop}px)`;
    this.#panes.main.table.style.transform =
      `translate(${-this.scroller.scrollLeft}px, ${-this.scroller.scrollTop}px)`;
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
        tr.style.height = `${headerHeight / Math.max(levels.length, 1)}px`;
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
    const direction = this.#model.direction?.() ?? 'ltr';
    this.root.dir = direction;
    this.root.classList.toggle(`${CLASS.root}--rtl`, direction === 'rtl');

    for (const existing of [...this.root.classList]) {
      if (existing.startsWith('cm-theme-')) {
        this.root.classList.remove(existing);
      }
    }
    const theme = this.#model.themeName?.();
    if (theme) {
      this.root.classList.add(`cm-theme-${theme}`);
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
