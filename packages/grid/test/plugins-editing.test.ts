import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import type { Autofill, Comments, CopyPaste, MergeCells } from '../src/plugins/index.js';
import {
  escapeClipboardValue,
  extendSeries,
  parseClipboardText,
  toClipboardHtml,
  toClipboardText,
} from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 6, startCols: 4, ...settings }).then((m) => m.grid);

/** A `ClipboardEvent` jsdom will accept, with a data transfer we can inspect. */
function clipboardEvent(type: string, text = ''): ClipboardEvent {
  const store = new Map<string, string>();
  if (text !== '') {
    store.set('text/plain', text);
  }
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => store.get(format) ?? '',
      setData: (format: string, value: string) => store.set(format, value),
    },
    configurable: true,
  });
  return event;
}

describe('the clipboard text format', () => {
  it('splits on tabs and newlines', () => {
    expect(parseClipboardText('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('treats a CRLF as one line break', () => {
    expect(parseClipboardText('a\r\nb')).toEqual([['a'], ['b']]);
  });

  it('keeps a tab that was quoted inside a field', () => {
    expect(parseClipboardText('"a\tb"\tc')).toEqual([['a\tb', 'c']]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseClipboardText('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });

  it('keeps a newline that was quoted inside a field', () => {
    expect(parseClipboardText('"line one\nline two"\tb')).toEqual([['line one\nline two', 'b']]);
  });

  it('keeps empty trailing cells on a row', () => {
    expect(parseClipboardText('a\t\tb')).toEqual([['a', '', 'b']]);
  });

  it('round-trips anything it can write', () => {
    const rows = [
      ['plain', 'with\ttab'],
      ['with "quotes"', 'with\nnewline'],
    ];
    expect(parseClipboardText(toClipboardText(rows))).toEqual(rows);
  });

  it('quotes only what needs quoting', () => {
    expect(escapeClipboardValue('plain')).toBe('plain');
    expect(escapeClipboardValue('a\tb')).toBe('"a\tb"');
    expect(escapeClipboardValue('a"b')).toBe('"a""b"');
  });

  it('escapes markup in the HTML flavour', () => {
    expect(toClipboardHtml([['<b>&']])).toBe('<table><tbody><tr><td>&lt;b&gt;&amp;</td></tr></tbody></table>');
  });
});

describe('the copyPaste plugin', () => {
  it('is on by default and puts both flavours on the clipboard', async () => {
    const grid = await makeGrid();
    grid.setDataAtCells([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, 'c'],
      [1, 1, 'd'],
    ]);
    const plugin = grid.getPlugin('copyPaste') as unknown as CopyPaste;
    expect(grid.isPluginEnabled('copyPaste')).toBe(true);

    grid.selectCell(0, 0, 1, 1);
    expect(plugin.getRangeData()).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);

    const event = clipboardEvent('copy');
    plugin.onCopy(event, false);
    expect(event.clipboardData?.getData('text/plain')).toBe('a\tb\nc\td');
    expect(event.clipboardData?.getData('text/html')).toContain('<td>a</td>');
  });

  it('empties the cells it cut', async () => {
    const grid = await makeGrid();
    grid.setDataAtCell(0, 0, 'gone');
    grid.selectCell(0, 0);
    const plugin = grid.getPlugin('copyPaste') as unknown as CopyPaste;
    plugin.onCopy(clipboardEvent('cut'), true);
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });

  it('pastes a block at the selection', async () => {
    const grid = await makeGrid();
    grid.selectCell(1, 1);
    const plugin = grid.getPlugin('copyPaste') as unknown as CopyPaste;
    plugin.paste('x\ty\nz\tw');
    expect(grid.getDataAtCell(1, 1)).toBe('x');
    expect(grid.getDataAtCell(1, 2)).toBe('y');
    expect(grid.getDataAtCell(2, 1)).toBe('z');
    expect(grid.getDataAtCell(2, 2)).toBe('w');
  });

  it('repeats one pasted value across a larger selection', async () => {
    const grid = await makeGrid();
    grid.selectCell(0, 0, 2, 0);
    const plugin = grid.getPlugin('copyPaste') as unknown as CopyPaste;
    plugin.paste('7');
    expect(grid.getDataAtCell(0, 0)).toBe('7');
    expect(grid.getDataAtCell(1, 0)).toBe('7');
    expect(grid.getDataAtCell(2, 0)).toBe('7');
  });

  it('lets a hook veto a paste', async () => {
    const grid = await makeGrid();
    grid.addHook('beforePaste', () => false);
    grid.selectCell(0, 0);
    (grid.getPlugin('copyPaste') as unknown as CopyPaste).paste('nope');
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });

  it('copies the column headers when asked', async () => {
    const grid = await makeGrid({ copyPaste: { copyColumnHeaders: true } });
    grid.setDataAtCell(0, 0, 'v');
    grid.selectCell(0, 0);
    const rows = (grid.getPlugin('copyPaste') as unknown as CopyPaste).getRangeData();
    expect(rows).toEqual([['A'], ['v']]);
  });

  it('shifts a formula it copied itself, but not one pasted from elsewhere', async () => {
    const grid = await makeGrid();
    grid.setDataAtCells([
      [0, 0, '2'],
      [1, 0, '3'],
      [0, 1, '=A1*10'],
    ]);
    const plugin = grid.getPlugin('copyPaste') as unknown as CopyPaste;

    grid.selectCell(0, 1);
    const copied = clipboardEvent('copy');
    plugin.onCopy(copied, false);
    // The clipboard's text flavour carries the result, as Excel's does.
    expect(copied.clipboardData?.getData('text/plain')).toBe('20');

    grid.selectCell(1, 1);
    plugin.paste(copied.clipboardData?.getData('text/plain') ?? '');
    expect(grid.getSourceDataAtCell(1, 1)).toBe('=A2*10');
    expect(grid.getDataAtCell(1, 1)).toBe('30');

    // Text that did not come from this grid is taken at face value.
    grid.selectCell(2, 1);
    plugin.paste('=A1*10');
    expect(grid.getSourceDataAtCell(2, 1)).toBe('=A1*10');
  });

  it('answers a paste event on the table', async () => {
    const grid = await makeGrid();
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(clipboardEvent('paste', 'from-event'));
    expect(grid.getDataAtCell(0, 0)).toBe('from-event');
  });
});

describe('filling a series', () => {
  it('continues two evenly spaced numbers', () => {
    expect(extendSeries(['1', '2'], 3)).toEqual(['3', '4', '5']);
    expect(extendSeries(['10', '20'], 2)).toEqual(['30', '40']);
  });

  it('continues a descending series', () => {
    expect(extendSeries(['5', '3'], 2)).toEqual(['1', '-1']);
  });

  it('repeats a single number rather than counting up', () => {
    expect(extendSeries(['7'], 3)).toEqual(['7', '7', '7']);
  });

  it('repeats text', () => {
    expect(extendSeries(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
  });

  it('repeats numbers that are not evenly spaced', () => {
    expect(extendSeries(['1', '2', '5'], 2)).toEqual(['1', '2']);
  });

  it('repeats a run of equal numbers instead of adding zero forever', () => {
    expect(extendSeries(['4', '4'], 2)).toEqual(['4', '4']);
  });
});

describe('the autofill plugin', () => {
  it('continues a series downward', async () => {
    const grid = await makeGrid();
    grid.setDataAtCells([
      [0, 0, '1'],
      [1, 0, '2'],
    ]);
    grid.selectCell(0, 0, 1, 0);
    (grid.getPlugin('autofill') as unknown as Autofill).fill({
      startRow: 0,
      endRow: 4,
      startCol: 0,
      endCol: 0,
    });
    expect(grid.getDataAtCell(2, 0)).toBe('3');
    expect(grid.getDataAtCell(3, 0)).toBe('4');
    expect(grid.getDataAtCell(4, 0)).toBe('5');
  });

  it('continues a series upward, counting backward', async () => {
    const grid = await makeGrid();
    grid.setDataAtCells([
      [3, 0, '10'],
      [4, 0, '11'],
    ]);
    grid.selectCell(3, 0, 4, 0);
    (grid.getPlugin('autofill') as unknown as Autofill).fill({
      startRow: 1,
      endRow: 4,
      startCol: 0,
      endCol: 0,
    });
    expect(grid.getDataAtCell(2, 0)).toBe('9');
    expect(grid.getDataAtCell(1, 0)).toBe('8');
  });

  it('fills sideways too', async () => {
    const grid = await makeGrid();
    grid.setDataAtCell(0, 0, 'x');
    grid.selectCell(0, 0);
    (grid.getPlugin('autofill') as unknown as Autofill).fill({
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 2,
    });
    expect(grid.getDataAtCell(0, 1)).toBe('x');
    expect(grid.getDataAtCell(0, 2)).toBe('x');
  });

  it('carries a formula down with its references shifted', async () => {
    const grid = await makeGrid();
    grid.setDataAtCells([
      [0, 0, '2'],
      [1, 0, '3'],
      [2, 0, '4'],
      [0, 1, '=A1*10'],
    ]);
    grid.selectCell(0, 1);
    (grid.getPlugin('autofill') as unknown as Autofill).fill({
      startRow: 0,
      endRow: 2,
      startCol: 1,
      endCol: 1,
    });
    expect(grid.getSourceDataAtCell(1, 1)).toBe('=A2*10');
    expect(grid.getDataAtCell(1, 1)).toBe('30');
    expect(grid.getDataAtCell(2, 1)).toBe('40');
  });

  it('lets a hook veto the fill', async () => {
    const grid = await makeGrid();
    grid.addHook('beforeAutofill', () => false);
    grid.setDataAtCell(0, 0, 'x');
    grid.selectCell(0, 0);
    (grid.getPlugin('autofill') as unknown as Autofill).fill({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 0,
    });
    expect(grid.getDataAtCell(1, 0)).toBe('');
  });
});

describe('the mergeCells plugin', () => {
  it('is off unless the settings ask for it', async () => {
    const grid = await makeGrid();
    expect(grid.isPluginEnabled('mergeCells')).toBe(false);
  });

  it('merges a rectangle and keeps only the corner value', async () => {
    const grid = await makeGrid({ mergeCells: true });
    grid.setDataAtCells([
      [0, 0, 'keep'],
      [0, 1, 'lose'],
      [1, 0, 'lose'],
      [1, 1, 'lose'],
    ]);
    const plugin = grid.getPlugin('mergeCells') as unknown as MergeCells;
    plugin.merge(0, 0, 1, 1);

    expect(grid.getDataAtCell(0, 0)).toBe('keep');
    expect(grid.getDataAtCell(0, 1)).toBe('');
    expect(grid.getDataAtCell(1, 1)).toBe('');
    expect(plugin.getMergedAreas()).toEqual([{ row: 0, col: 0, rowspan: 2, colspan: 2 }]);
    expect(plugin.isCovered(0, 1)).toBe(true);
    expect(plugin.isCovered(0, 0)).toBe(false);
  });

  it('takes its areas from the settings', async () => {
    const grid = await makeGrid({ mergeCells: [{ row: 1, col: 1, rowspan: 2, colspan: 2 }] });
    const plugin = grid.getPlugin('mergeCells') as unknown as MergeCells;
    expect(plugin.getCoveringArea(2, 2)).toEqual({ row: 1, col: 1, rowspan: 2, colspan: 2 });
    expect(plugin.getCoveringArea(0, 0)).toBeNull();
  });

  it('spans the corner cell and hides the covered ones when rendering', async () => {
    const grid = await makeGrid({ mergeCells: [{ row: 0, col: 0, rowspan: 2, colspan: 2 }] });
    grid.render();
    const corner = grid.view?.elementAt(0, 0);
    const covered = grid.view?.elementAt(0, 1);
    expect(corner?.rowSpan).toBe(2);
    expect(corner?.colSpan).toBe(2);
    expect(covered?.style.display).toBe('none');
  });

  it('replaces an overlapping merge rather than nesting one inside it', async () => {
    const grid = await makeGrid({ mergeCells: true });
    const plugin = grid.getPlugin('mergeCells') as unknown as MergeCells;
    plugin.merge(0, 0, 1, 1);
    plugin.merge(1, 1, 2, 2);
    expect(plugin.getMergedAreas()).toEqual([{ row: 1, col: 1, rowspan: 2, colspan: 2 }]);
  });

  it('ignores a merge of a single cell', async () => {
    const grid = await makeGrid({ mergeCells: true });
    const plugin = grid.getPlugin('mergeCells') as unknown as MergeCells;
    plugin.merge(0, 0, 0, 0);
    expect(plugin.getMergedAreas()).toEqual([]);
  });

  it('toggles the selection between merged and not', async () => {
    const grid = await makeGrid({ mergeCells: true });
    const plugin = grid.getPlugin('mergeCells') as unknown as MergeCells;
    grid.selectCell(0, 0, 1, 1);
    plugin.toggleMerge();
    expect(plugin.getMergedAreas()).toHaveLength(1);
    plugin.toggleMerge();
    expect(plugin.getMergedAreas()).toHaveLength(0);
  });

  it('lets a hook veto a merge', async () => {
    const grid = await makeGrid({ mergeCells: true });
    grid.addHook('beforeMergeCells', () => false);
    const plugin = grid.getPlugin('mergeCells') as unknown as MergeCells;
    plugin.merge(0, 0, 1, 1);
    expect(plugin.getMergedAreas()).toEqual([]);
  });
});

describe('the comments plugin', () => {
  it('keeps a comment out of the cell value', async () => {
    const grid = await makeGrid({ comments: true });
    const plugin = grid.getPlugin('comments') as unknown as Comments;
    grid.setDataAtCell(0, 0, '5');
    plugin.setComment(0, 0, 'checked with finance');

    expect(plugin.getComment(0, 0)).toEqual({ value: 'checked with finance' });
    expect(grid.getDataAtCell(0, 0)).toBe('5');
    // A formula reading the cell sees the number, not the note.
    grid.setDataAtCell(1, 0, '=A1+1');
    expect(grid.getDataAtCell(1, 0)).toBe('6');
  });

  it('marks a commented cell when rendering', async () => {
    const grid = await makeGrid({ comments: true });
    const plugin = grid.getPlugin('comments') as unknown as Comments;
    plugin.setComment(0, 0, 'a note');
    const cell = grid.view?.elementAt(0, 0);
    expect(cell?.classList.contains('htCommentCell')).toBe(true);
    expect(cell?.title).toBe('a note');
  });

  it('removes a comment', async () => {
    const grid = await makeGrid({ comments: true });
    const plugin = grid.getPlugin('comments') as unknown as Comments;
    plugin.setComment(0, 0, 'a note');
    plugin.removeComment(0, 0);
    expect(plugin.getComment(0, 0)).toBeNull();
  });

  it('reads a comment given as a plain string in the cell meta', async () => {
    const grid = await makeGrid({ comments: true });
    grid.setCellMeta(0, 0, 'comment', 'terse');
    const plugin = grid.getPlugin('comments') as unknown as Comments;
    expect(plugin.getComment(0, 0)).toEqual({ value: 'terse' });
  });

  it('comments whatever is selected', async () => {
    const grid = await makeGrid({ comments: true });
    grid.selectCell(2, 1);
    const plugin = grid.getPlugin('comments') as unknown as Comments;
    plugin.setCommentAtSelection('here');
    expect(plugin.getComment(2, 1)?.value).toBe('here');
  });

  it('saves the box on blur and takes it down', async () => {
    const grid = await makeGrid({ comments: true });
    const plugin = grid.getPlugin('comments') as unknown as Comments;
    plugin.show(0, 0);
    const box = document.querySelector('textarea.cm-comment') as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    box.value = 'typed in';
    box.dispatchEvent(new Event('blur'));
    expect(plugin.getComment(0, 0)?.value).toBe('typed in');
    expect(document.querySelector('textarea.cm-comment')).toBeNull();
  });
});
