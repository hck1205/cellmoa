/**
 * Exporting the table to a file.
 *
 * Two formats, and they are not the same kind of thing. CSV is built here from
 * what the cells show, because that is what a CSV is: a picture of the values.
 * `.xlsx` is built by the engine, because a workbook has formulas, styles and
 * defined names that only the engine knows about — rebuilding it in the browser
 * would quietly drop all of them.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface ExportOptions {
  /** What goes between fields. A single character. */
  columnDelimiter?: string;
  /** What goes between rows. */
  rowDelimiter?: string;
  /** Wrap every field in quotes, not just the ones that need it. */
  exportHiddenRows?: boolean;
  exportHiddenColumns?: boolean;
  columnHeaders?: boolean;
  rowHeaders?: boolean;
  /** The rectangle to export. Defaults to the whole table. */
  range?: [number, number, number, number];
  /** The name offered in the save dialog, without an extension. */
  filename?: string;
  mimeType?: string;
  /** Add a UTF-8 byte-order mark, which is what makes Excel read it as UTF-8. */
  bom?: boolean;
}

const DEFAULTS: Required<Pick<ExportOptions, 'columnDelimiter' | 'rowDelimiter'>> = {
  columnDelimiter: ',',
  rowDelimiter: '\r\n',
};

/**
 * Quotes a CSV field when it needs it.
 *
 * A field is quoted if it contains the delimiter, a quote or a line break, and
 * a quote inside is doubled. A leading or trailing space is quoted too, since
 * some readers strip it otherwise.
 */
export function escapeCsvValue(value: string, delimiter: string): string {
  const needsQuotes =
    value.includes(delimiter) ||
    /["\n\r]/.test(value) ||
    value !== value.trim();
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
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
    const [startRow, startCol, endRow, endCol] = options.range ?? [
      0,
      0,
      this.grid.countRows() - 1,
      this.grid.countCols() - 1,
    ];

    const lines: string[] = [];
    if (options.columnHeaders && this.grid.hasColHeaders()) {
      const header: string[] = [];
      if (options.rowHeaders) {
        // The corner cell above the row headers is empty, as it is on screen.
        header.push('');
      }
      for (let col = startCol; col <= endCol; col += 1) {
        if (this.#skipColumn(col, options)) {
          continue;
        }
        header.push(escapeCsvValue(this.grid.getColHeader(col), columnDelimiter));
      }
      lines.push(header.join(columnDelimiter));
    }

    for (let row = startRow; row <= endRow; row += 1) {
      if (this.#skipRow(row, options)) {
        continue;
      }
      const values: string[] = [];
      if (options.rowHeaders) {
        values.push(escapeCsvValue(this.grid.getRowHeader(row), columnDelimiter));
      }
      for (let col = startCol; col <= endCol; col += 1) {
        if (this.#skipColumn(col, options)) {
          continue;
        }
        values.push(escapeCsvValue(this.grid.getDataAtCell(row, col), columnDelimiter));
      }
      lines.push(values.join(columnDelimiter));
    }
    const body = lines.join(rowDelimiter);
    return options.bom ? `﻿${body}` : body;
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
    link.download = `${options.filename ?? 'export'}.${format}`;
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
