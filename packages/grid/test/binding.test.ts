/**
 * Binding to data.
 *
 * `data` is how nearly every table starts, and it is the setting most likely to
 * arrive as an array of objects because that is the shape an API answers with.
 * A grid that took the setting and drew nothing would be broken for the
 * ordinary case, which is why these tests come before the interesting ones.
 */

import { describe, expect, it } from 'vitest';
import { makeGrid } from './helpers.js';
import { normalizeData } from '../src/grid.js';

describe('the shape of `data`', () => {
  const prop = (col: number): string | number => col;

  it('takes an array of arrays as it is', () => {
    expect(normalizeData([['a', 'b'], ['c', 'd']], prop)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('writes every value as text, and a hole as empty', () => {
    expect(normalizeData([[1, null, undefined, true]], prop)).toEqual([['1', '', '', 'true']]);
  });

  it('orders an array of objects by the first object’s keys', () => {
    expect(normalizeData([{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }], prop)).toEqual([
      ['1', 'Ada'],
      ['2', 'Grace'],
    ]);
  });

  it('lets the columns decide the order when they name themselves', () => {
    const byColumn = (col: number): string | number => (['name', 'id'][col] ?? col);
    expect(normalizeData([{ id: 1, name: 'Ada' }], byColumn)).toEqual([['Ada', '1']]);
  });

  it('has nothing to say about anything else', () => {
    expect(normalizeData(undefined, prop)).toEqual([]);
    expect(normalizeData('not data', prop)).toEqual([]);
    expect(normalizeData([], prop)).toEqual([]);
  });
});

describe('a grid built with `data`', () => {
  it('shows what it was given', async () => {
    const grid = await makeGrid({ data: [['a', 'b'], ['c', 'd']] });
    expect(grid.getDataAtCell(0, 0)).toBe('a');
    expect(grid.getDataAtCell(1, 1)).toBe('d');
  });

  it('calculates a formula that came in with the data', async () => {
    const grid = await makeGrid({ data: [['2', '3', '=A1+B1']] });
    expect(grid.getDataAtCell(0, 2)).toBe('5');
  });

  it('reads an array of objects through the columns that name themselves', async () => {
    const grid = await makeGrid({
      columns: [{ data: 'name' }, { data: 'qty' }],
      data: [
        { id: 9, name: 'bolt', qty: 4 },
        { id: 10, name: 'nut', qty: 12 },
      ],
    });
    expect(grid.getDataAtCell(0, 0)).toBe('bolt');
    expect(grid.getDataAtCell(0, 1)).toBe('4');
    expect(grid.getDataAtCell(1, 0)).toBe('nut');
    // `id` was not asked for, so it is not a column.
    expect(grid.colToProp(0)).toBe('name');
    expect(grid.propToCol('qty')).toBe(1);
  });

  it('prefers a column’s `data` key over its header', async () => {
    const grid = await makeGrid({
      colHeaders: ['Quantity'],
      columns: [{ data: 'qty' }],
      data: [{ qty: 3 }],
    });
    expect(grid.getColHeader(0)).toBe('Quantity');
    expect(grid.colToProp(0)).toBe('qty');
  });

  it('reloads when `data` is updated, and leaves the rows alone otherwise', async () => {
    const grid = await makeGrid({ data: [['a', 'b']] });
    grid.updateSettings({ rowHeaders: false });
    expect(grid.getDataAtCell(0, 0)).toBe('a');

    grid.updateSettings({ data: [['x', 'y']] });
    expect(grid.getDataAtCell(0, 0)).toBe('x');
  });

  it('is empty when no data was given', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });
});
