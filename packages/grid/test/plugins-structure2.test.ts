import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import type {
  BindRowsWithHeaders,
  CustomBorders,
  DataProvider,
  DragToScroll,
  MoveCells,
  MultipleSelectionHandles,
  NestedRows,
  Pagination,
  SelectionHandles,
  TouchScroll,
} from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 6, startCols: 3, ...settings }).then((m) => m.grid);

describe('the pagination plugin', () => {
  it('shows one page at a time without touching the data', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 } });
    const plugin = grid.getPlugin('pagination') as unknown as Pagination;

    expect(grid.countRows()).toBe(2);
    expect(plugin.countPages()).toBe(3);
    expect(plugin.getCurrentPage()).toBe(1);

    plugin.nextPage();
    expect(plugin.getCurrentPage()).toBe(2);
    expect(grid.countRows()).toBe(2);
  });

  it('leaves a formula reading a row on another page working', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 } });
    const plugin = grid.getPlugin('pagination') as unknown as Pagination;
    grid.setDataAtCell(0, 0, '7');
    plugin.setPage(2);
    // A2 is on page one, out of sight — but it is not gone, so this reads it.
    grid.setDataAtCell(0, 1, '=A1');
    expect(grid.getDataAtCell(0, 1)).toBe('7');
  });

  it('clamps a page number to the pages that exist', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 } });
    const plugin = grid.getPlugin('pagination') as unknown as Pagination;
    plugin.setPage(99);
    expect(plugin.getCurrentPage()).toBe(3);
    plugin.setPage(-5);
    expect(plugin.getCurrentPage()).toBe(1);
  });

  it('keeps the top row in view when the page size changes', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 } });
    const plugin = grid.getPlugin('pagination') as unknown as Pagination;
    plugin.setPage(3); // rows 4-5
    plugin.setPageSize(3);
    // Row 4 is now on page 2 of three-row pages.
    expect(plugin.getCurrentPage()).toBe(2);
  });

  it('reports what a pager needs to draw itself', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 4 } });
    const plugin = grid.getPlugin('pagination') as unknown as Pagination;
    plugin.setPage(2);
    const data = plugin.getPaginationData();
    expect(data.currentPage).toBe(2);
    expect(data.totalPages).toBe(2);
    expect(data.firstVisibleRowIndex).toBe(4);
    expect(data.lastVisibleRowIndex).toBe(5);
  });

  it('gives every row back when it is switched off', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 } });
    grid.updateSettings({ pagination: false });
    expect(grid.countRows()).toBe(6);
  });

  it('lets a hook veto a page change', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 } });
    grid.addHook('beforePageChange', () => false);
    const plugin = grid.getPlugin('pagination') as unknown as Pagination;
    plugin.nextPage();
    expect(plugin.getCurrentPage()).toBe(1);
  });
});

describe('the customBorders plugin', () => {
  it('outlines a selection rather than bordering every cell in it', async () => {
    const grid = await makeGrid({ customBorders: true });
    const plugin = grid.getPlugin('customBorders') as unknown as CustomBorders;
    grid.selectCell(0, 0, 1, 1);
    plugin.setBorders('all');

    expect(plugin.getBorder(0, 0)).toEqual({
      top: { width: 1, color: '#000' },
      left: { width: 1, color: '#000' },
    });
    expect(plugin.getBorder(1, 1)).toEqual({
      bottom: { width: 1, color: '#000' },
      right: { width: 1, color: '#000' },
    });
  });

  it('draws the border it recorded', async () => {
    const grid = await makeGrid({
      customBorders: [{ row: 0, col: 0, top: { width: 2, color: '#f00' } }],
    });
    grid.render();
    const cell = grid.view?.elementAt(0, 0);
    expect(cell?.style.borderTop).toBe('2px solid rgb(255, 0, 0)');
  });

  it('never changes what a formula reads', async () => {
    const grid = await makeGrid({ customBorders: true });
    grid.setDataAtCells([
      [0, 0, '4'],
      [1, 0, '=A1*2'],
    ]);
    grid.selectCell(0, 0);
    (grid.getPlugin('customBorders') as unknown as CustomBorders).setBorders('all');
    expect(grid.getDataAtCell(1, 0)).toBe('8');
  });

  it('takes borders off the selection and off everything', async () => {
    const grid = await makeGrid({ customBorders: true });
    const plugin = grid.getPlugin('customBorders') as unknown as CustomBorders;
    grid.selectCell(0, 0, 1, 1);
    plugin.setBorders('all');
    expect(plugin.getBorders()).toHaveLength(4);

    grid.selectCell(0, 0);
    plugin.clearBorders();
    expect(plugin.getBorder(0, 0)).toBeNull();
    plugin.clearBorders(true);
    expect(plugin.getBorders()).toHaveLength(0);
  });

  it('borders one side only when told to', async () => {
    const grid = await makeGrid({ customBorders: true });
    const plugin = grid.getPlugin('customBorders') as unknown as CustomBorders;
    grid.selectCell(0, 0, 1, 0);
    plugin.setBorders('bottom');
    expect(plugin.getBorder(0, 0)).toBeNull();
    expect(plugin.getBorder(1, 0)).toEqual({ bottom: { width: 1, color: '#000' } });
  });
});

describe('the moveCells plugin', () => {
  it('moves a block and keeps its formulas pointing where they pointed', async () => {
    const grid = await makeGrid({ moveCells: true });
    grid.setDataAtCells([
      [0, 0, '5'],
      [0, 1, '=A1*2'],
    ]);
    const plugin = grid.getPlugin('moveCells') as unknown as MoveCells;
    plugin.moveCellRange({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }, 3, 1);

    // Moved, not copied: it is the same cell somewhere else, so it still reads A1.
    expect(grid.getSourceDataAtCell(3, 1)).toBe('=A1*2');
    expect(grid.getDataAtCell(3, 1)).toBe('10');
    expect(grid.getDataAtCell(0, 1)).toBe('');
  });

  it('shifts the references when the drag is a copy', async () => {
    const grid = await makeGrid({ moveCells: true });
    grid.setDataAtCells([
      [0, 0, '5'],
      [1, 0, '6'],
      [0, 1, '=A1*2'],
    ]);
    const plugin = grid.getPlugin('moveCells') as unknown as MoveCells;
    plugin.moveCellRange({ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }, 1, 1, true);

    expect(grid.getSourceDataAtCell(1, 1)).toBe('=A2*2');
    // The source is left where it was, because a copy copies.
    expect(grid.getSourceDataAtCell(0, 1)).toBe('=A1*2');
  });

  it('survives a target overlapping the source', async () => {
    const grid = await makeGrid({ moveCells: true });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
      [2, 0, 'c'],
    ]);
    const plugin = grid.getPlugin('moveCells') as unknown as MoveCells;
    plugin.moveCellRange({ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, 1, 0);
    expect([0, 1, 2, 3].map((row) => grid.getDataAtCell(row, 0))).toEqual(['', 'a', 'b', 'c']);
  });

  it('refuses a move that goes nowhere', async () => {
    const grid = await makeGrid({ moveCells: true });
    const plugin = grid.getPlugin('moveCells') as unknown as MoveCells;
    expect(plugin.moveCellRange({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, 0, 0)).toBe(
      false,
    );
  });

  it('lets a hook veto the move', async () => {
    const grid = await makeGrid({ moveCells: true });
    grid.setDataAtCell(0, 0, 'stays');
    grid.addHook('beforeMoveCells', () => false);
    const plugin = grid.getPlugin('moveCells') as unknown as MoveCells;
    expect(plugin.moveCellRange({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, 2, 0)).toBe(
      false,
    );
    expect(grid.getDataAtCell(0, 0)).toBe('stays');
  });
});

describe('scrolling plugins', () => {
  it('scrolls by exactly how far the pointer went past the edge', async () => {
    const grid = await makeGrid({ dragToScroll: true });
    const plugin = grid.getPlugin('dragToScroll') as unknown as DragToScroll;
    const moves: Array<[number, number]> = [];
    plugin.setBoundaries({ top: 0, bottom: 100, left: 0, right: 100 });
    plugin.setCallback((x, y) => moves.push([x, y]));

    // Inside the boundaries, nothing happens at all.
    plugin.check(50, 50);
    expect(moves).toEqual([]);

    plugin.check(120, 50);
    plugin.check(50, -30);
    expect(moves).toEqual([
      [20, 0],
      [0, -30],
    ]);
  });

  it('only watches between the press and the release', async () => {
    const grid = await makeGrid({ dragToScroll: true });
    const plugin = grid.getPlugin('dragToScroll') as unknown as DragToScroll;
    expect(plugin.isListening()).toBe(false);
    grid.view?.root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(plugin.isListening()).toBe(true);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(plugin.isListening()).toBe(false);
  });

  it('scrolls the view against the finger', async () => {
    const grid = await makeGrid({ touchScroll: true });
    const plugin = grid.getPlugin('touchScroll') as unknown as TouchScroll;
    const scroller = grid.view!.scroller;
    scroller.scrollTop = 100;
    scroller.scrollLeft = 50;

    const touch = (x: number, y: number) => [{ clientX: x, clientY: y } as Touch];
    grid.view?.root.dispatchEvent(
      Object.assign(new Event('touchstart', { bubbles: true }), { touches: touch(200, 200) }),
    );
    expect(plugin.isScrolling()).toBe(true);
    grid.view?.root.dispatchEvent(
      Object.assign(new Event('touchmove', { bubbles: true, cancelable: true }), {
        touches: touch(180, 150),
      }),
    );
    // The finger went up and left, so the content follows and the scroll grows.
    expect(scroller.scrollTop).toBe(150);
    expect(scroller.scrollLeft).toBe(70);

    grid.view?.root.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(plugin.isScrolling()).toBe(false);
  });
});

describe('selection handles', () => {
  it('puts one handle at the bottom-right of the selection', async () => {
    const grid = await makeGrid({ selectionHandles: true });
    grid.selectCell(0, 0, 1, 1);
    const plugin = grid.getPlugin('selectionHandles') as unknown as SelectionHandles;
    plugin.reposition();
    const handles = plugin.getHandles();
    expect(handles).toHaveLength(1);
    expect(handles[0]?.dataset['position']).toBe('bottom-right');
  });

  it('puts one at each end for touch, so a selection can grow upward', async () => {
    const grid = await makeGrid({ multipleSelectionHandles: true });
    grid.selectCell(1, 1, 2, 2);
    const plugin = grid.getPlugin('multipleSelectionHandles') as unknown as MultipleSelectionHandles;
    plugin.reposition();
    expect(plugin.getHandles().map((h) => h.dataset['position'])).toEqual([
      'top-left',
      'bottom-right',
    ]);
    expect(plugin.isDragged()).toBe(false);
  });

  it('takes the handles away when nothing is selected', async () => {
    const grid = await makeGrid({ selectionHandles: true });
    grid.selectCell(0, 0);
    const plugin = grid.getPlugin('selectionHandles') as unknown as SelectionHandles;
    plugin.reposition();
    expect(plugin.getHandles()).toHaveLength(1);
    grid.deselectCell();
    plugin.reposition();
    expect(plugin.getHandles()).toHaveLength(0);
  });
});

describe('the bindRowsWithHeaders plugin', () => {
  it('makes the header follow the row when it moves', async () => {
    const grid = await makeGrid({ bindRowsWithHeaders: true, manualRowMove: true });
    const move = grid.getPlugin('manualRowMove') as unknown as {
      moveIndexes(indexes: number[], target: number): boolean;
    };
    move.moveIndexes([2], 0);
    // Row 3 is now first, and it says so.
    expect(grid.getRowHeader(0)).toBe('3');
    expect(grid.getRowHeader(1)).toBe('1');
  });

  it('renumbers by position under the loose strategy', async () => {
    const grid = await makeGrid({ bindRowsWithHeaders: 'loose', manualRowMove: true });
    const move = grid.getPlugin('manualRowMove') as unknown as {
      moveIndexes(indexes: number[], target: number): boolean;
    };
    move.moveIndexes([2], 0);
    expect(grid.getRowHeader(0)).toBe('1');
  });
});

describe('the nestedRows plugin', () => {
  const tree = [{ row: 0, children: [{ row: 1, children: [{ row: 2 }] }, { row: 3 }] }];

  it('reports the depth of each row', async () => {
    const grid = await makeGrid({ nestedRows: tree });
    const plugin = grid.getPlugin('nestedRows') as unknown as NestedRows;
    expect(plugin.getRowLevel(0)).toBe(0);
    expect(plugin.getRowLevel(1)).toBe(1);
    expect(plugin.getRowLevel(2)).toBe(2);
    expect(plugin.hasChildren(1)).toBe(true);
    expect(plugin.hasChildren(3)).toBe(false);
  });

  it('collapses a parent, taking everything under it with it', async () => {
    const grid = await makeGrid({ nestedRows: tree });
    const plugin = grid.getPlugin('nestedRows') as unknown as NestedRows;
    expect(plugin.getDescendants(0)).toEqual([1, 2, 3]);

    plugin.collapse(0);
    expect(grid.countRows()).toBe(3); // row 0 plus the two rows outside the tree
    plugin.expand(0);
    expect(grid.countRows()).toBe(6);
  });

  it('does not reveal an inner fold when the outer one opens', async () => {
    const grid = await makeGrid({ nestedRows: tree });
    const plugin = grid.getPlugin('nestedRows') as unknown as NestedRows;
    plugin.collapse(1);
    plugin.collapse(0);
    plugin.expand(0);
    // Row 2 is under row 1, which is still folded.
    expect(plugin.isCollapsed(1)).toBe(true);
    expect(grid.countRows()).toBe(5);
  });

  it('leaves the values alone while a row is folded away', async () => {
    const grid = await makeGrid({ nestedRows: tree });
    grid.setDataAtCells([
      [2, 0, '9'],
      [5, 0, '=A3'],
    ]);
    expect(grid.getDataAtCell(5, 0)).toBe('9');

    const plugin = grid.getPlugin('nestedRows') as unknown as NestedRows;
    plugin.collapse(1);
    // Row 3 is out of the visual space now; the formula still reads it.
    expect(grid.getDataAtCell(grid.countRows() - 1, 0)).toBe('9');
  });

  it('puts a fold button on the row header of a parent', async () => {
    const grid = await makeGrid({ nestedRows: tree });
    grid.render();
    const buttons = grid.view?.root.querySelectorAll('button.cm-nested-toggle');
    expect(buttons?.length).toBe(2); // rows 0 and 1
  });
});

describe('the dataProvider plugin', () => {
  it('asks the source for a page and loads what comes back', async () => {
    const calls: unknown[] = [];
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      dataProvider: {
        pageSize: 2,
        data: (query: unknown) => {
          calls.push(query);
          return { rows: [['a', 'b'], ['c', 'd']], totalRows: 10 };
        },
      },
    });
    const plugin = grid.getPlugin('dataProvider') as unknown as DataProvider;
    await plugin.fetch();

    expect(calls[calls.length - 1]).toEqual({ page: 1, pageSize: 2, sort: null, filters: null });
    expect(grid.getDataAtCell(0, 0)).toBe('a');
    expect(grid.getDataAtCell(1, 1)).toBe('d');
    expect(plugin.getTotalRows()).toBe(10);
    expect(plugin.countPages()).toBe(5);
  });

  it('goes back to page one when the sort changes', async () => {
    const grid = await makeGrid({
      dataProvider: { pageSize: 2, data: () => ({ rows: [], totalRows: 10 }) },
    });
    const plugin = grid.getPlugin('dataProvider') as unknown as DataProvider;
    await plugin.setPage(3);
    await plugin.setSort({ column: 0, sortOrder: 'asc' });
    // The third page of a differently sorted list is not the same rows.
    expect(plugin.getQueryParameters().page).toBe(1);
  });

  it('reports a failed fetch rather than swallowing it', async () => {
    const errors: unknown[] = [];
    const grid = await makeGrid({
      dataProvider: {
        data: () => Promise.reject(new Error('network down')),
        onError: (error: unknown) => errors.push(error),
      },
    });
    const plugin = grid.getPlugin('dataProvider') as unknown as DataProvider;
    await plugin.fetch();
    expect((errors[0] as Error).message).toBe('network down');
    expect((plugin.getLastError() as Error).message).toBe('network down');
  });

  it('throws away an answer to a query it has moved on from', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    let call = 0;
    const grid = await makeGrid({
      startRows: 1,
      startCols: 1,
      dataProvider: {
        data: () => {
          call += 1;
          if (call === 1) {
            return new Promise((resolve) => {
              resolveFirst = resolve as (value: unknown) => void;
            }) as Promise<{ rows: string[][]; totalRows: number }>;
          }
          return Promise.resolve({ rows: [['second']], totalRows: 1 });
        },
      },
    });
    const plugin = grid.getPlugin('dataProvider') as unknown as DataProvider;
    const slow = plugin.fetch();
    await plugin.setPage(2);
    expect(grid.getDataAtCell(0, 0)).toBe('second');

    resolveFirst?.({ rows: [['first']], totalRows: 1 });
    await slow;
    // The stale answer does not overwrite the fresh one.
    expect(grid.getDataAtCell(0, 0)).toBe('second');
  });

  it('shows the loading overlay while it waits', async () => {
    // Every fetch's resolver is kept, including the one the plugin makes when
    // it starts: an overlay left up by a forgotten request is exactly the bug
    // the reference count exists to prevent.
    const waiting: Array<(result: { rows: string[][]; totalRows: number }) => void> = [];
    const grid = await makeGrid({
      loading: true,
      dataProvider: {
        data: () =>
          new Promise<{ rows: string[][]; totalRows: number }>((resolve) => {
            waiting.push(resolve);
          }),
      },
    });
    const plugin = grid.getPlugin('dataProvider') as unknown as DataProvider;
    const loading = grid.getPlugin('loading') as unknown as { isVisible(): boolean };
    const pending = plugin.fetch();
    expect(loading.isVisible()).toBe(true);

    for (const resolve of waiting) {
      resolve({ rows: [], totalRows: 0 });
    }
    await pending;
    await Promise.resolve();
    expect(loading.isVisible()).toBe(false);
  });

  it('lets a hook veto a fetch', async () => {
    const calls = vi.fn(() => ({ rows: [], totalRows: 0 }));
    const grid = await makeGrid({ dataProvider: { data: calls } });
    calls.mockClear();
    grid.addHook('beforeFetch', () => false);
    await (grid.getPlugin('dataProvider') as unknown as DataProvider).fetch();
    expect(calls).not.toHaveBeenCalled();
  });
});
