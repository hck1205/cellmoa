import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import { pluginNames } from '../src/plugins/base.js';
import type { ColumnSorting, Filters, HiddenColumns, HiddenRows, ManualColumnFreeze, ManualColumnMove, ManualRowMove, MultiColumnSorting, TrimRows } from '../src/plugins/index.js';
import { compareValues, testCondition } from '../src/plugins/index.js';
import { readWasm } from './wasm.js';

const wasm = readWasm();

async function makeGrid(settings: Record<string, unknown> = {}) {
  const engine = await Engine.load(wasm);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(container, 'clientWidth', { value: 600, configurable: true });
  document.body.appendChild(container);
  // The table below has four rows and two columns; without this the grid would
  // also show the five empty rows Handsontable starts with.
  return new Grid(container, {
    engine,
    colHeaders: true,
    rowHeaders: true,
    startRows: 4,
    startCols: 2,
    ...settings,
  });
}

/** Fills a grid with a small table of names and numbers. */
function fill(grid: Grid): void {
  const rows: Array<[string, string]> = [
    ['banana', '20'],
    ['apple', '30'],
    ['cherry', '10'],
    ['date', ''],
  ];
  grid.setDataAtCells(
    rows.flatMap(([name, amount], row) => [
      [row, 0, name] as [number, number, string],
      [row, 1, amount] as [number, number, string],
    ]),
  );
}

describe('the plugin registry', () => {
  it('registers every plugin implemented so far', () => {
    expect(pluginNames()).toContain('columnSorting');
    expect(pluginNames()).toContain('filters');
    expect(pluginNames()).toContain('hiddenRows');
    expect(pluginNames()).toContain('manualRowMove');
  });

  it('builds every plugin whether or not the settings ask for it', async () => {
    const grid = await makeGrid();
    // The instance exists so it can be switched on later.
    expect(grid.getPlugin('columnSorting')).toBeDefined();
    expect(grid.isPluginEnabled('columnSorting')).toBe(false);

    grid.updateSettings({ columnSorting: true });
    expect(grid.isPluginEnabled('columnSorting')).toBe(true);
  });
});

describe('sorting', () => {
  let grid: Grid;
  let sorting: ColumnSorting;

  beforeEach(async () => {
    document.body.replaceChildren();
    grid = await makeGrid({ columnSorting: true });
    fill(grid);
    sorting = grid.getPlugin<ColumnSorting>('columnSorting')!;
  });

  it('sorts ascending and descending without writing anything', () => {
    const revision = grid.revision;
    sorting.sort({ column: 0, sortOrder: 'asc' });
    expect(grid.getDataAtCell(0, 0)).toBe('apple');
    expect(grid.getDataAtCell(3, 0)).toBe('date');
    // Sorting is a view change, not an edit.
    expect(grid.revision).toBe(revision);

    sorting.sort({ column: 0, sortOrder: 'desc' });
    expect(grid.getDataAtCell(0, 0)).toBe('date');
  });

  it('keeps a row together when it moves', () => {
    sorting.sort({ column: 0, sortOrder: 'asc' });
    // apple was row 1 and had 30 next to it.
    expect(grid.getDataAtCell(0, 0)).toBe('apple');
    expect(grid.getDataAtCell(0, 1)).toBe('30');
  });

  it('sorts numbers as numbers', () => {
    sorting.sort({ column: 1, sortOrder: 'asc' });
    expect(grid.getDataAtCell(0, 1)).toBe('10');
    expect(grid.getDataAtCell(1, 1)).toBe('20');
    expect(grid.getDataAtCell(2, 1)).toBe('30');
  });

  it('leaves blanks at the bottom in both directions', () => {
    sorting.sort({ column: 1, sortOrder: 'asc' });
    expect(grid.getDataAtCell(3, 1)).toBe('');
    sorting.sort({ column: 1, sortOrder: 'desc' });
    // Flipping the sort must not fill the top with empty rows.
    expect(grid.getDataAtCell(3, 1)).toBe('');
  });

  it('cycles ascending, descending, off', () => {
    sorting.toggleSort(0);
    expect(sorting.getSortConfig()[0]!.sortOrder).toBe('asc');
    sorting.toggleSort(0);
    expect(sorting.getSortConfig()[0]!.sortOrder).toBe('desc');
    sorting.toggleSort(0);
    expect(sorting.isSorted()).toBe(false);
    expect(grid.getDataAtCell(0, 0)).toBe('banana');
  });

  it('marks the sorted header', () => {
    sorting.sort({ column: 0, sortOrder: 'asc' });
    expect(grid.getColHeader(0)).toContain('▲');
    sorting.sort({ column: 0, sortOrder: 'desc' });
    expect(grid.getColHeader(0)).toContain('▼');
  });

  it('fires beforeColumnSort and lets it veto', () => {
    grid.addHook('beforeColumnSort', () => false);
    sorting.sort({ column: 0, sortOrder: 'asc' });
    expect(grid.getDataAtCell(0, 0)).toBe('banana');
  });

  it('sorts by several columns when the multi-column plugin is on', async () => {
    document.body.replaceChildren();
    const multi = await makeGrid({ multiColumnSorting: true });
    multi.setDataAtCells([
      [0, 0, 'b'], [0, 1, '2'],
      [1, 0, 'a'], [1, 1, '2'],
      [2, 0, 'a'], [2, 1, '1'],
    ]);
    const plugin = multi.getPlugin<MultiColumnSorting>('multiColumnSorting')!;
    plugin.sort([
      { column: 0, sortOrder: 'asc' },
      { column: 1, sortOrder: 'asc' },
    ]);
    expect(multi.getDataAtRow(0).slice(0, 2)).toEqual(['a', '1']);
    expect(multi.getDataAtRow(1).slice(0, 2)).toEqual(['a', '2']);
    expect(multi.getDataAtRow(2).slice(0, 2)).toEqual(['b', '2']);
  });
});

describe('the comparator', () => {
  it('puts numbers before text before booleans, and blanks last', () => {
    expect(compareValues(1, 2)).toBeLessThan(0);
    expect(compareValues(99, 'a')).toBeLessThan(0);
    expect(compareValues('z', true)).toBeLessThan(0);
    expect(compareValues(null, 1)).toBeGreaterThan(0);
    expect(compareValues(null, null)).toBe(0);
  });

  it('compares text case-insensitively and numerically', () => {
    expect(compareValues('Apple', 'apple')).toBe(0);
    // `item10` after `item9`, as a person would file them.
    expect(compareValues('item9', 'item10')).toBeLessThan(0);
  });
});

describe('filtering', () => {
  let grid: Grid;
  let filters: Filters;

  beforeEach(async () => {
    document.body.replaceChildren();
    grid = await makeGrid({ filters: true });
    fill(grid);
    filters = grid.getPlugin<Filters>('filters')!;
  });

  it('removes the rows that fail, renumbering the rest', () => {
    filters.addCondition(1, 'gt', [15]);
    filters.filter();
    expect(grid.countRows()).toBe(2);
    // A filtered row is gone, so the rows the user sees stay contiguous.
    expect(grid.getDataAtCell(0, 0)).toBe('banana');
    expect(grid.getDataAtCell(1, 0)).toBe('apple');
  });

  it('brings the rows back when the conditions are cleared', () => {
    filters.addCondition(1, 'gt', [15]);
    filters.filter();
    filters.clearConditions();
    filters.filter();
    expect(grid.countRows()).toBe(4);
  });

  it('filters by a list of values', () => {
    filters.addCondition(0, 'by_value', [['apple', 'cherry']]);
    filters.filter();
    expect(grid.getDataAtCol(0).slice(0, 2)).toEqual(['apple', 'cherry']);
  });

  it('reports the distinct values of a column', () => {
    expect(filters.getValues(0)).toEqual(['banana', 'apple', 'cherry', 'date']);
  });

  it('combines conditions on one column, and columns with AND', () => {
    filters.addCondition(0, 'contains', ['a']);
    filters.addCondition(1, 'lt', [25]);
    filters.filter();
    expect(grid.getDataAtCol(0).filter(Boolean)).toEqual(['banana']);
  });
});

describe('conditions', () => {
  it('covers the comparisons a filter box offers', () => {
    expect(testCondition('apple', { name: 'eq', args: ['APPLE'] })).toBe(true);
    expect(testCondition('apple', { name: 'neq', args: ['pear'] })).toBe(true);
    expect(testCondition('apple', { name: 'begins_with', args: ['ap'] })).toBe(true);
    expect(testCondition('apple', { name: 'ends_with', args: ['le'] })).toBe(true);
    expect(testCondition('apple', { name: 'contains', args: ['ppl'] })).toBe(true);
    expect(testCondition('apple', { name: 'not_contains', args: ['z'] })).toBe(true);
    expect(testCondition(5, { name: 'gt', args: [4] })).toBe(true);
    expect(testCondition(5, { name: 'gte', args: [5] })).toBe(true);
    expect(testCondition(5, { name: 'lt', args: [6] })).toBe(true);
    expect(testCondition(5, { name: 'lte', args: [5] })).toBe(true);
    expect(testCondition(5, { name: 'between', args: [1, 10] })).toBe(true);
    // The bounds either way round mean the same range.
    expect(testCondition(5, { name: 'between', args: [10, 1] })).toBe(true);
    expect(testCondition(50, { name: 'not_between', args: [1, 10] })).toBe(true);
    expect(testCondition(null, { name: 'empty', args: [] })).toBe(true);
    expect(testCondition('x', { name: 'not_empty', args: [] })).toBe(true);
  });
});

describe('hiding and trimming', () => {
  it('hides a row while still counting it', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ hiddenRows: true });
    fill(grid);
    const hidden = grid.getPlugin<HiddenRows>('hiddenRows')!;
    hidden.hide([1]);
    // Hiding does not renumber: the row is still there to be referred to.
    expect(grid.countRows()).toBe(4);
    expect(grid.rowIndex.renderableLength).toBe(3);
    expect(hidden.isHidden(1)).toBe(true);

    hidden.show([1]);
    expect(grid.rowIndex.renderableLength).toBe(4);
  });

  it('hides a column', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ hiddenColumns: { columns: [1] } });
    const hidden = grid.getPlugin<HiddenColumns>('hiddenColumns')!;
    expect(hidden.getHiddenIndexes()).toEqual([1]);
    expect(grid.colIndex.renderableLength).toBe(grid.countCols() - 1);
  });

  it('trims a row out of the visual space', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ trimRows: true });
    fill(grid);
    const trim = grid.getPlugin<TrimRows>('trimRows')!;
    trim.trimRows([1]);
    // Unlike hiding, trimming renumbers.
    expect(grid.countRows()).toBe(3);
    expect(grid.getDataAtCell(1, 0)).toBe('cherry');
    trim.untrimAll();
    expect(grid.countRows()).toBe(4);
  });
});

describe('moving and freezing', () => {
  it('moves a row without writing anything', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ manualRowMove: true });
    fill(grid);
    const revision = grid.revision;
    const move = grid.getPlugin<ManualRowMove>('manualRowMove')!;
    expect(move.moveIndexes([0], 2)).toBe(true);
    expect(grid.getDataAtCol(0).slice(0, 3)).toEqual(['apple', 'cherry', 'banana']);
    expect(grid.revision).toBe(revision);
  });

  it('lets a hook refuse a move', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ manualRowMove: true });
    fill(grid);
    grid.addHook('beforeRowMove', () => false);
    const move = grid.getPlugin<ManualRowMove>('manualRowMove')!;
    expect(move.moveIndexes([0], 2)).toBe(false);
    expect(grid.getDataAtCell(0, 0)).toBe('banana');
  });

  it('moves a column', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ manualColumnMove: true });
    fill(grid);
    grid.getPlugin<ManualColumnMove>('manualColumnMove')!.moveIndexes([1], 0);
    expect(grid.getDataAtCell(0, 0)).toBe('20');
    expect(grid.getDataAtCell(0, 1)).toBe('banana');
  });

  it('freezes a column by moving it into the fixed block', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ manualColumnFreeze: true });
    fill(grid);
    const freeze = grid.getPlugin<ManualColumnFreeze>('manualColumnFreeze')!;
    freeze.freezeColumn(1);
    expect(grid.getSettings().fixedColumnsStart).toBe(1);
    expect(grid.getDataAtCell(0, 0)).toBe('20');

    freeze.unfreezeColumn(0);
    expect(grid.getSettings().fixedColumnsStart).toBe(0);
  });
});

describe('resizing', () => {
  it('resizes a column and remembers it', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ manualColumnResize: true });
    const resize = grid.getPlugin('manualColumnResize') as unknown as {
      setSize(index: number, size: number | null): void;
      getManualSizes(): Array<[number, number]>;
      clearManualSizes(): void;
    };
    resize.setSize(0, 150);
    expect(grid.getColWidth(0)).toBe(150);
    expect(resize.getManualSizes()).toEqual([[0, 150]]);
    resize.clearManualSizes();
    expect(grid.getColWidth(0)).toBe(50);
  });

  it('sizes columns to their content, leaving hand-set widths alone', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid({ autoColumnSize: true, manualColumnResize: true });
    grid.setDataAtCell(0, 0, 'a very long value indeed');
    grid.setColWidth(1, 999);

    const auto = grid.getPlugin('autoColumnSize') as unknown as { recalculate(): void };
    auto.recalculate();
    expect(grid.getColWidth(0)).toBeGreaterThan(100);
    // A column the user dragged keeps the width they chose.
    expect(grid.getColWidth(1)).toBe(999);
  });
});
