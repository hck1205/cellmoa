import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import { Menu, SEPARATOR, resolve } from '../src/menu.js';
import type { MenuItem } from '../src/menu.js';
import type { ContextMenu, DropdownMenu } from '../src/plugins/index.js';
import { DEFAULT_CONTEXT_MENU, ITEM, buildMenu } from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 4, startCols: 3, ...settings }).then((m) => m.grid);

/** The labels the menu is showing, separators included as a dash. */
function labels(root: HTMLElement | null): string[] {
  return [...(root?.children ?? [])].map((child) =>
    child.classList.contains('cm-menu-separator') ? '-' : (child.textContent ?? ''),
  );
}

describe('the menu widget', () => {
  it('resolves a value that was given as a function', () => {
    expect(resolve('plain', 'fallback')).toBe('plain');
    expect(resolve(() => 'computed', 'fallback')).toBe('computed');
    expect(resolve(undefined, 'fallback')).toBe('fallback');
  });

  it('draws items, separators and disabled entries', () => {
    const menu = new Menu({ document, selection: () => [] });
    menu.open(
      [
        { key: 'a', name: 'First' },
        { key: SEPARATOR },
        { key: 'b', name: 'Second', disabled: true },
        { key: 'c', name: 'Ticked', checked: true },
      ],
      10,
      20,
    );
    expect(labels(menu.element)).toEqual(['First', '-', 'Second', 'Ticked']);
    expect(menu.element?.querySelector('[data-key="b"]')?.className).toContain('disabled');
    expect(menu.element?.querySelector('[data-key="c"]')?.getAttribute('aria-checked')).toBe('true');
    menu.close();
    expect(menu.isOpen).toBe(false);
  });

  it('leaves out an item that says it is hidden', () => {
    const menu = new Menu({ document, selection: () => [] });
    menu.open([{ key: 'a', name: 'Shown' }, { key: 'b', name: 'Gone', hidden: () => true }], 0, 0);
    expect(labels(menu.element)).toEqual(['Shown']);
  });

  it('runs an item and closes, but does nothing for a disabled one', () => {
    const ran: string[] = [];
    const menu = new Menu({ document, selection: () => [] });
    menu.open(
      [
        { key: 'go', name: 'Go', callback: (key) => ran.push(key) },
        { key: 'no', name: 'No', disabled: true, callback: (key) => ran.push(key) },
      ],
      0,
      0,
    );
    (menu.element?.querySelector('[data-key="no"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    expect(ran).toEqual([]);
    expect(menu.isOpen).toBe(true);

    (menu.element?.querySelector('[data-key="go"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    expect(ran).toEqual(['go']);
    expect(menu.isOpen).toBe(false);
  });

  it('closes when something else is clicked', () => {
    const menu = new Menu({ document, selection: () => [] });
    menu.open([{ key: 'a', name: 'A' }], 0, 0);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu.isOpen).toBe(false);
  });

  it('opens a submenu on hover and closes everything when it is used', () => {
    const ran: string[] = [];
    const menu = new Menu({ document, selection: () => [] });
    menu.open(
      [
        {
          key: 'parent',
          name: 'Parent',
          submenu: { items: [{ key: 'child', name: 'Child', callback: (k) => ran.push(k) }] },
        },
      ],
      0,
      0,
    );
    const parent = menu.element?.querySelector('[data-key="parent"]') as HTMLElement;
    parent.dispatchEvent(new MouseEvent('mouseenter'));
    const child = document.querySelector('[data-key="child"]') as HTMLElement;
    expect(child).not.toBeNull();
    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ran).toEqual(['child']);
    expect(menu.isOpen).toBe(false);
  });

  it('does nothing when a parent item itself is chosen', () => {
    const menu = new Menu({ document, selection: () => [] });
    const item: MenuItem = { key: 'parent', name: 'Parent', submenu: { items: [{ key: 'x' }] } };
    menu.open([item], 0, 0);
    menu.execute(item, new Event('test'));
    expect(menu.isOpen).toBe(true);
  });
});

describe('building a menu from settings', () => {
  const available: Record<string, MenuItem> = {
    a: { key: 'a', name: 'A' },
    b: { key: 'b', name: 'B' },
  };

  it('takes the defaults for `true`', () => {
    expect(buildMenu(true, available, ['b', 'a']).map((item) => item.key)).toEqual(['b', 'a']);
  });

  it('takes a list of keys in the order given', () => {
    expect(buildMenu(['a'], available, ['b', 'a']).map((item) => item.key)).toEqual(['a']);
  });

  it('drops a key that names no command', () => {
    // Which commands exist depends on which plugins are on; a dead entry would
    // be a menu item that does nothing.
    expect(buildMenu(['a', 'nonexistent'], available, []).map((item) => item.key)).toEqual(['a']);
  });

  it('keeps separators wherever they were put', () => {
    expect(buildMenu(['a', SEPARATOR, 'b'], available, []).map((item) => item.key)).toEqual([
      'a',
      SEPARATOR,
      'b',
    ]);
  });

  it('lets an object override a built-in or define a new command', () => {
    const items = buildMenu(
      { items: { a: { name: 'Renamed' }, custom: { name: 'Mine' } } },
      available,
      [],
    );
    expect(items.map((item) => [item.key, item.name])).toEqual([
      ['a', 'Renamed'],
      ['custom', 'Mine'],
    ]);
  });
});

describe('the contextMenu plugin', () => {
  it('is off unless the settings ask for it', async () => {
    const grid = await makeGrid();
    expect(grid.isPluginEnabled('contextMenu')).toBe(false);
  });

  it('shows the default commands', async () => {
    const grid = await makeGrid({ contextMenu: true });
    const plugin = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    expect(plugin.getItems().map((item) => item.key)).toEqual(DEFAULT_CONTEXT_MENU);
  });

  it('inserts a row when the command is run', async () => {
    const grid = await makeGrid({ contextMenu: true });
    grid.setDataAtCells([
      [0, 0, 'top'],
      [1, 0, 'below'],
    ]);
    grid.selectCell(1, 0);
    const plugin = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    plugin.open(0, 0);
    plugin.executeCommand(ITEM.rowAbove);
    expect(grid.getDataAtCell(1, 0)).toBe('');
    expect(grid.getDataAtCell(2, 0)).toBe('below');
  });

  it('names the command for how much is selected', async () => {
    const grid = await makeGrid({ contextMenu: true });
    const plugin = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    grid.selectCell(0, 0);
    const single = plugin.getItems().find((item) => item.key === ITEM.removeRow);
    expect(resolve(single?.name, '')).toBe('Remove row');
    grid.selectCell(0, 0, 2, 0);
    const many = plugin.getItems().find((item) => item.key === ITEM.removeRow);
    expect(resolve(many?.name, '')).toBe('Remove rows');
  });

  it('greys out undo when there is nothing to undo', async () => {
    const grid = await makeGrid({ contextMenu: true });
    const plugin = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    const undoOf = () => plugin.getItems().find((item) => item.key === ITEM.undo);
    expect(resolve(undoOf()?.disabled, false)).toBe(true);
    grid.setDataAtCell(0, 0, 'something');
    expect(resolve(undoOf()?.disabled, false)).toBe(false);
  });

  it('offers a merge command only when the plugin is on', async () => {
    const without = await makeGrid({ contextMenu: ['mergeCells'] });
    expect((without.getPlugin('contextMenu') as unknown as ContextMenu).getItems()).toEqual([]);

    const withIt = await makeGrid({ contextMenu: ['mergeCells'], mergeCells: true });
    expect(
      (withIt.getPlugin('contextMenu') as unknown as ContextMenu).getItems().map((i) => i.key),
    ).toEqual(['mergeCells']);
  });

  it('opens on a right-click and selects the cell under the pointer', async () => {
    const grid = await makeGrid({ contextMenu: true });
    grid.selectCell(0, 0);
    const cell = grid.view?.elementAt(2, 1);
    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(grid.getSelectedRangeLast()?.topRow).toBe(2);
    expect(grid.getSelectedRangeLast()?.startCol).toBe(1);
    expect(document.querySelector('.cm-menu')).not.toBeNull();
  });

  it('leaves a selection alone when the click is inside it', async () => {
    const grid = await makeGrid({ contextMenu: true });
    grid.selectCell(0, 0, 2, 2);
    grid.view?.elementAt(1, 1)?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(grid.getSelectedRangeLast()?.bottomRow).toBe(2);
  });

  it('lets a hook veto the menu', async () => {
    const grid = await makeGrid({ contextMenu: true });
    grid.addHook('beforeContextMenuShow', () => false);
    (grid.getPlugin('contextMenu') as unknown as ContextMenu).open(0, 0);
    expect(document.querySelector('.cm-menu')).toBeNull();
  });

  it('sets an alignment class without clearing the other axis', async () => {
    const grid = await makeGrid({ contextMenu: true });
    grid.selectCell(0, 0);
    grid.setAlignment({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, 'htRight');
    grid.setAlignment({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, 'htMiddle');
    expect(grid.getCellMeta(0, 0)['className']).toBe('htRight htMiddle');
    // Changing one axis replaces only that axis.
    grid.setAlignment({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, 'htLeft');
    expect(grid.getCellMeta(0, 0)['className']).toBe('htMiddle htLeft');
  });

  it('offers to take back an agent’s change, and only then', async () => {
    const grid = await makeGrid({ contextMenu: true });
    const plugin = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    const agentUndo = () => plugin.getItems().find((item) => item.key === ITEM.undoAgent);

    grid.setDataAtCell(0, 0, 'by a person');
    // Nothing an agent did, so the command is not offered at all.
    expect(agentUndo()).toBeUndefined();

    const agentGrid = await makeGrid({
      contextMenu: [ITEM.undoAgent],
      actor: { kind: 'agent', id: 'assistant-1' },
      engine: grid.engine,
    });
    agentGrid.setDataAtCell(1, 0, 'by an agent');
    const agentPlugin = agentGrid.getPlugin('contextMenu') as unknown as ContextMenu;
    expect(agentPlugin.getItems().map((item) => item.key)).toEqual([ITEM.undoAgent]);

    agentPlugin.executeCommand(ITEM.undoAgent);
    expect(agentGrid.getDataAtCell(1, 0)).toBe('');
    // The person's edit is untouched.
    expect(agentGrid.getDataAtCell(0, 0)).toBe('by a person');
  });
});

describe('the dropdownMenu plugin', () => {
  it('puts a button on the column header and opens the column commands', async () => {
    const grid = await makeGrid({ dropdownMenu: true });
    grid.render();
    const button = grid.view?.root.querySelector('button.cm-dropdown') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.cm-menu')).not.toBeNull();
    // Opening it selects the column the commands act on.
    expect(grid.getSelectedRangeLast()?.startCol).toBe(0);
  });

  it('removes the column it was opened from', async () => {
    const grid = await makeGrid({ dropdownMenu: true });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [0, 1, 'b'],
    ]);
    const plugin = grid.getPlugin('dropdownMenu') as unknown as DropdownMenu;
    plugin.openForColumn(0);
    plugin.executeCommand(ITEM.removeColumn);
    expect(grid.getDataAtCell(0, 0)).toBe('b');
  });

  it('clears a column without removing it', async () => {
    const grid = await makeGrid({ dropdownMenu: true });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
      [0, 1, 'keep'],
    ]);
    const plugin = grid.getPlugin('dropdownMenu') as unknown as DropdownMenu;
    plugin.openForColumn(0);
    plugin.executeCommand(ITEM.clearColumn);
    expect(grid.getDataAtCell(0, 0)).toBe('');
    expect(grid.getDataAtCell(1, 0)).toBe('');
    expect(grid.getDataAtCell(0, 1)).toBe('keep');
  });

  it('sorts from the header menu when sorting is on', async () => {
    const grid = await makeGrid({ dropdownMenu: true, columnSorting: true });
    grid.setDataAtCells([
      [0, 0, 'banana'],
      [1, 0, 'apple'],
      [2, 0, 'cherry'],
    ]);
    const plugin = grid.getPlugin('dropdownMenu') as unknown as DropdownMenu;
    plugin.openForColumn(0);
    plugin.executeCommand(ITEM.sortAscending);
    expect(grid.getDataAtCell(0, 0)).toBe('apple');
  });
});

describe('what both menus share', () => {
  it('runs the `callback` setting for either of them', async () => {
    // The two menus used to be separate copies of the same code, and only one
    // of them honoured `callback`. A dropdown menu that quietly ignored the
    // setting looked exactly like a menu whose command did nothing.
    for (const which of ['contextMenu', 'dropdownMenu'] as const) {
      const seen: string[] = [];
      const grid = await makeGrid({
        startRows: 3,
        startCols: 3,
        [which]: { items: ['row_above'], callback: (key: string) => seen.push(key) },
      });
      const plugin = grid.getPlugin(which) as unknown as {
        executeCommand(key: string): void;
      };
      grid.selectCell(1, 1);
      plugin.executeCommand('row_above');
      expect(seen).toEqual(['row_above']);
    }
  });

  it('refuses a command the settings did not offer, in either of them', async () => {
    for (const which of ['contextMenu', 'dropdownMenu'] as const) {
      const grid = await makeGrid({ startRows: 3, startCols: 3, [which]: { items: ['row_above'] } });
      const before = grid.countRows();
      const plugin = grid.getPlugin(which) as unknown as {
        executeCommand(key: string): void;
      };
      grid.selectCell(1, 1);
      plugin.executeCommand('remove_row');
      expect(grid.countRows()).toBe(before);
    }
  });
});
