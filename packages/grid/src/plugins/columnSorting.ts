/**
 * Sorting by a column.
 *
 * Sorting reorders the index map, not the data. Nothing is written, the
 * workbook's revision does not move, and a formula that referred to a cell
 * before the sort still refers to it after — which is the behaviour a
 * spreadsheet needs and the reason sorting is not an edit.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** Which way a column is sorted. */
export type SortOrder = 'asc' | 'desc';

export interface SortConfig {
  column: number;
  sortOrder: SortOrder;
}

/** What the `columnSorting` setting may hold. */
export interface SortSettings {
  initialConfig?: SortConfig | SortConfig[];
  sortEmptyCells?: boolean;
  indicator?: boolean;
  headerAction?: boolean;
  /** A comparator factory, for a column that sorts by something of its own. */
  compareFunctionFactory?: (
    sortOrder: SortOrder,
    columnMeta: Record<string, unknown>,
  ) => (a: unknown, b: unknown) => number;
}

/**
 * Compares two cells the way a spreadsheet does.
 *
 * Numbers before text before booleans, blanks last whichever way the sort
 * runs — a blank is not "smaller", it is absent, and burying the empty rows at
 * the bottom is what people expect from both directions.
 */
export function compareValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  const rank = (value: unknown): number => {
    if (value === null || value === undefined || value === '') {
      return 4;
    }
    if (typeof value === 'number') {
      return 0;
    }
    if (typeof value === 'string') {
      return 1;
    }
    return 2;
  };
  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  if (rankA === 4) {
    return 0;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  // Locale-aware and case-insensitive, as a spreadsheet's own sort is.
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

export class ColumnSorting extends BasePlugin {
  static override readonly pluginName: string = 'columnSorting';

  /** The columns currently sorted, most significant first. */
  protected sortState: SortConfig[] = [];

  override isEnabled(): boolean {
    return this.grid.getSettings()[this.pluginName] !== undefined
      && this.grid.getSettings()[this.pluginName] !== false;
  }

  protected override onEnable(): void {
    const initial = this.options<SortSettings>().initialConfig;
    if (initial) {
      this.sort(initial);
    }
    // Clicking a header cycles ascending, descending, off — the order every
    // spreadsheet uses.
    this.addHook('afterOnCellMouseDown', (event: MouseEvent, coords: unknown) => {
      const target = event?.target as HTMLElement | undefined;
      if (!target || !target.classList.contains('cm-col-header')) {
        return;
      }
      const col = Number(target.dataset.col);
      if (!Number.isFinite(col) || !this.#respondsToHeader(col)) {
        return;
      }
      this.toggleSort(col);
      void coords;
    });
    this.addHook('modifyColHeader', (label: string, col: number) => {
      const config = this.sortState.find((entry) => entry.column === col);
      if (!config || this.options<SortSettings>().indicator === false) {
        return label;
      }
      // An arrow in the header, so the sort is visible without a legend.
      return `${label} ${config.sortOrder === 'asc' ? '▲' : '▼'}`;
    });
  }

  protected override onDisable(): void {
    this.clearSort();
  }

  /**
   * Whether clicking a column's header sorts it.
   *
   * The guide makes one column unsortable by writing `headerAction: false`
   * inside that column's own entry in `columns`, so the column has the last
   * word and the plugin-level setting is only what a column that says nothing
   * inherits. Reading the plugin-level setting alone made the option all or
   * nothing, and the documented per-column form did nothing at all.
   */
  #respondsToHeader(col: number): boolean {
    const own = this.grid.getColumnMeta(col)[this.pluginName];
    if (typeof own === 'object' && own !== null && 'headerAction' in own) {
      return (own as SortSettings).headerAction !== false;
    }
    return this.options<SortSettings>().headerAction !== false;
  }

  /** The current sort, or an empty list. */
  getSortConfig(): SortConfig[] {
    return this.sortState.map((entry) => ({ ...entry }));
  }

  /** Whether a column takes part in the sort. */
  isSorted(column?: number): boolean {
    return column === undefined
      ? this.sortState.length > 0
      : this.sortState.some((entry) => entry.column === column);
  }

  /** Cycles a column: ascending, then descending, then unsorted. */
  toggleSort(column: number): void {
    const current = this.sortState.find((entry) => entry.column === column);
    if (!current) {
      this.sort({ column, sortOrder: 'asc' });
    } else if (current.sortOrder === 'asc') {
      this.sort({ column, sortOrder: 'desc' });
    } else {
      this.clearSort();
    }
  }

  /** Sorts by one column, or by several in order of significance. */
  sort(config: SortConfig | SortConfig[]): void {
    const wanted = Array.isArray(config) ? config : [config];
    if (this.grid.hooks.allows('beforeColumnSort', this.getSortConfig(), wanted) === false) {
      return;
    }
    this.sortState = this.limit(wanted);
    this.#apply();
    this.grid.hooks.notify('afterColumnSort', this.getSortConfig(), wanted);
    this.grid.render();
  }

  /** Returns the rows to their natural order. */
  clearSort(): void {
    this.sortState = [];
    this.grid.rowIndex.setSequence(
      Array.from({ length: this.grid.rowIndex.length }, (_, i) => i),
    );
    this.grid.render();
  }

  /**
   * Narrows a requested sort to what this plugin supports.
   *
   * Single-column sorting keeps only the last request; the multi-column
   * subclass keeps them all.
   */
  protected limit(config: SortConfig[]): SortConfig[] {
    return config.slice(-1);
  }

  /** Reorders the index map according to the current sort. */
  #apply(): void {
    if (this.sortState.length === 0) {
      this.clearSort();
      return;
    }
    const rows = this.grid.rowIndex.visibleLength;
    const options = this.options<SortSettings>();
    const sortEmptyCells = options.sortEmptyCells === true;

    // The visual order is what gets sorted, then translated back to physical
    // indexes — sorting the physical order would ignore any filtering.
    const visual = Array.from({ length: rows }, (_, i) => i);
    const keys = new Map<number, Array<string | number | boolean | null>>();
    for (const row of visual) {
      keys.set(
        row,
        this.sortState.map((entry) => this.grid.getCell(row, entry.column)?.value ?? null),
      );
    }

    visual.sort((left, right) => {
      const a = keys.get(left)!;
      const b = keys.get(right)!;
      for (const [index, entry] of this.sortState.entries()) {
        const columnMeta = this.grid.getCellMeta(0, entry.column);
        const factory =
          options.compareFunctionFactory;
        const compare = factory
          ? factory(entry.sortOrder, columnMeta as Record<string, unknown>)
          : compareValues;
        let result = compare(a[index] ?? null, b[index] ?? null);
        if (!sortEmptyCells) {
          // Blanks stay at the bottom in both directions, so flipping the sort
          // does not fill the top of the grid with empty rows.
          const aEmpty = a[index] === null || a[index] === '';
          const bEmpty = b[index] === null || b[index] === '';
          if (aEmpty !== bEmpty) {
            return aEmpty ? 1 : -1;
          }
        }
        if (entry.sortOrder === 'desc') {
          result = -result;
        }
        if (result !== 0) {
          return result;
        }
      }
      // A stable tie-break, so an equal pair keeps the order it had.
      return left - right;
    });

    const physical = visual.map((row) => this.grid.rowIndex.toPhysical(row)!);
    const trimmed = this.grid.rowIndex
      .getSequence()
      .filter((index) => this.grid.rowIndex.isTrimmed(index));
    this.grid.rowIndex.setSequence([...physical, ...trimmed]);
  }
}

/** Sorting by several columns at once. */
export class MultiColumnSorting extends ColumnSorting {
  static override readonly pluginName: string = 'multiColumnSorting';

  /** Keeps every column it was given. */
  protected override limit(config: SortConfig[]): SortConfig[] {
    return config;
  }

  /** Adds a column to the sort rather than replacing it. */
  override toggleSort(column: number): void {
    const current = this.sortState.find((entry) => entry.column === column);
    const others = this.sortState.filter((entry) => entry.column !== column);
    if (!current) {
      this.sort([...others, { column, sortOrder: 'asc' }]);
    } else if (current.sortOrder === 'asc') {
      this.sort([...others, { column, sortOrder: 'desc' }]);
    } else {
      this.sort(others);
    }
  }
}

registerPlugin(ColumnSorting);
registerPlugin(MultiColumnSorting);
