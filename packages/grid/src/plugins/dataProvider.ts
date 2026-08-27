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
 *
 * Reading and writing stay in one class because writing is defined in terms of
 * reading: every mutation ends in a refetch, and a removal has to know how many
 * pages are left. Pulling them apart would buy two files that each hold a
 * reference to the other. What did come out is the presentation — see
 * `dataProviderReporting.ts` — because that half knows nothing about a query or
 * a queue and is the only part with an opinion about other plugins.
 */

import { BasePlugin, registerPlugin } from './base.js';
import { loadingOverlay, messageOf, reportProviderError } from './dataProviderReporting.js';
import type { CellChange } from '../grid.js';
import type { FailedOperation } from './dataProviderReporting.js';
import type {
  DataProviderSettings,
  FetchOptions,
  FetchResult,
  FilterDescriptor,
  MutationOperation,
  QueryParameters,
  RowUpdate,
  RowsCreate,
  SortDescriptor,
} from '../settings.js';

// Re-exported so `getPlugin('dataProvider')` and its types come from one
// import, as they did when they were declared here. `messageOf` is re-exported
// for the same reason: it moved to a neighbouring file, which is not a reason
// for anyone importing it to have to move with it.
export { messageOf };
export type {
  DataProviderSettings,
  FetchOptions,
  FetchResult,
  FilterDescriptor,
  MutationOperation,
  QueryParameters,
  RowUpdate,
  RowsCreate,
  SortDescriptor,
};

/**
 * The change sources that mean a person changed a value.
 *
 * Everything else — a page landing, a revert, an undo replaying the journal —
 * is the grid catching up with something, and sending those back to the server
 * would be the grid arguing with itself.
 */
const EDIT_SOURCES = new Set(['edit', 'paste', 'autofill', 'populateFromArray', 'cut']);

export const INITIAL_QUERY: QueryParameters = { page: 1, pageSize: 10, sort: null, filters: null };

/**
 * The settings that stop this plugin working.
 *
 * Each one reorders or hides rows on the client, which is a claim about a whole
 * dataset the client does not have. Rather than let them half-work on the page
 * that happens to be loaded, the plugin declines to run and says why.
 */
const CONFLICTING = ['trimRows', 'manualRowMove', 'manualColumnMove', 'multiColumnSorting'] as const;

export class DataProvider extends BasePlugin {
  static override readonly pluginName: string = 'dataProvider';

  /**
   * Its own setting, and the four that switch it off.
   *
   * Turning `manualRowMove` on has to disable this plugin, and turning it
   * off again has to bring it back — neither happens if the plugin only
   * ever looks at a payload that names `dataProvider`.
   */
  static override get settingKeys(): string[] {
    return ['dataProvider', ...CONFLICTING];
  }

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

  protected override onDisable(): void {
    this.#generation += 1;
    this.#inFlight?.abort();
    this.#inFlight = null;
    // A disable in the middle of a revert would otherwise leave this set, and
    // a re-enabled plugin would ignore every edit for the rest of its life.
    this.#reverting = false;
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
  async fetchData(overrides: FetchOptions = {}): Promise<boolean> {
    const settings = this.settings<DataProviderSettings>();
    if (!settings?.fetchRows) {
      return false;
    }
    const { skipLoading, ...queryOverrides } = overrides;
    const query: QueryParameters = { ...this.#query, ...queryOverrides };
    query.page = Math.max(query.page, 1);
    query.pageSize = Math.max(query.pageSize, 1);

    if (this.grid.hooks.allows('beforeDataProviderFetch', { ...query, skipLoading }) === false) {
      return false;
    }
    this.#query = query;

    // The previous request is for a page nobody is looking at now. Aborting it
    // is not an optimisation: without it a slow first answer can land after a
    // fast second one and put the wrong page on screen.
    this.#inFlight?.abort();
    const controller = new AbortController();
    this.#inFlight = controller;
    const generation = (this.#generation += 1);

    const loading = loadingOverlay(this.grid);
    if (!skipLoading) {
      loading?.show({ message: 'Loading…' });
    }

    try {
      const result = await settings.fetchRows(query, { signal: controller.signal });
      if (generation !== this.#generation) {
        this.grid.hooks.notify('afterDataProviderFetchAbort', query, 'superseded');
        // Overtaken, not failed: the fetch that replaced this one is the one
        // whose answer counts, so this is not a failure to report.
        return true;
      }
      this.#lastError = null;
      this.#totalRows = result.totalRows;
      this.grid.replaceRows(result.rows, 'dataProvider');
      this.grid.hooks.notify(
        'afterDataProviderFetch',
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
        return this.fetchData({ page: lastPage, skipLoading: true });
      }
      return true;
    } catch (error) {
      if (generation !== this.#generation || isAbort(error)) {
        this.grid.hooks.notify('afterDataProviderFetchAbort', query, error);
        return true;
      }
      this.#lastError = error;
      settings.onError?.(error, query);
      this.grid.hooks.notify('afterDataProviderFetchError', error, query);
      this.#report(error, 'fetch');
      return false;
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

  setPage(page: number): Promise<boolean> {
    return this.fetchData({ page: Math.min(Math.max(page, 1), this.countPages()) });
  }

  setSort(sort: SortDescriptor | null): Promise<boolean> {
    // Back to the first page: the second page of a differently sorted list is
    // not the same rows, and staying on it would look like data going missing.
    return this.fetchData({ sort, page: 1, skipLoading: true });
  }

  setFilters(filters: FilterDescriptor[] | null): Promise<boolean> {
    return this.fetchData({ filters, page: 1 });
  }

  setPageSize(pageSize: number): Promise<boolean> {
    return this.fetchData({ pageSize: Math.max(pageSize, 1), page: 1 });
  }

  // --- writing ------------------------------------------------------------

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
    if (!allNamed(rows.map((row) => row.id))) {
      revert();
      const error = unnamedRowError('update');
      this.grid.hooks.notify('afterRowsMutationError', 'update', error);
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
      this.grid.hooks.notify('afterRowsMutationError', 'update', invalid);
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
        this.grid.getEditableValue(row, col),
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

  /** Asks the source to add rows. */
  createRows(payload: RowsCreate): Promise<void> {
    return this.#enqueue(async () => {
      const settings = this.settings<DataProviderSettings>();
      if (!settings?.onRowsCreate) {
        return;
      }
      const maxRows = this.grid.getSettings().maxRows;
      // `countRows()` is the page that happens to be loaded; `maxRows` is a
      // limit on the table. Comparing them capped the page rather than the
      // data, so a ten-row page and `maxRows: 10` refused every insert however
      // few rows the server held.
      if (typeof maxRows === 'number' && this.getTotalRows() >= maxRows) {
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
      if (!allNamed(rows.map((row) => row.id))) {
        throw unnamedRowError('update');
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
      if (!allNamed(ids)) {
        throw unnamedRowError('remove');
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
      this.grid.hooks.notify('afterRowsMutationError', operation, error);
      this.#report(error, operation);
      throw error;
    }
    this.grid.hooks.notify('afterRowsMutation', operation);
    // A refetch that fails after a write that succeeded is still that write's
    // failure as far as the reader is concerned: what they see is now stale.
    // `fetchData` reports its own failure and resolves rather than throwing —
    // it has its own hooks and its own toast — so the answer has to be asked
    // for. Catching around it, as this used to, caught nothing.
    if (!(await this.fetchData({ skipLoading: true }))) {
      this.grid.hooks.notify(
        'afterRowsMutationError',
        operation,
        this.#lastError ?? new Error('[cellmoa] dataProvider: the refetch failed.'),
      );
    }
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    // Whether the plugin still exists is asked when the turn comes, not when
    // the work is queued. Emptying the queue on disable does not help: the
    // chain was built when `then` was called and holds its own reference, so
    // the only thing that can stop a waiting mutation is the mutation itself.
    const guarded = async (): Promise<void> => {
      if (this.isPluginEnabled()) {
        await work();
      }
    };
    const next = this.#queue.then(guarded, guarded);
    // The chain must not reject, or every later mutation inherits the failure.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** Hands a failure to the presentation half, with the retry it would need. */
  #report(error: unknown, operation: FailedOperation): void {
    reportProviderError(this.grid, error, operation, () => void this.fetchData());
  }
}

/**
 * Whether the source could name every one of these rows.
 *
 * Both write paths ask it and neither may answer it differently: which rows are
 * refused cannot depend on whether the change came from a keystroke or from
 * `updateRows`, so there is one definition of "named" and both read it.
 */
function allNamed(ids: unknown[]): boolean {
  return ids.every((id) => id !== null && id !== undefined);
}

/** The refusal all three sites give, worded once so they cannot drift apart. */
function unnamedRowError(operation: 'update' | 'remove'): Error {
  return new Error(`[cellmoa] dataProvider: cannot ${operation} a row without an id.`);
}

/** Whether a rejection is a request being called off rather than failing. */
function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

registerPlugin(DataProvider);
