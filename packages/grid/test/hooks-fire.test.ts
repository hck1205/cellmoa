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
