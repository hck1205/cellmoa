/**
 * Hiding a row or column.
 *
 * `renderableLength`, `toRenderable` and `fromRenderable` were tracked in the
 * index map and read by nothing outside it, so hiding reached the export and
 * the formulas and never reached the screen. These are the questions that were
 * being answered wrongly in silence.
 */

import { describe, expect, it } from 'vitest';
import { mountGrid } from './helpers.js';
import type { HiddenColumns, HiddenRows } from '../src/plugins/index.js';

/** Which rows the grid actually drew. */
function drawnRows(grid: Awaited<ReturnType<typeof mountGrid>>['grid']): number[] {
  const cells = grid.view!.root.querySelectorAll('td[data-row]');
  return [...new Set([...cells].map((td) => Number((td as HTMLElement).dataset['row'])))].sort(
    (a, b) => a - b,
  );
}

function drawnCols(grid: Awaited<ReturnType<typeof mountGrid>>['grid']): number[] {
  const cells = grid.view!.root.querySelectorAll('td[data-col]');
  return [...new Set([...cells].map((td) => Number((td as HTMLElement).dataset['col'])))].sort(
    (a, b) => a - b,
  );
}

describe('a hidden row', () => {
  it('is not drawn', async () => {
    const { grid } = await mountGrid({ startRows: 4, startCols: 1, hiddenRows: { rows: [1] } });
    grid.render();
    expect(drawnRows(grid)).toEqual([0, 2, 3]);
  });

  it('takes no room, so the rows below move up', async () => {
    const { grid } = await mountGrid({ startRows: 4, startCols: 1, rowHeights: 20 });
    const before = grid.rowSizes.offsetOf(3);
    (grid.getPlugin('hiddenRows') as unknown as HiddenRows).hide([1]);
    expect(grid.rowSizes.offsetOf(3)).toBe(before - 20);
    expect(grid.rowSizes.total).toBe(before - 20 + 20);
  });

  it('comes back when it is shown again', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 1, hiddenRows: { rows: [1] } });
    grid.render();
    expect(drawnRows(grid)).toEqual([0, 2]);

    (grid.getPlugin('hiddenRows') as unknown as HiddenRows).show([1]);
    expect(drawnRows(grid)).toEqual([0, 1, 2]);
  });

  it('still holds its value, because hidden is not deleted', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 1 });
    grid.setDataAtCell(1, 0, 'kept');
    (grid.getPlugin('hiddenRows') as unknown as HiddenRows).hide([1]);
    expect(grid.getDataAtCell(1, 0)).toBe('kept');
  });
});

describe('a hidden column', () => {
  it('is not drawn, and its header goes with it', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 4,
      colHeaders: true,
      hiddenColumns: { columns: [1] },
    });
    grid.render();
    expect(drawnCols(grid)).toEqual([0, 2, 3]);

    const headers = [...grid.view!.root.querySelectorAll('th.cm-col-header')].map(
      (th) => (th as HTMLElement).dataset['col'],
    );
    expect(headers).not.toContain('1');
  });

  it('takes no width, so the columns after it move left', async () => {
    const { grid } = await mountGrid({ startRows: 1, startCols: 4, colWidths: 50 });
    const before = grid.columnSizes.offsetOf(3);
    (grid.getPlugin('hiddenColumns') as unknown as HiddenColumns).hide([1]);
    expect(grid.columnSizes.offsetOf(3)).toBe(before - 50);
  });
});

describe('the measurements a hidden index feeds', () => {
  it('are recomputed after something is hidden, not served from before it', async () => {
    // The size map keeps prefix sums. Nothing told it they were stale, so the
    // first read after a hide answered from the layout that existed before.
    const { grid } = await mountGrid({ startRows: 5, startCols: 1, rowHeights: 20 });
    expect(grid.rowSizes.total).toBe(100);

    const rows = grid.getPlugin('hiddenRows') as unknown as HiddenRows;
    rows.hide([0, 1]);
    expect(grid.rowSizes.total).toBe(60);

    rows.show([0]);
    expect(grid.rowSizes.total).toBe(80);
  });

  it('report a uniform grid as uniform only while it really is', async () => {
    // `total` and `offsetOf` take an arithmetic shortcut for a grid where every
    // index is the default size. A hidden index is zero, which is not the
    // default, so the shortcut has to stop being taken.
    const { grid } = await mountGrid({ startRows: 3, startCols: 1, rowHeights: 20 });
    expect(grid.rowSizes.isUniform).toBe(true);
    (grid.getPlugin('hiddenRows') as unknown as HiddenRows).hide([0]);
    expect(grid.rowSizes.isUniform).toBe(false);
    expect(grid.rowSizes.offsetOf(1)).toBe(0);
  });
});
