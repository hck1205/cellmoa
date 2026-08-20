import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import type {
  CollapsibleColumns,
  ColumnSummary,
  ExportFile,
  NestedHeaders,
  Search,
  UndoRedo,
} from '../src/plugins/index.js';
import {
  DEFAULT_QUERY_METHOD,
  escapeCsvValue,
  normalizeHeaders,
} from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 5, startCols: 4, ...settings }).then((m) => m.grid);

describe('the undoRedo plugin', () => {
  it('reports what undo would do next, and for whom', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('undoRedo') as unknown as UndoRedo;
    expect(plugin.isUndoAvailable()).toBe(false);

    grid.setDataAtCell(0, 0, 'first');
    grid.setDataAtCell(0, 1, 'second');
    const state = plugin.getState();
    expect(state.canUndo).toBe(true);
    expect(state.undoCount).toBe(2);
    expect(state.canRedo).toBe(false);

    plugin.undo();
    expect(grid.getDataAtCell(0, 1)).toBe('');
    expect(plugin.getState().redoCount).toBe(1);
    plugin.redo();
    expect(grid.getDataAtCell(0, 1)).toBe('second');
  });

  it('lets a hook veto an undo', async () => {
    const grid = await makeGrid();
    grid.setDataAtCell(0, 0, 'kept');
    grid.addHook('beforeUndo', () => false);
    grid.undo();
    expect(grid.getDataAtCell(0, 0)).toBe('kept');
  });

  it('refuses to pretend the journal can be cleared', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('undoRedo') as unknown as UndoRedo;
    expect(() => plugin.clear()).toThrow(/cannot be cleared/);
  });
});

describe('searching', () => {
  it('matches anywhere, ignoring case, and nothing at all on an empty query', () => {
    expect(DEFAULT_QUERY_METHOD('an', 'banana')).toBe(true);
    expect(DEFAULT_QUERY_METHOD('AN', 'banana')).toBe(true);
    expect(DEFAULT_QUERY_METHOD('xyz', 'banana')).toBe(false);
    expect(DEFAULT_QUERY_METHOD('', 'banana')).toBe(false);
  });

  it('finds cells and marks them when they are drawn', async () => {
    const grid = await makeGrid({ search: true });
    grid.setDataAtCells([
      [0, 0, 'banana'],
      [1, 0, 'apple'],
      [2, 0, 'banana bread'],
    ]);
    const plugin = grid.getPlugin('search') as unknown as Search;
    const results = plugin.query('banana');
    expect(results).toEqual([
      { row: 0, col: 0, data: 'banana' },
      { row: 2, col: 0, data: 'banana bread' },
    ]);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('htSearchResult')).toBe(true);
    expect(grid.view?.elementAt(1, 0)?.classList.contains('htSearchResult')).toBe(false);
  });

  it('searches what the cell shows, not what it holds', async () => {
    const grid = await makeGrid({ search: true });
    grid.setDataAtCells([
      [0, 0, '4'],
      [1, 0, '=A1*3'],
    ]);
    const plugin = grid.getPlugin('search') as unknown as Search;
    // The formula's result, which is what is on the screen.
    expect(plugin.query('12')).toHaveLength(1);
    expect(plugin.query('A1*3')).toHaveLength(0);
  });

  it('steps through the matches, wrapping round', async () => {
    const grid = await makeGrid({ search: true });
    grid.setDataAtCells([
      [0, 0, 'x'],
      [2, 0, 'x'],
    ]);
    const plugin = grid.getPlugin('search') as unknown as Search;
    plugin.query('x');
    expect(plugin.next()?.row).toBe(0);
    expect(plugin.next()?.row).toBe(2);
    expect(plugin.next()?.row).toBe(0);
    expect(plugin.previous()?.row).toBe(2);
    expect(grid.getSelectedRangeLast()?.topRow).toBe(2);
  });

  it('says nothing rather than wrapping when there were no matches', async () => {
    const grid = await makeGrid({ search: true });
    const plugin = grid.getPlugin('search') as unknown as Search;
    plugin.query('nothing here');
    expect(plugin.next()).toBeNull();
  });

  it('takes the highlights off when cleared', async () => {
    const grid = await makeGrid({ search: true });
    grid.setDataAtCell(0, 0, 'x');
    const plugin = grid.getPlugin('search') as unknown as Search;
    plugin.query('x');
    plugin.clear();
    expect(plugin.getResults()).toEqual([]);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('htSearchResult')).toBe(false);
  });

  it('takes a matcher of its own', async () => {
    const grid = await makeGrid({
      search: { queryMethod: (query: string, value: string) => value === query },
    });
    grid.setDataAtCells([
      [0, 0, 'ban'],
      [1, 0, 'banana'],
    ]);
    const plugin = grid.getPlugin('search') as unknown as Search;
    expect(plugin.query('ban')).toEqual([{ row: 0, col: 0, data: 'ban' }]);
  });
});

describe('the columnSummary plugin', () => {
  it('writes a formula, not a frozen number', async () => {
    const grid = await makeGrid({
      columnSummary: [{ sourceColumn: 0, destinationRow: 4, type: 'sum' }],
    });
    grid.setDataAtCells([
      [0, 0, '1'],
      [1, 0, '2'],
      [2, 0, '3'],
    ]);
    const plugin = grid.getPlugin('columnSummary') as unknown as ColumnSummary;
    plugin.refresh();

    // The destination is left out of its own range, or it would be circular.
    expect(grid.getSourceDataAtCell(4, 0)).toBe('=SUM(A1:A4)');
    expect(grid.getDataAtCell(4, 0)).toBe('6');

    // And because it is a formula, it keeps itself right.
    grid.setDataAtCell(0, 0, '10');
    expect(grid.getDataAtCell(4, 0)).toBe('15');
  });

  it('counts the destination row from the end when asked', async () => {
    const grid = await makeGrid({
      columnSummary: [
        { sourceColumn: 1, destinationRow: 0, reversedRowCoords: true, type: 'average' },
      ],
    });
    const plugin = grid.getPlugin('columnSummary') as unknown as ColumnSummary;
    expect(plugin.destinationRow(plugin.getSpecs()[0]!)).toBe(4);
    expect(plugin.formulaFor(plugin.getSpecs()[0]!)).toBe('=AVERAGE(B1:B4)');
  });

  it('takes explicit ranges, and rounds when told to', async () => {
    const grid = await makeGrid({ columnSummary: [] });
    const plugin = grid.getPlugin('columnSummary') as unknown as ColumnSummary;
    expect(
      plugin.formulaFor({
        sourceColumn: 0,
        destinationRow: 4,
        type: 'sum',
        ranges: [[0, 1], [3]],
        roundFloat: 2,
      }),
    ).toBe('=ROUND(SUM(A1:A2,A4),2)');
  });

  it('writes the summary elsewhere without excluding it from its own column', async () => {
    const grid = await makeGrid({ columnSummary: [] });
    const plugin = grid.getPlugin('columnSummary') as unknown as ColumnSummary;
    expect(
      plugin.formulaFor({ sourceColumn: 0, destinationColumn: 2, destinationRow: 2, type: 'max' }),
    ).toBe('=MAX(A1:A5)');
  });

  it('substitutes the range into a custom formula', async () => {
    const grid = await makeGrid({ columnSummary: [] });
    const plugin = grid.getPlugin('columnSummary') as unknown as ColumnSummary;
    expect(
      plugin.formulaFor({
        sourceColumn: 0,
        destinationRow: 4,
        type: 'custom',
        customFunction: 'SUMPRODUCT({{range}},{{range}})',
      }),
    ).toBe('=SUMPRODUCT(A1:A4,A1:A4)');
  });
});

describe('exporting', () => {
  it('quotes only the fields that need it', () => {
    expect(escapeCsvValue('plain', ',')).toBe('plain');
    expect(escapeCsvValue('a,b', ',')).toBe('"a,b"');
    expect(escapeCsvValue('a;b', ',')).toBe('a;b');
    expect(escapeCsvValue('say "hi"', ',')).toBe('"say ""hi"""');
    expect(escapeCsvValue(' padded ', ',')).toBe('" padded "');
  });

  it('writes the values as they are shown', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, '1'],
      [0, 1, 'a,b'],
      [1, 0, '=A1+1'],
      [1, 1, 'plain'],
    ]);
    const plugin = grid.getPlugin('exportFile') as unknown as ExportFile;
    expect(plugin.exportAsString('csv')).toBe('1,"a,b"\r\n2,plain');
  });

  it('includes the headers when asked', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 2 });
    grid.setDataAtCell(0, 0, 'v');
    const plugin = grid.getPlugin('exportFile') as unknown as ExportFile;
    expect(plugin.exportAsString('csv', { columnHeaders: true, rowHeaders: true })).toBe(
      ',A,B\r\n1,v,',
    );
  });

  it('leaves out hidden columns unless told otherwise', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 3, hiddenColumns: { columns: [1] } });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [0, 2, 'c'],
    ]);
    const plugin = grid.getPlugin('exportFile') as unknown as ExportFile;
    expect(plugin.exportAsString('csv')).toBe('a,c');
    expect(plugin.exportAsString('csv', { exportHiddenColumns: true })).toBe('a,b,c');
  });

  it('takes its delimiters from the options', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
    ]);
    const plugin = grid.getPlugin('exportFile') as unknown as ExportFile;
    expect(plugin.exportAsString('csv', { columnDelimiter: ';', rowDelimiter: '\n' })).toBe(
      'a;\nb;',
    );
  });

  it('hands the workbook itself to the engine rather than rebuilding it', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    grid.setDataAtCell(0, 0, '=1+1');
    const plugin = grid.getPlugin('exportFile') as unknown as ExportFile;
    const bytes = plugin.exportAsWorkbook();
    // A ZIP, which is what an .xlsx is.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });
});

describe('nested headers', () => {
  it('fills the columns a row does not reach', () => {
    expect(normalizeHeaders([[{ label: 'pair', colspan: 2 }]], 4)).toEqual([
      [
        { col: 0, colspan: 2, label: 'pair' },
        { col: 2, colspan: 1, label: '' },
        { col: 3, colspan: 1, label: '' },
      ],
    ]);
  });

  it('clips a span that runs past the last column', () => {
    expect(normalizeHeaders([[{ label: 'wide', colspan: 9 }]], 2)).toEqual([
      [{ col: 0, colspan: 2, label: 'wide' }],
    ]);
  });

  it('draws exactly the rows the settings describe', async () => {
    // The settings are the whole header, not the groups above one. A single
    // configured row means a single row of header — the reference appends no
    // row of column letters underneath, and neither does this.
    const grid = await makeGrid({
      nestedHeaders: [['A group', { label: 'B group', colspan: 3 }]],
    });
    expect(grid.countColHeaderLevels()).toBe(1);

    const plugin = grid.getPlugin('nestedHeaders') as unknown as NestedHeaders;
    const rows = plugin.rowsFor(0, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      { col: 0, colspan: 1, level: 0, label: 'A group' },
      { col: 1, colspan: 3, level: 0, label: 'B group' },
    ]);
  });

  it('draws a group above the columns when both rows are given', async () => {
    const grid = await makeGrid({
      nestedHeaders: [['A group', { label: 'B group', colspan: 3 }], ['A', 'B', 'C', 'D']],
    });
    expect(grid.countColHeaderLevels()).toBe(2);

    const plugin = grid.getPlugin('nestedHeaders') as unknown as NestedHeaders;
    const rows = plugin.rowsFor(0, 3);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.map((cell) => cell.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('clips a span to the window being drawn', async () => {
    const grid = await makeGrid({ nestedHeaders: [[{ label: 'all four', colspan: 4 }]] });
    const plugin = grid.getPlugin('nestedHeaders') as unknown as NestedHeaders;
    expect(plugin.rowsFor(1, 2)[0]).toEqual([
      { col: 1, colspan: 2, level: 0, label: 'all four' },
    ]);
  });

  it('spans the header cell in the DOM', async () => {
    const grid = await makeGrid({ nestedHeaders: [[{ label: 'group', colspan: 2 }]] });
    grid.render();
    const th = grid.view?.root.querySelector('th[data-level="0"][data-col="0"]');
    expect((th as HTMLTableCellElement | null)?.colSpan).toBe(2);
    expect(th?.textContent).toBe('group');
  });
});

describe('collapsible columns', () => {
  it('folds a group down to its first column and back', async () => {
    const grid = await makeGrid({
      nestedHeaders: [[{ label: 'group', colspan: 3 }, 'D']],
      collapsibleColumns: true,
      hiddenColumns: true,
    });
    const plugin = grid.getPlugin('collapsibleColumns') as unknown as CollapsibleColumns;
    expect(plugin.getGroups()).toEqual([{ level: 0, col: 0, colspan: 3, collapsed: false }]);

    plugin.collapse(0, 0);
    expect(grid.isColumnHidden(1)).toBe(true);
    expect(grid.isColumnHidden(2)).toBe(true);
    // The first column stays, so the group can be unfolded again.
    expect(grid.isColumnHidden(0)).toBe(false);

    plugin.expand(0, 0);
    expect(grid.isColumnHidden(1)).toBe(false);
  });

  it('leaves a column someone else hid alone', async () => {
    const grid = await makeGrid({
      nestedHeaders: [[{ label: 'group', colspan: 2 }]],
      collapsibleColumns: true,
      hiddenColumns: { columns: [3] },
    });
    const plugin = grid.getPlugin('collapsibleColumns') as unknown as CollapsibleColumns;
    plugin.collapse(0, 0);
    plugin.expand(0, 0);
    expect(grid.isColumnHidden(3)).toBe(true);
  });

  it('offers no control on a group of one column', async () => {
    const grid = await makeGrid({
      nestedHeaders: [['A', { label: 'rest', colspan: 3 }]],
      collapsibleColumns: true,
    });
    const plugin = grid.getPlugin('collapsibleColumns') as unknown as CollapsibleColumns;
    expect(plugin.isCollapsible(0, 0)).toBe(false);
    expect(plugin.isCollapsible(0, 1)).toBe(true);
  });

  it('honours a list of which cells may be folded', async () => {
    const grid = await makeGrid({
      nestedHeaders: [[{ label: 'a', colspan: 2 }, { label: 'b', colspan: 2 }]],
      collapsibleColumns: [{ row: 0, col: 2, collapsible: true }],
    });
    const plugin = grid.getPlugin('collapsibleColumns') as unknown as CollapsibleColumns;
    expect(plugin.isCollapsible(0, 0)).toBe(false);
    expect(plugin.isCollapsible(0, 2)).toBe(true);
  });

  it('puts a fold button in the header', async () => {
    const grid = await makeGrid({
      nestedHeaders: [[{ label: 'group', colspan: 2 }]],
      collapsibleColumns: true,
      hiddenColumns: true,
    });
    grid.render();
    const button = grid.view?.root.querySelector('button.cm-collapse') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('−');
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(grid.isColumnHidden(1)).toBe(true);
  });

  it('folds and unfolds every group at once', async () => {
    const grid = await makeGrid({
      nestedHeaders: [[{ label: 'a', colspan: 2 }, { label: 'b', colspan: 2 }]],
      collapsibleColumns: true,
      hiddenColumns: true,
    });
    const plugin = grid.getPlugin('collapsibleColumns') as unknown as CollapsibleColumns;
    plugin.collapseAll();
    expect(grid.isColumnHidden(1)).toBe(true);
    expect(grid.isColumnHidden(3)).toBe(true);
    plugin.expandAll();
    expect(grid.isColumnHidden(1)).toBe(false);
  });
});
