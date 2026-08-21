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
  // An empty field and a field that is not there are the same string, so
  // without this a last row whose one cell is `""` cannot be told from the
  // trailing line break spreadsheets end their clipboard text with, and one of
  // the two is a row that has to survive.
  let wasQuoted = false;
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
      wasQuoted = true;
      index += 1;
      continue;
    }
    if (character === '\t') {
      row.push(field);
      field = '';
      wasQuoted = false;
      index += 1;
      continue;
    }
    if (character === '\n' || character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      wasQuoted = false;
      // A CRLF is one line break, not two.
      index += character === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== '' || wasQuoted || row.length > 0) {
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

/**
 * How far a paste reaches.
 *
 * A selection larger than the pasted block repeats it, which is how pasting one
 * value down a column fills the column, so the extent is whichever of the two
 * is larger. Folded rather than spread into `Math.max`: pasting a CSV of a few
 * hundred thousand rows is an ordinary thing to do, and that many arguments
 * overflows the call stack.
 */
export function pasteExtent(
  values: string[][],
  rowCount: number,
  colCount: number,
): { rows: number; cols: number } {
  let cols = colCount;
  for (const line of values) {
    if (line.length > cols) {
      cols = line.length;
    }
  }
  return { rows: Math.max(rowCount, values.length), cols };
}

/** The rectangle a copy covers, after the limits the settings put on it. */
interface CopyBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
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

/**
 * Reads a pasted string as the value it looks like.
 *
 * Only when `parsePastedValue` asks for it. The default is to write what was
 * pasted, because guessing is how a part number becomes a date.
 */
export function parsePastedValue(text: string, locale = 'en-US'): string {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('=')) {
    return text;
  }
  // The separators this locale actually uses, rather than an assumption about
  // commas: `1.234,5` is twelve hundred in German and malformed in English.
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';

  const escape = (character: string): string => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Groups of three, then at most one decimal part — checked before anything is
  // stripped. Stripping first would read `1,234.5` as a German number and turn
  // it into `1.2345`, which is not what was pasted and not what it means.
  const shape = new RegExp(
    `^[+-]?\\d{1,3}(?:${escape(group)}\\d{3})*(?:${escape(decimal)}\\d+)?$` +
      `|^[+-]?\\d+(?:${escape(decimal)}\\d+)?(?:e[+-]?\\d+)?$`,
    'i',
  );
  if (!shape.test(trimmed)) {
    return text;
  }
  return trimmed.split(group).join('').replace(decimal, '.');
}

export class CopyPaste extends BasePlugin {
  static override readonly pluginName: string = 'copyPaste';

  /** `fragmentSelection` decides whether a selection can be copied at all. */
  static override get settingKeys(): string[] {
    return ['copyPaste', 'fragmentSelection'];
  }

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

  /**
   * The rectangle a copy covers.
   *
   * The limits are part of what leaves the grid, so they are settled once here
   * rather than at each caller: the values and the formulas behind them have to
   * describe the same rectangle, or a paste of this grid's own copy writes rows
   * that were never on the clipboard.
   */
  #copyBounds(): CopyBounds | null {
    const range = this.grid.getSelectedRangeLast();
    if (!range) {
      return null;
    }
    const limits = this.options<CopyPasteSettings>();
    return {
      top: range.topRow,
      left: range.startCol,
      bottom: Math.min(range.bottomRow, range.topRow + (limits.rowsLimit ?? 1000) - 1),
      right: Math.min(range.endCol, range.startCol + (limits.columnsLimit ?? 1000) - 1),
    };
  }

  /** Whether a copy puts a row of column headers in front of the values. */
  #copiesHeaders(): boolean {
    const asked = this.options<CopyPasteSettings>().copyColumnHeaders === true;
    return asked && this.grid.hasColHeaders();
  }

  /** A rectangle read one cell at a time, blanking what may not be copied. */
  #collect(bounds: CopyBounds, read: (row: number, col: number) => string): string[][] {
    const rows: string[][] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const values: string[] = [];
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        values.push(this.isCopyable(row, col) ? read(row, col) : '');
      }
      rows.push(values);
    }
    return rows;
  }

  /** The selected cells as a rectangle of values. */
  getRangeData(): string[][] {
    const bounds = this.#copyBounds();
    if (!bounds) {
      return [];
    }
    const rows = this.#collect(bounds, (row, col) => this.grid.getDataAtCell(row, col));
    if (this.#copiesHeaders()) {
      const header: string[] = [];
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        header.push(this.grid.getColHeader(col));
      }
      rows.unshift(header);
    }
    return rows;
  }

  /**
   * Whether a cell's value may leave the grid.
   *
   * `copyable: false` is how a column of secrets stays out of the clipboard.
   * The cell is still there and still readable on screen — this is about what
   * crosses into another application, not about hiding anything.
   */
  isCopyable(row: number, col: number): boolean {
    return this.grid.getCellMeta(row, col)['copyable'] !== false;
  }

  /** The same rectangle, as the formulas behind it rather than their results. */
  getRangeSource(): string[][] {
    const bounds = this.#copyBounds();
    if (!bounds) {
      return [];
    }
    return this.#collect(bounds, (row, col) => this.grid.getSourceDataAtCell(row, col));
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
    // With a header row in front of them the source rows no longer sit where
    // they were copied from, and every formula would be shifted by one. Keeping
    // no clipping costs this grid the formulas on a paste back into itself and
    // gains it the same block every other application is handed.
    this.#clipping =
      range && !this.#copiesHeaders()
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
    const prepared = this.#prepare(shifted, range.topRow, range.startCol);
    const extent = pasteExtent(prepared, range.rowCount, range.colCount);
    this.grid.populateFromArray(
      range.topRow,
      range.startCol,
      prepared,
      range.topRow + extent.rows - 1,
      range.startCol + extent.cols - 1,
      'paste',
    );
    this.grid.hooks.run('afterPaste', undefined, values, range.toArray());
  }

  /**
   * Applies the settings that decide what a paste may write.
   *
   * A row or column marked `skipRowOnPaste` / `skipColumnOnPaste` keeps what it
   * has — the incoming value is dropped rather than shifted into the next cell,
   * because shifting would silently misalign every column after it.
   */
  #prepare(values: string[][], top: number, left: number): string[][] {
    const settings = this.grid.getSettings();
    const trim = settings.trimWhitespace !== false;
    const parse = settings.parsePastedValue === true;

    return values.map((line, r) => {
      const row = top + r;
      if (this.grid.getCellMeta(row, left)['skipRowOnPaste'] === true) {
        // Keep the row's own values, so the block below it stays in place.
        return line.map((_, c) => this.grid.getSourceDataAtCell(row, left + c));
      }
      return line.map((value, c) => {
        const col = left + c;
        const meta = this.grid.getCellMeta(row, col);
        if (meta['skipColumnOnPaste'] === true) {
          return this.grid.getSourceDataAtCell(row, col);
        }
        let text = trim ? value.trim() : value;
        if (parse) {
          // A pasted `1,234` is a number to the reader; without this it is the
          // text `1,234`, which sorts and sums as nothing.
          const parsed = parsePastedValue(text, this.grid.getLocale());
          text = parsed;
        }
        return text;
      });
    });
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

registerPlugin(CopyPaste);
