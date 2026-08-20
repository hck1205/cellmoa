/**
 * Loading rows from somewhere else, a page at a time.
 *
 * The grid stops being the owner of the data and becomes a view of it: sorting,
 * filtering and paging are sent to the source as a query rather than performed
 * here, because a server holding a million rows can answer "the first fifty,
 * sorted by name" and the browser cannot.
 *
 * A fetch is allowed to be slow and is allowed to fail. Both are ordinary, so
 * both are reported rather than swallowed: a table showing stale rows because a
 * request quietly failed is worse than a table showing an error.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** How the rows should be ordered. */
export interface SortDescriptor {
  column: number;
  sortOrder: 'asc' | 'desc';
}

/** One column's filter, as the source receives it. */
export interface FilterDescriptor {
  column: number;
  conditions: Array<{ name: string; args: unknown[] }>;
  operation?: 'conjunction' | 'disjunction';
}

/** What the grid asks the source for. */
export interface QueryParameters {
  page: number;
  pageSize: number;
  sort: SortDescriptor | null;
  filters: FilterDescriptor[] | null;
}

/** What the source answers with. */
export interface FetchResult {
  /** The rows for this page, each a list of cell values. */
  rows: string[][];
  /** How many rows there are altogether, which is what paging needs. */
  totalRows: number;
}

export interface DataProviderSettings {
  /** Fetches a page. */
  data: (query: QueryParameters) => Promise<FetchResult> | FetchResult;
  /** Called when a fetch throws, so the host can show what went wrong. */
  onError?: (error: unknown, query: QueryParameters) => void;
  pageSize?: number;
  /** Identifies a row, for a source that needs to know which row changed. */
  rowId?: (row: number, values: string[]) => unknown;
}

export const INITIAL_QUERY: QueryParameters = { page: 1, pageSize: 10, sort: null, filters: null };

export class DataProvider extends BasePlugin {
  static override readonly pluginName: string = 'dataProvider';

  #query: QueryParameters = { ...INITIAL_QUERY };
  #totalRows = 0;
  /** Bumped on each fetch, so a slow answer to an old query is discarded. */
  #generation = 0;
  #lastError: unknown = null;

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().dataProvider;
    return typeof settings === 'object' && settings !== null;
  }

  protected override onEnable(): void {
    const settings = this.settings<DataProviderSettings>();
    this.#query = { ...INITIAL_QUERY, pageSize: settings?.pageSize ?? INITIAL_QUERY.pageSize };
    void this.fetch();
  }

  protected override onDisable(): void {
    // Anything still in flight is for a query nobody is waiting for now.
    this.#generation += 1;
  }

  /** The query the last fetch was made with. */
  getQueryParameters(): QueryParameters {
    return { ...this.#query };
  }

  /** How many rows the source says there are. */
  getTotalRows(): number {
    return this.#totalRows;
  }

  /** Whatever the last fetch threw, or `null`. */
  getLastError(): unknown {
    return this.#lastError;
  }

  /** How the source identifies a row. */
  getRowId(row: number): unknown {
    const settings = this.settings<DataProviderSettings>();
    if (!settings?.rowId) {
      return row;
    }
    const values: string[] = [];
    for (let col = 0; col < this.grid.countCols(); col += 1) {
      values.push(this.grid.getDataAtCell(row, col));
    }
    return settings.rowId(row, values);
  }

  /** Asks the source for a page and puts it in the grid. */
  async fetch(overrides: Partial<QueryParameters> = {}): Promise<void> {
    const settings = this.settings<DataProviderSettings>();
    if (!settings?.data) {
      return;
    }
    const query: QueryParameters = { ...this.#query, ...overrides };
    if (this.grid.hooks.allows('beforeFetch', query) === false) {
      return;
    }
    this.#query = query;
    const generation = (this.#generation += 1);
    const loading = this.grid.getPlugin('loading') as unknown as {
      show(options?: { message?: string }): void;
      hide(): void;
    } | null;
    loading?.show({ message: 'Loading…' });

    try {
      const result = await settings.data(query);
      // A request that was overtaken while it was in flight is thrown away: its
      // answer describes a query the user has already moved on from.
      if (generation !== this.#generation) {
        return;
      }
      this.#lastError = null;
      this.#totalRows = result.totalRows;
      this.#load(result.rows);
      this.grid.hooks.run('afterFetch', undefined, result, query);
    } catch (error) {
      if (generation !== this.#generation) {
        return;
      }
      this.#lastError = error;
      settings.onError?.(error, query);
      this.grid.hooks.run('afterFetchError', undefined, error, query);
    } finally {
      loading?.hide();
    }
  }

  /** How many pages the source's rows make. */
  countPages(): number {
    return Math.max(Math.ceil(this.#totalRows / Math.max(this.#query.pageSize, 1)), 1);
  }

  /** Fetches another page. */
  setPage(page: number): Promise<void> {
    return this.fetch({ page: Math.min(Math.max(page, 1), this.countPages()) });
  }

  /** Fetches with a different sort. */
  setSort(sort: SortDescriptor | null): Promise<void> {
    // Back to the first page: the second page of a differently sorted list is
    // not the same rows, and staying on it would look like data going missing.
    return this.fetch({ sort, page: 1 });
  }

  /** Fetches with different filters. */
  setFilters(filters: FilterDescriptor[] | null): Promise<void> {
    return this.fetch({ filters, page: 1 });
  }

  /** Fetches with a different page size. */
  setPageSize(pageSize: number): Promise<void> {
    return this.fetch({ pageSize: Math.max(pageSize, 1), page: 1 });
  }

  #load(rows: string[][]): void {
    const changes: Array<[number, number, string]> = [];
    const width = Math.max(this.grid.countCols(), ...rows.map((row) => row.length), 1);
    for (let row = 0; row < Math.max(rows.length, this.grid.countRows()); row += 1) {
      for (let col = 0; col < width; col += 1) {
        changes.push([row, col, rows[row]?.[col] ?? '']);
      }
    }
    this.grid.setDataAtCells(changes, 'dataProvider');
  }
}

registerPlugin(DataProvider as never);
