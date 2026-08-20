import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import { readWasm } from './wasm.js';

const wasm = readWasm();

async function makeGrid(settings: Record<string, unknown> = {}) {
  const engine = await Engine.load(wasm);
  const container = document.createElement('div');
  // jsdom reports zero for every measurement, so the viewport is given a size.
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(container, 'clientWidth', { value: 600, configurable: true });
  document.body.appendChild(container);
  const grid = new Grid(container, { engine, colHeaders: true, rowHeaders: true, ...settings });
  return { grid, engine, container };
}

describe('the grid', () => {
  let grid: Grid;
  let container: HTMLElement;

  beforeEach(async () => {
    document.body.replaceChildren();
    ({ grid, container } = await makeGrid());
  });

  it('mounts into its container', () => {
    expect(container.querySelector('.cm-grid')).not.toBeNull();
    expect(grid.container).toBe(container);
    expect(grid.isDestroyed()).toBe(false);
  });

  it('starts with the configured number of rows and columns', () => {
    // Handsontable's defaults: five by five.
    expect(grid.countRows()).toBe(5);
    expect(grid.countCols()).toBe(5);
  });

  it('writes and reads a cell', () => {
    grid.setDataAtCell(0, 0, '10');
    grid.setDataAtCell(0, 1, '=A1*2');
    expect(grid.getDataAtCell(0, 0)).toBe('10');
    expect(grid.getDataAtCell(0, 1)).toBe('20');
    // An editor gets the formula, not the result.
    expect(grid.getSourceDataAtCell(0, 1)).toBe('=A1*2');
  });

  it('recalculates dependants on every edit', () => {
    grid.setDataAtCell(0, 0, '10');
    grid.setDataAtCell(1, 0, '=A1*3');
    grid.setDataAtCell(0, 0, '100');
    expect(grid.getDataAtCell(1, 0)).toBe('300');
  });

  it('writes several cells as one change', () => {
    const before = grid.revision;
    grid.setDataAtCells([
      [0, 0, '1'],
      [0, 1, '2'],
      [0, 2, '=A1+B1'],
    ]);
    expect(grid.getDataAtCell(0, 2)).toBe('3');
    // One commit, not three.
    expect(grid.revision).toBe(before + 1);
  });

  it('fires beforeChange and afterChange', () => {
    const seen: unknown[] = [];
    grid.addHook('afterChange', (changes, source) => {
      seen.push([changes, source]);
    });
    grid.setDataAtCell(0, 0, 'x');
    expect(seen).toHaveLength(1);
    const [changes, source] = seen[0] as [unknown[], string];
    expect(source).toBe('edit');
    expect(changes[0]).toEqual([0, 0, '', 'x']);
  });

  it('lets beforeChange veto an edit', () => {
    grid.addHook('beforeChange', () => false);
    grid.setDataAtCell(0, 0, 'blocked');
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });

  it('refuses to write a read-only cell', () => {
    grid.setCellMeta(1, 1, 'readOnly', true);
    grid.setDataAtCells([
      [1, 1, 'no'],
      [1, 2, 'yes'],
    ]);
    expect(grid.getDataAtCell(1, 1)).toBe('');
    // The rest of the change still lands, as a paste over a locked cell should.
    expect(grid.getDataAtCell(1, 2)).toBe('yes');
  });

  it('cascades settings from the grid to the column to the cell', () => {
    grid.updateSettings({ readOnly: false, columns: [{ readOnly: true }, {}] });
    expect(grid.getCellMeta(0, 0).readOnly).toBe(true);
    expect(grid.getCellMeta(0, 1).readOnly).toBe(false);
    grid.setCellMeta(0, 0, 'readOnly', false);
    expect(grid.getCellMeta(0, 0).readOnly).toBe(false);
  });

  it('consults the cells function for a single row', () => {
    grid.updateSettings({
      cells: (row) => (row === 2 ? { readOnly: true } : {}),
    });
    expect(grid.getCellMeta(2, 0).readOnly).toBe(true);
    expect(grid.getCellMeta(1, 0).readOnly).toBe(false);
  });

  it('populates a rectangle from an array, repeating the source', () => {
    grid.populateFromArray(0, 0, [['a', 'b']], 2, 1);
    expect(grid.getDataAtCell(0, 0)).toBe('a');
    expect(grid.getDataAtCell(2, 1)).toBe('b');
  });

  it('selects cells, rows, columns and everything', () => {
    grid.selectCell(1, 1);
    expect(grid.getSelectedLast()).toEqual([1, 1, 1, 1]);

    grid.selectCell(1, 1, 3, 3);
    expect(grid.getSelectedLast()).toEqual([1, 1, 3, 3]);

    grid.selectRows(2);
    expect(grid.getSelectedLast()).toEqual([2, 0, 2, 4]);

    grid.selectColumns(1);
    expect(grid.getSelectedLast()).toEqual([0, 1, 4, 1]);

    grid.selectAll();
    expect(grid.getSelectedLast()).toEqual([0, 0, 4, 4]);
  });

  it('fires afterSelection with the range', () => {
    const seen: number[][] = [];
    grid.addHook('afterSelection', (_value: unknown, ...coords: number[]) => {
      seen.push(coords);
    });
    grid.selectCell(1, 2, 3, 4);
    expect(seen[0]).toEqual([1, 2, 3, 4]);
  });

  it('empties the selected cells', () => {
    grid.setDataAtCells([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, 'c'],
    ]);
    grid.selectCell(0, 0, 0, 1);
    grid.emptySelectedCells();
    expect(grid.getDataAtCell(0, 0)).toBe('');
    expect(grid.getDataAtCell(0, 1)).toBe('');
    expect(grid.getDataAtCell(1, 0)).toBe('c');
  });

  it('undoes and redoes', () => {
    grid.setDataAtCell(0, 0, 'first');
    grid.setDataAtCell(0, 0, 'second');
    grid.undo();
    expect(grid.getDataAtCell(0, 0)).toBe('first');
    grid.redo();
    expect(grid.getDataAtCell(0, 0)).toBe('second');
  });

  it('grows as data is written past the current extent', () => {
    grid.setDataAtCell(0, 0, 'x');
    expect(grid.countRows()).toBe(5);
    grid.setDataAtCell(20, 0, 'far');
    expect(grid.countRows()).toBe(21);
  });

  it('reads headers from settings', () => {
    expect(grid.getColHeader(0)).toBe('A');
    expect(grid.getRowHeader(0)).toBe('1');
    grid.updateSettings({ colHeaders: ['One', 'Two'] });
    expect(grid.getColHeader(0)).toBe('One');
    expect(grid.getColHeader(5)).toBe('F');
    grid.updateSettings({ colHeaders: (index: number) => `#${index}` });
    expect(grid.getColHeader(3)).toBe('#3');
  });

  it('resizes rows and columns', () => {
    expect(grid.getColWidth(0)).toBe(50);
    grid.setColWidth(0, 120);
    expect(grid.getColWidth(0)).toBe(120);
    grid.setRowHeight(0, 40);
    expect(grid.getRowHeight(0)).toBe(40);
  });

  it('lets a hook modify a measured width', () => {
    grid.addHook('modifyColWidth', (width: number, col: number) => (col === 1 ? 200 : width));
    expect(grid.getColWidth(1)).toBe(200);
    expect(grid.getColWidth(0)).toBe(50);
  });

  it('draws only what is on screen', () => {
    grid.setDataAtCell(2000, 0, 'far away');
    expect(grid.countRows()).toBe(2001);
    const rendered = container.querySelectorAll('td').length;
    // Two thousand rows in the sheet, a screenful in the DOM.
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(2000);
  });

  it('holds off drawing during a batch', () => {
    let renders = 0;
    grid.addHook('afterRender', () => {
      renders += 1;
    });
    grid.batch(() => {
      grid.setDataAtCell(0, 0, '1');
      grid.setDataAtCell(0, 1, '2');
      grid.setDataAtCell(0, 2, '3');
    });
    expect(renders).toBe(1);
  });

  it('reports the history of a cell', () => {
    grid.setDataAtCell(0, 0, 'first');
    grid.setDataAtCell(0, 0, 'second');
    const history = grid.getCellHistory(0, 0);
    expect(history).toHaveLength(2);
  });

  it('undoes only one actor', () => {
    // The engine records the grid's own edits under a single actor, so this
    // undoes them all — the interesting case is an agent editing alongside.
    grid.setDataAtCell(0, 0, '1');
    grid.engine.call({
      op: 'write',
      who: { kind: 'agent', id: 'agent-7' },
      cells: [{ cell: 'B1', input: '99' }],
    });
    grid.undoBy('agent-7');
    expect(grid.getDataAtCell(0, 0)).toBe('1');
    expect(grid.getDataAtCell(0, 1)).toBe('');
  });

  it('destroys cleanly and stays destroyed', () => {
    grid.destroy();
    expect(grid.isDestroyed()).toBe(true);
    expect(container.querySelector('.cm-grid')).toBeNull();
    // Further calls are no-ops rather than crashes.
    grid.setDataAtCell(0, 0, 'x');
    grid.destroy();
  });
});

describe('inserting and deleting rows and columns', () => {
  it('moves the cells below an inserted row down', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, 'top'],
      [1, 0, 'middle'],
    ]);
    grid.alter('insert_row', 1);
    expect(grid.getDataAtCell(0, 0)).toBe('top');
    expect(grid.getDataAtCell(1, 0)).toBe('');
    expect(grid.getDataAtCell(2, 0)).toBe('middle');
    expect(grid.countRows()).toBe(5);
  });

  it('keeps a formula pointing at what it pointed at', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 3 });
    grid.setDataAtCells([
      [0, 0, '1'],
      [1, 0, '2'],
      [0, 2, '=SUM(A1:A2)'],
    ]);
    grid.alter('insert_row', 1);
    // The new row is inside the block being summed, so the sum covers it.
    expect(grid.getSourceDataAtCell(0, 2)).toBe('=SUM(A1:A3)');
    grid.setDataAtCell(1, 0, '10');
    expect(grid.getDataAtCell(0, 2)).toBe('13');
  });

  it('removes a row and pulls the rest up', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, 'one'],
      [1, 0, 'two'],
      [2, 0, 'three'],
    ]);
    grid.alter('remove_row', 1);
    expect(grid.getDataAtCell(0, 0)).toBe('one');
    expect(grid.getDataAtCell(1, 0)).toBe('three');
    expect(grid.countRows()).toBe(3);
  });

  it('leaves a #REF! rather than a wrong number', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 3 });
    grid.setDataAtCells([
      [1, 0, '5'],
      [0, 2, '=A2'],
    ]);
    grid.alter('remove_row', 1);
    expect(grid.getDataAtCell(0, 2)).toBe('#REF!');
  });

  it('inserts and removes columns too', async () => {
    const { grid } = await makeGrid({ startRows: 2, startCols: 3 });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [0, 1, 'b'],
    ]);
    grid.alter('insert_col', 1);
    expect(grid.getDataAtCell(0, 1)).toBe('');
    expect(grid.getDataAtCell(0, 2)).toBe('b');
    grid.alter('remove_col', 1);
    expect(grid.getDataAtCell(0, 1)).toBe('b');
  });

  it('moves a cell comment along with the cell it describes', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setCellMeta(1, 0, 'comment', { value: 'about the second row' });
    grid.alter('insert_row', 0);
    expect(grid.getCellMeta(1, 0)['comment']).toBeUndefined();
    expect(grid.getCellMeta(2, 0)['comment']).toEqual({ value: 'about the second row' });
  });

  it('drops what was said about a row that was deleted', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setCellMeta(1, 0, 'readOnly', true);
    grid.alter('remove_row', 1);
    expect(grid.getCellMeta(1, 0)['readOnly']).toBeFalsy();
  });

  it('lets a hook veto the change', async () => {
    const { grid } = await makeGrid({ startRows: 3, startCols: 2 });
    grid.setDataAtCell(1, 0, 'stays');
    grid.addHook('beforeRemoveRow', () => false);
    grid.alter('remove_row', 1);
    expect(grid.getDataAtCell(1, 0)).toBe('stays');
  });

  it('undoes in one step', async () => {
    const { grid } = await makeGrid({ startRows: 4, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, 'one'],
      [1, 0, 'two'],
    ]);
    grid.alter('remove_row', 0);
    expect(grid.getDataAtCell(0, 0)).toBe('two');
    grid.undo();
    expect(grid.getDataAtCell(0, 0)).toBe('one');
    expect(grid.getDataAtCell(1, 0)).toBe('two');
  });
});
