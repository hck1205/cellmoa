/**
 * The plugin lifecycle.
 *
 * `updateSettings` used to rebuild every plugin on every call, which meant
 * changing the grid's height threw away the reader's sort. A plugin says which
 * settings concern it, and is left alone otherwise — that is what these tests
 * are about, and the first one is the bug that prompted them.
 */

import { describe, expect, it, vi } from 'vitest';
import { makeGrid } from './helpers.js';
import { BasePlugin, registerPlugin } from '../src/plugins/base.js';
import type { ColumnSorting } from '../src/plugins/columnSorting.js';

describe('a setting a plugin does not care about', () => {
  it('leaves a sort standing', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2, columnSorting: true });
    grid.setDataAtCells([
      [0, 0, 'c'],
      [1, 0, 'a'],
      [2, 0, 'b'],
      [3, 0, 'd'],
    ]);
    const sorting = grid.getPlugin('columnSorting') as unknown as ColumnSorting;
    sorting.sort({ column: 0, sortOrder: 'asc' });
    expect(grid.getDataAtCell(0, 0)).toBe('a');

    // Someone changing how tall the grid is has not asked to un-sort it.
    grid.updateSettings({ height: 500 });
    expect(grid.getDataAtCell(0, 0)).toBe('a');
    expect(sorting.getSortConfig()).toEqual([{ column: 0, sortOrder: 'asc' }]);
  });

  it('leaves the filters standing', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 2, filters: true });
    grid.setDataAtCells([
      [0, 0, 'keep'],
      [1, 0, 'drop'],
      [2, 0, 'keep'],
      [3, 0, 'drop'],
    ]);
    const filters = grid.getPlugin('filters') as unknown as {
      addCondition(col: number, name: string, args: unknown[]): void;
      filter(): void;
    };
    filters.addCondition(0, 'contains', ['keep']);
    filters.filter();
    const visible = grid.countRows();

    grid.updateSettings({ colHeaders: false });
    expect(grid.countRows()).toBe(visible);
  });
});

describe('a setting a plugin does care about', () => {
  it('switches a feature on after the grid was built', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    expect(grid.isPluginEnabled('contextMenu')).toBe(false);
    grid.updateSettings({ contextMenu: true });
    expect(grid.isPluginEnabled('contextMenu')).toBe(true);
  });

  it('switches it off again', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 2, contextMenu: true });
    expect(grid.isPluginEnabled('contextMenu')).toBe(true);
    grid.updateSettings({ contextMenu: false });
    expect(grid.isPluginEnabled('contextMenu')).toBe(false);
  });

  it('re-reads a setting that is not the plugin’s own name', async () => {
    // `undoRedo` reads `undo`, so a payload naming `undo` has to reach it.
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    expect(grid.isPluginEnabled('undoRedo')).toBe(true);
    grid.updateSettings({ undo: false });
    expect(grid.isPluginEnabled('undoRedo')).toBe(false);
  });

  it('switches the data provider off when a conflicting setting appears', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      dataProvider: { fetchRows: () => ({ rows: [], totalRows: 0 }) },
    });
    expect(grid.isPluginEnabled('dataProvider')).toBe(true);
    // The conflict is not the provider's own setting, and still has to reach it.
    grid.updateSettings({ manualRowMove: true });
    expect(grid.isPluginEnabled('dataProvider')).toBe(false);
    warn.mockRestore();
  });
});

describe('what a plugin declares', () => {
  it('defaults to its own name', () => {
    class Ordinary extends BasePlugin {
      static override readonly pluginName = 'ordinaryTestPlugin';
      override isEnabled(): boolean {
        return false;
      }
      protected override onEnable(): void {}
    }
    expect(Ordinary.settingKeys).toEqual(['ordinaryTestPlugin']);
  });

  it('is asked before the plugin is updated', async () => {
    const updates: string[] = [];
    class Watcher extends BasePlugin {
      static override readonly pluginName = 'watcherTestPlugin';
      static override get settingKeys(): string[] {
        return ['watcherTestPlugin', 'somethingElse'];
      }
      override isEnabled(): boolean {
        return true;
      }
      protected override onEnable(): void {}
      override updatePlugin(): void {
        updates.push('updated');
        super.updatePlugin();
      }
    }
    registerPlugin(Watcher as never);

    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    updates.length = 0;

    grid.updateSettings({ height: 300 });
    expect(updates).toEqual([]);

    grid.updateSettings({ somethingElse: 1 });
    expect(updates).toEqual(['updated']);
  });

  it('can ask to be updated on everything, or on nothing', async () => {
    class Always extends BasePlugin {
      static override readonly pluginName = 'alwaysTestPlugin';
      static override get settingKeys(): boolean {
        return true;
      }
      override isEnabled(): boolean {
        return true;
      }
      protected override onEnable(): void {}
    }
    class Never extends BasePlugin {
      static override readonly pluginName = 'neverTestPlugin';
      static override get settingKeys(): boolean {
        return false;
      }
      override isEnabled(): boolean {
        return true;
      }
      protected override onEnable(): void {}
    }
    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    const always = new Always(grid);
    const never = new Never(grid);
    expect(always.concernedBy({ anything: 1 })).toBe(true);
    expect(never.concernedBy({ neverTestPlugin: 1 })).toBe(false);
  });
});
