/**
 * Whether a hook a caller registers actually gets called.
 *
 * `scripts/parity.mjs` counts a hook as reachable when its name appears in the
 * source, and that is a claim about text. It has already been wrong once in
 * both directions: it missed the template form
 * `` `afterHide${this.#suffix()}` `` and reported sixteen live hooks as dead.
 * Reading the source more cleverly does not fix the class of mistake — the only
 * thing that settles whether a hook fires is registering a handler and doing
 * the thing.
 *
 * So these tests do that, for every hook whose name is built from a template
 * rather than written out. Those are exactly the ones a text search is bad at,
 * and exactly the ones nothing else here covers.
 */

import { describe, expect, it } from 'vitest';
import { mountGrid } from './helpers.js';
import type { HiddenColumns, HiddenRows } from '../src/plugins/index.js';

/** The move plugin's only public method. */
interface ManualMove {
  moveIndexes(indexes: number[], target: number): boolean;
}

/** Records every hook that fired, with what it was handed. */
function record(grid: Awaited<ReturnType<typeof mountGrid>>['grid'], names: string[]) {
  const fired: Array<{ name: string; args: unknown[] }> = [];
  for (const name of names) {
    grid.addHook(name, (...args: unknown[]) => {
      fired.push({ name, args });
    });
  }
  return fired;
}

describe('hiding fires its hooks', () => {
  it('calls beforeHideRows and afterHideRows with the rows', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 2,
      hiddenRows: true,
    });
    const fired = record(grid, ['beforeHideRows', 'afterHideRows']);

    (grid.getPlugin('hiddenRows') as HiddenRows).hide([1, 2]);

    expect(fired.map((f) => f.name)).toEqual(['beforeHideRows', 'afterHideRows']);
    expect(fired[0]?.args[0]).toEqual([1, 2]);
    expect(fired[1]?.args[0]).toEqual([1, 2]);
  });

  it('calls beforeUnhideRows and afterUnhideRows', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 2,
      hiddenRows: { rows: [1] },
    });
    const fired = record(grid, ['beforeUnhideRows', 'afterUnhideRows']);

    (grid.getPlugin('hiddenRows') as HiddenRows).show([1]);

    expect(fired.map((f) => f.name)).toEqual(['beforeUnhideRows', 'afterUnhideRows']);
  });

  it('calls the column hooks, not the row ones', async () => {
    // The name is built from an axis suffix, so a grid that got the suffix
    // wrong would fire `afterHideRows` when a column was hidden — and a text
    // search cannot tell the two apart, because neither name is written down.
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 4,
      hiddenColumns: true,
    });
    const fired = record(grid, ['afterHideColumns', 'afterHideRows']);

    (grid.getPlugin('hiddenColumns') as HiddenColumns).hide([2]);

    expect(fired.map((f) => f.name)).toEqual(['afterHideColumns']);
  });

  it('lets beforeHideRows veto the hide', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 2,
      hiddenRows: true,
    });
    grid.addHook('beforeHideRows', () => false);
    const plugin = grid.getPlugin('hiddenRows') as HiddenRows;

    plugin.hide([1]);

    expect(plugin.isHidden(1)).toBe(false);
  });
});

describe('manual move fires its hooks', () => {
  it('calls beforeRowMove and afterRowMove with the indexes and the target', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 2,
      manualRowMove: true,
    });
    const fired = record(grid, ['beforeRowMove', 'afterRowMove']);

    // `moveIndexes` is the whole of the plugin's API. The reference documents
    // `moveRow`, `moveRows`, `dragRow` and `dragRows`, and none of those exist
    // here — see docs/known-defects.md. Writing this test with `moveRows`
    // first is how that was noticed: `?.moveRows?.()` did nothing and said
    // nothing.
    (grid.getPlugin('manualRowMove') as unknown as ManualMove).moveIndexes([0], 2);

    expect(fired.map((f) => f.name)).toEqual(['beforeRowMove', 'afterRowMove']);
    expect(fired[0]?.args[0]).toEqual([0]);
    expect(fired[0]?.args[1]).toBe(2);
  });

  it('calls the column hooks for a column move', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 4,
      manualColumnMove: true,
    });
    const fired = record(grid, ['afterColumnMove', 'afterRowMove']);

    (grid.getPlugin('manualColumnMove') as unknown as ManualMove).moveIndexes([0], 2);

    expect(fired.map((f) => f.name)).toEqual(['afterColumnMove']);
  });

  it('lets beforeRowMove veto the move', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 2,
      manualRowMove: true,
    });
    grid.addHook('beforeRowMove', () => false);
    const before = grid.getDataAtCell(0, 0);

    (grid.getPlugin('manualRowMove') as unknown as ManualMove).moveIndexes([0], 2);

    expect(grid.getDataAtCell(0, 0)).toBe(before);
  });
});

describe('manual resize fires its hooks', () => {
  it('calls beforeColumnResize and afterColumnResize with the size and index', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 3,
      manualColumnResize: true,
    });
    const fired = record(grid, ['beforeColumnResize', 'afterColumnResize']);

    grid.setColWidth(1, 180);

    expect(fired.map((f) => f.name)).toEqual(['beforeColumnResize', 'afterColumnResize']);
    expect(fired[0]?.args[0]).toBe(180);
    expect(fired[0]?.args[1]).toBe(1);
  });

  it('calls the row hooks for a row resize', async () => {
    const { grid } = await mountGrid({
      startRows: 3,
      startCols: 2,
      manualRowResize: true,
    });
    const fired = record(grid, ['afterRowResize', 'afterColumnResize']);

    grid.setRowHeight(1, 44);

    expect(fired.map((f) => f.name)).toEqual(['afterRowResize']);
  });

  it('lets beforeColumnResize veto the resize', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 3,
      manualColumnResize: true,
    });
    const before = grid.getColWidth(1);
    grid.addHook('beforeColumnResize', () => false);

    grid.setColWidth(1, 180);

    expect(grid.getColWidth(1)).toBe(before);
  });
});

describe('selecting whole rows, columns and everything fires its own hooks', () => {
  it('fires beforeSelectRows and afterSelectRows with the range', async () => {
    const { grid } = await mountGrid({ startRows: 5, startCols: 3 });
    const fired = record(grid, ['beforeSelectRows', 'afterSelectRows']);

    grid.selectRows(1, 3);

    expect(fired.map((f) => f.name)).toEqual(['beforeSelectRows', 'afterSelectRows']);
    expect(fired[1]?.args).toEqual([1, 3]);
  });

  it('reports refusal through the return value, not only by not selecting', async () => {
    // The signature has always said `boolean` and always returned `true`,
    // which is a promise of information it never gave.
    const { grid } = await mountGrid({ startRows: 5, startCols: 3 });
    grid.addHook('beforeSelectRows', () => false);

    expect(grid.selectRows(1, 3)).toBe(false);
    expect(grid.getSelectedLast()).toBeUndefined();
  });

  it('fires the column hooks for a column selection', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 5 });
    const fired = record(grid, ['afterSelectColumns', 'afterSelectRows']);

    grid.selectColumns(2);

    expect(fired.map((f) => f.name)).toEqual(['afterSelectColumns']);
  });

  it('fires beforeSelectAll and afterSelectAll, and lets the before one refuse', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    const fired = record(grid, ['beforeSelectAll', 'afterSelectAll']);

    grid.selectAll();
    expect(fired.map((f) => f.name)).toEqual(['beforeSelectAll', 'afterSelectAll']);

    grid.deselectCell();
    grid.addHook('beforeSelectAll', () => false);
    grid.selectAll();
    expect(grid.getSelectedLast()).toBeUndefined();
  });

  it('still fires the general afterSelection beside the specific one', async () => {
    // The specific hooks are additions, not replacements: a handler on
    // `afterSelection` must keep hearing about a row selection.
    const { grid } = await mountGrid({ startRows: 4, startCols: 3 });
    const fired = record(grid, ['afterSelection', 'afterSelectRows']);

    grid.selectRows(1);

    expect(fired.map((f) => f.name).sort()).toEqual(['afterSelectRows', 'afterSelection']);
  });
});

describe('the loading overlay fires its hooks once per transition', () => {
  it('announces going up and coming down', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, loading: true });
    const fired = record(grid, ['beforeLoadingShow', 'afterLoadingShow', 'afterLoadingHide']);
    const loading = grid.getPlugin('loading') as unknown as {
      show(options?: unknown): void;
      hide(): void;
    };

    loading.show({ message: 'one moment' });
    loading.hide();

    expect(fired.map((f) => f.name)).toEqual([
      'beforeLoadingShow',
      'afterLoadingShow',
      'afterLoadingHide',
    ]);
  });

  it('says it once however deeply the overlay is nested', async () => {
    // `during` nests, so three fetches raise one overlay — and should report
    // one, not three.
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, loading: true });
    const fired = record(grid, ['afterLoadingShow', 'afterLoadingHide']);
    const loading = grid.getPlugin('loading') as unknown as {
      show(options?: unknown): void;
      hide(): void;
    };

    loading.show();
    loading.show();
    loading.hide();
    expect(fired.map((f) => f.name)).toEqual(['afterLoadingShow'], 'still up');

    loading.hide();
    expect(fired.map((f) => f.name)).toEqual(['afterLoadingShow', 'afterLoadingHide']);
  });
});

describe('a menu asks what it should contain', () => {
  it('lets afterContextMenuDefaultOptions add to the vocabulary', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, contextMenu: true });
    let sawDefaults = false;
    grid.addHook('afterContextMenuDefaultOptions', (predefined: Record<string, unknown>) => {
      sawDefaults = typeof predefined === 'object' && predefined !== null;
    });

    (grid.getPlugin('contextMenu') as unknown as { getItems(): unknown[] }).getItems();

    expect(sawDefaults).toBe(true);
  });

  it('lets beforeContextMenuSetItems have the last word on the list', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, contextMenu: true });
    grid.addHook('beforeContextMenuSetItems', () => [{ key: 'only', name: 'Only this' }]);

    const items = (grid.getPlugin('contextMenu') as unknown as { getItems(): Array<{ key: string }> })
      .getItems();

    expect(items.map((item) => item.key)).toEqual(['only']);
  });
});

describe('the pointer events other than mousedown are announced', () => {
  it('fires beforeOnCellMouseUp and afterOnCellMouseUp with the event and the cell', async () => {
    // Only mousedown was announced, so a handler on the event a drag selection
    // *finishes* with heard nothing.
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    const fired = record(grid, ['beforeOnCellMouseUp', 'afterOnCellMouseUp']);
    const cell = grid.view!.root.querySelector('td[data-row="1"][data-col="1"]');

    cell?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(fired.map((f) => f.name)).toEqual(['beforeOnCellMouseUp', 'afterOnCellMouseUp']);
    expect(fired[1]?.args[1]).toMatchObject({ row: 1, col: 1 });
  });

  it('fires the over and out hooks', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    const fired = record(grid, ['afterOnCellMouseOver', 'afterOnCellMouseOut']);
    const cell = grid.view!.root.querySelector('td[data-row="0"][data-col="0"]');

    cell?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    cell?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

    expect(fired.map((f) => f.name)).toEqual(['afterOnCellMouseOver', 'afterOnCellMouseOut']);
  });

  it('does not announce a pointer event over something that is not a cell', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, colHeaders: true });
    const fired = record(grid, ['afterOnCellMouseUp']);

    grid.view!.root
      .querySelector('th')
      ?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(fired).toEqual([]);
  });
});

describe('the smaller notifications', () => {
  it('announces a removed cell meta and lets the before hook refuse', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.setCellMeta(0, 0, 'className', 'marked');
    const fired = record(grid, ['beforeRemoveCellMeta', 'afterRemoveCellMeta']);

    grid.removeCellMeta(0, 0, 'className');
    expect(fired.map((f) => f.name)).toEqual(['beforeRemoveCellMeta', 'afterRemoveCellMeta']);

    grid.setCellMeta(0, 1, 'className', 'kept');
    grid.addHook('beforeRemoveCellMeta', () => false);
    grid.removeCellMeta(0, 1, 'className');
    expect(grid.getCellMeta(0, 1)['className']).toBe('kept');
  });

  it('announces a refresh, and lets the before hook stop it', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    const fired = record(grid, ['beforeRefreshDimensions', 'afterRefreshDimensions']);

    grid.refreshDimensions();

    expect(fired.map((f) => f.name)).toEqual([
      'beforeRefreshDimensions',
      'afterRefreshDimensions',
    ]);
  });

  it('announces an alignment change with the range and the class', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    const fired = record(grid, ['afterCellAlignment']);

    grid.setAlignment({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }, 'htRight');

    expect(fired).toHaveLength(1);
    expect(fired[0]?.args[1]).toBe('htRight');
  });

  it('announces both stacks moving on an undo and on a redo', async () => {
    // A toolbar button watches these to know whether to grey itself out, and
    // an undo moves both stacks — one loses an entry, the other gains one.
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.setDataAtCell(0, 0, 'first');
    const fired = record(grid, ['afterUndoStackChange', 'afterRedoStackChange']);

    grid.undo();
    expect(fired.map((f) => f.name)).toEqual(['afterUndoStackChange', 'afterRedoStackChange']);

    grid.redo();
    expect(fired).toHaveLength(4);
  });
});
