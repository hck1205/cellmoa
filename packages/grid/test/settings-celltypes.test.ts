import { describe, expect, it, vi } from 'vitest';
import { formatTemporal } from '../src/cellTypes/renderers.js';
import { mountGrid } from './helpers.js';

describe('date and time formatting', () => {
  it('shows the ISO source unless a format asks otherwise', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, columns: [{ type: 'date' }] });
    grid.setDataAtCell(0, 0, '2026-03-09');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('2026-03-09');
  });

  it('formats through Intl in the grid’s locale', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      locale: 'en-GB',
      columns: [{ type: 'date', dateFormat: { day: '2-digit', month: 'short', year: 'numeric' } }],
    });
    grid.setDataAtCell(0, 0, '2026-03-09');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('09 Mar 2026');
  });

  it('formats a time likewise', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      locale: 'en-GB',
      columns: [{ type: 'time', timeFormat: { hour: '2-digit', minute: '2-digit' } }],
    });
    grid.setDataAtCell(0, 0, '14:05');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('14:05');
  });

  it('leaves a value that is not a date alone rather than guessing', () => {
    // A column saying `type: 'date'` is not a reason to turn 'n/a' into one.
    expect(formatTemporal('n/a', { dateStyle: 'full' }, 'en-US', 'date')).toBe('n/a');
    expect(formatTemporal('', { dateStyle: 'full' }, 'en-US', 'date')).toBe('');
    expect(formatTemporal('2026-03-09', undefined, 'en-US', 'date')).toBe('2026-03-09');
  });
});

describe('the autocomplete list', () => {
  const source = ['apple', 'apricot', 'banana', 'blueberry', 'cherry'];

  it('scrolls past `visibleRows` instead of growing off the screen', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'autocomplete', source, visibleRows: 2 }],
    });
    grid.beginEditing(0, 0);
    const list = document.querySelector('.cm-editor-list') as HTMLElement;
    expect(list.style.overflowY).toBe('auto');
    expect(list.style.maxHeight).toBe('44px');
  });

  it('grows to fit the longest option when not trimmed', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'autocomplete', source, trimDropdown: false }],
    });
    grid.beginEditing(0, 0);
    expect((document.querySelector('.cm-editor--autocomplete') as HTMLElement).style.width).toBe(
      'auto',
    );
  });

  it('puts the options that start with the query first', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'autocomplete', source: ['banana', 'apple', 'grape'] }],
    });
    grid.beginEditing(0, 0, 'a');
    const shown = [...document.querySelectorAll('.cm-editor-item')].map((i) => i.textContent);
    // 'apple' starts with it; 'banana' and 'grape' merely contain it.
    expect(shown[0]).toBe('apple');
  });

  it('keeps the source order when relevance is switched off', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'autocomplete', source: ['banana', 'apple'], sortByRelevance: false }],
    });
    grid.beginEditing(0, 0, 'a');
    const shown = [...document.querySelectorAll('.cm-editor-item')].map((i) => i.textContent);
    expect(shown).toEqual(['banana', 'apple']);
  });
});

describe('the multi-select editor', () => {
  const source = ['red', 'green', 'blue'];

  it('shows a search box unless told not to', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'multiSelect', source }],
    });
    grid.beginEditing(0, 0);
    expect(document.querySelector('.cm-editor--multi-select input[type="search"]')).not.toBeNull();

    grid.closeEditor(false);
    grid.updateSettings({ columns: [{ type: 'multiSelect', source, searchInput: false }] });
    grid.beginEditing(0, 0);
    expect(document.querySelector('.cm-editor--multi-select input[type="search"]')).toBeNull();
  });

  it('stops at `maxSelections`', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'multiSelect', source, maxSelections: 2 }],
    });
    grid.setDataAtCell(0, 0, 'red, green');
    grid.beginEditing(0, 0);
    const boxes = [...document.querySelectorAll('.cm-editor-option input')] as HTMLInputElement[];
    // The two already chosen can still be unticked; the third cannot be added.
    expect(boxes.map((b) => b.disabled)).toEqual([false, false, true]);
  });

  it('sorts the options with the function it was given', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [
        { type: 'multiSelect', source, sourceSortFunction: (a: string, b: string) => a.localeCompare(b) },
      ],
    });
    grid.beginEditing(0, 0);
    const labels = [...document.querySelectorAll('.cm-editor-option')].map((l) => l.textContent);
    expect(labels).toEqual(['blue', 'green', 'red']);
  });

  it('keeps the editor open on Enter when `enterCommits` is off', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'multiSelect', source, enterCommits: false }],
    });
    grid.beginEditing(0, 0);
    grid.view?.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.cm-editor--multi-select')).not.toBeNull();
  });
});

describe('the password editor', () => {
  it('masks by default', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, columns: [{ type: 'password' }] });
    grid.beginEditing(0, 0);
    expect((document.querySelector('.cm-editor') as HTMLInputElement).type).toBe('password');
  });

  it('reveals each keystroke for a moment when asked', async () => {
    vi.useFakeTimers();
    try {
      const { grid } = await mountGrid({
        startRows: 2,
        startCols: 2,
        columns: [{ type: 'password', hashRevealDelay: 500 }],
      });
      grid.beginEditing(0, 0);
      const input = document.querySelector('.cm-editor') as HTMLInputElement;
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      expect(input.type).toBe('text');
      vi.advanceTimersByTime(501);
      expect(input.type).toBe('password');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('numeric literals', () => {
  it('keeps what was typed when asked to preserve it', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ type: 'numeric', numericFormat: { minimumFractionDigits: 3 } }],
    });
    grid.setDataAtCell(0, 0, '9');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('9.000');

    const literal = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [
        { type: 'numeric', numericFormat: { minimumFractionDigits: 3 }, preserveNumericLiteral: true },
      ],
    });
    literal.grid.setDataAtCell(0, 0, '9');
    expect(literal.grid.view?.elementAt(0, 0)?.textContent).toBe('9');
  });
});
