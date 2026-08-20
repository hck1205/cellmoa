/**
 * The core methods the reference names.
 *
 * `scripts/parity.mjs` can tell that a method exists; it cannot tell that it
 * answers correctly. These tests are the half the counter cannot do — every
 * assertion here is one the parity number would happily pass without.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeGrid, mountGrid } from './helpers.js';
import type { Grid } from '../src/grid.js';

/** A grid with a small block of data, for the counting questions. */
async function filled(): Promise<Grid> {
  const grid = await makeGrid({ startRows: 5, startCols: 4 });
  grid.setDataAtCells([
    [0, 0, 'a'],
    [0, 1, 'b'],
    [1, 0, 'c'],
    [3, 2, 'd'],
  ]);
  return grid;
}

describe('counting', () => {
  let grid: Grid;
  beforeEach(async () => {
    grid = await filled();
  });

  it('counts the header bands actually drawn', async () => {
    expect(grid.countRowHeaders()).toBe(1);
    expect(grid.countColHeaders()).toBe(1);

    const bare = await makeGrid({ startRows: 2, startCols: 2, rowHeaders: false, colHeaders: false });
    expect(bare.countRowHeaders()).toBe(0);
    expect(bare.countColHeaders()).toBe(0);
  });

  it('counts nested header levels as separate bands', async () => {
    const nested = await makeGrid({
      startRows: 2,
      startCols: 4,
      nestedHeaders: [['A', { label: 'B', colspan: 3 }], ['a', 'b', 'c', 'd']],
    });
    expect(nested.countColHeaders()).toBe(2);
  });

  it('tells an empty row from a written one', () => {
    expect(grid.isEmptyRow(0)).toBe(false);
    expect(grid.isEmptyRow(2)).toBe(true);
    expect(grid.isEmptyCol(0)).toBe(false);
    expect(grid.isEmptyCol(3)).toBe(true);
  });

  it('counts trailing empties apart from all empties', () => {
    // Rows 2 and 4 are empty; only row 4 is at the end.
    expect(grid.countEmptyRows()).toBe(2);
    expect(grid.countEmptyRows(true)).toBe(1);
    // Column 3 is empty and last; column 1 is empty of nothing (it has 'b').
    expect(grid.countEmptyCols(true)).toBe(1);
  });

  it('counts what was rendered, not what exists', () => {
    expect(grid.countRenderedRows()).toBeGreaterThan(0);
    expect(grid.countRenderedRows()).toBeLessThanOrEqual(grid.countRows());
    expect(grid.countRenderedCols()).toBeLessThanOrEqual(grid.countCols());
  });
});

describe('the viewport', () => {
  it('reports fully and partially visible edges, and they differ at the edge', async () => {
    const grid = await makeGrid({
      startRows: 40,
      startCols: 4,
      rowHeights: 30,
      colHeaders: false,
      rowHeaders: false,
    });
    // jsdom measures every element as zero, and these methods ask the scroller
    // how tall it is — the same element the renderer asks. 100px holds three
    // whole 30px rows and cuts the fourth, which is the case being tested.
    Object.defineProperty(grid.view!.scroller, 'clientHeight', { value: 100, configurable: true });
    expect(grid.getFirstFullyVisibleRow()).toBe(0);
    expect(grid.getLastFullyVisibleRow()).toBe(2);
    // Row 3 runs from 90 to 120: it is on screen, but not all of it.
    expect(grid.getLastPartiallyVisibleRow()).toBe(3);
  });

  it('measures the table including its headers', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3, colWidths: 50, rowHeights: 20 });
    expect(grid.getTableWidth()).toBe(3 * 50 + grid.getRowHeaderWidth());
    expect(grid.getTableHeight()).toBe(3 * 20 + grid.getColHeaderHeight());
  });

  it('scrolls the focused cell into view', async () => {
    const grid = await makeGrid({
      startRows: 200,
      startCols: 4,
      rowHeights: 20,
      viewport: { width: 600, height: 200 },
    });
    grid.selectCell(150, 0);
    grid.scrollToFocusedCell();
    expect(grid.view!.scrollTop).toBeGreaterThan(0);
  });
});

describe('indexes', () => {
  it('translates between visual and physical across a move', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2, manualRowMove: true });
    grid.rowIndex.moveIndexes([0], 2);
    // Physical row 0 now sits at visual position 2.
    expect(grid.toVisualRow(0)).toBe(2);
    expect(grid.toPhysicalRow(2)).toBe(0);
    expect(grid.toPhysicalColumn(1)).toBe(1);
    expect(grid.toVisualColumn(1)).toBe(1);
  });

  it('names columns by their header and finds them back', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 3, colHeaders: ['id', 'name', 'qty'] });
    expect(grid.colToProp(1)).toBe('name');
    expect(grid.propToCol('qty')).toBe(2);
    expect(grid.propToCol('nothing')).toBe(-1);
    // A number is already a column, and passes through.
    expect(grid.propToCol(1)).toBe(1);
  });

  it('reads and writes by column name', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 2, colHeaders: ['id', 'name'] });
    grid.setDataAtRowProp(0, 'name', 'Ada');
    expect(grid.getDataAtRowProp(0, 'name')).toBe('Ada');
    expect(grid.getDataAtProp('name')).toEqual(['Ada', '', '']);
    expect(grid.getDataAtProp('missing')).toEqual([]);
  });

  it('gives a direction factor that flips with the layout', async () => {
    const ltr = await makeGrid({ startRows: 1, startCols: 1 });
    expect(ltr.isLtr()).toBe(true);
    expect(ltr.getDirectionFactor()).toBe(1);

    const rtl = await makeGrid({ startRows: 1, startCols: 1, layoutDirection: 'rtl' });
    expect(rtl.isLtr()).toBe(false);
    expect(rtl.getDirectionFactor()).toBe(-1);
  });

  it('finds the cell an element belongs to', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    // `getCell` here is the cell's value; the element has its own name.
    const td = grid.getCellElement(1, 2);
    expect(td).not.toBeNull();
    expect(grid.getCoords(td)).toEqual({ row: 1, col: 2 });
    expect(grid.getCoords(null)).toBeNull();
  });
});

describe('data', () => {
  it('reads source values, which are formulas rather than results', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCell(0, 0, '2');
    grid.setDataAtCell(0, 1, '=A1*3');
    expect(grid.getDataAtCell(0, 1)).toBe('6');
    expect(grid.getSourceDataAtCell(0, 1)).toBe('=A1*3');
    expect(grid.getSourceDataAtRow(0)).toEqual(['2', '=A1*3']);
    expect(grid.getSourceDataAtCol(1)).toEqual(['=A1*3', '']);
    expect(grid.getSourceData()[0]).toEqual(['2', '=A1*3']);
    expect(grid.getSourceDataArray()).toEqual(grid.getSourceData());
  });

  it('withholds what a non-copyable cell holds', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCell(0, 0, 'secret');
    expect(grid.getCopyableData(0, 0)).toBe('secret');
    grid.setCellMeta(0, 0, 'copyable', false);
    expect(grid.getCopyableData(0, 0)).toBe('');
    expect(grid.getCopyableSourceData(0, 0)).toBe('');
  });

  it('answers "mixed" when a block is not of one type', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3 });
    expect(grid.getDataType(0, 0, 1, 1)).toBe('text');
    grid.setCellMeta(1, 1, 'type', 'numeric');
    expect(grid.getDataType(0, 0, 1, 1)).toBe('mixed');
    expect(grid.getDataType(1, 1, 1, 1)).toBe('numeric');
  });

  it('describes the columns as a schema', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 2, colHeaders: ['id', 'name'] });
    expect(grid.getSchema()).toEqual({ id: null, name: null });
  });

  it('replaces everything on loadData and clears what is past the new edge', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3 });
    grid.setDataAtCell(2, 2, 'old');
    grid.loadData([['x', 'y']]);
    expect(grid.getDataAtCell(0, 0)).toBe('x');
    expect(grid.getDataAtCell(2, 2)).toBe('');
  });

  it('leaves untouched cells alone on updateData', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3 });
    grid.setDataAtCell(2, 2, 'kept');
    grid.updateData([['x']]);
    expect(grid.getDataAtCell(0, 0)).toBe('x');
    expect(grid.getDataAtCell(2, 2)).toBe('kept');
  });

  it('lets a hook refuse a load', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCell(0, 0, 'kept');
    grid.addHook('beforeLoadData', () => false);
    grid.loadData([['gone']]);
    expect(grid.getDataAtCell(0, 0)).toBe('kept');
  });

  it('splices a row the way an array splice would', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 4 });
    grid.setDataAtCells([[0, 0, 'a'], [0, 1, 'b'], [0, 2, 'c'], [0, 3, 'd']]);
    grid.spliceRow(0, 1, 1, 'B');
    expect(grid.getSourceDataAtRow(0)).toEqual(['a', 'B', 'c', 'd']);
  });

  it('splices a column the same way', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setDataAtCells([[0, 0, 'a'], [1, 0, 'b'], [2, 0, 'c'], [3, 0, 'd']]);
    grid.spliceCol(0, 1, 2);
    expect(grid.getSourceDataAtCol(0)).toEqual(['a', 'd', '', '']);
  });

  it('reports whether columns may be changed at all', async () => {
    const open = await makeGrid({ startRows: 1, startCols: 1 });
    expect(open.isColumnModificationAllowed()).toBe(true);
    const closed = await makeGrid({
      startRows: 1,
      startCols: 1,
      allowInsertColumn: false,
      allowRemoveColumn: false,
    });
    expect(closed.isColumnModificationAllowed()).toBe(false);
  });
});

describe('cell meta', () => {
  it('hands back every cell and every cell of a row', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 2 });
    expect(grid.getCellMetaAtRow(0)).toHaveLength(2);
    expect(grid.getCellsMeta()).toHaveLength(6);
  });

  it('skips the hook when asked for the transient meta', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.addHook('afterGetCellMeta', (meta: Record<string, unknown>) => ({
      ...meta,
      className: 'from-the-hook',
    }));
    expect(grid.getCellMeta(0, 0).className).toBe('from-the-hook');
    expect(grid.getCellMetaTransient(0, 0).className).toBeUndefined();
  });

  it('reads a column’s own settings', async () => {
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ readOnly: true }, {}],
    });
    expect(grid.getColumnMeta(0).readOnly).toBe(true);
    expect(grid.getColumnMeta(1).readOnly).toBe(false);
  });

  it('moves settings with the rows when spliced', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setCellMeta(2, 0, 'className', 'marked');
    // Drop one row of settings at row 0: what was at row 2 lands at row 1.
    grid.spliceCellsMeta(0, 1);
    expect(grid.getCellMeta(1, 0).className).toBe('marked');
    expect(grid.getCellMeta(2, 0).className).toBeUndefined();
  });

  it('resolves the renderer, editor and validator a cell will use', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.setCellMeta(0, 0, 'type', 'numeric');
    expect(typeof grid.getCellRenderer(0, 0)).toBe('function');
    expect(typeof grid.getCellEditor(0, 0)).toBe('function');
    expect(typeof grid.getCellValidator(0, 0)).toBe('function');

    const own = (): boolean => true;
    grid.setCellMeta(1, 1, 'renderer', own);
    expect(grid.getCellRenderer(1, 1)).toBe(own);
  });

  it('reads a boolean validator the same way at every entry point', async () => {
    // A validator written the way the reference teaches returns a boolean, not
    // a `{ valid }`. It used to be read as a refusal on the edit path and as an
    // acceptance on the batch path — the same rule giving two answers.
    const grid = await makeGrid({ startRows: 2, startCols: 1, allowInvalid: false });
    grid.setCellMeta(0, 0, 'validator', (value: string) => value !== 'no');

    expect(await grid.validateCell(0, 0, 'yes')).toEqual({ valid: true });
    expect(await grid.validateCell(0, 0, 'no')).toEqual({ valid: false });

    // The edit path agrees: an accepted value lands.
    grid.beginEditing(0, 0, 'yes');
    grid.closeEditor(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(grid.getDataAtCell(0, 0)).toBe('yes');
    expect(grid.isCellInvalid(0, 0)).toBe(false);
  });

  it('validates every cell and reports the verdict once', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 1 });
    grid.setCellMeta(0, 0, 'type', 'numeric');
    grid.setDataAtCell(0, 0, 'not a number');
    const verdict = await new Promise<boolean>((resolve) => {
      grid.validateCells(resolve);
    });
    expect(verdict).toBe(false);
    expect(grid.isCellInvalid(0, 0)).toBe(true);
  });

  it('validates only the rows or columns it was given', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 1 });
    grid.setCellMeta(2, 0, 'type', 'numeric');
    grid.setDataAtCell(2, 0, 'nope');
    const rows = await new Promise<boolean>((resolve) => grid.validateRows([0, 1], resolve));
    expect(rows).toBe(true);
    const cols = await new Promise<boolean>((resolve) => grid.validateColumns([0], resolve));
    expect(cols).toBe(false);
  });
});

describe('selection, batching and the rest', () => {
  it('reports the active layer of a multi-layer selection', async () => {
    const grid = await makeGrid({ startRows: 5, startCols: 5 });
    grid.selectCells([[0, 0, 1, 1], [3, 3, 4, 4]]);
    expect(grid.getSelectedActive()).toEqual([3, 3, 4, 4]);
    expect(grid.getActiveSelectionLayerIndex()).toBe(1);
    expect(grid.getSelectedRangeActive()).toEqual(grid.getSelectedRangeLast());
  });

  it('draws once for a batch under either name', async () => {
    const grid = await makeGrid({ startRows: 5, startCols: 5 });
    let renders = 0;
    grid.addHook('afterRender', () => {
      renders += 1;
    });
    grid.batchRender(() => {
      grid.setDataAtCell(0, 0, 'a');
      grid.setDataAtCell(1, 0, 'b');
    });
    expect(renders).toBe(1);
  });

  it('draws once for a batch, not once per change', async () => {
    const grid = await makeGrid({ startRows: 5, startCols: 5 });
    let renders = 0;
    grid.addHook('afterRender', () => {
      renders += 1;
    });
    grid.batchExecution(() => {
      grid.setDataAtCell(0, 0, 'a');
      grid.setDataAtCell(1, 0, 'b');
      grid.setDataAtCell(2, 0, 'c');
    });
    expect(renders).toBe(1);
  });

  it('says while it is suspended, and stops saying so afterwards', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    expect(grid.isExecutionSuspended()).toBe(false);
    grid.suspendExecution();
    expect(grid.isExecutionSuspended()).toBe(true);
    grid.resumeExecution();
    expect(grid.isExecutionSuspended()).toBe(false);
  });

  it('names a plugin it owns, and refuses to name one it does not', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2, contextMenu: true });
    const plugin = grid.getPlugin('contextMenu');
    expect(grid.getPluginName(plugin)).toBe('contextMenu');
    expect(grid.getPluginName({})).toBeNull();
    expect(grid.getPluginsNames()).toContain('contextMenu');
  });

  it('hands back itself, its shortcut manager and its theme', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1, theme: 'horizon' });
    expect(grid.getInstance()).toBe(grid);
    expect(grid.getShortcutManager()).toBe(grid.shortcuts);
    expect(grid.getCurrentThemeName()).toBe('horizon');
    grid.useTheme('classic');
    expect(grid.getCurrentThemeName()).toBe('classic');
  });

  it('opens and closes an editor, and reports which one is open', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    expect(grid.getActiveEditor()).toBeNull();
    grid.selectCell(0, 0);
    grid.beginEditing(0, 0, 'typed');
    expect(grid.getActiveEditor()).not.toBeNull();
    grid.destroyEditor(true);
    expect(grid.getActiveEditor()).toBeNull();
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });

  it('writes itself out as an HTML table', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2, colHeaders: ['x', 'y'] });
    grid.setDataAtCell(0, 0, 'a');
    const html = grid.toHTML();
    expect(html).toContain('<table');
    expect(html).toContain('>a<');
    expect(grid.toTableElement().tagName).toBe('TABLE');
  });
});

describe('bootstrap', () => {
  it('is safe to run twice', async () => {
    const { grid, container } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.setDataAtCell(0, 0, 'kept');
    const before = container.querySelectorAll('td').length;
    grid.init();
    expect(container.querySelectorAll('td').length).toBe(before);
    expect(grid.getDataAtCell(0, 0)).toBe('kept');
  });

  it('keeps the index maps rather than rebuilding them', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2 });
    grid.rowIndex.moveIndexes([0], 2);
    grid.initIndexMappers();
    expect(grid.toVisualRow(0)).toBe(2);
  });

  it('re-registers the built-in shortcuts without doubling them', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3 });
    grid.registerAllShortcutContexts();
    grid.selectCell(0, 0);
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
    grid.view!.root.dispatchEvent(event);
    // Doubled shortcuts would move two rows rather than one.
    expect(grid.getSelectedLast()?.[0]).toBe(1);
  });
});
