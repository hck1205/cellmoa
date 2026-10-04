/**
 * The keyboard, as a table and as arithmetic.
 *
 * Both used to live inside the method that registered them, so the only way to
 * ask "where does mod+End go" was to press it. These are the questions that
 * were being asked indirectly.
 */

import { describe, expect, it, vi } from 'vitest';
import { EDITOR_KEYS, coreKeymap, edgeTarget, mirror } from '../src/keymap.js';
import type { KeyActions } from '../src/keymap.js';

describe('where an edge jump lands', () => {
  const extent = { rows: 10, cols: 5 };
  const from = { row: 3, col: 2 };

  it('travels to the end of the sheet in the direction of the step', () => {
    expect(edgeTarget(from, { row: 1, col: 0 }, extent)).toEqual({ row: 9, col: 2 });
    expect(edgeTarget(from, { row: -1, col: 0 }, extent)).toEqual({ row: 0, col: 2 });
    expect(edgeTarget(from, { row: 0, col: 1 }, extent)).toEqual({ row: 3, col: 4 });
    expect(edgeTarget(from, { row: 0, col: -1 }, extent)).toEqual({ row: 3, col: 0 });
  });

  it('leaves the other axis where it was', () => {
    // `mod+left` travels along the row it is on; it does not go home.
    expect(edgeTarget({ row: 7, col: 4 }, { row: 0, col: -1 }, extent).row).toBe(7);
    expect(edgeTarget({ row: 7, col: 4 }, { row: -1, col: 0 }, extent).col).toBe(4);
  });

  it('stays inside a grid of one cell', () => {
    expect(edgeTarget({ row: 0, col: 0 }, { row: 1, col: 1 }, { rows: 1, cols: 1 })).toEqual({
      row: 0,
      col: 0,
    });
  });
});

describe('which way is left', () => {
  it('flips the column, and only the column, when the sheet reads right to left', () => {
    expect(mirror({ row: 1, col: -1 }, true)).toEqual({ row: 1, col: 1 });
    expect(mirror({ row: -1, col: 0 }, true)).toEqual({ row: -1, col: 0 });
  });

  it('leaves a left-to-right sheet alone', () => {
    const step = { row: 0, col: -1 };
    expect(mirror(step, false)).toBe(step);
  });
});

describe('the keymap', () => {
  /** Every action, recording which one the key reached. */
  function spies(): { actions: KeyActions; calls: string[] } {
    const calls: string[] = [];
    const note =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push(args.length ? `${name}(${JSON.stringify(args)})` : name);
      };
    const actions: KeyActions = {
      move: note('move'),
      extend: note('extend'),
      edge: note('edge'),
      selectAll: note('selectAll'),
      selectCell: note('selectCell'),
      selectRowOfHighlight: note('selectRow'),
      selectColumnOfHighlight: note('selectColumn'),
      lastCell: () => ({ row: 9, col: 4 }),
      pageSize: () => 20,
      enter: note('enter'),
      tab: vi.fn(() => false),
      beginEditing: note('beginEditing'),
      emptySelectedCells: note('empty'),
      deselectCell: note('deselect'),
      undo: note('undo'),
      redo: note('redo'),
    };
    return { actions, calls };
  }

  /** Runs the entry bound to a combination. */
  function press(keys: string[], actions: KeyActions): void {
    const entry = coreKeymap(actions).find(
      (shortcut) => shortcut.keys.some((combo) => combo.join('+') === keys.join('+')),
    );
    expect(entry, `no shortcut for ${keys.join('+')}`).toBeDefined();
    entry!.callback(new KeyboardEvent('keydown'));
  }

  it('binds no combination twice', () => {
    const seen = new Set<string>();
    for (const shortcut of coreKeymap(spies().actions)) {
      for (const combo of shortcut.keys) {
        const key = combo.join('+');
        expect(seen.has(key), `${key} is bound twice`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('sends the arrows to move, and shift+arrows to extend', () => {
    const { actions, calls } = spies();
    press(['arrowdown'], actions);
    press(['shift', 'arrowright'], actions);
    expect(calls).toEqual([
      'move([{"row":1,"col":0}])',
      'extend([{"row":0,"col":1}])',
    ]);
  });

  it('sends mod+arrows to the edge, and mod+shift+arrows to the edge extending', () => {
    const { actions, calls } = spies();
    press(['mod', 'arrowup'], actions);
    press(['mod', 'shift', 'arrowup'], actions);
    expect(calls).toEqual([
      'edge([{"row":-1,"col":0},false])',
      'edge([{"row":-1,"col":0},true])',
    ]);
  });

  it('reads the page size when the key is pressed, not when the map is built', () => {
    const { actions, calls } = spies();
    let size = 5;
    actions.pageSize = () => size;
    const map = coreKeymap(actions);
    const pageDown = map.find((s) => s.keys[0]?.[0] === 'pagedown')!;
    size = 30;
    pageDown.callback(new KeyboardEvent('keydown'));
    // How many rows fit changes with the window, so a size captured at build
    // time would be the size the grid had when it started.
    expect(calls).toEqual(['move([{"row":30,"col":0}])']);
  });

  it('sends mod+End to the last cell the grid has', () => {
    const { actions, calls } = spies();
    press(['mod', 'end'], actions);
    expect(calls).toEqual(['selectCell([9,4])']);
  });

  it('gives the editor the keys it has to answer first', () => {
    expect(EDITOR_KEYS.map((combo) => combo.join('+'))).toEqual([
      'enter',
      'shift+enter',
      'tab',
      'shift+tab',
      'escape',
      'alt+enter',
    ]);
  });
});
