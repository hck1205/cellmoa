/**
 * The cell-type defects the documentation walk turned up.
 *
 * Every one of these had the right name and the wrong behaviour, so there was
 * nothing for a user to report: a tick that vanished, a validator that
 * disagreed with the editor above it, a checkbox drawn from half its own
 * configuration. Each test is pinned to the reference page that specifies the
 * behaviour it asserts.
 */

import { describe, expect, it } from 'vitest';
import { getCellType, getRenderer, getValidator, matchOptions } from '../src/cellTypes/index.js';
import { mountGrid } from './helpers.js';

/** Presses a key on the grid, which is where the editor's keys arrive. */
function press(root: HTMLElement, key: string): void {
  root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Ticks a multi-select option by name, re-querying because `draw` replaces it. */
function tick(option: string): void {
  const box = document.querySelector(
    `.cm-editor-option input[value="${option}"]`,
  ) as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new Event('change'));
}

/** Lets a validated write settle, since a validator may answer asynchronously. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the multi-select editor', () => {
  const source = ['red', 'green', 'blue'];

  it('keeps a tick the search box has scrolled out of sight', async () => {
    // Reading the ticks back off the drawn boxes loses every option the filter
    // removed, which is silent data loss: the user ticked them and they are
    // gone.
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'multiSelect', source }],
    });
    grid.beginEditing(0, 0);
    tick('red');
    tick('green');
    tick('blue');

    const search = document.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'red';
    search.dispatchEvent(new Event('input'));

    press(grid.view!.root, 'Enter');
    await settle();
    expect(grid.getDataAtCell(0, 0)).toBe('red, green, blue');
  });
});

describe('a list cell’s `strict`', () => {
  const source = ['red', 'green'];

  it('lets an autocomplete accept a value that is not on the list', async () => {
    // Flexible is the default for `autocomplete`, and is the whole point of the
    // type: the list is a suggestion, not a constraint.
    const validate = getValidator('autocomplete')!;
    expect((await validate('purple', { source })).valid).toBe(true);
    expect((await validate('purple', { source, strict: true })).valid).toBe(false);
    expect((await validate('red', { source, strict: true })).valid).toBe(true);
  });

  it('keeps a dropdown closed unless the column says otherwise', async () => {
    const validate = getValidator('dropdown')!;
    expect((await validate('purple', { source })).valid).toBe(false);
    expect((await validate('purple', { source, strict: false })).valid).toBe(true);
  });

  it('does not mark a typed autocomplete value invalid', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'autocomplete', source }],
    });
    grid.beginEditing(0, 0, 'purple');
    press(grid.view!.root, 'Enter');
    await settle();
    expect(grid.getDataAtCell(0, 0)).toBe('purple');
    expect(grid.isCellInvalid(0, 0)).toBe(false);
  });

  it('lets a loose dropdown commit what its validator would accept', async () => {
    // The editor forced `strict: true` on itself, so it refused a value the
    // validator was perfectly happy with and the Enter key did nothing.
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'dropdown', source, strict: false }],
    });
    grid.beginEditing(0, 0, 'purple');
    press(grid.view!.root, 'Enter');
    await settle();
    expect(grid.getDataAtCell(0, 0)).toBe('purple');
  });

  it('still refuses an off-list value in a plain dropdown', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'dropdown', source }],
    });
    grid.beginEditing(0, 0, 'purple');
    press(grid.view!.root, 'Enter');
    await settle();
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });
});

describe('the checkbox renderer', () => {
  const templates = { type: 'checkbox', checkedTemplate: 'yes', uncheckedTemplate: 'no' } as const;

  /** The input the renderer drew, after a render. */
  function box(grid: { getCellElement(r: number, c: number): HTMLTableCellElement | null }):
    HTMLInputElement {
    return grid.getCellElement(0, 0)?.querySelector('.cm-checkbox') as HTMLInputElement;
  }

  it('agrees with the toggle about what counts as checked', async () => {
    // The toggle compared case-insensitively and the renderer compared exactly,
    // so 'YES' drew unchecked and then unticked itself when pressed.
    const { grid } = await mountGrid({ startRows: 2, startCols: 1 });
    grid.setCellMetaObject(0, 0, { ...templates });
    grid.setDataAtCell(0, 0, 'YES');
    expect(box(grid).checked).toBe(true);

    grid.selectCell(0, 0);
    press(grid.view!.root, ' ');
    expect(grid.getDataAtCell(0, 0)).toBe('no');
    expect(box(grid).checked).toBe(false);
  });

  it('tells the unchecked value apart from no value at all', async () => {
    // Reading only `checkedTemplate` left the renderer unable to make this
    // distinction, so the documented `noValue` class — which is what fades a
    // cell nobody has answered — could not be applied to either.
    const { grid } = await mountGrid({ startRows: 2, startCols: 1 });
    grid.setCellMetaObject(0, 0, { ...templates });
    grid.setDataAtCell(0, 0, 'NO');
    expect(box(grid).checked).toBe(false);
    expect(box(grid).classList.contains('noValue')).toBe(false);

    grid.setDataAtCell(0, 0, 'maybe');
    expect(box(grid).checked).toBe(false);
    expect(box(grid).classList.contains('noValue')).toBe(true);
  });

  it('calls a label given as a function rather than printing its source', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 1 });
    grid.setCellMetaObject(0, 0, {
      ...templates,
      label: {
        position: 'after',
        value(_row: number, _column: number, _prop: unknown, value: unknown) {
          return value === 'yes' ? 'In black' : 'Not in black';
        },
      },
    });
    grid.setDataAtCell(0, 0, 'yes');
    expect(grid.getCellElement(0, 0)?.querySelector('.cm-checkbox-label')?.textContent)
      .toBe('In black');
  });
});

describe('the documented type names', () => {
  it('resolve to the same types the camel-cased ones do', () => {
    for (const [documented, ours] of [
      ['intl-date', 'intlDate'],
      ['intl-time', 'intlTime'],
      ['multiselect', 'multiSelect'],
    ]) {
      expect(getRenderer(documented!), documented).toBeTypeOf('function');
      expect(getCellType(documented!), documented).toBe(getCellType(ours!));
    }
  });

  it('select the right renderer rather than falling back to text', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'multiselect' as 'multiSelect', source: ['red'] }],
    });
    grid.render();
    expect(grid.getCellElement(0, 0)?.classList.contains('cm-multi-select')).toBe(true);
  });
});

describe('the date and time editors', () => {
  it('open a native picker', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'date' }, { type: 'time' }],
    });
    grid.setDataAtCell(0, 0, '2026-03-09');
    grid.beginEditing(0, 0);
    expect((document.querySelector('.cm-editor') as HTMLInputElement).type).toBe('date');
    grid.closeEditor(false);

    grid.setDataAtCell(0, 1, '14:05');
    grid.beginEditing(0, 1);
    expect((document.querySelector('.cm-editor') as HTMLInputElement).type).toBe('time');
  });

  it('stay a text field for a value a native picker would throw away', async () => {
    // A native date input holds ISO or nothing, so handing it '=TODAY()' or a
    // half-typed date would blank the cell the moment the editor opened.
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'date' }],
    });
    grid.setDataAtCell(0, 0, '=TODAY()');
    grid.beginEditing(0, 0);
    const input = document.querySelector('.cm-editor') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('=TODAY()');
  });
});

describe('the time validator', () => {
  it('accepts the milliseconds the renderer formats', async () => {
    const validate = getValidator('time')!;
    expect((await validate('12:30:45.123', {})).valid).toBe(true);
    expect((await validate('12:30:45.1', {})).valid).toBe(true);
    expect((await validate('12:30:45', {})).valid).toBe(true);
    expect((await validate('12:30:45.1234', {})).valid).toBe(false);
  });
});

describe('which options a list offers for what was typed', () => {
  // These rules could only be checked by building an editor and reading its
  // `<li>` children back, so `sortByRelevance` and `filteringCaseSensitive`
  // had no test of their own.
  const all = ['Apple', 'Apricot', 'Banana', 'Grape', 'pineapple'];

  it('narrows to what contains the query, ignoring case by default', () => {
    // `Grape` and `pineapple` both contain "ap"; `Banana` does not.
    expect(matchOptions(all, 'ap', {})).toEqual(['Apple', 'Apricot', 'Grape', 'pineapple']);
  });

  it('respects case when asked to', () => {
    // Only the lower-case "ap" now — `Apple` and `Apricot` have a capital A.
    expect(matchOptions(all, 'ap', { filteringCaseSensitive: true })).toEqual([
      'Grape',
      'pineapple',
    ]);
  });

  it('puts what starts with the query first, keeping each half in source order', () => {
    // `Grape` and `pineapple` merely contain it, so they follow the two that
    // begin with it — and each half keeps the order the source gave.
    expect(matchOptions(all, 'Ap', {})).toEqual(['Apple', 'Apricot', 'Grape', 'pineapple']);
  });

  it('keeps the source order when relevance is switched off', () => {
    expect(matchOptions(all, 'ap', { sortByRelevance: false })).toEqual([
      'Apple',
      'Apricot',
      'Grape',
      'pineapple',
    ]);
  });

  it('shows everything when filtering is off, whatever was typed', () => {
    expect(matchOptions(all, 'zzz', { filter: false })).toEqual(all);
  });

  it('shows everything for an empty query', () => {
    expect(matchOptions(all, '', {})).toEqual(all);
  });
});
