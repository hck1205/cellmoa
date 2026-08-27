/**
 * The panes, and the class names the grid's elements wear.
 *
 * Six of them, so that frozen rows and columns stay put while the middle
 * scrolls:
 *
 *     corner │ top      (frozen rows)
 *     ───────┼──────────
 *     left   │ main
 *     (frozen columns)
 *
 * plus a bottomLeft and a bottom for rows frozen at the foot of the sheet.
 * Each holds its own table and draws its own slice; none of them knows about
 * the scroll except as an offset handed to it, which is what keeps the drawing
 * here and the windowing arithmetic in `geometry`.
 *
 * The class names live here rather than in the view because they are one
 * vocabulary — a stylesheet that knows `cm-pane` also knows `cm-wrapper` — and
 * splitting them across two modules would mean looking in both.
 */

import { columnLetters } from './dataSource.js';
import type { Metrics, ScrollState } from './geometry.js';
import type { ColHeaderCell, ViewModel } from './viewModel.js';

export const CLASS = {
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

/** Which pane an element belongs to. */
export type PaneName = 'main' | 'top' | 'left' | 'corner' | 'bottom' | 'bottomLeft';

export interface Pane {
  name: PaneName;
  element: HTMLDivElement;
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
}

/** The slice of the sheet one pane draws, and which headers come with it. */
export interface PaneArea {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
  colHeader: boolean;
  rowHeader: boolean;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

export function createPane(document: Document, name: PaneName): Pane {
  const element = createElement(document, 'div', `${CLASS.pane} ${CLASS.pane}--${name}`);
  const table = createElement(document, 'table', 'cm-table');
  const body = document.createElement('tbody');
  table.appendChild(body);
  element.appendChild(table);
  return { name, element, table, body };
}

/** Sizes and positions the six panes, and offsets the ones that scroll. */
export function placePanes(
  panes: Record<PaneName, Pane>,
  metrics: Metrics,
  scroll: ScrollState,
): void {
  const place = (pane: Pane, left: number, top: number, width: string, height: string): void => {
    const style = pane.element.style;
    style.position = 'absolute';
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.width = width;
    style.height = height;
    style.overflow = 'hidden';
  };
  const { headerWidth, headerHeight, frozenWidth, frozenHeight, bottomFrozen } = metrics;
  const insetLeft = headerWidth + frozenWidth;
  const insetTop = headerHeight + frozenHeight;

  place(panes.corner, 0, 0, `${insetLeft}px`, `${insetTop}px`);
  place(panes.top, insetLeft, 0, 'auto', `${insetTop}px`);
  place(panes.left, 0, insetTop, `${insetLeft}px`, 'auto');
  place(panes.main, insetLeft, insetTop, 'auto', 'auto');
  const bottomHeight = bottomFrozen ? metrics.bottomHeight : 0;
  const bottomTop = Math.max(scroll.height - bottomHeight, 0);
  place(panes.bottomLeft, 0, bottomTop, `${insetLeft}px`, `${bottomHeight}px`);
  place(panes.bottom, insetLeft, bottomTop, 'auto', `${bottomHeight}px`);
  panes.bottom.element.hidden = !bottomFrozen;
  panes.bottomLeft.element.hidden = !bottomFrozen;

  // Only the panes that scroll get an offset; the corner never moves.
  panes.top.table.style.transform = `translateX(${-scroll.left}px)`;
  panes.left.table.style.transform = `translateY(${-scroll.top}px)`;
  panes.main.table.style.transform = `translate(${-scroll.left}px, ${-scroll.top}px)`;
  // The bottom panes hold rows from the end of the sheet, so their contents
  // are offset by where those rows actually sit rather than by the scroll.
  if (bottomFrozen) {
    const offset = metrics.rows.offsetOf(bottomFrozen.first) - headerHeight;
    panes.bottom.table.style.transform = `translate(${-scroll.left}px, ${-offset}px)`;
    panes.bottomLeft.table.style.transform = `translateY(${-offset}px)`;
  }
}

/**
 * Draws one pane.
 *
 * Rows are positioned absolutely rather than laid out by the table, so a
 * pane that starts at row 5000 does not need 5000 empty rows above it.
 */
export function drawPane(
  pane: Pane,
  area: PaneArea,
  metrics: Metrics,
  model: ViewModel,
  document: Document,
): void {
  const { rows, cols, headerWidth, headerHeight } = metrics;
  // Asked once for the whole pane: it is a setting, and reading it per cell
  // turns a settings lookup into part of the inner loop.
  const aria = model.ariaTags?.() !== false;
  // The row-header column counts as a column for ARIA, so the data columns are
  // numbered after it. Zero when there are no row headers.
  const rowHeaderColumns = headerWidth > 0 ? 1 : 0;
  // The header rows, asked for once. A data row's ARIA index counts past them,
  // and the header itself is drawn from them — two callers for one answer, and
  // asking twice put a model lookup in the draw path for nothing.
  const levels = headerHeight > 0 ? model.colHeaderRows(area.firstCol, area.lastCol) : [];

  pane.body.replaceChildren();
  pane.table.style.position = 'absolute';
  pane.table.style.left = '0';
  pane.table.style.top = '0';

  if (area.colHeader && headerHeight > 0) {
    drawColHeader(pane, area, metrics, model, document, aria, levels, rowHeaderColumns);
  }

  for (let row = area.firstRow; row <= area.lastRow; row += 1) {
    // A hidden row measures zero. Drawing it anyway would put an empty `<tr>`
    // in the table for a screen reader to announce and for `:nth-child` to
    // count, which is not what "hidden" means to either of them.
    if (rows.sizeOf(row) === 0) {
      continue;
    }
    const tr = document.createElement('tr');
    tr.style.height = `${rows.sizeOf(row)}px`;
    tr.dataset.row = String(row);
    if (aria) {
      tr.setAttribute('role', 'row');
      // One-based, counted across the whole table rather than the window being
      // drawn — a screen reader announcing "row 1 of 12" while the user is at
      // row 400 would be worse than saying nothing — and counted past the
      // header rows, which are rows too.
      tr.setAttribute('aria-rowindex', String(row + 1 + levels.length));
    }
    // Each pane draws its own slice, so the row is placed by its own offset
    // within that slice rather than by its index in the sheet.
    tr.style.position = 'absolute';
    tr.style.top = `${rows.offsetOf(row) + (area.colHeader ? 0 : headerHeight)}px`;
    tr.style.left = '0';

    if (area.rowHeader && headerWidth > 0) {
      const th = createElement(document, 'th', CLASS.rowHeader);
      if (aria) {
        th.setAttribute('role', 'rowheader');
        // The row-header column is column 1, so the data columns start at 2.
        // Leaving it out of the numbering made a screen reader announce every
        // cell one column to the left of where it is.
        th.setAttribute('aria-colindex', '1');
        th.setAttribute('scope', 'row');
      }
      th.style.width = `${headerWidth}px`;
      th.dataset.row = String(row);
      th.textContent = model.rowHeader(row) ?? String(row + 1);
      model.renderRowHeader?.(th, row);
      tr.appendChild(th);
    }
    for (let col = area.firstCol; col <= area.lastCol; col += 1) {
      if (cols.sizeOf(col) === 0) {
        continue;
      }
      const td = document.createElement('td');
      td.className = CLASS.cell;
      td.style.width = `${cols.sizeOf(col)}px`;
      td.dataset.row = String(row);
      td.dataset.col = String(col);
      if (aria) {
        td.setAttribute('role', 'gridcell');
        td.setAttribute('aria-colindex', String(col + 1 + rowHeaderColumns));
      }
      model.renderCell({ row, col, td });
      tr.appendChild(td);
    }
    pane.body.appendChild(tr);
  }

  // The header row is in normal flow; the data rows are absolute, so the
  // table needs an explicit height to hold them.
  pane.table.style.height = `${rows.total + headerHeight}px`;
  pane.table.style.width = `${cols.total + headerWidth}px`;
}

function drawColHeader(
  pane: Pane,
  area: PaneArea,
  metrics: Metrics,
  model: ViewModel,
  document: Document,
  aria: boolean,
  levels: ColHeaderCell[][],
  rowHeaderColumns: number,
): void {
  const { cols, headerWidth, headerHeight } = metrics;
  levels.forEach((cells, level) => {
    const tr = createElement(document, 'tr', CLASS.header);
    tr.style.height = `${
      model.colHeaderLevelHeight?.(level) ?? headerHeight / Math.max(levels.length, 1)
    }px`;
    tr.dataset.level = String(level);
    if (aria) {
      tr.setAttribute('role', 'row');
      // Header rows are rows: `aria-rowindex` is one-based across the whole
      // table, headers included, so the first of them is 1 and the first row
      // of data is one past the last header. Leaving it off here left a screen
      // reader with a table whose rows all announced one lower than they are.
      tr.setAttribute('aria-rowindex', String(level + 1));
    }
    if (area.rowHeader && headerWidth > 0) {
      const corner = createElement(document, 'th', CLASS.corner);
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
      let width = 0;
      for (let col = cell.col; col < cell.col + cell.colspan; col += 1) {
        width += cols.sizeOf(col);
      }
      // Every column the header spans is hidden, so the header is too. A
      // spanning header that still covers one visible column keeps its place.
      if (width === 0) {
        continue;
      }
      const th = createElement(document, 'th', CLASS.colHeader);
      if (aria) {
        th.setAttribute('role', 'columnheader');
        th.setAttribute('aria-colindex', String(cell.col + 1 + rowHeaderColumns));
        th.setAttribute('scope', 'col');
      }
      th.style.width = `${width}px`;
      th.dataset.col = String(cell.col);
      th.dataset.level = String(cell.level);
      if (cell.colspan > 1) {
        th.colSpan = cell.colspan;
      }
      th.textContent = cell.label !== '' ? cell.label : columnLetters(cell.col);
      model.renderColHeader?.(th, cell);
      tr.appendChild(th);
    }
    pane.body.appendChild(tr);
  });
}
