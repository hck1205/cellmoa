/**
 * The documented clipboard and export behaviour.
 *
 * These cover the options the guides describe and this grid either spelled
 * differently, defaulted the other way, or declared and never read — the kind
 * of gap that a caller only finds out about by losing data.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Autofill, CopyPaste, ExportFile } from '../src/plugins/index.js';
import { escapeCsvValue } from '../src/plugins/exportFile.js';
import { clipboardEvent, makeGrid, mountGrid } from './helpers.js';

const clipboardOf = (grid: Awaited<ReturnType<typeof mountGrid>>['grid']) =>
  grid.getPlugin('copyPaste') as unknown as CopyPaste;

const exporterOf = (grid: Awaited<ReturnType<typeof mountGrid>>['grid']) =>
  grid.getPlugin('exportFile') as unknown as ExportFile;

const autofillOf = (grid: Awaited<ReturnType<typeof mountGrid>>['grid']) =>
  grid.getPlugin('autofill') as unknown as Autofill;

/**
 * The name a download would have been saved under.
 *
 * jsdom has no object URLs and no real downloads, so the two are stubbed for
 * the whole file rather than per test: the export releases its URL from a
 * timer that fires after the test has finished, and a stub taken away in
 * between would throw where nothing can catch it.
 */
const urlApi = URL as unknown as Record<string, unknown>;

urlApi.createObjectURL = () => 'blob:export';
urlApi.revokeObjectURL = () => undefined;

function downloadedName(
  grid: Awaited<ReturnType<typeof mountGrid>>['grid'],
  options: Parameters<ExportFile['downloadFile']>[1],
): string {
  let name = '';
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function captured(this: HTMLAnchorElement) {
      name = this.download;
    });
  try {
    exporterOf(grid).downloadFile('csv', options);
  } finally {
    click.mockRestore();
  }
  return name;
}

describe('how much of a selection a copy takes', () => {
  it('copies everything that was selected, however much that is', async () => {
    const { grid } = await mountGrid({ startRows: 1200, startCols: 1 });
    grid.selectCell(0, 0, 1199, 0);
    // The reference made both limits `Infinity` in 10.0. A default of 1000 is
    // a silent truncation of an ordinary selection.
    expect(clipboardOf(grid).getRangeData().length).toBe(1200);
  });

  it('tells the hook when a limit did clip the copy', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 3,
      copyPaste: { rowsLimit: 2, columnsLimit: 1 },
    });
    const seen = vi.fn();
    grid.addHook('afterCopyLimit', seen);
    grid.selectCell(0, 0, 3, 2);
    clipboardOf(grid).onCopy(clipboardEvent('copy'), false);
    expect(seen).toHaveBeenCalledWith(2, 1, 2, 1);
  });

  it('says nothing when the whole selection fits', async () => {
    const { grid } = await mountGrid({ startRows: 4, startCols: 3 });
    const seen = vi.fn();
    grid.addHook('afterCopyLimit', seen);
    grid.selectCell(0, 0, 3, 2);
    clipboardOf(grid).onCopy(clipboardEvent('copy'), false);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('keeping a formula out of the exported CSV', () => {
  it('leaves a value alone when sanitization was not asked for', () => {
    expect(escapeCsvValue('=1+1', ',')).toBe('=1+1');
  });

  it('prefixes every lead character a spreadsheet reads as a formula', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(escapeCsvValue(`${lead}cmd`, ',', true)).toBe(`"'${lead}cmd"`);
    }
  });

  it('leaves an ordinary value alone, but quotes it all the same', () => {
    // Quoting everything is what the reference does once sanitization is on:
    // an unquoted `'=x` and a quoted one are not the same field to every
    // reader, so the whole file is written the one way.
    expect(escapeCsvValue('plain', ',', true)).toBe('"plain"');
    expect(escapeCsvValue('', ',', true)).toBe('');
  });

  it('takes a regular expression to decide, and a function to rewrite', () => {
    expect(escapeCsvValue('=WEBSERVICE("x")', ',', /WEBSERVICE/)).toBe('"\'=WEBSERVICE(""x"")"');
    expect(escapeCsvValue('safe', ',', /WEBSERVICE/)).toBe('"safe"');
    expect(escapeCsvValue('=CMD("x")', ',', () => 'REMOVED')).toBe('"REMOVED"');
  });

  it('sanitizes the exported file when the option is set', async () => {
    // Text to this grid, a command to Excel. That gap is the whole attack:
    // nothing here looks like a formula until the file is opened elsewhere.
    const grid = await makeGrid({ startRows: 2, startCols: 1 });
    grid.setSourceDataAtCell(0, 0, "@SUM(1+9)*cmd|'/c calc'!A0");
    grid.setSourceDataAtCell(1, 0, 'plain');
    expect(exporterOf(grid).exportAsString('csv')).toBe("@SUM(1+9)*cmd|'/c calc'!A0\r\nplain");
    expect(exporterOf(grid).exportAsString('csv', { sanitizeValues: true })).toBe(
      '"\'@SUM(1+9)*cmd|\'/c calc\'!A0"\r\n"plain"',
    );
  });
});

describe('the export options the guide documents', () => {
  it('takes the headers under the name the guide gives them', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 2 });
    grid.setDataAtCell(0, 0, 'v');
    expect(exporterOf(grid).exportAsString('csv', { colHeaders: true })).toBe('A,B\r\nv,');
  });

  it('still takes the name this grid used to spell it', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 2 });
    grid.setDataAtCell(0, 0, 'v');
    expect(exporterOf(grid).exportAsString('csv', { columnHeaders: true })).toBe('A,B\r\nv,');
  });

  it('puts the date into the filename and takes the extension from the options', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    expect(
      downloadedName(grid, { filename: 'stock_[YYYY]-[MM]-[DD]', fileExtension: 'txt' }),
    ).toMatch(/^stock_\d{4}-\d{2}-\d{2}\.txt$/);
  });

  it('names the file the way the guide says it is named', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    expect(downloadedName(grid, {})).toMatch(/^Handsontable \d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('what a paste reads off the clipboard', () => {
  it('prefers the HTML table, which is what keeps a spreadsheet paste in shape', async () => {
    // A cell whose own text holds a tab is the case that separates the two
    // flavours: the plain one cannot say which of its tabs end a cell, the
    // HTML one does not have to.
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.selectCell(0, 0);
    clipboardOf(grid).onPaste(
      clipboardEvent('paste', {
        'text/html': '<table><tbody><tr><td>one\ttwo</td><td>b</td></tr></tbody></table>',
        'text/plain': 'one\ttwo\tb',
      }),
    );
    expect([grid.getDataAtCell(0, 0), grid.getDataAtCell(0, 1)]).toEqual(['one\ttwo', 'b']);
  });

  it('still recognises this grid\'s own copy, so its formulas move with it', async () => {
    // Our own copy writes both flavours. Reading the HTML first must not cost
    // the paste the thing only the plain text can establish: that the block
    // came from here, and its references belong to where it is going.
    const { grid } = await mountGrid({ startRows: 4, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, '5'],
      [1, 0, '6'],
      [0, 1, '=A1*2'],
    ]);
    grid.selectCell(0, 1);
    const copied = clipboardEvent('copy');
    clipboardOf(grid).onCopy(copied, false);

    grid.selectCell(1, 1);
    clipboardOf(grid).onPaste(
      clipboardEvent('paste', {
        'text/html': copied.clipboardData?.getData('text/html') ?? '',
        'text/plain': copied.clipboardData?.getData('text/plain') ?? '',
      }),
    );
    expect(grid.getSourceDataAtCell(1, 1)).toBe('=A2*2');
  });

  it('falls back to the plain text when there is no table', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.selectCell(0, 0);
    clipboardOf(grid).onPaste(clipboardEvent('paste', { 'text/plain': 'a\tb' }));
    expect([grid.getDataAtCell(0, 0), grid.getDataAtCell(0, 1)]).toEqual(['a', 'b']);
  });
});

describe('copying the column headers', () => {
  it('takes the row nearest the cells when asked for it', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCells([
      [0, 0, 'x'],
      [0, 1, 'y'],
    ]);
    grid.selectCell(0, 0, 0, 1);
    expect(clipboardOf(grid).getRangeData('with-column-headers')).toEqual([
      ['A', 'B'],
      ['x', 'y'],
    ]);
  });

  it('takes the headers on their own', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.setDataAtCell(0, 0, 'x');
    grid.selectCell(0, 0, 0, 1);
    expect(clipboardOf(grid).getRangeData('column-headers-only')).toEqual([['A', 'B']]);
  });

  it('takes every level above the cells when asked for all of them', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      nestedHeaders: [[{ label: 'pair', colspan: 2 }], ['x', 'y']],
    });
    grid.setDataAtCells([
      [0, 0, '1'],
      [0, 1, '2'],
    ]);
    grid.selectCell(0, 0, 0, 1);
    expect(clipboardOf(grid).getRangeData('with-all-column-headers')).toEqual([
      ['pair', ''],
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('offers the header modes as settings too', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 1,
      copyPaste: { copyColumnHeadersOnly: true },
    });
    expect(clipboardOf(grid).isHeaderModeAllowed('column-headers-only')).toBe(true);
    expect(clipboardOf(grid).isHeaderModeAllowed('with-all-column-headers')).toBe(false);
  });
});

describe('where a paste puts what was already there', () => {
  it('pushes the rows down instead of writing over them', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 1,
      copyPaste: { pasteMode: 'shift_down' },
    });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
      [2, 0, 'c'],
    ]);
    grid.selectCell(1, 0);
    clipboardOf(grid).paste('X');
    expect([0, 1, 2, 3].map((row) => grid.getDataAtCell(row, 0))).toEqual(['a', 'X', 'b', 'c']);
  });

  it('pushes the columns right instead of writing over them', async () => {
    const { grid } = await mountGrid({
      startRows: 1,
      startCols: 4,
      copyPaste: { pasteMode: 'shift_right' },
    });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [0, 2, 'c'],
    ]);
    grid.selectCell(0, 1);
    clipboardOf(grid).paste('X');
    expect([0, 1, 2, 3].map((col) => grid.getDataAtCell(0, col))).toEqual(['a', 'X', 'b', 'c']);
  });

  it('writes over them when that is the mode, which is the default', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 1 });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
    ]);
    grid.selectCell(0, 0);
    clipboardOf(grid).paste('X');
    expect([0, 1].map((row) => grid.getDataAtCell(row, 0))).toEqual(['X', 'b']);
  });
});

describe('the autofill settings that were declared but never read', () => {
  it('refuses a sideways drag when only vertical fills are allowed', async () => {
    const grid = await makeGrid({
      startRows: 3,
      startCols: 3,
      fillHandle: { direction: 'vertical' },
    });
    grid.setDataAtCell(0, 0, 'x');
    grid.selectCell(0, 0);
    autofillOf(grid).fill({ startRow: 0, endRow: 0, startCol: 0, endCol: 2 });
    expect(grid.getDataAtCell(0, 1)).toBe('');
  });

  it('reads the bare string as the direction it is shorthand for', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3, fillHandle: 'horizontal' });
    grid.setDataAtCell(0, 0, 'x');
    grid.selectCell(0, 0);
    autofillOf(grid).fill({ startRow: 0, endRow: 2, startCol: 0, endCol: 1 });
    expect(grid.getDataAtCell(0, 1)).toBe('x');
    expect(grid.getDataAtCell(1, 0)).toBe('');
  });

  it('stops at the last row rather than growing the table', async () => {
    const grid = await makeGrid({
      startRows: 4,
      startCols: 1,
      fillHandle: { autoInsertRow: false },
    });
    grid.setDataAtCells([
      [0, 0, '1'],
      [1, 0, '2'],
    ]);
    grid.selectCell(0, 0, 1, 0);
    autofillOf(grid).fill({ startRow: 0, endRow: 7, startCol: 0, endCol: 0 });
    expect(grid.countRows()).toBe(4);
    expect([2, 3].map((row) => grid.getDataAtCell(row, 0))).toEqual(['3', '4']);
  });

  it('lets the hook change the values it was handed', async () => {
    const grid = await makeGrid({ startRows: 4, startCols: 1 });
    grid.setDataAtCell(0, 0, 'x');
    grid.addHook('beforeAutofill', (values: string[][]) => {
      values[0]![0] = 'y';
    });
    grid.selectCell(0, 0);
    autofillOf(grid).fill({ startRow: 0, endRow: 2, startCol: 0, endCol: 0 });
    expect([1, 2].map((row) => grid.getDataAtCell(row, 0))).toEqual(['y', 'y']);
  });
});
