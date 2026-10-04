import { describe, expect, it } from 'vitest';
import { fetchRange, measure, viewportOf } from '../src/geometry.js';
import { SizeMap } from '../src/sizes.js';
import type { ViewModel } from '../src/view.js';

/**
 * The windowing arithmetic, away from the DOM.
 *
 * jsdom gives every element a client size of zero, so a grid mounted in a test
 * always draws one row: the numbers that matter to a real viewport can only be
 * checked here.
 */
const model = (overrides: Partial<ViewModel> = {}): ViewModel => {
  const rows = new SizeMap(10_000, 20);
  const cols = new SizeMap(50, 100);
  return {
    rowCount: () => 10_000,
    colCount: () => 50,
    rowSizes: () => rows,
    colSizes: () => cols,
    fixedRowsTop: () => 0,
    fixedColumnsStart: () => 0,
    rowHeader: () => null,
    colHeaderRows: () => [],
    rowHeaderWidth: () => 0,
    colHeaderHeight: () => 0,
    prepare: () => {},
    renderCell: () => {},
    overscan: () => ({ rows: 0, cols: 0 }),
    ...overrides,
  };
};

describe('the drawn window', () => {
  it('covers the viewport and nothing above it', () => {
    const view = model();
    const scroll = { top: 4000, left: 0, width: 500, height: 200 };
    expect(viewportOf(view, measure(view), scroll)).toMatchObject({
      firstRow: 200,
      lastRow: 209,
      firstCol: 0,
      lastCol: 4,
    });
  });

  it('starts after the frozen rows, which have a pane of their own', () => {
    const view = model({ fixedRowsTop: () => 3, fixedColumnsStart: () => 2 });
    const metrics = measure(view);
    expect(metrics.frozenHeight).toBe(60);
    expect(metrics.frozenWidth).toBe(200);
    const window = viewportOf(view, metrics, { top: 0, left: 0, width: 500, height: 200 });
    expect(window.firstRow).toBe(3);
    expect(window.firstCol).toBe(2);
  });

  it('takes the bottom frozen rows off the end of the sheet', () => {
    const view = model({ fixedRowsBottom: () => 2 });
    const metrics = measure(view);
    expect(metrics.bottomFrozen).toEqual({ first: 9998, last: 9999 });
    expect(metrics.bottomHeight).toBe(40);
  });
});

describe('the window the data is fetched for', () => {
  it('asks only for what is drawn when nothing is frozen', () => {
    const view = model();
    const metrics = measure(view);
    const window = viewportOf(view, metrics, { top: 4000, left: 0, width: 500, height: 200 });
    expect(fetchRange(metrics, window).startRow).toBe(200);
  });

  it('reaches back to the top only when there are frozen rows to draw', () => {
    const view = model({ fixedRowsTop: () => 2, fixedColumnsStart: () => 1 });
    const metrics = measure(view);
    const window = viewportOf(view, metrics, { top: 4000, left: 0, width: 500, height: 200 });
    expect(fetchRange(metrics, window)).toMatchObject({ startRow: 0, startCol: 0 });
  });
});
