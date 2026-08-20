/**
 * Copy, cut and paste.
 *
 * The clipboard carries two flavours: tab-separated text, which every
 * spreadsheet and text editor understands, and an HTML table, which preserves
 * the shape when pasting into a word processor. Writing both is what makes a
 * copy out of this grid land correctly in Excel.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface CopyPasteSettings {
  columnsLimit?: number;
  rowsLimit?: number;
  pasteMode?: 'overwrite' | 'shift_down' | 'shift_right';
  copyColumnHeaders?: boolean;
}

/**
 * Parses the tab-separated text a spreadsheet puts on the clipboard.
 *
 * Quoting follows the CSV rules that Excel uses for its text flavour: a field
 * containing a tab, a newline or a quote is wrapped in quotes, and a quote
 * inside is doubled. Parsing this properly is what stops a pasted sentence
 * with a comma in it from becoming two cells.
 */
export function parseClipboardText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === '\t') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (character === '\n' || character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      // A CRLF is one line break, not two.
      index += character === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Writes a value the way the clipboard's text flavour expects. */
export function escapeClipboardValue(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Turns a rectangle of values into tab-separated text. */
export function toClipboardText(rows: string[][]): string {
  return rows.map((row) => row.map(escapeClipboardValue).join('\t')).join('\n');
}

/** Turns it into an HTML table, for applications that prefer one. */
export function toClipboardHtml(rows: string[][]): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

/** What a copy took out of the grid, kept so a paste can shift its formulas. */
interface Clipping {
  row: number;
  col: number;
  /** The source text — formulas, not their results. */
  source: string[][];
  /** The text flavour that went on the system clipboard, to recognise it by. */
  text: string;
}

export class CopyPaste extends BasePlugin {
  static override readonly pluginName: string = 'copyPaste';

  /**
   * The last copy made from this grid.
   *
   * A spreadsheet's clipboard carries more than the text it hands to other
   * applications: pasting `=A1+1` one row down has to become `=A2+1`, and the
   * plain text on the system clipboard says nothing about where it came from.
   * Keeping the clipping lets a paste of our own copy shift its references,
   * while a paste from anywhere else still lands verbatim.
   */
  #clipping: Clipping | null = null;

  override isEnabled(): boolean {
    return this.grid.getSettings().copyPaste !== false;
  }

  protected override onEnable(): void {
    const root = this.grid.view?.root;
    if (!root) {
      return;
    }
    this.listen(root, 'copy', (event: ClipboardEvent) => this.onCopy(event, false));
    this.listen(root, 'cut', (event: ClipboardEvent) => this.onCopy(event, true));
    this.listen(root, 'paste', (event: ClipboardEvent) => this.onPaste(event));
  }

  /** The selected cells as a rectangle of values. */
  getRangeData(): string[][] {
    const range = this.grid.getSelectedRangeLast();
    if (!range) {
      return [];
    }
    const limits = this.settings<CopyPasteSettings>() ?? {};
    const lastRow = Math.min(range.bottomRow, range.topRow + (limits.rowsLimit ?? 1000) - 1);
    const lastCol = Math.min(range.endCol, range.startCol + (limits.columnsLimit ?? 1000) - 1);

    const rows: string[][] = [];
    if (limits.copyColumnHeaders && this.grid.hasColHeaders()) {
      const header: string[] = [];
      for (let col = range.startCol; col <= lastCol; col += 1) {
        header.push(this.grid.getColHeader(col));
      }
      rows.push(header);
    }
    for (let row = range.topRow; row <= lastRow; row += 1) {
      const values: string[] = [];
      for (let col = range.startCol; col <= lastCol; col += 1) {
        values.push(this.grid.getDataAtCell(row, col));
      }
      rows.push(values);
    }
    return rows;
  }

  /** The same rectangle, as the formulas behind it rather than their results. */
  getRangeSource(): string[][] {
    const range = this.grid.getSelectedRangeLast();
    if (!range) {
      return [];
    }
    const rows: string[][] = [];
    for (let row = range.topRow; row <= range.bottomRow; row += 1) {
      const values: string[] = [];
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        values.push(this.grid.getSourceDataAtCell(row, col));
      }
      rows.push(values);
    }
    return rows;
  }

  /** The selected cells as clipboard text, for a caller doing its own copy. */
  getCopyableText(): string {
    return toClipboardText(this.getRangeData());
  }

  /** Handles a copy or a cut. */
  onCopy(event: ClipboardEvent, isCut: boolean): void {
    const rows = this.getRangeData();
    if (rows.length === 0) {
      return;
    }
    const hookName = isCut ? 'beforeCut' : 'beforeCopy';
    if (this.grid.hooks.allows(hookName, rows) === false) {
      event.preventDefault();
      return;
    }
    const text = toClipboardText(rows);
    event.clipboardData?.setData('text/plain', text);
    event.clipboardData?.setData('text/html', toClipboardHtml(rows));
    event.preventDefault();

    const range = this.grid.getSelectedRangeLast();
    this.#clipping = range
      ? { row: range.topRow, col: range.startCol, source: this.getRangeSource(), text }
      : null;

    if (isCut) {
      this.grid.emptySelectedCells('cut');
    }
    this.grid.hooks.run(isCut ? 'afterCut' : 'afterCopy', undefined, rows);
  }

  /** Handles a paste. */
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) {
      return;
    }
    event.preventDefault();
    this.paste(text);
  }

  /** Pastes clipboard text into the selection. */
  paste(text: string): void {
    const values = parseClipboardText(text);
    if (values.length === 0) {
      return;
    }
    const range = this.grid.getSelectedRangeLast();
    if (!range) {
      return;
    }
    if (this.grid.hooks.allows('beforePaste', values, range.toArray()) === false) {
      return;
    }
    const shifted = this.#shiftClipping(text, range.topRow, range.startCol) ?? values;
    // A selection larger than the pasted block repeats it, which is how
    // pasting one value over a column fills the column.
    const height = Math.max(range.rowCount, shifted.length);
    const width = Math.max(range.colCount, Math.max(...shifted.map((row) => row.length)));
    this.grid.populateFromArray(
      range.topRow,
      range.startCol,
      shifted,
      range.topRow + height - 1,
      range.startCol + width - 1,
      'paste',
    );
    this.grid.hooks.run('afterPaste', undefined, values, range.toArray());
  }

  /**
   * The stored clipping with its formulas moved to the paste target, or `null`
   * when the clipboard did not come from this grid.
   *
   * Comparing the text is what tells the two apart: if the system clipboard
   * still holds exactly what we put there, this is our copy. If the user copied
   * something else in between, the text differs and the paste lands verbatim,
   * which is the only safe reading of a formula from an unknown source.
   */
  #shiftClipping(text: string, row: number, col: number): string[][] | null {
    const clipping = this.#clipping;
    if (!clipping || clipping.text !== text) {
      return null;
    }
    const rows = row - clipping.row;
    const cols = col - clipping.col;
    if (rows === 0 && cols === 0) {
      return clipping.source;
    }
    return clipping.source.map((line) =>
      line.map((value) => this.grid.translateFormula(value, rows, cols)),
    );
  }
}

registerPlugin(CopyPaste as never);
