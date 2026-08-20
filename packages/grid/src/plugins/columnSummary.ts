/**
 * Summary rows.
 *
 * Handsontable computes the total itself and writes the number into a cell.
 * This grid writes a *formula* instead, because there is an engine underneath:
 * a total that is a formula keeps itself right when the numbers above it
 * change, and it survives a save to `.xlsx` as a real total rather than a
 * frozen number.
 */

import { columnLetters } from '../dataSource.js';
import { BasePlugin, registerPlugin } from './base.js';

export type SummaryType = 'sum' | 'min' | 'max' | 'count' | 'average' | 'custom';

/** One summary to keep up to date. */
export interface SummarySpec {
  /** The column being summarised. */
  sourceColumn: number;
  /** Where the result goes. Negative counts back from the last row. */
  destinationRow: number;
  /** Which column the result goes in. Defaults to `sourceColumn`. */
  destinationColumn?: number;
  type?: SummaryType;
  /** For `type: 'custom'`, the formula to write, with `{{range}}` substituted. */
  customFunction?: string;
  /** The rows to summarise, as `[start, end]` pairs or `[row]` singles. */
  ranges?: Array<[number, number] | [number]>;
  /** Read the destination row's position from the end of the data. */
  reversedRowCoords?: boolean;
  /** Leave the destination out of its own range. Always true here. */
  forceNumeric?: boolean;
  roundFloat?: number | boolean;
  suppressDataTypeErrors?: boolean;
}

const FUNCTION_OF: Record<Exclude<SummaryType, 'custom'>, string> = {
  sum: 'SUM',
  min: 'MIN',
  max: 'MAX',
  count: 'COUNT',
  average: 'AVERAGE',
};

export class ColumnSummary extends BasePlugin {
  static override readonly pluginName: string = 'columnSummary';

  #specs: SummarySpec[] = [];

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().columnSummary;
    return Array.isArray(settings) || typeof settings === 'function';
  }

  protected override onEnable(): void {
    this.#specs = this.#readSpecs();
    this.refresh();
  }

  protected override onDisable(): void {
    this.#specs = [];
  }

  /** The summaries this plugin is maintaining. */
  getSpecs(): SummarySpec[] {
    return this.#specs.map((spec) => ({ ...spec }));
  }

  /** Writes every summary formula. */
  refresh(): void {
    const changes: Array<[number, number, string]> = [];
    for (const spec of this.#specs) {
      const row = this.destinationRow(spec);
      const col = spec.destinationColumn ?? spec.sourceColumn;
      if (row < 0 || col < 0) {
        continue;
      }
      changes.push([row, col, this.formulaFor(spec)]);
    }
    if (changes.length > 0) {
      this.grid.setDataAtCells(changes, 'columnSummary');
    }
  }

  /** Where a summary's result goes, resolving a from-the-end coordinate. */
  destinationRow(spec: SummarySpec): number {
    if (spec.reversedRowCoords) {
      return this.grid.countRows() - 1 - spec.destinationRow;
    }
    return spec.destinationRow;
  }

  /**
   * The formula for one summary.
   *
   * The destination is kept out of its own range: a `SUM` that included the
   * cell it is written into would be a circular reference, which the engine
   * would correctly refuse to evaluate.
   */
  formulaFor(spec: SummarySpec): string {
    const column = columnLetters(spec.sourceColumn);
    const destination = this.destinationRow(spec);
    const sameColumn = (spec.destinationColumn ?? spec.sourceColumn) === spec.sourceColumn;

    const ranges: Array<[number, number] | [number]> = spec.ranges ?? [
      [0, Math.max(this.grid.countRows() - 1, 0)],
    ];
    const parts: string[] = [];
    for (const range of ranges) {
      // A range is `[start, end]`, or `[row]` for a single row.
      const [start, end = start] = range;
      for (const [from, to] of this.#without(start, end, sameColumn ? destination : -1)) {
        parts.push(from === to ? `${column}${from + 1}` : `${column}${from + 1}:${column}${to + 1}`);
      }
    }
    const range = parts.length > 0 ? parts.join(',') : `${column}1:${column}1`;

    if (spec.type === 'custom' && spec.customFunction) {
      return `=${spec.customFunction.replace(/\{\{range\}\}/g, range)}`;
    }
    const name = FUNCTION_OF[(spec.type ?? 'sum') as Exclude<SummaryType, 'custom'>] ?? 'SUM';
    const call = `${name}(${range})`;
    return typeof spec.roundFloat === 'number' ? `=ROUND(${call},${spec.roundFloat})` : `=${call}`;
  }

  /** Splits `[from, to]` around a row that must be left out. */
  #without(from: number, to: number, excluded: number): Array<[number, number]> {
    if (excluded < from || excluded > to) {
      return from <= to ? [[from, to]] : [];
    }
    const parts: Array<[number, number]> = [];
    if (from <= excluded - 1) {
      parts.push([from, excluded - 1]);
    }
    if (excluded + 1 <= to) {
      parts.push([excluded + 1, to]);
    }
    return parts;
  }

  #readSpecs(): SummarySpec[] {
    const settings = this.grid.getSettings().columnSummary;
    const list =
      typeof settings === 'function'
        ? ((settings as () => SummarySpec[])() ?? [])
        : ((settings as SummarySpec[]) ?? []);
    return list.map((spec) => ({ ...spec }));
  }
}

registerPlugin(ColumnSummary as never);
