/**
 * What every key does, as a table.
 *
 * The map used to live inside the method that registered it, wrapped around
 * the three closures that build its callbacks — so seeing which key did what
 * meant reading past forty lines of navigation arithmetic first. A keyboard is
 * a thing a person needs to be able to read at a glance, and a table is how
 * you read one.
 *
 * The arithmetic that used to sit alongside it is here too, as functions that
 * take numbers and return numbers. It was reachable only through a synthetic
 * key event before, which is why the edges were tested by pressing keys rather
 * than by asking what the edge is.
 */

import type { Coords } from './settings.js';
import type { ShortcutOptions } from './shortcuts.js';

/** Where a `mod`+arrow lands: the far edge of the sheet in that direction. */
export function edgeTarget(
  from: Coords,
  step: Coords,
  extent: { rows: number; cols: number },
): Coords {
  return {
    // A step of zero on an axis means that axis does not move — `mod+left`
    // travels to column 0 and stays on its row.
    row: step.row === 0 ? from.row : step.row > 0 ? extent.rows - 1 : 0,
    col: step.col === 0 ? from.col : step.col > 0 ? extent.cols - 1 : 0,
  };
}

/**
 * Mirrors a horizontal step when the grid is laid out right to left.
 *
 * The arrow keys are about the screen, not about the data: in an RTL sheet the
 * leftward arrow moves toward the higher column number, because that is where
 * "left" is. Vertical movement is unaffected, so only the column is touched.
 */
export function mirror(step: Coords, isRtl: boolean): Coords {
  // `|| 0` because negating zero gives `-0`, which is a different value to
  // anything that compares with `Object.is` or writes the step out as JSON —
  // and a step that does not move sideways should not come back changed.
  return isRtl ? { row: step.row, col: -step.col || 0 } : step;
}

/** What the core keymap needs the grid to be able to do. */
export interface KeyActions {
  /** Moves the highlight by a step, wrapping if the settings allow it. */
  move(step: Coords): void;
  /** Moves the far edge of the selection, leaving the anchor. */
  extend(step: Coords): void;
  /** Jumps to the edge of the sheet, extending the selection or not. */
  edge(step: Coords, extending: boolean): void;
  selectAll(): void;
  selectCell(row: number, col: number): void;
  selectRowOfHighlight(): void;
  selectColumnOfHighlight(): void;
  lastCell(): Coords;
  /** How far a page-up or page-down goes. */
  pageSize(): number;
  enter(shift: boolean): void;
  tab(shift: boolean): boolean;
  beginEditing(): void;
  emptySelectedCells(): void;
  deselectCell(): void;
  undo(): void;
  redo(): void;
}

const UP: Coords = { row: -1, col: 0 };
const DOWN: Coords = { row: 1, col: 0 };
const LEFT: Coords = { row: 0, col: -1 };
const RIGHT: Coords = { row: 0, col: 1 };

/**
 * The keyboard, as Handsontable defines it.
 *
 * `pageSize` is read when the key is pressed rather than when the map is built,
 * because how many rows fit changes with the window.
 */
export function coreKeymap(actions: KeyActions): ShortcutOptions[] {
  return [
    { keys: [['arrowup']], callback: () => actions.move(UP) },
    { keys: [['arrowdown']], callback: () => actions.move(DOWN) },
    { keys: [['arrowleft']], callback: () => actions.move(LEFT) },
    { keys: [['arrowright']], callback: () => actions.move(RIGHT) },

    { keys: [['shift', 'arrowup']], callback: () => actions.extend(UP) },
    { keys: [['shift', 'arrowdown']], callback: () => actions.extend(DOWN) },
    { keys: [['shift', 'arrowleft']], callback: () => actions.extend(LEFT) },
    { keys: [['shift', 'arrowright']], callback: () => actions.extend(RIGHT) },

    { keys: [['mod', 'arrowup']], callback: () => actions.edge(UP, false) },
    { keys: [['mod', 'arrowdown']], callback: () => actions.edge(DOWN, false) },
    { keys: [['mod', 'arrowleft']], callback: () => actions.edge(LEFT, false) },
    { keys: [['mod', 'arrowright']], callback: () => actions.edge(RIGHT, false) },

    { keys: [['mod', 'shift', 'arrowup']], callback: () => actions.edge(UP, true) },
    { keys: [['mod', 'shift', 'arrowdown']], callback: () => actions.edge(DOWN, true) },
    { keys: [['mod', 'shift', 'arrowleft']], callback: () => actions.edge(LEFT, true) },
    { keys: [['mod', 'shift', 'arrowright']], callback: () => actions.edge(RIGHT, true) },

    // Home and End are the row's edges; with `mod` they are the sheet's.
    { keys: [['home']], callback: () => actions.edge(LEFT, false) },
    { keys: [['end']], callback: () => actions.edge(RIGHT, false) },
    { keys: [['mod', 'home']], callback: () => actions.selectCell(0, 0) },
    {
      keys: [['mod', 'end']],
      callback: () => {
        const last = actions.lastCell();
        actions.selectCell(last.row, last.col);
      },
    },

    { keys: [['pageup']], callback: () => actions.move({ row: -actions.pageSize(), col: 0 }) },
    { keys: [['pagedown']], callback: () => actions.move({ row: actions.pageSize(), col: 0 }) },

    { keys: [['mod', 'a']], callback: () => actions.selectAll() },
    { keys: [['shift', 'space']], callback: () => actions.selectRowOfHighlight() },
    { keys: [['mod', 'space']], callback: () => actions.selectColumnOfHighlight() },

    { keys: [['enter']], callback: () => actions.enter(false) },
    { keys: [['shift', 'enter']], callback: () => actions.enter(true) },
    { keys: [['f2']], callback: () => actions.beginEditing() },
    { keys: [['tab']], callback: () => actions.tab(false) },
    { keys: [['shift', 'tab']], callback: () => actions.tab(true) },

    { keys: [['delete']], callback: () => actions.emptySelectedCells() },
    { keys: [['backspace']], callback: () => actions.emptySelectedCells() },
    { keys: [['escape']], callback: () => actions.deselectCell() },

    { keys: [['mod', 'z']], callback: () => actions.undo() },
    { keys: [['mod', 'y']], callback: () => actions.redo() },
    { keys: [['mod', 'shift', 'z']], callback: () => actions.redo() },
  ];
}

/**
 * The keys an open editor answers first.
 *
 * It only handles what it wants; anything it declines falls through to the
 * grid, which is what lets Escape close an editor and then, pressed again,
 * clear the selection.
 */
export const EDITOR_KEYS = [
  ['enter'],
  ['shift', 'enter'],
  ['tab'],
  ['shift', 'tab'],
  ['escape'],
  ['alt', 'enter'],
];
