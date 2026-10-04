import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import { cellTypeNames, getEditor, getRenderer, getValidator } from '../src/cellTypes/index.js';
import { makeGrid } from './helpers.js';

function key(grid: Grid, k: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...modifiers });
  grid.view!.root.dispatchEvent(event);
  return event;
}

describe('the cell type registry', () => {
  it('registers every type Handsontable ships, under every name it ships it as', () => {
    // The reference registers `intl-date`, `intl-time` and `multiselect`, and
    // `multiSelect` besides for the spelling it shipped with first. A name that
    // does not resolve is not an error anyone sees — the column just falls back
    // to the text renderer — so each documented spelling is pinned here.
    expect(cellTypeNames()).toEqual([
      'autocomplete', 'checkbox', 'date', 'dropdown', 'handsontable',
      'intl-date', 'intl-time', 'intlDate', 'intlTime', 'multiSelect',
      'multiselect', 'numeric', 'password', 'select', 'text', 'time',
    ]);
  });

  it('gives each type a renderer, and most an editor and a validator', () => {
    for (const name of cellTypeNames()) {
      expect(getRenderer(name), name).toBeTypeOf('function');
    }
    // A checkbox is toggled rather than typed into.
    expect(getEditor('checkbox')).toBeUndefined();
    expect(getEditor('text')).toBeTypeOf('function');
    expect(getValidator('numeric')).toBeTypeOf('function');
  });
});

describe('validators', () => {
  it('accepts numbers, rejects text, and lets a formula through', async () => {
    const validate = getValidator('numeric')!;
    expect((await validate('42', {})).valid).toBe(true);
    expect((await validate('1,234.5', {})).valid).toBe(true);
    expect((await validate('50%', {})).valid).toBe(true);
    expect((await validate('abc', {})).valid).toBe(false);
    // A formula in a numeric column is the engine's business, not the
    // validator's.
    expect((await validate('=SUM(A1:A9)', {})).valid).toBe(true);
  });

  it('honours allowEmpty', async () => {
    const validate = getValidator('text')!;
    expect((await validate('', {})).valid).toBe(true);
    expect((await validate('', { allowEmpty: false })).valid).toBe(false);
  });

  it('checks a value against a list', async () => {
    const validate = getValidator('dropdown')!;
    const meta = { source: ['red', 'green'] };
    expect((await validate('red', meta)).valid).toBe(true);
    expect((await validate('blue', meta)).valid).toBe(false);
    // Not strict means anything goes.
    expect((await validate('blue', { ...meta, strict: false })).valid).toBe(true);
  });

  it('checks a list given as selectOptions, which is where the editor reads it', async () => {
    const validate = getValidator('select')!;
    const meta = { selectOptions: ['red', 'green'] };
    expect((await validate('red', meta)).valid).toBe(true);
    expect((await validate('blue', meta)).valid).toBe(false);
  });

  it('checks dates and times loosely enough to match the parser', async () => {
    const date = getValidator('date')!;
    expect((await date('2024-01-01', {})).valid).toBe(true);
    expect((await date('1/1/2024', {})).valid).toBe(true);
    expect((await date('nonsense', {})).valid).toBe(false);

    const time = getValidator('time')!;
    expect((await time('12:30', {})).valid).toBe(true);
    expect((await time('6:00 PM', {})).valid).toBe(true);
    expect((await time('half past', {})).valid).toBe(false);
  });
});

describe('renderers', () => {
  it('masks a password', async () => {
    const grid = await makeGrid({ columns: [{ type: 'password', hashLength: 5 }] });
    grid.setDataAtCell(0, 0, 'secret');
    const td = grid.view!.elementAt(0, 0)!;
    expect(td.textContent).toBe('*****');
    expect(td.textContent).not.toContain('secret');
  });

  it('draws a checkbox', async () => {
    const grid = await makeGrid({ columns: [{ type: 'checkbox' }] });
    grid.setDataAtCell(0, 0, 'true');
    const input = grid.view!.elementAt(0, 0)!.querySelector('input');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).checked).toBe(true);
  });

  it('escapes cell text unless HTML was asked for', async () => {
    const grid = await makeGrid();
    grid.setDataAtCell(0, 0, '<b>bold</b>');
    // The markup is shown, not run.
    expect(grid.view!.elementAt(0, 0)!.querySelector('b')).toBeNull();
    expect(grid.view!.elementAt(0, 0)!.textContent).toBe('<b>bold</b>');

    grid.updateSettings({ allowHtml: true });
    expect(grid.view!.elementAt(0, 0)!.querySelector('b')).not.toBeNull();
  });

  it('shows a placeholder in an empty cell', async () => {
    const grid = await makeGrid({ columns: [{ placeholder: 'type here' }] });
    expect(grid.view!.elementAt(0, 0)!.textContent).toBe('type here');
    grid.setDataAtCell(0, 0, 'x');
    expect(grid.view!.elementAt(0, 0)!.textContent).toBe('x');
  });
});

describe('editing', () => {
  let grid: Grid;
  beforeEach(async () => {
    document.body.replaceChildren();
    grid = await makeGrid();
  });

  it('opens on F2 and commits on Enter', () => {
    grid.selectCell(0, 0);
    key(grid, 'F2');
    expect(grid.isEditing()).toBe(true);

    const input = grid.view!.root.querySelector('input.cm-editor') as HTMLInputElement;
    input.value = 'typed';
    key(grid, 'Enter');
    expect(grid.isEditing()).toBe(false);
    expect(grid.getDataAtCell(0, 0)).toBe('typed');
    // Enter moves down after committing.
    expect(grid.getSelectedLast()).toEqual([1, 0, 1, 0]);
  });

  it('cancels on Escape without writing', () => {
    grid.setDataAtCell(0, 0, 'before');
    grid.selectCell(0, 0);
    key(grid, 'F2');
    const input = grid.view!.root.querySelector('input.cm-editor') as HTMLInputElement;
    input.value = 'after';
    key(grid, 'Escape');
    expect(grid.getDataAtCell(0, 0)).toBe('before');
  });

  it('starts editing when a printable key is pressed, keeping the keystroke', () => {
    grid.selectCell(1, 1);
    key(grid, 'x');
    expect(grid.isEditing()).toBe(true);
    const input = grid.view!.root.querySelector('input.cm-editor') as HTMLInputElement;
    expect(input.value).toBe('x');
  });

  it('edits a formula as its source, not its result', () => {
    grid.setDataAtCell(0, 0, '10');
    grid.setDataAtCell(0, 1, '=A1*2');
    expect(grid.getDataAtCell(0, 1)).toBe('20');

    grid.selectCell(0, 1);
    key(grid, 'F2');
    const input = grid.view!.root.querySelector('input.cm-editor') as HTMLInputElement;
    expect(input.value).toBe('=A1*2');
  });

  it('refuses to open on a read-only cell', () => {
    grid.setCellMeta(0, 0, 'readOnly', true);
    grid.selectCell(0, 0);
    key(grid, 'F2');
    expect(grid.isEditing()).toBe(false);
  });

  it('marks a value that fails validation but still writes it', async () => {
    grid.updateSettings({ columns: [{ type: 'numeric' }] });
    grid.selectCell(0, 0);
    key(grid, 'F2');
    const input = grid.view!.root.querySelector('input.cm-editor') as HTMLInputElement;
    input.value = 'not a number';
    key(grid, 'Enter');

    expect(grid.isCellInvalid(0, 0)).toBe(true);
    // allowInvalid defaults to true, so the value is there to be corrected.
    expect(grid.getDataAtCell(0, 0)).toBe('not a number');
    expect(grid.view!.elementAt(0, 0)!.classList.contains('htInvalid')).toBe(true);
  });

  it('refuses an invalid value when allowInvalid is off', () => {
    grid.updateSettings({ columns: [{ type: 'numeric', allowInvalid: false }] });
    grid.selectCell(0, 0);
    key(grid, 'F2');
    const input = grid.view!.root.querySelector('input.cm-editor') as HTMLInputElement;
    input.value = 'nope';
    key(grid, 'Enter');
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });

  it('toggles a checkbox with Space rather than opening an editor', () => {
    grid.updateSettings({ columns: [{ type: 'checkbox' }] });
    grid.selectCell(0, 0);
    key(grid, ' ');
    expect(grid.isEditing()).toBe(false);
    expect(grid.getDataAtCell(0, 0)).toBe('TRUE');
    key(grid, ' ');
    expect(grid.getDataAtCell(0, 0)).toBe('FALSE');
  });

  it('opens on a double click', () => {
    grid.selectCell(0, 0);
    const td = grid.view!.elementAt(0, 0)!;
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(grid.isEditing()).toBe(true);
  });
});

describe('keyboard navigation', () => {
  let grid: Grid;
  beforeEach(async () => {
    document.body.replaceChildren();
    grid = await makeGrid();
    grid.selectCell(2, 2);
  });

  it('moves with the arrow keys', () => {
    key(grid, 'ArrowDown');
    expect(grid.getSelectedLast()).toEqual([3, 2, 3, 2]);
    key(grid, 'ArrowRight');
    expect(grid.getSelectedLast()).toEqual([3, 3, 3, 3]);
    key(grid, 'ArrowUp');
    key(grid, 'ArrowLeft');
    expect(grid.getSelectedLast()).toEqual([2, 2, 2, 2]);
  });

  it('extends the selection with shift and an arrow', () => {
    key(grid, 'ArrowDown', { shiftKey: true });
    key(grid, 'ArrowRight', { shiftKey: true });
    expect(grid.getSelectedLast()).toEqual([2, 2, 3, 3]);
  });

  it('jumps to the edge with ctrl and an arrow', () => {
    key(grid, 'ArrowDown', { ctrlKey: true });
    expect(grid.getSelectedLast()).toEqual([grid.countRows() - 1, 2, grid.countRows() - 1, 2]);
    key(grid, 'ArrowUp', { ctrlKey: true });
    expect(grid.getSelectedLast()).toEqual([0, 2, 0, 2]);
  });

  it('selects everything, a row and a column', () => {
    key(grid, 'a', { ctrlKey: true });
    expect(grid.getSelectedLast()).toEqual([0, 0, grid.countRows() - 1, grid.countCols() - 1]);

    grid.selectCell(2, 2);
    key(grid, ' ', { shiftKey: true });
    expect(grid.getSelectedLast()).toEqual([2, 0, 2, grid.countCols() - 1]);

    grid.selectCell(2, 2);
    key(grid, ' ', { ctrlKey: true });
    expect(grid.getSelectedLast()).toEqual([0, 2, grid.countRows() - 1, 2]);
  });

  it('moves with Tab and back with shift+Tab', () => {
    key(grid, 'Tab');
    expect(grid.getSelectedLast()).toEqual([2, 3, 2, 3]);
    key(grid, 'Tab', { shiftKey: true });
    expect(grid.getSelectedLast()).toEqual([2, 2, 2, 2]);
  });

  it('clears the selected cells with Delete', () => {
    grid.setDataAtCells([[2, 2, 'a'], [2, 3, 'b']]);
    grid.selectCell(2, 2, 2, 3);
    key(grid, 'Delete');
    expect(grid.getDataAtCell(2, 2)).toBe('');
    expect(grid.getDataAtCell(2, 3)).toBe('');
  });

  it('undoes and redoes from the keyboard', () => {
    grid.setDataAtCell(0, 0, 'first');
    key(grid, 'z', { ctrlKey: true });
    expect(grid.getDataAtCell(0, 0)).toBe('');
    key(grid, 'y', { ctrlKey: true });
    expect(grid.getDataAtCell(0, 0)).toBe('first');
  });

  it('lets beforeKeyDown veto a keystroke', () => {
    grid.addHook('beforeKeyDown', () => false);
    key(grid, 'ArrowDown');
    expect(grid.getSelectedLast()).toEqual([2, 2, 2, 2]);
  });

  it('ignores keystrokes while not listening', () => {
    grid.unlisten();
    key(grid, 'ArrowDown');
    expect(grid.getSelectedLast()).toEqual([2, 2, 2, 2]);
    grid.listen();
    key(grid, 'ArrowDown');
    expect(grid.getSelectedLast()).toEqual([3, 2, 3, 2]);
  });
});

describe('mouse selection', () => {
  it('selects, extends with shift and adds with ctrl', async () => {
    document.body.replaceChildren();
    const grid = await makeGrid();
    const click = (row: number, col: number, modifiers: Partial<MouseEventInit> = {}) => {
      grid.view!.elementAt(row, col)!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, ...modifiers }),
      );
    };
    click(1, 1);
    expect(grid.getSelectedLast()).toEqual([1, 1, 1, 1]);

    click(3, 3, { shiftKey: true });
    expect(grid.getSelectedLast()).toEqual([1, 1, 3, 3]);

    click(0, 0, { ctrlKey: true });
    expect(grid.getSelected()).toHaveLength(2);
  });
});
