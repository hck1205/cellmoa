/**
 * The defects a documentation audit found: settings the guides describe that
 * the plugins never read, and plugins that undo one another's work.
 *
 * They are grouped by the guide that names them rather than by plugin, because
 * that is the order they were found in and the order a reader checking the
 * guides against the code would meet them again.
 */

import { describe, expect, it } from 'vitest';
import type { Grid } from '../src/grid.js';
import type {
  CollapsibleColumns,
  ColumnSorting,
  ColumnSummary,
  Filters,
  MergeCells,
  Pagination,
  TrimRows,
} from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 4, startCols: 4, ...settings }).then((m) => m.grid);

/** Writes one value per row into column 0, before anything trims the table. */
function fillColumn(grid: Grid, values: string[]): void {
  grid.setDataAtCells(values.map((value, row) => [row, 0, value] as [number, number, string]));
}

describe('one plugin trimming over another', () => {
  it('keeps the page a pager set when a filter runs', async () => {
    const grid = await makeGrid({ startRows: 12, startCols: 2, filters: true });
    fillColumn(
      grid,
      Array.from({ length: 12 }, (_, row) => (row % 2 === 0 ? 'keep' : 'drop')),
    );
    grid.updateSettings({ pagination: { pageSize: 4 } });
    expect(grid.countRows()).toBe(4);

    const filters = grid.getPlugin<Filters>('filters')!;
    filters.addCondition(0, 'eq', ['keep']);
    filters.filter();

    // Six rows pass, so the pager still has a page of four to show and a
    // second page behind it.
    expect(grid.countRows()).toBe(4);
    expect(grid.getDataAtCell(0, 0)).toBe('keep');
    expect(grid.getDataAtCell(3, 0)).toBe('keep');
    const pagination = grid.getPlugin<Pagination>('pagination')!;
    expect(pagination.countAllRows()).toBe(6);
    expect(pagination.countPages()).toBe(2);
  });

  it('lets a filter judge the rows a page is holding back', async () => {
    const grid = await makeGrid({ startRows: 12, startCols: 2, filters: true });
    fillColumn(
      grid,
      Array.from({ length: 12 }, (_, row) => (row < 4 ? 'drop' : 'keep')),
    );
    grid.updateSettings({ pagination: { pageSize: 4 } });
    // The first page is entirely made of rows the filter will reject, so a
    // filter that only looked at what is on screen would leave nothing.
    const filters = grid.getPlugin<Filters>('filters')!;
    filters.addCondition(0, 'eq', ['keep']);
    filters.filter();

    expect(grid.countRows()).toBe(4);
    expect(grid.getDataAtCell(0, 0)).toBe('keep');
  });

  it('gives back only the rows trimRows took', async () => {
    const grid = await makeGrid({ startRows: 12, startCols: 2, trimRows: true });
    fillColumn(
      grid,
      Array.from({ length: 12 }, (_, row) => String(row)),
    );
    const trim = grid.getPlugin<TrimRows>('trimRows')!;
    trim.trimRows([0]);
    grid.updateSettings({ pagination: { pageSize: 4 } });
    expect(grid.countRows()).toBe(4);

    trim.untrimAll();
    expect(grid.countRows()).toBe(4);
    expect(trim.getTrimmedRows()).toEqual([]);
  });

  it('lets a hook veto putting a trimmed row back', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2, trimRows: [1] });
    const trim = grid.getPlugin<TrimRows>('trimRows')!;
    expect(grid.countRows()).toBe(3);
    grid.addHook('beforeUntrimRow', () => false);
    trim.untrimRows([1]);
    expect(grid.countRows()).toBe(3);
    trim.untrimAll();
    expect(grid.countRows()).toBe(3);
  });
});

describe('collapsible columns, as the guide configures them', () => {
  it('counts the levels of a list entry upwards from the first table row', async () => {
    const grid = await makeGrid({
      startCols: 4,
      nestedHeaders: [
        [{ label: 'top', colspan: 4 }],
        [
          { label: 'a', colspan: 2 },
          { label: 'b', colspan: 2 },
        ],
      ],
      collapsibleColumns: [{ row: -2, col: 0, collapsible: true }],
    });
    const plugin = grid.getPlugin<CollapsibleColumns>('collapsibleColumns')!;
    // `row: -2` is the second level counting up from the table, which is the
    // topmost of the two.
    expect(plugin.isCollapsible(0, 0)).toBe(true);
    expect(plugin.isCollapsible(1, 0)).toBe(false);
  });

  it('still reads a level counted from the top of the stack', async () => {
    const grid = await makeGrid({
      startCols: 4,
      nestedHeaders: [
        [
          { label: 'a', colspan: 2 },
          { label: 'b', colspan: 2 },
        ],
      ],
      collapsibleColumns: [{ row: 0, col: 2, collapsible: true }],
    });
    const plugin = grid.getPlugin<CollapsibleColumns>('collapsibleColumns')!;
    expect(plugin.isCollapsible(0, 2)).toBe(true);
    expect(plugin.isCollapsible(0, 0)).toBe(false);
  });

  it('lets a hook veto a collapse and an expand', async () => {
    const grid = await makeGrid({
      startCols: 4,
      nestedHeaders: [[{ label: 'group', colspan: 3 }, 'D']],
      collapsibleColumns: true,
      hiddenColumns: true,
    });
    const plugin = grid.getPlugin<CollapsibleColumns>('collapsibleColumns')!;
    const veto = () => false;
    grid.addHook('beforeColumnCollapse', veto);
    plugin.collapse(0, 0);
    expect(grid.isColumnHidden(1)).toBe(false);

    grid.removeHook('beforeColumnCollapse', veto);
    plugin.collapse(0, 0);
    expect(grid.isColumnHidden(1)).toBe(true);

    grid.addHook('beforeColumnExpand', veto);
    plugin.expand(0, 0);
    expect(grid.isColumnHidden(1)).toBe(true);
  });
});

describe('merged cells, as the guide configures them', () => {
  it('switches on for the object form and takes its cells', async () => {
    const grid = await makeGrid({
      startRows: 5,
      startCols: 5,
      mergeCells: { virtualized: true, cells: [{ row: 1, col: 1, rowspan: 2, colspan: 2 }] },
    });
    const plugin = grid.getPlugin<MergeCells>('mergeCells')!;
    expect(plugin.isPluginEnabled()).toBe(true);
    expect(plugin.getMergedAreas()).toEqual([{ row: 1, col: 1, rowspan: 2, colspan: 2 }]);
  });

  it('clears the covered cells of a merge declared in the settings', async () => {
    const { grid } = await mountGrid({ startRows: 5, startCols: 5 });
    grid.setDataAtCells([
      [0, 0, 'corner'],
      [0, 1, 'covered'],
      [1, 0, 'covered'],
    ]);
    grid.updateSettings({ mergeCells: [{ row: 0, col: 0, rowspan: 2, colspan: 2 }] });
    expect(grid.getDataAtCell(0, 0)).toBe('corner');
    expect(grid.getDataAtCell(0, 1)).toBe('');
    expect(grid.getDataAtCell(1, 0)).toBe('');
  });
});

describe('settings the guides describe and something has to read', () => {
  it('marks the headers next to a hidden row', async () => {
    const grid = await makeGrid({
      startRows: 4,
      startCols: 2,
      hiddenRows: { rows: [1], indicators: true },
    });
    grid.render();
    const header = (row: number) =>
      grid.view?.root.querySelector(`th.cm-row-header[data-row="${row}"]`);
    expect(header(0)?.classList.contains('cm-before-hidden')).toBe(true);
    expect(header(2)?.classList.contains('cm-after-hidden')).toBe(true);
    expect(header(3)?.classList.contains('cm-after-hidden')).toBe(false);
  });

  it('draws no indicator when the setting does not ask for one', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2, hiddenRows: { rows: [1] } });
    grid.render();
    const header = grid.view?.root.querySelector('th.cm-row-header[data-row="0"]');
    expect(header?.classList.contains('cm-before-hidden')).toBe(false);
  });

  it('marks the headers next to a hidden column', async () => {
    const grid = await makeGrid({
      startRows: 2,
      startCols: 4,
      hiddenColumns: { columns: [1], indicators: true },
    });
    grid.render();
    const header = (col: number) =>
      grid.view?.root.querySelector(`th.cm-col-header[data-col="${col}"]`);
    expect(header(0)?.classList.contains('cm-before-hidden')).toBe(true);
    expect(header(2)?.classList.contains('cm-after-hidden')).toBe(true);
  });

  it('draws the pager into a container of the page’s choosing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const grid = await makeGrid({
      startRows: 12,
      startCols: 2,
      pagination: { pageSize: 4, uiContainer: container },
    });
    const plugin = grid.getPlugin<Pagination>('pagination')!;
    expect(plugin.pager?.parentElement).toBe(container);
    expect(grid.view?.root.querySelector('.cm-pagination')).toBeNull();
  });

  it('offers a page-size selector, and leaves it out when told to', async () => {
    const grid = await makeGrid({
      startRows: 12,
      startCols: 2,
      pagination: { pageSize: 4, pageSizeList: [4, 8] },
    });
    const plugin = grid.getPlugin<Pagination>('pagination')!;
    const select = plugin.pager?.querySelector('select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual(['4', '8']);
    select!.value = '8';
    select!.dispatchEvent(new Event('change'));
    expect(plugin.getCurrentPageSize()).toBe(8);

    const plain = await makeGrid({
      startRows: 12,
      startCols: 2,
      pagination: { pageSize: 4, showPageSize: false },
    });
    expect(plain.getPlugin<Pagination>('pagination')!.pager?.querySelector('select')).toBeNull();
  });

  it('leaves the sort arrow off when the indicator is switched off', async () => {
    const grid = await makeGrid({
      startRows: 4,
      startCols: 2,
      columnSorting: { indicator: false, initialConfig: { column: 0, sortOrder: 'asc' } },
    });
    expect(grid.getColHeader(0)).not.toContain('▲');

    const shown = await makeGrid({
      startRows: 4,
      startCols: 2,
      columnSorting: { initialConfig: { column: 0, sortOrder: 'asc' } },
    });
    expect(shown.getColHeader(0)).toContain('▲');
  });

  it('takes headerAction from the column it was written on', async () => {
    const grid = await makeGrid({
      startRows: 4,
      startCols: 2,
      columnSorting: true,
      columns: [{ columnSorting: { headerAction: false } }, {}],
    });
    const plugin = grid.getPlugin<ColumnSorting>('columnSorting')!;
    grid.render();
    // Driven through the hook the plugin listens on rather than through a real
    // click: a click on a header does not reach `afterOnCellMouseDown` at all,
    // which is a defect of its own and not this one.
    const press = (col: number) => {
      const target = grid.view?.root.querySelector(`th.cm-col-header[data-col="${col}"]`);
      grid.hooks.notify('afterOnCellMouseDown', { target }, { row: -1, col });
    };
    press(0);
    expect(plugin.isSorted(0)).toBe(false);
    press(1);
    expect(plugin.isSorted(1)).toBe(true);
  });
});

describe('a column summary written the way the guide writes it', () => {
  it('says what is wrong instead of throwing from a render', async () => {
    await expect(
      makeGrid({
        startRows: 4,
        startCols: 2,
        columnSummary: [
          {
            sourceColumn: 0,
            destinationRow: 3,
            type: 'custom',
            customFunction: (endpoint: unknown) => endpoint,
          },
        ],
      }),
    ).rejects.toThrow(/customFunction must be a formula template/);
  });

  it('rounds to whole numbers when roundFloat is true', async () => {
    const grid = await makeGrid({
      startRows: 4,
      startCols: 2,
      columnSummary: [{ sourceColumn: 0, destinationRow: 3, roundFloat: true }],
    });
    const plugin = grid.getPlugin<ColumnSummary>('columnSummary')!;
    expect(plugin.formulaFor(plugin.getSpecs()[0]!)).toBe('=ROUND(SUM(A1:A3),0)');
  });

  it('does not round when roundFloat is false', async () => {
    const grid = await makeGrid({
      startRows: 4,
      startCols: 2,
      columnSummary: [{ sourceColumn: 0, destinationRow: 3, roundFloat: false }],
    });
    const plugin = grid.getPlugin<ColumnSummary>('columnSummary')!;
    expect(plugin.formulaFor(plugin.getSpecs()[0]!)).toBe('=SUM(A1:A3)');
  });
});
