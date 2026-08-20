/**
 * Loading rows from somewhere else, a page at a time.
 *
 * The grid stops being the owner of the data and becomes a view of it: sorting,
 * filtering and paging are sent to the source as a query rather than performed
 * here, because a server holding a million rows can answer "the first fifty,
 * sorted by name" and the browser cannot.
 *
 * Writing runs the other way, and that is the harder half. An edit is shown at
 * once and sent afterwards, so the grid may be showing something the server has
 * not accepted yet — which is fine as long as a refusal takes it back. Every
 * path here that shows a value before the server has agreed to it has a
 * matching path that restores the old one, and the two are written next to each
 * other so neither can be changed without the other.
 */

import { BasePlugin, registerPlugin } from './base.js';
import { PHRASE } from '../i18n/keys.js';
import type { CellChange } from '../grid.js';

/**
 * The change sources that mean a person changed a value.
 *
 * Everything else — a page landing, a revert, an undo replaying the journal —
 * is the grid catching up with something, and sending those back to the server
 * would be the grid arguing with itself.
 */
const EDIT_SOURCES = new Set(['edit', 'paste', 'autofill', 'populateFromArray', 'cut']);

/** How the rows should be ordered. */
export interface SortDescriptor {
  /** The column's name, which is what a server can act on. */
  prop: string | number;
  order: 'asc' | 'desc';
}

/** One column's filter, as the source receives it. */
export interface FilterDescriptor {
  prop: string | number;
  conditions: Array<{ name: string; args: unknown[] }>;
  operation?: 'conjunction' | 'disjunction';
}

/** What the grid asks the source for. */
export interface QueryParameters {
  /** 1-based. */
  page: number;
  pageSize: number;
  sort: SortDescriptor | null;
  filters: FilterDescriptor[] | null;
}

/**
 * A fetch's options, which are the query plus what the source must not see.
 *
 * `skipLoading` says the fetch is one the grid started for its own reasons —
 * after a sort, or after a write went through — so the overlay should not flash
 * over a table the reader is already looking at. It never reaches `fetchRows`:
 * how the grid draws is not the source's business.
 */
export interface FetchOptions extends Partial<QueryParameters> {
  skipLoading?: boolean;
}

/** What the source answers with. */
export interface FetchResult {
  rows: string[][];
  totalRows: number;
}

/** One row's worth of changes, as `onRowsUpdate` receives them. */
export interface RowUpdate {
  id: unknown;
  changes: Record<string, string>;
  rowData?: string[];
}

/** What `onRowsCreate` receives. */
export interface RowsCreate {
  position: 'above' | 'below';
  referenceRowId?: unknown;
  rowsAmount: number;
}

export type MutationOperation = 'create' | 'update' | 'remove';

export interface DataProviderSettings {
  /**
   * Names a row.
   *
   * A string reads that column; a function decides. Without one the grid has
   * nothing stable to send a server — a visual index changes when the page
   * does — so writing is refused rather than sent against the wrong row.
   */
  rowId?: string | ((row: number, values: string[]) => unknown);
  /** Fetches a page. `signal` aborts when this request is overtaken. */
  fetchRows?: (
    query: QueryParameters,
    context: { signal: AbortSignal },
  ) => Promise<FetchResult> | FetchResult;
  onRowsCreate?: (payload: RowsCreate) => Promise<unknown> | unknown;
  onRowsUpdate?: (rows: RowUpdate[]) => Promise<unknown> | unknown;
  onRowsRemove?: (ids: unknown[]) => Promise<unknown> | unknown;
  /** Called when a fetch throws, so a host with its own error UI can use it. */
  onError?: (error: unknown, query: QueryParameters) => void;
}

export const INITIAL_QUERY: QueryParameters = { page: 1, pageSize: 10, sort: null, filters: null };

/**
 * The settings that stop this plugin working.
 *
 * Each one reorders or hides rows on the client, which is a claim about a whole
 * dataset the client does not have. Rather than let them half-work on the page
 * that happens to be loaded, the plugin declines to run and says why.
 */
const CONFLICTING = ['trimRows', 'manualRowMove', 'manualColumnMove', 'multiColumnSorting'] as const;

/**
 * Digs a message out of whatever was thrown.
 *
 * An HTTP client rejects with its own shape, and the useful sentence is usually
 * buried in a JSON body one or two levels down. Showing "[object Object]" to a
 * reader who could have been told "SKU already exists" is a real cost, so the
 * likely places are tried in order before falling back.
 */
export function messageOf(error: unknown, fallback: string): string {
  const bodies = [
    error,
    (error as { response?: { data?: unknown } } | null)?.response?.data,
    (error as { data?: unknown } | null)?.data,
    (error as { body?: unknown } | null)?.body,
  ];
  for (const body of bodies) {
    if (typeof body === 'string' && body !== '') {
      return body;
    }
    for (const key of ['message', 'error', 'detail'] as const) {
      const value = (body as Record<string, unknown> | null | undefined)?.[key];
      if (typeof value === 'string' && value !== '') {
        return value;
      }
    }
  }
  return fallback;
}

export class DataProvider extends BasePlugin {
  static override readonly pluginName: string = 'dataProvider';

  #query: QueryParameters = { ...INITIAL_QUERY };
  #totalRows = 0;
  /** Bumped on each fetch, so a slow answer to an old query is discarded. */
  #generation = 0;
  #inFlight: AbortController | null = null;
  #lastError: unknown = null;
  /**
   * Mutations run one after another.
   *
   * Two writes overlapping would reach the server in whichever order the
   * network chose, and the refetch after the first would show rows from before
   * the second. Holding a promise and chaining onto it costs nothing and makes
   * the server see one stream.
   */
  #queue: Promise<unknown> = Promise.resolve();
  /** Set while an edit is being taken back, so the undo is not sent as an edit. */
  #reverting = false;

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().dataProvider;
    if (typeof settings !== 'object' || settings === null) {
      return false;
    }
    const conflict = this.#conflict();
    if (conflict) {
      // Said once, plainly: silently doing nothing would look like a bug in the
      // source rather than a setting the reader can change.
      console.warn(
        `[cellmoa] \`dataProvider\` is off: \`${conflict}\` reorders or hides rows on the client, ` +
          'which cannot be done over data the client only holds one page of.',
      );
      return false;
    }
    return true;
  }

  /** The first incompatible setting, or `null`. */
  #conflict(): string | null {
    const settings = this.grid.getSettings() as Record<string, unknown>;
    return CONFLICTING.find((name) => Boolean(settings[name])) ?? null;
  }

  protected override onEnable(): void {
    this.#query = { ...INITIAL_QUERY, pageSize: this.#pageSize() };
    // The row headers count across the whole dataset, not the loaded slice: on
    // page 2 of 5-row pages the first row is the sixth row, and saying "1"
    // would misdescribe which row a person is looking at.
    this.addHook('modifyRowHeader', (value: unknown, row: number) => {
      const offset = (this.#query.page - 1) * this.#query.pageSize;
      return String(offset + row + 1);
    });
    this.addHook('hasExternalDataSource', () => true);
    this.addHook('afterChange', (changes: unknown, source: unknown) => {
      void this.#onEdited(changes as CellChange[] | null, String(source ?? ''));
    });
    void this.fetchData();
  }

  /**
   * Sends an edit somebody made in the grid.
   *
   * The value is already on screen — the grid wrote it before this ran — so
   * this is the optimistic update, and everything below it is about being able
   * to take it back. `#reverting` is what keeps the undo write from being read
   * as a new edit and sent round again.
   */
  async #onEdited(changes: CellChange[] | null, source: string): Promise<void> {
    const settings = this.settings<DataProviderSettings>();
    if (!settings?.onRowsUpdate || !changes || changes.length === 0) {
      return;
    }
    if (this.#reverting || !EDIT_SOURCES.has(source)) {
      return;
    }

    const rows = this.#toUpdates(changes);
    const revert = (): void => {
      this.#reverting = true;
      try {
        this.grid.setDataAtCells(
          changes.map(
            ([row, prop, oldValue]) =>
              [row, this.grid.propToCol(prop), String(oldValue ?? '')] as [number, number, string],
          ),
          'dataProvider',
        );
      } finally {
        this.#reverting = false;
      }
    };

    // A row the source cannot name is a row the server would apply the change
    // to by guessing. Take it back instead.
    if (rows.some((row) => row.id === null || row.id === undefined)) {
      revert();
      this.grid.hooks.run(
        'afterRowsMutationError',
        undefined,
        'update',
        new Error('[cellmoa] dataProvider: cannot update a row without an id.'),
      );
      return;
    }

    // The guide states the order twice and not identically: the lifecycle list
    // puts validators first, while the hook's own description says they run
    // "only when the hook allows the mutation to continue". The second is the
    // more specific sentence, and it is also the one that does not run work
    // for a mutation that was already refused.
    if (this.grid.hooks.allows('beforeRowsMutation', 'update', { rows }) === false) {
      revert();
      return;
    }

    const invalid = await this.#validate(changes);
    if (invalid) {
      revert();
      this.grid.hooks.run('afterRowsMutationError', undefined, 'update', invalid);
      return;
    }

    await this.#enqueue(async () => {
      try {
        await this.#mutate('update', () => settings.onRowsUpdate!(rows));
      } catch {
        // `#mutate` has already reported it; this is the half it cannot do,
        // because only the caller knows what the values were before.
        revert();
      }
    });
  }

  /** Groups changed cells into one entry per row, keyed by column name. */
  #toUpdates(changes: CellChange[]): RowUpdate[] {
    const byRow = new Map<number, RowUpdate>();
    for (const [row, prop, , newValue] of changes) {
      let entry = byRow.get(row);
      if (!entry) {
        entry = { id: this.getRowId(row), changes: {}, rowData: this.grid.getDataAtRow(row) };
        byRow.set(row, entry);
      }
      entry.changes[String(prop)] = String(newValue ?? '');
    }
    return [...byRow.values()];
  }

  /** The first validation failure among the changed cells, or `null`. */
  async #validate(changes: CellChange[]): Promise<Error | null> {
    for (const [row, prop] of changes) {
      const col = this.grid.propToCol(prop);
      if (col < 0) {
        continue;
      }
      const { valid, reason } = await this.grid.validateCell(
        row,
        col,
        this.grid.getSourceDataAtCell(row, col),
      );
      if (!valid) {
        return new Error(
          `[cellmoa] dataProvider: row ${row}, column ${String(prop)} is not valid` +
            `${reason ? ` (${reason})` : ''}.`,
        );
      }
    }
    return null;
  }

  protected override onDisable(): void {
    this.#generation += 1;
    this.#inFlight?.abort();
    this.#inFlight = null;
  }

  /** Rows per page, which the Pagination plugin owns when it is on. */
  #pageSize(): number {
    const pagination = this.grid.getSettings().pagination;
    if (typeof pagination === 'object' && pagination !== null) {
      const size = (pagination as { pageSize?: unknown }).pageSize;
      if (typeof size === 'number' && size > 0) {
        return size;
      }
    }
    return INITIAL_QUERY.pageSize;
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

  /**
   * How the source names a row, or `undefined` when it cannot.
   *
   * `undefined` is a real answer and callers must handle it: a write sent
   * without an id is a write against whichever row the server guesses.
   */
  getRowId(row: number): unknown {
    const settings = this.settings<DataProviderSettings>();
    const rowId = settings?.rowId;
    if (typeof rowId === 'function') {
      return rowId(row, this.grid.getDataAtRow(row));
    }
    if (typeof rowId === 'string') {
      const col = this.grid.propToCol(rowId);
      return col < 0 ? undefined : this.grid.getDataAtCell(row, col);
    }
    return undefined;
  }

  // --- fetching -----------------------------------------------------------

  /**
   * Asks the source for a page and puts it in the grid.
   *
   * Overrides are merged into the standing query, so `fetchData({ page: 2 })`
   * keeps the sort and the filters — which is what someone paging through a
   * sorted list means by it.
   */
  async fetchData(overrides: FetchOptions = {}): Promise<void> {
    const settings = this.settings<DataProviderSettings>();
    if (!settings?.fetchRows) {
      return;
    }
    const { skipLoading, ...queryOverrides } = overrides;
    const query: QueryParameters = { ...this.#query, ...queryOverrides };
    query.page = Math.max(query.page, 1);
    query.pageSize = Math.max(query.pageSize, 1);

    if (this.grid.hooks.allows('beforeDataProviderFetch', { ...query, skipLoading }) === false) {
      return;
    }
    this.#query = query;

    // The previous request is for a page nobody is looking at now. Aborting it
    // is not an optimisation: without it a slow first answer can land after a
    // fast second one and put the wrong page on screen.
    this.#inFlight?.abort();
    const controller = new AbortController();
    this.#inFlight = controller;
    const generation = (this.#generation += 1);

    const loading = this.#loading();
    if (!skipLoading) {
      loading?.show({ message: 'Loading…' });
    }

    try {
      const result = await settings.fetchRows(query, { signal: controller.signal });
      if (generation !== this.#generation) {
        this.grid.hooks.run('afterDataProviderFetchAbort', undefined, query, 'superseded');
        return;
      }
      this.#lastError = null;
      this.#totalRows = result.totalRows;
      this.grid.replaceRows(result.rows, 'dataProvider');
      this.grid.hooks.run(
        'afterDataProviderFetch',
        undefined,
        {
          rows: result.rows,
          totalRows: result.totalRows,
          queryParameters: { ...query },
          columnSortConfig: query.sort,
          filtersConditionsStack: query.filters,
        },
        query,
      );
      // A page past the end is not an error — rows may have been removed since
      // the reader last looked — but showing them an empty page would be. Ask
      // again for the last page there is.
      const lastPage = this.countPages();
      if (query.page > lastPage) {
        await this.fetchData({ page: lastPage, skipLoading: true });
      }
    } catch (error) {
      if (generation !== this.#generation || isAbort(error)) {
        this.grid.hooks.run('afterDataProviderFetchAbort', undefined, query, error);
        return;
      }
      this.#lastError = error;
      settings.onError?.(error, query);
      this.grid.hooks.run('afterDataProviderFetchError', undefined, error, query);
      this.#report(error, 'fetch');
    } finally {
      // The overlay counts its callers, so a fetch that showed it must take its
      // own count back even when it was overtaken — otherwise the count never
      // reaches zero and the grid stays covered forever. This is still the
      // documented behaviour of an abort not clearing the overlay: the fetch
      // that overtook this one has a count of its own, and it is that one which
      // keeps the overlay up until it finishes.
      if (!skipLoading) {
        loading?.hide();
      }
      if (generation === this.#generation) {
        this.#inFlight = null;
      }
    }
  }

  /** How many pages the source's rows make. */
  countPages(): number {
    return Math.max(Math.ceil(this.#totalRows / Math.max(this.#query.pageSize, 1)), 1);
  }

  setPage(page: number): Promise<void> {
    return this.fetchData({ page: Math.min(Math.max(page, 1), this.countPages()) });
  }

  setSort(sort: SortDescriptor | null): Promise<void> {
    // Back to the first page: the second page of a differently sorted list is
    // not the same rows, and staying on it would look like data going missing.
    return this.fetchData({ sort, page: 1, skipLoading: true });
  }

  setFilters(filters: FilterDescriptor[] | null): Promise<void> {
    return this.fetchData({ filters, page: 1 });
  }

  setPageSize(pageSize: number): Promise<void> {
    return this.fetchData({ pageSize: Math.max(pageSize, 1), page: 1 });
  }

  // --- writing ------------------------------------------------------------

  /** Asks the source to add rows. */
  createRows(payload: RowsCreate): Promise<void> {
    return this.#enqueue(async () => {
      const settings = this.settings<DataProviderSettings>();
      if (!settings?.onRowsCreate) {
        return;
      }
      const maxRows = this.grid.getSettings().maxRows;
      if (typeof maxRows === 'number' && this.grid.countRows() >= maxRows) {
        return;
      }
      if (this.grid.hooks.allows('beforeRowsMutation', 'create', { rowsCreate: payload }) === false) {
        return;
      }
      await this.#mutate('create', () => settings.onRowsCreate!(payload));
    });
  }

  /**
   * Asks the source to change rows.
   *
   * Throws on a row with no id rather than sending the change: a write the
   * server cannot attribute is a write against some other row.
   */
  updateRows(rows: RowUpdate[]): Promise<void> {
    return this.#enqueue(async () => {
      const settings = this.settings<DataProviderSettings>();
      if (!settings?.onRowsUpdate) {
        return;
      }
      if (rows.some((row) => row.id === null || row.id === undefined)) {
        throw new Error('[cellmoa] dataProvider: cannot update a row without an id.');
      }
      if (this.grid.hooks.allows('beforeRowsMutation', 'update', { rows }) === false) {
        return;
      }
      await this.#mutate('update', () => settings.onRowsUpdate!(rows));
    });
  }

  /** Asks the source to delete rows. */
  removeRows(ids: unknown[]): Promise<void> {
    return this.#enqueue(async () => {
      const settings = this.settings<DataProviderSettings>();
      if (!settings?.onRowsRemove) {
        return;
      }
      if (ids.some((id) => id === null || id === undefined)) {
        throw new Error('[cellmoa] dataProvider: cannot remove a row without an id.');
      }
      if (this.grid.hooks.allows('beforeRowsMutation', 'remove', { rowsRemove: ids }) === false) {
        return;
      }
      await this.#mutate('remove', () => settings.onRowsRemove!(ids));
      // The page may have just emptied; the page before it has rows.
      if (this.#query.page > this.countPages()) {
        await this.fetchData({ page: this.countPages(), skipLoading: true });
      }
    });
  }

  /**
   * Runs one server callback and settles what follows from it.
   *
   * The refetch afterwards is the point: the server may have filled in a
   * default, stamped a timestamp or renumbered something, and a grid still
   * showing what the client sent would be quietly wrong.
   */
  async #mutate(operation: MutationOperation, send: () => Promise<unknown> | unknown): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.grid.hooks.run('afterRowsMutationError', undefined, operation, error);
      this.#report(error, operation);
      throw error;
    }
    this.grid.hooks.run('afterRowsMutation', undefined, operation);
    try {
      await this.fetchData({ skipLoading: true });
    } catch (error) {
      // A refetch that fails after a write that succeeded is still that write's
      // failure as far as the reader is concerned: what they see is now stale.
      this.grid.hooks.run('afterRowsMutationError', undefined, operation, error);
    }
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(work, work);
    // The chain must not reject, or every later mutation inherits the failure.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  // --- reporting ----------------------------------------------------------

  /**
   * Shows what went wrong, when there is somewhere to show it.
   *
   * A failed load is the one kind the reader can retry themselves, so it gets a
   * button and no timeout — a message about missing data that disappears after
   * four seconds is worse than none.
   */
  #report(error: unknown, operation: MutationOperation | 'fetch'): void {
    const notification = this.grid.getPlugin('notification') as unknown as {
      showMessage(options: {
        message: string;
        type?: string;
        timeout?: number;
        actions?: Array<{ label: string; onClick: () => void }>;
      }): string;
    } | null;
    if (!notification) {
      return;
    }
    const title = this.grid.getTranslatedPhrase(
      {
        fetch: PHRASE.DATA_PROVIDER_ERROR_FETCH,
        create: PHRASE.DATA_PROVIDER_ERROR_CREATE,
        update: PHRASE.DATA_PROVIDER_ERROR_UPDATE,
        remove: PHRASE.DATA_PROVIDER_ERROR_REMOVE,
      }[operation],
    );
    const detail = messageOf(
      error,
      this.grid.getTranslatedPhrase(PHRASE.DATA_PROVIDER_ERROR_REQUEST_FAILED),
    );
    notification.showMessage({
      message: `${title}: ${detail}`,
      type: 'error',
      timeout: operation === 'fetch' ? 0 : 4000,
      actions:
        operation === 'fetch'
          ? [
              {
                label: this.grid.getTranslatedPhrase(PHRASE.DATA_PROVIDER_REFETCH),
                onClick: () => void this.fetchData(),
              },
            ]
          : [],
    });
  }

  #loading(): { show(options?: { message?: string }): void; hide(): void } | null {
    return this.grid.getPlugin('loading') as unknown as {
      show(options?: { message?: string }): void;
      hide(): void;
    } | null;
  }

}

/** Whether a rejection is a request being called off rather than failing. */
function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

registerPlugin(DataProvider as never);
