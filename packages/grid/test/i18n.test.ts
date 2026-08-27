import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import { resolve } from '../src/menu.js';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  dictionary,
  hasLanguage,
  languages,
  phrase,
  phraseKeys,
  registerLanguage,
} from '../src/i18n/index.js';
import { PHRASE } from '../src/i18n/keys.js';
import type { ContextMenu } from '../src/plugins/index.js';
import { ITEM } from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 4, startCols: 3, ...settings }).then((m) => m.grid);

describe('the phrase dictionaries', () => {
  it('carries every language Handsontable ships', () => {
    expect(LANGUAGES).toHaveLength(21);
    expect(languages()).toContain('ko-KR');
    expect(languages()).toContain('ar-AR');
    expect(hasLanguage('de-DE')).toBe(true);
    expect(hasLanguage('kl-GL')).toBe(false);
  });

  it('has the same keys in every language', () => {
    // A missing key is a menu item in English inside a German menu, which is
    // the failure this check exists to catch.
    const expected = new Set(phraseKeys());
    expect(expected.size).toBeGreaterThan(100);
    for (const language of languages()) {
      const keys = new Set(Object.keys(dictionary(language)));
      expect([...expected].filter((key) => !keys.has(key))).toEqual([]);
    }
  });

  it('translates', () => {
    expect(phrase(DEFAULT_LANGUAGE, PHRASE.undo)).toBe('Undo');
    expect(phrase('ko-KR', PHRASE.undo)).toBe('되돌리기');
    expect(phrase('de-DE', PHRASE.rowAbove)).toBe('Zeile einfügen oberhalb');
  });

  it('chooses the singular or the plural by the count', () => {
    expect(phrase(DEFAULT_LANGUAGE, PHRASE.removeRow, 1)).toBe('Remove row');
    expect(phrase(DEFAULT_LANGUAGE, PHRASE.removeRow, 3)).toBe('Remove rows');
    expect(phrase(DEFAULT_LANGUAGE, PHRASE.removeRow, 0)).toBe('Remove rows');
  });

  it('falls back to English for a language it does not have', () => {
    expect(phrase('kl-GL', PHRASE.undo)).toBe('Undo');
  });

  it('shows the key itself rather than nothing for a phrase it lacks', () => {
    expect(phrase(DEFAULT_LANGUAGE, 'Nothing:atAll')).toBe('Nothing:atAll');
  });

  it('fills a registered dictionary in from English', () => {
    registerLanguage('xx-XX', { [PHRASE.undo]: 'Zurück' });
    expect(phrase('xx-XX', PHRASE.undo)).toBe('Zurück');
    // Not given, so it reads in English rather than being blank.
    expect(phrase('xx-XX', PHRASE.redo)).toBe('Redo');
  });
});

describe('a grid in another language', () => {
  it('labels its menu with the dictionary', async () => {
    const grid = await makeGrid({ language: 'ko-KR', contextMenu: true });
    grid.selectCell(0, 0);
    const menu = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    const item = menu.getItems().find((entry) => entry.key === ITEM.rowAbove);
    expect(resolve(item?.name, '')).toBe('위쪽에 행 삽입');
  });

  it('counts the selection when choosing singular or plural', async () => {
    const grid = await makeGrid({ contextMenu: true });
    const menu = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    const label = () =>
      resolve(menu.getItems().find((entry) => entry.key === ITEM.removeRow)?.name, '');

    grid.selectCell(0, 0);
    expect(label()).toBe('Remove row');
    grid.selectCell(0, 0, 2, 0);
    expect(label()).toBe('Remove rows');
  });

  it('keeps the locale separate from the language', async () => {
    const grid = await makeGrid({ language: 'en-US', locale: 'de-DE' });
    expect(grid.getTranslatedPhrase(PHRASE.undo)).toBe('Undo');
    expect(grid.getLocale()).toBe('de-DE');
    // With no locale of its own, the language is the locale.
    const plain = await makeGrid({ language: 'fr-FR' });
    expect(plain.getLocale()).toBe('fr-FR');
  });
});

describe('accessibility, direction and theming', () => {
  it('marks up the table for a screen reader', async () => {
    const grid = await makeGrid();
    const root = grid.view!.root;
    expect(root.getAttribute('role')).toBe('grid');
    // Counted the way the indexes below are counted: the header row and the
    // header column are a row and a column. Three data rows plus a header row,
    // and two data columns plus a header column.
    expect(root.getAttribute('aria-rowcount')).toBe('5');
    expect(root.getAttribute('aria-colcount')).toBe('4');

    const cell = grid.view?.elementAt(1, 2);
    expect(cell?.getAttribute('role')).toBe('gridcell');
    // One-based, and counted in the whole table rather than in the window.
    // The cell at visual (1, 2) sits in the fourth column — one header column
    // and two before it — and the third row, one header row and one above it.
    expect(cell?.getAttribute('aria-colindex')).toBe('4');
    expect(cell?.parentElement?.getAttribute('aria-rowindex')).toBe('3');
    expect(root.querySelector('th.cm-col-header')?.getAttribute('role')).toBe('columnheader');
    expect(root.querySelector('th.cm-row-header')?.getAttribute('role')).toBe('rowheader');
    // A header cell says what it heads, which is what lets a screen reader
    // read the right label out beside the cell.
    expect(root.querySelector('th.cm-row-header')?.getAttribute('scope')).toBe('row');
    expect(root.querySelector('th.cm-col-header')?.getAttribute('scope')).toBe('col');
    expect(root.querySelector('th.cm-row-header')?.getAttribute('aria-colindex')).toBe('1');
    // The header row is a row, and it is row 1. It lives in the same `tbody` as
    // the data — the reference uses a `thead` — so it is found through its
    // cells rather than through the section.
    const headerRow = root.querySelector('th.cm-col-header')?.parentElement;
    expect(headerRow?.getAttribute('aria-rowindex')).toBe('1');
  });

  it('leaves the markup off when it was told to', async () => {
    const grid = await makeGrid({ ariaTags: false });
    expect(grid.view?.root.getAttribute('role')).toBeNull();
    expect(grid.view?.elementAt(0, 0)?.getAttribute('role')).toBeNull();
  });

  it('lays out right to left when asked', async () => {
    const grid = await makeGrid({ layoutDirection: 'rtl' });
    expect(grid.isRtl()).toBe(true);
    expect(grid.view?.root.dir).toBe('rtl');
    expect(grid.view?.root.classList.contains('cm-grid--rtl')).toBe(true);
  });

  it('mirrors the arrow keys in a right-to-left grid', async () => {
    const grid = await makeGrid({ layoutDirection: 'rtl' });
    grid.selectCell(0, 1);
    const press = (key: string) =>
      grid.view?.root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    // "Left" is toward the higher column number when the layout is mirrored.
    press('ArrowLeft');
    expect(grid.selection.highlight?.col).toBe(2);
    press('ArrowRight');
    expect(grid.selection.highlight?.col).toBe(1);
    // Vertical movement is unaffected.
    press('ArrowDown');
    expect(grid.selection.highlight?.row).toBe(1);
  });

  it('puts the theme on the root as a class', async () => {
    const grid = await makeGrid({ themeName: 'main-dark' });
    expect(grid.view?.root.classList.contains('cm-theme-main-dark')).toBe(true);
    grid.updateSettings({ themeName: 'horizon' });
    expect(grid.view?.root.classList.contains('cm-theme-main-dark')).toBe(false);
    expect(grid.view?.root.classList.contains('cm-theme-horizon')).toBe(true);
  });
});

describe('spare rows and limits', () => {
  it('keeps empty rows below the data to type into', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1, minSpareRows: 2 });
    grid.setDataAtCell(0, 0, 'a');
    expect(grid.countRows()).toBe(3);
    grid.setDataAtCell(2, 0, 'b');
    // The spare rows follow the data down rather than being used up.
    expect(grid.countRows()).toBe(5);
  });

  it('does not add another spare row on every render', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1, minSpareRows: 1 });
    grid.setDataAtCell(0, 0, 'a');
    const before = grid.countRows();
    grid.render();
    grid.render();
    expect(grid.countRows()).toBe(before);
  });

  it('keeps spare columns too', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1, minSpareCols: 1 });
    grid.setDataAtCell(0, 0, 'a');
    expect(grid.countCols()).toBe(2);
  });

  it('stops at maxRows', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1, minSpareRows: 5, maxRows: 3 });
    grid.setDataAtCell(0, 0, 'a');
    expect(grid.countRows()).toBe(3);
  });
});

describe('cell content and markup', () => {
  it('shows markup as text unless HTML was asked for', async () => {
    const grid = await makeGrid();
    grid.setDataAtCell(0, 0, '<b>bold</b>');
    // The default: a file someone sent you does not get to run markup.
    expect(grid.view?.elementAt(0, 0)?.querySelector('b')).toBeNull();
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('<b>bold</b>');
  });

  it('renders HTML when it was asked for', async () => {
    const grid = await makeGrid({ allowHtml: true });
    grid.setDataAtCell(0, 0, '<b>bold</b>');
    expect(grid.view?.elementAt(0, 0)?.querySelector('b')?.textContent).toBe('bold');
  });

  it('runs the sanitizer over the markup it is allowed to render', async () => {
    const grid = await makeGrid({
      allowHtml: true,
      sanitizer: (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ''),
    });
    grid.setDataAtCell(0, 0, 'safe<script>alert(1)</script>');
    const cell = grid.view?.elementAt(0, 0);
    expect(cell?.querySelector('script')).toBeNull();
    expect(cell?.textContent).toBe('safe');
  });
});

describe('number formatting', () => {
  it('shows the workbook value untouched without `numericFormat`', async () => {
    const grid = await makeGrid();
    grid.setDataAtCell(0, 0, '1234.5');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('1234.5');
  });

  it('formats through Intl when asked, in the grid’s locale', async () => {
    const grid = await makeGrid({
      columns: [{ type: 'numeric', numericFormat: { minimumFractionDigits: 2, useGrouping: true } }],
    });
    grid.setDataAtCell(0, 0, '1234.5');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('1,234.50');

    const german = await makeGrid({
      locale: 'de-DE',
      columns: [{ type: 'numeric', numericFormat: { minimumFractionDigits: 2, useGrouping: true } }],
    });
    german.setDataAtCell(0, 0, '1234.5');
    expect(german.view?.elementAt(0, 0)?.textContent).toBe('1.234,50');
  });

  it('formats a currency', async () => {
    const grid = await makeGrid({
      columns: [{ type: 'numeric', numericFormat: { style: 'currency', currency: 'USD' } }],
    });
    grid.setDataAtCell(0, 0, '9.5');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('$9.50');
  });

  it('leaves text that merely looks numeric alone', async () => {
    const grid = await makeGrid({
      columns: [{ type: 'numeric', numericFormat: { minimumFractionDigits: 2 } }],
    });
    // A leading apostrophe stores it as text; formatting it would claim a type
    // the cell does not have.
    grid.setDataAtCell(0, 0, "'1234.5");
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('1234.5');
  });

  it('keeps the value rather than losing it to an unusable option', async () => {
    const grid = await makeGrid({
      columns: [{ type: 'numeric', numericFormat: { style: 'currency' } }],
    });
    grid.setDataAtCell(0, 0, '5');
    expect(grid.view?.elementAt(0, 0)?.textContent).toBe('5');
  });
});

describe('keyboard reach', () => {
  it('lets the selection sit on a header when `navigableHeaders` is on', async () => {
    const grid = await makeGrid({ navigableHeaders: true });
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    // -1 is the column header row.
    expect(grid.selection.highlight?.row).toBe(-1);
  });

  it('stops at the first cell without it', async () => {
    const grid = await makeGrid();
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(grid.selection.highlight?.row).toBe(0);
  });

  it('hands Tab back to the page when `tabNavigation` is off', async () => {
    const grid = await makeGrid({ tabNavigation: false });
    grid.selectCell(0, 0);
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    grid.view?.root.dispatchEvent(event);
    // Not consumed, so the browser moves focus out of the grid.
    expect(event.defaultPrevented).toBe(false);
    expect(grid.selection.highlight?.col).toBe(0);
  });

  it('moves across the row with Tab by default', async () => {
    const grid = await makeGrid();
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(grid.selection.highlight?.col).toBe(1);
  });
});

describe('input methods', () => {
  it('does not seed the editor with a composition keystroke', async () => {
    const grid = await makeGrid();
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Process', bubbles: true, cancelable: true }),
    );
    // Without imeFastEdit the grid waits; `Process` means nothing on its own.
    expect(document.querySelector('.cm-editor')).toBeNull();
  });

  it('opens an empty editor for the composition when `imeFastEdit` is on', async () => {
    const grid = await makeGrid({ imeFastEdit: true });
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Process', bubbles: true, cancelable: true }),
    );
    const editor = document.querySelector('.cm-editor') as HTMLInputElement | null;
    expect(editor).not.toBeNull();
    // Empty, so the composition lands in it rather than after a stray key.
    expect(editor?.value).toBe('');
  });
});

describe('the areas around the grid', () => {
  it('wraps the grid in a top slot, a bottom slot and an overlay', async () => {
    const grid = await makeGrid();
    const wrapper = grid.view!.wrapper;
    expect([...wrapper.children].map((child) => child.className.split(' ')[0])).toEqual([
      'cm-slot',
      'cm-grid',
      'cm-slot',
      'cm-overlay',
    ]);
    // An empty slot must not take up a line of its own.
    expect((wrapper.querySelector('.cm-slot--top') as HTMLElement).hidden).toBe(true);
  });

  it('places an element the caller registers', async () => {
    const grid = await makeGrid();
    const layout = grid.getLayoutManager()!;
    const toolbar = document.createElement('div');
    toolbar.textContent = 'Inventory';
    layout.register('toolbar', toolbar, { side: 'top' });

    expect(layout.getSlot('top').contains(toolbar)).toBe(true);
    expect(toolbar.classList.contains('cm-slot-element')).toBe(true);
    expect(layout.getSlot('top').hidden).toBe(false);

    layout.unregister('toolbar', 'top');
    expect(toolbar.isConnected).toBe(false);
    expect(layout.getSlot('top').hidden).toBe(true);
  });

  it('orders by weight, keeping registration order for ties', async () => {
    const grid = await makeGrid();
    const layout = grid.getLayoutManager()!;
    layout.register('c', document.createElement('div'), { side: 'top', weight: 200 });
    layout.register('a', document.createElement('div'), { side: 'top', weight: 100 });
    layout.register('b', document.createElement('div'), { side: 'top', weight: 100 });
    expect(layout.getKeys('top')).toEqual(['a', 'b', 'c']);
  });

  it('lets the `layout` setting pin an order the caller never knew about', async () => {
    const grid = await makeGrid({ layout: { bottom: ['mine', 'statusBar'] }, statusBar: true });
    const layout = grid.getLayoutManager()!;
    layout.register('mine', document.createElement('div'), { side: 'bottom', weight: 999 });
    expect(layout.getKeys('bottom')).toEqual(['mine', 'statusBar']);

    grid.updateSettings({ layout: { bottom: ['statusBar', 'mine'] } });
    expect(layout.getKeys('bottom')).toEqual(['statusBar', 'mine']);
  });

  it('replaces an element registered again under the same key', async () => {
    const grid = await makeGrid();
    const layout = grid.getLayoutManager()!;
    const first = document.createElement('div');
    const second = document.createElement('div');
    layout.register('x', first, { side: 'bottom' });
    layout.register('x', second, { side: 'bottom' });
    expect(layout.getKeys('bottom')).toEqual(['x']);
    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(true);
  });

  it('puts the status bar below the grid rather than over it', async () => {
    const grid = await makeGrid({ statusBar: true });
    const layout = grid.getLayoutManager()!;
    expect(layout.has('statusBar', 'bottom')).toBe(true);
    expect(layout.getSlot('bottom').querySelector('.cm-status-bar')).not.toBeNull();
  });

  it('draws a pager for a paginated grid, and keeps it in step', async () => {
    const grid = await makeGrid({ pagination: { pageSize: 2 }, startRows: 6 });
    const layout = grid.getLayoutManager()!;
    const pager = () => layout.getSlot('bottom').querySelector('.cm-pagination');
    expect(pager()?.querySelector('.cm-pagination-counter')?.textContent).toBe('1 / 3');

    // The buttons that would go nowhere are disabled, and the others work.
    const buttons = () =>
      [...(pager()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    expect(buttons()[0]?.disabled).toBe(true);
    buttons()[2]?.click();
    expect(pager()?.querySelector('.cm-pagination-counter')?.textContent).toBe('2 / 3');
    expect(buttons()[0]?.disabled).toBe(false);
  });
});

describe('a column that declares a title asks for a header', () => {
  it('draws the header row from `columns[].title` with no `colHeaders` beside it', async () => {
    // The guide's Column headers page configures exactly this. `getColHeader`
    // already returned the title; `hasColHeaders` only looked at `colHeaders`,
    // so nothing ever asked for a header row and the titles were computed into
    // nowhere. The reference draws them.
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ title: 'ID' }, { title: 'Name' }],
    });
    grid.render();

    expect(grid.hasColHeaders()).toBe(true);
    const headers = [...grid.view!.root.querySelectorAll('th.cm-col-header')].map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(['ID', 'Name']);
  });

  it('still draws nothing when colHeaders is off, whatever the columns say', async () => {
    // `colHeaders: false` is an instruction, not an absence.
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: false,
      columns: [{ title: 'ID' }, { title: 'Name' }],
    });
    grid.render();

    expect(grid.hasColHeaders()).toBe(false);
    expect(grid.view!.root.querySelector('th.cm-col-header')).toBeNull();
  });
});
