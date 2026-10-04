/**
 * Exporting the table to a file.
 *
 * Two formats, and they are not the same kind of thing. CSV is built here from
 * what the cells show, because that is what a CSV is: a picture of the values.
 * `.xlsx` is built by the engine, because a workbook has formulas, styles and
 * defined names that only the engine knows about — rebuilding it in the browser
 * would quietly drop all of them.
 *
 * A CSV of values a spreadsheet will execute is the reason `sanitizeValues`
 * exists. It is off by default because escaping changes what the file says,
 * and a grid whose contents are its own is entitled to a faithful export; a
 * grid holding anything a stranger typed should switch it on.
 */

import { BasePlugin, registerPlugin } from './base.js';

/**
 * How a value that a spreadsheet might read as a formula is defanged.
 *
 * `true` applies the OWASP rules; a `RegExp` escapes the values it matches;
 * a function returns whatever should be written instead.
 */
export type SanitizeValues = boolean | RegExp | ((value: string) => string);

export interface ExportOptions {
  /** What goes between fields. A single character. */
  columnDelimiter?: string;
  /** What goes between rows. */
  rowDelimiter?: string;
  /** Export rows a plugin is hiding, rather than leaving them out. */
  exportHiddenRows?: boolean;
  exportHiddenColumns?: boolean;
  /** Put a row of column headers in front of the values. */
  colHeaders?: boolean;
  /**
   * The name `colHeaders` had before the reference renamed it.
   *
   * Kept because it is what this grid asked for until now, and dropping it
   * would take the headers off an existing caller's export without a word.
   */
  columnHeaders?: boolean;
  rowHeaders?: boolean;
  /** The rectangle to export. Defaults to the whole table. */
  range?: [number, number, number, number];
  /**
   * The name offered in the save dialog, without an extension.
   *
   * `[YYYY]`, `[MM]` and `[DD]` are replaced with today's date.
   */
  filename?: string;
  /** The extension put after the filename. Defaults to the format's own. */
  fileExtension?: string;
  mimeType?: string;
  /** Add a UTF-8 byte-order mark, which is what makes Excel read it as UTF-8. */
  bom?: boolean;
  /** Defang values a spreadsheet would otherwise execute. Off by default. */
  sanitizeValues?: SanitizeValues;
}

const DEFAULTS: Required<Pick<ExportOptions, 'columnDelimiter' | 'rowDelimiter' | 'filename'>> = {
  columnDelimiter: ',',
  rowDelimiter: '\r\n',
  filename: 'Handsontable [YYYY]-[MM]-[DD]',
};

/**
 * The lead characters a spreadsheet takes as the start of a formula.
 *
 * `=`, `+`, `-` and `@` are the four OWASP names. The tab and the carriage
 * return are here because a spreadsheet trims them off the front of a field
 * before deciding what the field is, which puts whatever follows back in the
 * lead position. A line feed is not: it ends the field instead, and the
 * quoting already deals with that.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Rewrites a value a spreadsheet would otherwise execute.
 *
 * The escape is a leading apostrophe, which every spreadsheet reads as "the
 * rest of this cell is text" and does not itself show. Prefixing rather than
 * stripping is deliberate: the value a CSV describes is still there to be
 * read, it just stops being a program.
 */
export function sanitizeCsvValue(value: string, how: SanitizeValues): string {
  if (typeof how === 'function') {
    return how(value);
  }
  if (how instanceof RegExp) {
    return how.test(value) ? `'${value}` : value;
  }
  return how && FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/**
 * Quotes a CSV field when it needs it.
 *
 * A field is quoted if it contains the delimiter, a quote or a line break, and
 * a quote inside is doubled. A leading or trailing space is quoted too, since
 * some readers strip it otherwise.
 *
 * Sanitizing quotes everything, as the reference does. Half a file quoted and
 * half not is a file whose readers disagree about where a field begins, and
 * the escaped values are exactly the ones that must not be read wrong.
 */
export function escapeCsvValue(
  value: string,
  delimiter: string,
  sanitize: SanitizeValues = false,
): string {
  if (value === '') {
    return value;
  }
  const sanitized = sanitizeCsvValue(value, sanitize);
  const needsQuotes =
    Boolean(sanitize) ||
    sanitized.includes(delimiter) ||
    /["\n\r]/.test(sanitized) ||
    sanitized !== sanitized.trim();
  return needsQuotes ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
}

/** Puts today's date where the filename asked for it. */
export function applyFilenameDate(filename: string, today = new Date()): string {
  return filename
    .replace(/\[YYYY\]/g, String(today.getFullYear()))
    .replace(/\[MM\]/g, String(today.getMonth() + 1).padStart(2, '0'))
    .replace(/\[DD\]/g, String(today.getDate()).padStart(2, '0'));
}

export class ExportFile extends BasePlugin {
  static override readonly pluginName: string = 'exportFile';

  override isEnabled(): boolean {
    return this.grid.getSettings().exportFile !== false;
  }

  protected override onEnable(): void {
    // Nothing to attach: this plugin is a pair of methods, as in Handsontable.
  }

  /** The table as CSV text. */
  exportAsString(format: 'csv', options: ExportOptions = {}): string {
    if (format !== 'csv') {
      throw new Error(`cannot export ${format} as a string; use downloadFile`);
    }
    const columnDelimiter = options.columnDelimiter ?? DEFAULTS.columnDelimiter;
    const rowDelimiter = options.rowDelimiter ?? DEFAULTS.rowDelimiter;
    const sanitize = options.sanitizeValues ?? false;
    const asField = (value: string): string => escapeCsvValue(value, columnDelimiter, sanitize);
    const [startRow, startCol, endRow, endCol] = options.range ?? [
      0,
      0,
      this.grid.countRows() - 1,
      this.grid.countCols() - 1,
    ];

    const lines: string[] = [];
    if ((options.colHeaders ?? options.columnHeaders) && this.grid.hasColHeaders()) {
      const header: string[] = [];
      if (options.rowHeaders) {
        // The corner cell above the row headers is empty, as it is on screen.
        header.push('');
      }
      for (let col = startCol; col <= endCol; col += 1) {
        if (this.#skipColumn(col, options)) {
          continue;
        }
        header.push(asField(this.grid.getColHeader(col)));
      }
      lines.push(header.join(columnDelimiter));
    }

    for (let row = startRow; row <= endRow; row += 1) {
      if (this.#skipRow(row, options)) {
        continue;
      }
      const values: string[] = [];
      if (options.rowHeaders) {
        values.push(asField(this.grid.getRowHeader(row)));
      }
      for (let col = startCol; col <= endCol; col += 1) {
        if (this.#skipColumn(col, options)) {
          continue;
        }
        values.push(asField(this.grid.getDataAtCell(row, col)));
      }
      lines.push(values.join(columnDelimiter));
    }
    const body = lines.join(rowDelimiter);
    return options.bom ? `\uFEFF${body}` : body;
  }

  /** The workbook as an `.xlsx` file, built by the engine. */
  exportAsWorkbook(): Uint8Array {
    return this.grid.engine.save();
  }

  /** The export as a `Blob`, ready to be handed to a download. */
  exportAsBlob(format: 'csv' | 'xlsx', options: ExportOptions = {}): Blob {
    if (format === 'xlsx') {
      return new Blob([this.exportAsWorkbook() as unknown as BlobPart], {
        type:
          options.mimeType ??
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }
    return new Blob([this.exportAsString('csv', options)], {
      type: options.mimeType ?? 'text/csv;charset=utf-8',
    });
  }

  /** Saves the export to the user's downloads. */
  downloadFile(format: 'csv' | 'xlsx', options: ExportOptions = {}): void {
    const document = this.grid.view?.root.ownerDocument ?? globalThis.document;
    const blob = this.exportAsBlob(format, options);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const extension = options.fileExtension ?? format;
    link.download = `${applyFilenameDate(options.filename ?? DEFAULTS.filename)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Released on the next turn: revoking it before the click has been
    // dispatched cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  #skipRow(row: number, options: ExportOptions): boolean {
    return options.exportHiddenRows !== true && this.grid.isRowHidden(row);
  }

  #skipColumn(col: number, options: ExportOptions): boolean {
    return options.exportHiddenColumns !== true && this.grid.isColumnHidden(col);
  }
}

registerPlugin(ExportFile);
