/**
 * Column headers with more than one row.
 *
 * The settings describe the header the way a person would draw it: a list of
 * rows, each a list of labels, where a label can claim several columns. What
 * the view needs is the opposite — for a given window of columns, the cells
 * that cover it — so the plugin normalises the description once and answers
 * windows from that.
 */

import { columnLetters } from '../dataSource.js';
import type { ColHeaderCell } from '../view.js';
import { BasePlugin, registerPlugin } from './base.js';

/** One entry as it may be written in the settings. */
export type NestedHeaderEntry = string | { label?: string; colspan?: number };

/** A header cell after the settings have been normalised. */
export interface HeaderSpan {
  col: number;
  colspan: number;
  label: string;
  /** A collapsible group starts out expanded. */
  collapsible?: boolean;
}

/**
 * Turns the settings into, for each level, the spans it contains.
 *
 * Handsontable lets a row be shorter than the table; the columns past its end
 * simply have no group above them. That is represented as a one-column span
 * with an empty label rather than a gap, because the view draws a `<th>` for
 * every column either way and a gap would shift everything after it.
 */
export function normalizeHeaders(levels: NestedHeaderEntry[][], colCount: number): HeaderSpan[][] {
  return levels.map((row) => {
    const spans: HeaderSpan[] = [];
    let col = 0;
    for (const entry of row) {
      const label = typeof entry === 'string' ? entry : (entry.label ?? '');
      const colspan = Math.max(typeof entry === 'string' ? 1 : (entry.colspan ?? 1), 1);
      if (col >= colCount) {
        break;
      }
      spans.push({ col, colspan: Math.min(colspan, colCount - col), label });
      col += colspan;
    }
    while (col < colCount) {
      spans.push({ col, colspan: 1, label: '' });
      col += 1;
    }
    return spans;
  });
}

export class NestedHeaders extends BasePlugin {
  static override readonly pluginName: string = 'nestedHeaders';

  #levels: HeaderSpan[][] = [];

  override isEnabled(): boolean {
    return Array.isArray(this.grid.getSettings().nestedHeaders);
  }

  protected override onEnable(): void {
    this.#levels = normalizeHeaders(
      (this.grid.getSettings().nestedHeaders as NestedHeaderEntry[][]) ?? [],
      this.grid.countCols(),
    );
    this.addHook('modifyColHeaderLevels', () => this.countLevels());
    this.addHook('modifyColHeaderRows', (_current: unknown, first: number, last: number) =>
      this.rowsFor(first, last),
    );
    this.grid.render();
  }

  protected override onDisable(): void {
    this.#levels = [];
    this.grid.render();
  }

  /**
   * How deep the header is.
   *
   * The bottom row is the columns themselves, which the settings do not have to
   * mention — a `nestedHeaders` of one row means a group row *above* the
   * ordinary header, so the depth is one more than the settings list.
   */
  countLevels(): number {
    return Math.max(this.#levels.length, 1);
  }

  /** Every level, spans and all. */
  getLevels(): HeaderSpan[][] {
    return this.#levels.map((row) => row.map((span) => ({ ...span })));
  }

  /** The span covering a column at one level, or `null` past the end. */
  getSpanAt(level: number, col: number): HeaderSpan | null {
    return (
      this.#levels[level]?.find((span) => col >= span.col && col < span.col + span.colspan) ?? null
    );
  }

  /**
   * The header rows covering a window of columns.
   *
   * A span that starts before the window is clipped to it: the view draws only
   * the columns it is showing, and a `<th>` claiming columns that are not
   * there would push the row out of alignment.
   */
  rowsFor(firstCol: number, lastCol: number): ColHeaderCell[][] {
    const rows: ColHeaderCell[][] = [];
    this.#levels.forEach((spans, level) => {
      const cells: ColHeaderCell[] = [];
      for (const span of spans) {
        const from = Math.max(span.col, firstCol);
        const to = Math.min(span.col + span.colspan - 1, lastCol);
        if (from > to) {
          continue;
        }
        cells.push({ col: from, colspan: to - from + 1, level, label: span.label });
      }
      rows.push(cells);
    });

    // The last configured row *is* the row of columns — the settings describe
    // the whole header, not the groups above one. Appending a row of labels
    // here would draw a band nobody asked for, and push every level's index
    // one out of step with the settings that named it.
    if (rows.length === 0) {
      const bottom: ColHeaderCell[] = [];
      for (let col = firstCol; col <= lastCol; col += 1) {
        bottom.push({
          col,
          colspan: 1,
          level: 0,
          label: this.grid.hasColHeaders() ? this.grid.getColHeader(col) : columnLetters(col),
        });
      }
      rows.push(bottom);
    }
    return rows;
  }
}

registerPlugin(NestedHeaders as never);
