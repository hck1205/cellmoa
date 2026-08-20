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
import { readWasm } from './wasm.js';

const wasm = readWasm();

async function makeGrid(settings: Record<string, unknown> = {}) {
  document.body.replaceChildren();
  const engine = await Engine.load(wasm);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(container, 'clientWidth', { value: 600, configurable: true });
  document.body.appendChild(container);
  return new Grid(container, {
    engine,
    colHeaders: true,
    rowHeaders: true,
    startRows: 4,
    startCols: 3,
    ...settings,
  });
}

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
    expect(root.getAttribute('aria-rowcount')).toBe('4');
    expect(root.getAttribute('aria-colcount')).toBe('3');

    const cell = grid.view?.elementAt(1, 2);
    expect(cell?.getAttribute('role')).toBe('gridcell');
    // One-based, and counted in the whole table rather than in the window.
    expect(cell?.getAttribute('aria-colindex')).toBe('3');
    expect(cell?.parentElement?.getAttribute('aria-rowindex')).toBe('2');
    expect(root.querySelector('th.cm-col-header')?.getAttribute('role')).toBe('columnheader');
    expect(root.querySelector('th.cm-row-header')?.getAttribute('role')).toBe('rowheader');
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
