import { beforeEach, describe, expect, it } from 'vitest';
import { CellRange, Selection } from '../src/selection.js';

describe('a cell range', () => {
  it('normalises its corners', () => {
    const range = new CellRange({ row: 5, col: 7 }, { row: 2, col: 3 });
    expect(range.toArray()).toEqual([2, 3, 5, 7]);
    expect(range.rowCount).toBe(4);
    expect(range.colCount).toBe(5);
    expect(range.cellCount).toBe(20);
  });

  it('remembers which corner it started from', () => {
    // The anchor is what an extension grows from, so it must survive
    // normalisation.
    const range = new CellRange({ row: 5, col: 5 }, { row: 1, col: 1 });
    expect(range.from).toEqual({ row: 5, col: 5 });
    const extended = range.extendTo({ row: 8, col: 8 });
    expect(extended.toArray()).toEqual([5, 5, 8, 8]);
  });

  it('knows what it contains and what it overlaps', () => {
    const range = new CellRange({ row: 1, col: 1 }, { row: 3, col: 3 });
    expect(range.includes({ row: 2, col: 2 })).toBe(true);
    expect(range.includes({ row: 4, col: 2 })).toBe(false);
    expect(range.overlaps(new CellRange({ row: 3, col: 3 }, { row: 5, col: 5 }))).toBe(true);
    expect(range.overlaps(new CellRange({ row: 4, col: 4 }, { row: 5, col: 5 }))).toBe(false);
  });

  it('walks its cells row by row', () => {
    const range = new CellRange({ row: 0, col: 0 }, { row: 1, col: 1 });
    expect([...range.cells()]).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });
});

describe('the selection', () => {
  let selection: Selection;
  beforeEach(() => {
    selection = new Selection(() => 10, () => 6);
  });

  it('starts empty', () => {
    expect(selection.isEmpty).toBe(true);
    expect(selection.highlight).toBeNull();
    expect(selection.state).toBeNull();
  });

  it('selects a cell and a range', () => {
    selection.setCell({ row: 2, col: 3 });
    expect(selection.highlight).toEqual({ row: 2, col: 3 });
    expect(selection.last!.isSingle()).toBe(true);

    selection.setRange({ row: 1, col: 1 }, { row: 3, col: 3 });
    expect(selection.last!.toArray()).toEqual([1, 1, 3, 3]);
    // The highlight stays on the cell the selection began from.
    expect(selection.highlight).toEqual({ row: 1, col: 1 });
  });

  it('extends without moving the highlight', () => {
    selection.setCell({ row: 5, col: 2 });
    selection.extendTo({ row: 2, col: 2 });
    expect(selection.highlight).toEqual({ row: 5, col: 2 });
    expect(selection.last!.toArray()).toEqual([2, 2, 5, 2]);

    // Extending the other way past the anchor flips the rectangle.
    selection.extendTo({ row: 8, col: 4 });
    expect(selection.last!.toArray()).toEqual([5, 2, 8, 4]);
    expect(selection.highlight).toEqual({ row: 5, col: 2 });
  });

  it('holds several areas at once', () => {
    selection.setRange({ row: 0, col: 0 }, { row: 1, col: 1 });
    selection.addRange({ row: 4, col: 4 }, { row: 5, col: 5 });
    expect(selection.ranges).toHaveLength(2);
    expect(selection.includes({ row: 0, col: 0 })).toBe(true);
    expect(selection.includes({ row: 5, col: 5 })).toBe(true);
    expect(selection.includes({ row: 3, col: 3 })).toBe(false);
  });

  it('reports overlapping areas without duplicating cells', () => {
    selection.setRange({ row: 0, col: 0 }, { row: 1, col: 1 });
    selection.addRange({ row: 1, col: 1 }, { row: 2, col: 2 });
    // Four plus four, with the shared cell counted once.
    expect(selection.cells()).toHaveLength(7);
  });

  it('honours a single-area mode', () => {
    selection.setMode('range');
    selection.setRange({ row: 0, col: 0 }, { row: 1, col: 1 });
    selection.addRange({ row: 4, col: 4 });
    expect(selection.ranges).toHaveLength(1);
    expect(selection.last!.toArray()).toEqual([4, 4, 4, 4]);
  });

  it('honours a single-cell mode', () => {
    selection.setMode('single');
    selection.setRange({ row: 1, col: 1 }, { row: 3, col: 3 });
    expect(selection.last!.isSingle()).toBe(true);
    selection.extendTo({ row: 5, col: 5 });
    expect(selection.last!.isSingle()).toBe(true);
  });

  it('collapses an existing multi-area selection when the mode narrows', () => {
    selection.setRange({ row: 0, col: 0 }, { row: 1, col: 1 });
    selection.addRange({ row: 4, col: 4 }, { row: 5, col: 5 });
    selection.setMode('single');
    expect(selection.ranges).toHaveLength(1);
    expect(selection.last!.isSingle()).toBe(true);
  });

  it('moves the highlight and stops at the edge', () => {
    selection.setCell({ row: 0, col: 0 });
    expect(selection.moveBy(1, 0)).toBe(true);
    expect(selection.highlight).toEqual({ row: 1, col: 0 });
    expect(selection.moveBy(-5, 0)).toBe(false);
    // A refused move leaves the selection where it was.
    expect(selection.highlight).toEqual({ row: 1, col: 0 });
  });

  it('wraps to the next row when asked to', () => {
    selection.setCell({ row: 0, col: 5 });
    expect(selection.moveBy(0, 1, true)).toBe(true);
    expect(selection.highlight).toEqual({ row: 1, col: 0 });

    selection.setCell({ row: 1, col: 0 });
    expect(selection.moveBy(0, -1, true)).toBe(true);
    expect(selection.highlight).toEqual({ row: 0, col: 5 });
  });

  it('wraps around the grid at the very end', () => {
    selection.setCell({ row: 9, col: 5 });
    expect(selection.moveBy(0, 1, true)).toBe(true);
    expect(selection.highlight).toEqual({ row: 0, col: 0 });
  });

  it('selects whole rows, columns and everything', () => {
    selection.selectRows(2, 3);
    expect(selection.last!.toArray()).toEqual([2, 0, 3, 5]);
    expect(selection.isRowSelected(2)).toBe(true);
    expect(selection.isColumnSelected(0)).toBe(false);

    selection.selectColumns(1);
    expect(selection.last!.toArray()).toEqual([0, 1, 9, 1]);
    expect(selection.isColumnSelected(1)).toBe(true);

    selection.selectAll();
    expect(selection.last!.toArray()).toEqual([0, 0, 9, 5]);
    expect(selection.isRowSelected(4)).toBe(true);
    expect(selection.isColumnSelected(4)).toBe(true);
  });

  it('keeps coordinates inside the grid', () => {
    selection.setCell({ row: 99, col: 99 });
    expect(selection.highlight).toEqual({ row: 9, col: 5 });
    selection.setCell({ row: -5, col: -5 });
    expect(selection.highlight).toEqual({ row: 0, col: 0 });
  });

  it('clears', () => {
    selection.setCell({ row: 1, col: 1 });
    selection.clear();
    expect(selection.isEmpty).toBe(true);
    expect(selection.highlight).toBeNull();
  });
});
