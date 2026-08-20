import { describe, expect, it } from 'vitest';
import type { CopyPaste } from '../src/plugins/index.js';
import { parsePastedValue } from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';

const clipboardOf = (grid: Awaited<ReturnType<typeof mountGrid>>['grid']) =>
  grid.getPlugin('copyPaste') as unknown as CopyPaste;

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
