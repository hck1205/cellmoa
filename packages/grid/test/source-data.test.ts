/**
 * Source data, and which indexes name it.
 *
 * The reference is explicit: `getSourceData*` take **physical** indexes and
 * return the dataset in the order it was given, trimmed rows included. Ours
 * translated from visual, so a caller who followed the guide and saved
 * `getSourceData()` to a backend wrote the sorted view with the trimmed rows
 * missing — a silent loss on the one operation you cannot undo.
 */

import { describe, expect, it } from 'vitest';
import { makeGrid } from './helpers.js';
import type { TrimRows } from '../src/plugins/index.js';

/** A grid whose visual order differs from its physical one. */
async function sorted(): Promise<Awaited<ReturnType<typeof makeGrid>>> {
  const grid = await makeGrid({ startRows: 3, startCols: 1 });
  grid.setDataAtCells([
    [0, 0, 'first'],
    [1, 0, 'second'],
    [2, 0, 'third'],
  ]);
  // Physical row 0 now sits last on screen.
  grid.rowIndex.moveIndexes([0], 2);
  return grid;
}

describe('reading the source', () => {
  it('names a cell by its physical index, not where it is drawn', async () => {
    const grid = await sorted();
    expect(grid.getDataAtCell(2, 0), 'visually last').toBe('first');
    // Physically, `first` is still row 0.
    expect(grid.getSourceDataAtCell(0, 0)).toBe('first');
    expect(grid.getSourceDataAtCell(2, 0)).toBe('third');
  });

  it('returns the dataset in the order it was given', async () => {
    const grid = await sorted();
    expect(grid.getData().map((row) => row[0])).toEqual(['second', 'third', 'first']);
    expect(grid.getSourceData().map((row) => row[0])).toEqual(['first', 'second', 'third']);
  });

  it('keeps a trimmed row, which the visible data does not', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 1 });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'trimmed'],
      [2, 0, 'c'],
    ]);
    (grid.getPlugin('trimRows') as unknown as TrimRows).trimRows([1]);

    expect(grid.countRows(), 'the trimmed row is gone from the view').toBe(2);
    expect(grid.getSourceData().map((row) => row[0])).toEqual(['a', 'trimmed', 'c']);
  });

  it('reads a physical row and column the same way', async () => {
    const grid = await sorted();
    expect(grid.getSourceDataAtRow(0)).toEqual(['first']);
    expect(grid.getSourceDataAtCol(0)).toEqual(['first', 'second', 'third']);
  });

  it('writes at a physical index too', async () => {
    const grid = await sorted();
    grid.setSourceDataAtCell(0, 0, 'rewritten');
    expect(grid.getSourceDataAtCell(0, 0)).toBe('rewritten');
    // Which is the row drawn last, because that is where physical 0 now sits.
    expect(grid.getDataAtCell(2, 0)).toBe('rewritten');
  });
});

describe('what the grid itself reads while sorted', () => {
  it('copies the cells that are on screen, not their physical twins', async () => {
    // Every internal caller works in visual space. Making the public reader
    // physical without giving them their own would have made a copy from a
    // sorted grid take the wrong cells — and no test covered a sorted copy.
    const grid = await sorted();
    grid.selectCell(0, 0);
    const clipboard = grid.getPlugin('copyPaste') as unknown as {
      getCopyableText(): string;
    };
    // Visually first is physical row 1, `second`.
    expect(clipboard.getCopyableText()).toBe('second');
  });

  it('seeds an editor from the cell that was clicked', async () => {
    const grid = await sorted();
    expect(grid.getEditableValue(0, 0)).toBe('second');
    expect(grid.getEditableValue(2, 0)).toBe('first');
  });

  it('counts an empty row by what is drawn there', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 1 });
    grid.setDataAtCell(0, 0, 'only');
    grid.rowIndex.moveIndexes([0], 2);
    // Physical row 0 holds the value and is drawn last.
    expect(grid.isEmptyRow(0)).toBe(true);
    expect(grid.isEmptyRow(2)).toBe(false);
  });
});
