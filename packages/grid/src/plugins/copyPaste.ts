/**
 * Copy, cut and paste.
 *
 * The clipboard carries two flavours: tab-separated text, which every
 * spreadsheet and text editor understands, and an HTML table, which preserves
 * the shape when pasting into a word processor. Writing both is what makes a
 * copy out of this grid land correctly in Excel.
 */

import { BasePlugin, registerPlugin } from './base.js';

/**
 * Where a paste puts what was already in the cells.
 *
 * `overwrite` writes over them. The two shift modes keep them: the block that
 * was there moves down or to the right of what arrives, which is how a paste
 * inserts rather than replaces.
 */
export type PasteMode = 'overwrite' | 'shift_down' | 'shift_right';

/**
 * What a copy takes.
 *
 * `with-column-group-headers` is the name the reference's own `copy()` uses
 * for `with-all-column-headers`; the guide gives the latter. Both are here
 * because code written against either has to land in the same place.
 */
export type CopyMode =
  | 'cells-only'
  | 'with-column-headers'
  | 'with-all-column-headers'
  | 'with-column-group-headers'
  | 'column-headers-only';

export interface CopyPasteSettings {
  columnsLimit?: number;
  rowsLimit?: number;
  pasteMode?: PasteMode;
  /** Let a copy take the header row nearest the cells. */
  copyColumnHeaders?: boolean;
  /** Let a copy take every header level above the cells. */
  copyColumnGroupHeaders?: boolean;
  /** Let a copy take the headers and none of the cells. */
  copyColumnHeadersOnly?: boolean;
}

/**
 * Parses the tab-separated text a spreadsheet puts on the clipboard.
 *
 * Quoting follows the CSV rules that Excel uses for its text flavour: a field
 * containing a tab, a newline or a quote is wrapped in quotes, and a quote
 * inside is doubled. Parsing this properly is what stops a pasted sentence
 * with a comma in it from becoming two cells.
 */
/** The rectangle a copy covers, after the limits the settings put on it. */
interface CopyBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** How big the selection was before the limits clipped it. */
  askedRows: number;
  askedCols: number;
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

// The formats themselves live apart, and are re-exported because every caller
// and every test has always imported them from here.
import {
  parseClipboardHtml,
  repeatBlock,
  parseClipboardText,
  parsePastedValue,
  pasteExtent,
  toClipboardHtml,
  toClipboardText,
} from './clipboardFormat.js';

export {
  escapeClipboardValue,
  parseClipboardHtml,
  parseClipboardText,
  parsePastedValue,
  pasteExtent,
  toClipboardHtml,
  toClipboardText,
} from './clipboardFormat.js';

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

  /**
   * What the next copy takes, when `copy()` was the one that asked for it.
   *
   * A copy has to be answered by the browser's own `copy` event, so the mode
   * cannot be passed to it directly: it is left here and consumed there.
   */
  #copyMode: CopyMode | null = null;

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
    const limits = this.#limits();
    return {
      top: range.topRow,
      left: range.startCol,
      // The `Math.max` keeps a limit of zero from turning the rectangle inside
      // out and copying a row above the one that was selected.
      bottom: Math.min(range.bottomRow, Math.max(range.topRow + limits.rows - 1, range.topRow)),
      right: Math.min(range.endCol, Math.max(range.startCol + limits.cols - 1, range.startCol)),
      askedRows: range.bottomRow - range.topRow + 1,
      askedCols: range.endCol - range.startCol + 1,
    };
  }

  /**
   * How much of a selection may leave the grid.
   *
   * Both defaults became `Infinity` in the reference's 10.0, and this is why:
   * a finite one stops a copy part-way through what was selected and says
   * nothing about it, so the loss is only ever found in the paste.
   */
  #limits(): { rows: number; cols: number } {
    const settings = this.options<CopyPasteSettings>();
    return { rows: settings.rowsLimit ?? Infinity, cols: settings.columnsLimit ?? Infinity };
  }

  /**
   * Says so when the limits cut a copy short.
   *
   * `afterCopyLimit` is the only warning there is that the clipboard holds
   * less than was selected, which is why it has to run even though nothing in
   * this grid listens to it. The four arguments are the reference's, in its
   * order: a handler for this hook can only have been written against that.
   */
  #announceLimit(bounds: CopyBounds): void {
    const rows = bounds.bottom - bounds.top + 1;
    const cols = bounds.right - bounds.left + 1;
    if (rows === bounds.askedRows && cols === bounds.askedCols) {
      return;
    }
    const limits = this.#limits();
    this.grid.hooks.run('afterCopyLimit', rows, cols, limits.rows, limits.cols);
  }

  /**
   * The mode a copy uses when the caller did not name one.
   *
   * `copyColumnHeaders` has meant "every copy carries the headers" in this
   * grid since it was written, so it keeps meaning that. In the reference the
   * same setting only offers the menu item, and changing it here would take
   * the header row off an existing caller's copy without a word.
   */
  #defaultMode(): CopyMode {
    return this.options<CopyPasteSettings>().copyColumnHeaders === true
      ? 'with-column-headers'
      : 'cells-only';
  }

  /** Which header levels a mode asks for, if any. */
  #headerLevels(mode: CopyMode): 'none' | 'bottom' | 'all' {
    switch (mode) {
      case 'with-column-headers':
      case 'column-headers-only':
        return 'bottom';
      case 'with-all-column-headers':
      case 'with-column-group-headers':
        return 'all';
      default:
        return 'none';
    }
  }

  /**
   * The header rows a copy puts in front of the values.
   *
   * A group's label sits in the first column it spans and the rest of the span
   * is blank, which is what a header cell reports for a column it does not
   * begin. Repeating the label across the span would read, in a spreadsheet
   * that the copy lands in, as one group per column rather than one group.
   */
  #headerRows(bounds: CopyBounds, which: 'bottom' | 'all'): string[][] {
    if (!this.grid.hasColHeaders()) {
      return [];
    }
    const levels = this.grid.getColHeaderRows(bounds.left, bounds.right);
    const wanted = which === 'all' ? levels : levels.slice(-1);
    const width = bounds.right - bounds.left + 1;
    return wanted.map((cells) => {
      const row: string[] = Array.from({ length: width }, () => '');
      for (const cell of cells) {
        row[cell.col - bounds.left] = cell.label;
      }
      return row;
    });
  }

  /**
   * Whether the settings offer a header-copy mode.
   *
   * The three predefined context-menu items are each switched on by one of the
   * three settings, and the menu is the only thing that has to ask.
   */
  isHeaderModeAllowed(mode: CopyMode): boolean {
    if (!this.grid.hasColHeaders()) {
      return false;
    }
    const settings = this.options<CopyPasteSettings>();
    switch (mode) {
      case 'with-column-headers':
        return settings.copyColumnHeaders === true;
      case 'with-all-column-headers':
      case 'with-column-group-headers':
        return settings.copyColumnGroupHeaders === true;
      case 'column-headers-only':
        return settings.copyColumnHeadersOnly === true;
      default:
        return true;
    }
  }

  /**
   * Copies the selection, with as much of its column header as the mode asks.
   *
   * A page may only write to the clipboard while it is answering a `copy`
   * event, so this cannot do the writing: it records what the next copy should
   * take and asks the document for the event. Where `execCommand` is not there
   * the mode still stands, which is what a caller reading `getCopyableText()`
   * for itself relies on.
   */
  copy(mode: CopyMode = 'cells-only'): void {
    this.#copyMode = mode;
    const owner = this.grid.view?.root.ownerDocument ?? globalThis.document;
    owner.execCommand?.('copy');
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
  getRangeData(mode: CopyMode = this.#defaultMode()): string[][] {
    const bounds = this.#copyBounds();
    if (!bounds) {
      return [];
    }
    const which = this.#headerLevels(mode);
    const headers = which === 'none' ? [] : this.#headerRows(bounds, which);
    if (mode === 'column-headers-only') {
      return headers;
    }
    return [...headers, ...this.#collect(bounds, (row, col) => this.grid.getDataAtCell(row, col))];
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
    return this.#collect(bounds, (row, col) => this.grid.getEditableValue(row, col));
  }

  /** The selected cells as clipboard text, for a caller doing its own copy. */
  getCopyableText(mode: CopyMode = this.#defaultMode()): string {
    return toClipboardText(this.getRangeData(mode));
  }

  /** Handles a copy or a cut. */
  onCopy(event: ClipboardEvent, isCut: boolean): void {
    // Whatever `copy()` asked for is spent here, so the next plain Ctrl+C is
    // an ordinary copy again rather than a repeat of the last menu command.
    const mode = this.#copyMode ?? this.#defaultMode();
    this.#copyMode = null;
    const bounds = this.#copyBounds();
    if (bounds) {
      this.#announceLimit(bounds);
    }
    const rows = this.getRangeData(mode);
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
      range && mode === 'cells-only'
        ? { row: range.topRow, col: range.startCol, source: this.getRangeSource(), text }
        : null;

    if (isCut) {
      this.grid.emptySelectedCells('cut');
    }
    this.grid.hooks.run(isCut ? 'afterCut' : 'afterCopy', undefined, rows);
  }

  /**
   * Handles a paste.
   *
   * The HTML flavour is read first and the plain text is the fallback, which
   * is what keeps a paste out of a spreadsheet in the shape it left in: the
   * markup says where every cell ends, so a value holding a tab or a line
   * break of its own arrives as one cell rather than as several.
   *
   * The text is still carried alongside, because it is what identifies a paste
   * of this grid's own copy and so what lets the formulas in it be shifted.
   */
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const values = this.#fromHtml(event.clipboardData?.getData('text/html') ?? '');
    if (!values && !text) {
      return;
    }
    event.preventDefault();
    this.#write(values ?? parseClipboardText(text), text);
  }

  /**
   * The rows an HTML clipboard flavour describes, or `null` when it has none.
   *
   * The caller's `sanitizer` sees it first, as it sees every other piece of
   * foreign markup this grid handles. A setting that covers all but one way in
   * is worth nothing, and this is a way in.
   */
  #fromHtml(html: string): string[][] | null {
    if (!html) {
      return null;
    }
    const sanitizer = this.grid.getSettings().sanitizer;
    return parseClipboardHtml(
      typeof sanitizer === 'function' ? String(sanitizer(html, 'CopyPaste.paste')) : html,
    );
  }

  /** Pastes clipboard text into the selection. */
  paste(text: string): void {
    this.#write(parseClipboardText(text), text);
  }

  /**
   * Writes a pasted rectangle.
   *
   * The clipboard text comes along even when the values were read from the
   * HTML flavour, because it is what says whether this is a paste of this
   * grid's own copy — and so whether the formulas in it may be shifted.
   */
  #write(values: string[][], text: string): void {
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
    const mode = this.options<CopyPasteSettings>().pasteMode ?? 'overwrite';
    const block =
      mode === 'overwrite' ? prepared : this.#shiftAside(prepared, range, extent, mode);
    // The block already covers the whole target under the shift modes, so the
    // corner is taken from it rather than from the extent, which describes
    // only the part of it that was actually pasted.
    const rows = mode === 'overwrite' ? extent.rows : block.length;
    const cols = mode === 'overwrite' ? extent.cols : (block[0]?.length ?? extent.cols);
    this.grid.populateFromArray(
      range.topRow,
      range.startCol,
      block,
      range.topRow + rows - 1,
      range.startCol + cols - 1,
      'paste',
    );
    this.grid.hooks.run('afterPaste', undefined, values, range.toArray());
  }

  /**
   * The pasted block with what was already there moved out of its way.
   *
   * Down or right, depending on the mode. Only the columns the paste covers
   * move down, and only the rows it covers move right — a shift that reached
   * the rest of the table would rearrange cells nobody pasted over.
   */
  #shiftAside(
    values: string[][],
    range: { topRow: number; startCol: number },
    extent: { rows: number; cols: number },
    mode: PasteMode,
  ): string[][] {
    const top = range.topRow;
    const left = range.startCol;
    const block = repeatBlock(values, extent.rows, extent.cols);
    if (mode === 'shift_down') {
      for (let row = top; row < this.grid.countRows(); row += 1) {
        block.push(
          Array.from({ length: extent.cols }, (_, c) =>
            this.grid.getEditableValue(row, left + c),
          ),
        );
      }
      return block;
    }
    return block.map((line, r) => {
      const pushed: string[] = [];
      for (let col = left; col < this.grid.countCols(); col += 1) {
        pushed.push(this.grid.getEditableValue(top + r, col));
      }
      return [...line, ...pushed];
    });
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
        return line.map((_, c) => this.grid.getEditableValue(row, left + c));
      }
      return line.map((value, c) => {
        const col = left + c;
        const meta = this.grid.getCellMeta(row, col);
        if (meta['skipColumnOnPaste'] === true) {
          return this.grid.getEditableValue(row, col);
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
