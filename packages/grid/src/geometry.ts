/**
 * Where everything is.
 *
 * The arithmetic behind virtual scrolling — which rows and columns fall in the
 * window, how tall the frozen edges are, where the sheet ends. None of it
 * touches the DOM, which is what lets it be read once at the top of a render
 * and handed to every part of the draw: the model is free to compute these
 * numbers, so asking it for the same one six times a frame is not free either.
 */

import type { SizeMap } from './sizes.js';
import type { ViewModel, Viewport } from './viewModel.js';

/** Where the scroller sits, and how much of the sheet it shows. */
export interface ScrollState {
  top: number;
  left: number;
  /** The scroller's own size, not the sheet's. */
  width: number;
  height: number;
}

/** The sizes a render works from, read once. */
export interface Metrics {
  rows: SizeMap;
  cols: SizeMap;
  rowCount: number;
  colCount: number;
  headerWidth: number;
  headerHeight: number;
  /** Frozen counts, already clamped to what the sheet actually has. */
  fixedRows: number;
  fixedCols: number;
  /** How far the frozen rows and columns reach. */
  frozenHeight: number;
  frozenWidth: number;
  /** The rows frozen at the bottom, or `null` when none are. */
  bottomFrozen: { first: number; last: number } | null;
  bottomHeight: number;
}

/** Reads every size a render needs. */
export function measure(model: ViewModel): Metrics {
  const rows = model.rowSizes();
  const cols = model.colSizes();
  const rowCount = model.rowCount();
  const colCount = model.colCount();
  const fixedRows = Math.min(model.fixedRowsTop(), rowCount);
  const fixedCols = Math.min(model.fixedColumnsStart(), colCount);

  // The bottom frozen rows come off the end of the sheet, not off the top, so
  // the range moves whenever the sheet grows — which is what makes a totals row
  // stay under the data rather than under wherever row 20 happens to be.
  const bottomCount = Math.min(model.fixedRowsBottom?.() ?? 0, rowCount);
  const bottomFrozen =
    bottomCount > 0 ? { first: rowCount - bottomCount, last: rowCount - 1 } : null;
  let bottomHeight = 0;
  if (bottomFrozen) {
    for (let row = bottomFrozen.first; row <= bottomFrozen.last; row += 1) {
      bottomHeight += rows.sizeOf(row);
    }
  }

  return {
    rows,
    cols,
    rowCount,
    colCount,
    headerWidth: model.rowHeaderWidth(),
    headerHeight: model.colHeaderHeight(),
    fixedRows,
    fixedCols,
    frozenHeight: rows.offsetOf(fixedRows),
    frozenWidth: cols.offsetOf(fixedCols),
    bottomFrozen,
    bottomHeight,
  };
}

/**
 * Which rows and columns the scrolling pane should draw.
 *
 * The window is measured from where the frozen area ends rather than from the
 * top of the sheet, because the frozen rows are drawn by their own panes and
 * would otherwise be counted twice.
 */
export function viewportOf(model: ViewModel, metrics: Metrics, scroll: ScrollState): Viewport {
  const viewHeight = Math.max(scroll.height - metrics.headerHeight - metrics.frozenHeight, 0);
  const viewWidth = Math.max(scroll.width - metrics.headerWidth - metrics.frozenWidth, 0);
  const overscan = model.overscan();

  const rowRange = metrics.rows.rangeAt(scroll.top + metrics.frozenHeight, viewHeight);
  const colRange = metrics.cols.rangeAt(scroll.left + metrics.frozenWidth, viewWidth);

  return {
    firstRow:
      overscan.rows === 'all'
        ? metrics.fixedRows
        : Math.max(rowRange.first - overscan.rows, metrics.fixedRows),
    lastRow:
      overscan.rows === 'all'
        ? metrics.rowCount - 1
        : Math.min(rowRange.last + overscan.rows, metrics.rowCount - 1),
    firstCol:
      overscan.cols === 'all'
        ? metrics.fixedCols
        : Math.max(colRange.first - overscan.cols, metrics.fixedCols),
    lastCol:
      overscan.cols === 'all'
        ? metrics.colCount - 1
        : Math.min(colRange.last + overscan.cols, metrics.colCount - 1),
  };
}

/**
 * The window the data has to be fetched for, covering every pane at once.
 *
 * One fetch rather than one per pane, so the frozen rows do not cost a second
 * round trip to the engine. It reaches back to row 0 only when there are frozen
 * rows up there to draw: without that check, a grid scrolled to row 5000 asks
 * for all five thousand rows above it on every frame.
 */
export function fetchRange(
  metrics: Metrics,
  viewport: Viewport,
): { startRow: number; endRow: number; startCol: number; endCol: number } {
  return {
    startRow: metrics.fixedRows > 0 ? 0 : viewport.firstRow,
    endRow: Math.max(viewport.lastRow, metrics.fixedRows - 1),
    startCol: metrics.fixedCols > 0 ? 0 : viewport.firstCol,
    endCol: Math.max(viewport.lastCol, metrics.fixedCols - 1),
  };
}
