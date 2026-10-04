import { describe, expect, it } from 'vitest';
import type { CopyPaste } from '../src/plugins/index.js';
import { parsePastedValue } from '../src/plugins/index.js';
import { pasteExtent, parseClipboardText } from '../src/plugins/copyPaste.js';
import { clipboardEvent, mountGrid } from './helpers.js';

const clipboardOf = (grid: Awaited<ReturnType<typeof mountGrid>>['grid']) =>
  grid.getPlugin('copyPaste') as unknown as CopyPaste;

describe('reading the clipboard text', () => {
  it('keeps a field that was quoted down to nothing', () => {
    // `""` is how a producer says "this cell is deliberately empty"; dropping
    // it loses a row that the clipboard plainly described.
    expect(parseClipboardText('""')).toEqual([['']]);
    expect(parseClipboardText('a\n""')).toEqual([['a'], ['']]);
  });
});

describe('how far a paste reaches', () => {
  it('measures a block far too wide to spread as arguments', () => {
    // A pasted CSV of a few hundred thousand rows is an ordinary thing to do,
    // and `Math.max(...rows)` overflows the call stack well before that.
    const huge = Array.from({ length: 200_000 }, () => ['x']);
    expect(pasteExtent(huge, 1, 1)).toEqual({ rows: 200_000, cols: 1 });
  });

  it('takes whichever of the block and the selection is larger', () => {
    expect(pasteExtent([['a', 'b']], 3, 1)).toEqual({ rows: 3, cols: 2 });
    expect(pasteExtent([['a'], ['b']], 1, 4)).toEqual({ rows: 2, cols: 4 });
  });
});

describe('what a copy carries back to its own grid', () => {
  it('pastes back exactly the rows the clipboard was given', async () => {
    const { grid } = await mountGrid({
      startRows: 6,
      startCols: 1,
      copyPaste: { rowsLimit: 2 },
    });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
      [2, 0, 'c'],
    ]);
    grid.selectCell(0, 0, 2, 0);
    const copied = clipboardEvent('copy');
    clipboardOf(grid).onCopy(copied, false);
    expect(copied.clipboardData?.getData('text/plain')).toBe('a\nb');

    grid.selectCell(3, 0);
    clipboardOf(grid).paste(copied.clipboardData?.getData('text/plain') ?? '');
    // The limit is what left the grid, so it is also what comes back: the third
    // row was never on the clipboard and must not appear.
    expect([3, 4, 5].map((row) => grid.getDataAtCell(row, 0))).toEqual(['a', 'b', '']);
  });

  it('pastes back the header row it put on the clipboard', async () => {
    const { grid } = await mountGrid({
      startRows: 6,
      startCols: 1,
      copyPaste: { copyColumnHeaders: true },
    });
    grid.setDataAtCell(0, 0, 'v');
    grid.selectCell(0, 0);
    const copied = clipboardEvent('copy');
    clipboardOf(grid).onCopy(copied, false);
    expect(copied.clipboardData?.getData('text/plain')).toBe('A\nv');

    grid.selectCell(2, 0);
    clipboardOf(grid).paste(copied.clipboardData?.getData('text/plain') ?? '');
    expect([2, 3].map((row) => grid.getDataAtCell(row, 0))).toEqual(['A', 'v']);
  });
});

describe('what may leave the grid', () => {
  it('blanks a cell marked not copyable', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [{}, { copyable: false }],
    });
    grid.setDataAtCells([
      [0, 0, 'public'],
      [0, 1, 'secret'],
    ]);
    grid.selectCell(0, 0, 0, 1);
    // Still on screen and still readable — this is about the clipboard only.
    expect(grid.getDataAtCell(0, 1)).toBe('secret');
    expect(clipboardOf(grid).getRangeData()).toEqual([['public', '']]);
  });
});

describe('what a paste may write', () => {
  it('leaves a skipped row as it was', async () => {
    const { grid } = await mountGrid({
      startRows: 3,
      startCols: 2,
      cells: (row: number) => (row === 1 ? { skipRowOnPaste: true } : {}),
    });
    grid.setDataAtCell(1, 0, 'kept');
    grid.selectCell(0, 0);
    clipboardOf(grid).paste('a\nb\nc');

    expect(grid.getDataAtCell(0, 0)).toBe('a');
    // The row is skipped, not shifted: 'c' still lands on row 2.
    expect(grid.getDataAtCell(1, 0)).toBe('kept');
    expect(grid.getDataAtCell(2, 0)).toBe('c');
  });

  it('leaves a skipped column as it was', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 3,
      columns: [{}, { skipColumnOnPaste: true }, {}],
    });
    grid.setDataAtCell(0, 1, 'kept');
    grid.selectCell(0, 0);
    clipboardOf(grid).paste('a\tb\tc');
    expect([0, 1, 2].map((col) => grid.getDataAtCell(0, col))).toEqual(['a', 'kept', 'c']);
  });

  it('trims the edges unless told not to', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.selectCell(0, 0);
    clipboardOf(grid).paste('"  padded  "');
    expect(grid.getDataAtCell(0, 0)).toBe('padded');

    const kept = await mountGrid({ startRows: 2, startCols: 2, trimWhitespace: false });
    kept.grid.selectCell(0, 0);
    clipboardOf(kept.grid).paste('"  padded  "');
    expect(kept.grid.getDataAtCell(0, 0)).toBe('  padded  ');
  });

  it('trims a typed value too', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.beginEditing(0, 0);
    grid.closeEditor(true);
    grid.setDataAtCell(0, 0, '  5  ');
    // Typed through the editor, where the setting applies.
    grid.beginEditing(0, 1, '  7  ');
    grid.closeEditor(true);
    expect(grid.getDataAtCell(0, 1)).toBe('7');
  });
});

describe('reading a pasted value as a number', () => {
  it('is off by default, because guessing turns a part number into a date', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.selectCell(0, 0);
    clipboardOf(grid).paste('"1,234"');
    expect(grid.getSourceDataAtCell(0, 0)).toBe('1,234');
  });

  it('reads the grouping the locale actually uses', () => {
    expect(parsePastedValue('1,234.5', 'en-US')).toBe('1234.5');
    expect(parsePastedValue('1.234,5', 'de-DE')).toBe('1234.5');
    // Not a number under this locale's rules, so it is left alone.
    expect(parsePastedValue('1,234.5', 'de-DE')).toBe('1,234.5');
    expect(parsePastedValue('ABC-123', 'en-US')).toBe('ABC-123');
    // A formula is the user's, not ours to reinterpret.
    expect(parsePastedValue('=A1+1', 'en-US')).toBe('=A1+1');
  });

  it('writes the number when asked to', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, parsePastedValue: true });
    grid.selectCell(0, 0);
    clipboardOf(grid).paste('"1,234"');
    expect(grid.getDataAtCell(0, 0)).toBe('1234');
  });
});
