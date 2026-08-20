/**
 * Server-backed data.
 *
 * The reading half is easy to test and easy to get right. The writing half is
 * neither: an edit is shown before the server has agreed to it, so every test
 * here that shows a value asks the harder question too — what is on screen
 * after the server says no.
 */

import { describe, expect, it, vi } from 'vitest';
import { makeGrid } from './helpers.js';
import type { DataProvider, FetchResult, QueryParameters } from '../src/plugins/dataProvider.js';
import { messageOf } from '../src/plugins/dataProvider.js';

/** The plugin, typed. */
function providerOf(grid: Awaited<ReturnType<typeof makeGrid>>): DataProvider {
  return grid.getPlugin('dataProvider') as unknown as DataProvider;
}

/** A source that hands back fixed rows and records what it was asked. */
function source(rows: string[][], totalRows = rows.length) {
  const queries: QueryParameters[] = [];
  return {
    queries,
    fetchRows: (query: QueryParameters): FetchResult => {
      queries.push({ ...query });
      return { rows, totalRows };
    },
  };
}

describe('fetching', () => {
  it('asks for a page and loads what comes back', async () => {
    const it_ = source([['a', 'b'], ['c', 'd']], 10);
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      pagination: { pageSize: 2 },
      dataProvider: { fetchRows: it_.fetchRows },
    });
    const plugin = providerOf(grid);
    await plugin.fetchData();

    expect(it_.queries.at(-1)).toEqual({ page: 1, pageSize: 2, sort: null, filters: null });
    expect(grid.getDataAtCell(0, 0)).toBe('a');
    expect(grid.getDataAtCell(1, 1)).toBe('d');
    expect(plugin.getTotalRows()).toBe(10);
    expect(plugin.countPages()).toBe(5);
  });

  it('takes its page size from Pagination, not from its own settings', async () => {
    const it_ = source([], 100);
    const grid = await makeGrid({
      pagination: { pageSize: 25 },
      dataProvider: { fetchRows: it_.fetchRows },
    });
    await providerOf(grid).fetchData();
    expect(it_.queries.at(-1)?.pageSize).toBe(25);
  });

  it('keeps the sort and filters when only the page changes', async () => {
    const it_ = source([], 100);
    const grid = await makeGrid({
      pagination: { pageSize: 10 },
      dataProvider: { fetchRows: it_.fetchRows },
    });
    const plugin = providerOf(grid);
    await plugin.setSort({ prop: 'name', order: 'asc' });
    await plugin.setPage(3);
    expect(it_.queries.at(-1)).toEqual({
      page: 3,
      pageSize: 10,
      sort: { prop: 'name', order: 'asc' },
      filters: null,
    });
  });

  it('goes back to page one when the sort changes', async () => {
    const it_ = source([], 100);
    const grid = await makeGrid({
      pagination: { pageSize: 2 },
      dataProvider: { fetchRows: it_.fetchRows },
    });
    const plugin = providerOf(grid);
    await plugin.setPage(3);
    await plugin.setSort({ prop: 0, order: 'asc' });
    expect(plugin.getQueryParameters().page).toBe(1);
  });

  it('aborts the request it has moved on from', async () => {
    const aborted: boolean[] = [];
    let release: ((result: FetchResult) => void) | null = null;
    let call = 0;
    const grid = await makeGrid({
      startRows: 1,
      startCols: 1,
      dataProvider: {
        fetchRows: (_query, { signal }) => {
          call += 1;
          if (call === 1) {
            signal.addEventListener('abort', () => aborted.push(true));
            return new Promise<FetchResult>((resolve) => {
              release = resolve;
            });
          }
          return { rows: [['second']], totalRows: 1 };
        },
      },
    });
    const plugin = providerOf(grid);
    const slow = plugin.fetchData();
    await plugin.setPage(2);

    expect(aborted).toEqual([true]);
    expect(grid.getDataAtCell(0, 0)).toBe('second');

    release?.({ rows: [['first']], totalRows: 1 });
    await slow;
    // The overtaken answer does not overwrite the fresh one.
    expect(grid.getDataAtCell(0, 0)).toBe('second');
  });

  it('reports a superseded fetch as an abort, not an error', async () => {
    const aborts: unknown[] = [];
    const errors: unknown[] = [];
    let release: ((result: FetchResult) => void) | null = null;
    let slowNext = false;
    const grid = await makeGrid({
      dataProvider: {
        fetchRows: () =>
          slowNext
            ? new Promise<FetchResult>((resolve) => {
                release = resolve;
              })
            : { rows: [], totalRows: 0 },
      },
    });
    // The plugin fetches once when it starts; the hooks go on afterwards so
    // this counts only what the test itself provokes.
    grid.addHook('afterDataProviderFetchAbort', (_v: unknown, query: unknown) => aborts.push(query));
    grid.addHook('afterDataProviderFetchError', (_v: unknown, error: unknown) => errors.push(error));
    const plugin = providerOf(grid);
    slowNext = true;
    const slow = plugin.fetchData();
    slowNext = false;
    await plugin.fetchData({ page: 2 });
    release?.({ rows: [], totalRows: 0 });
    await slow;

    expect(aborts).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('reports a failed fetch rather than swallowing it', async () => {
    const errors: unknown[] = [];
    const grid = await makeGrid({
      dataProvider: {
        fetchRows: () => Promise.reject(new Error('network down')),
        onError: (error: unknown) => errors.push(error),
      },
    });
    const plugin = providerOf(grid);
    await plugin.fetchData();
    expect((errors[0] as Error).message).toBe('network down');
    expect((plugin.getLastError() as Error).message).toBe('network down');
  });

  it('asks again for the last page there is when the one requested is past the end', async () => {
    const it_ = source([], 20);
    const grid = await makeGrid({
      pagination: { pageSize: 10 },
      dataProvider: { fetchRows: it_.fetchRows },
    });
    const plugin = providerOf(grid);
    await plugin.fetchData({ page: 9 });
    // 20 rows at 10 a page is two pages; page 9 does not exist.
    expect(it_.queries.at(-1)?.page).toBe(2);
  });

  it('shows the loading overlay, and skips it for its own refetches', async () => {
    const waiting: Array<(result: FetchResult) => void> = [];
    const grid = await makeGrid({
      loading: true,
      dataProvider: {
        fetchRows: () =>
          new Promise<FetchResult>((resolve) => {
            waiting.push(resolve);
          }),
      },
    });
    const plugin = providerOf(grid);
    const loading = grid.getPlugin('loading') as unknown as { isVisible(): boolean };
    const pending = plugin.fetchData();
    expect(loading.isVisible()).toBe(true);
    for (const resolve of waiting.splice(0)) {
      resolve({ rows: [], totalRows: 0 });
    }
    await pending;
    expect(loading.isVisible()).toBe(false);

    // A sort refetches for its own reasons; the overlay must not flash.
    const quiet = plugin.setSort({ prop: 0, order: 'asc' });
    expect(loading.isVisible()).toBe(false);
    for (const resolve of waiting.splice(0)) {
      resolve({ rows: [], totalRows: 0 });
    }
    await quiet;
  });

  it('lets a hook veto a fetch, and does not hide skipLoading from it', async () => {
    const seen: unknown[] = [];
    const fetchRows = vi.fn(() => ({ rows: [], totalRows: 0 }));
    const grid = await makeGrid({ dataProvider: { fetchRows } });
    grid.addHook('beforeDataProviderFetch', (query: unknown) => {
      seen.push(query);
      return false;
    });
    fetchRows.mockClear();
    await providerOf(grid).fetchData({ skipLoading: true });
    expect(fetchRows).not.toHaveBeenCalled();
    expect((seen[0] as { skipLoading?: boolean }).skipLoading).toBe(true);
  });

  it('does not pass skipLoading to the source', async () => {
    const it_ = source([]);
    const grid = await makeGrid({ dataProvider: { fetchRows: it_.fetchRows } });
    await providerOf(grid).fetchData({ skipLoading: true });
    expect(it_.queries.at(-1)).not.toHaveProperty('skipLoading');
  });
});

describe('row identity', () => {
  it('reads the id from a named column', async () => {
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: ['id', 'name'],
      dataProvider: { rowId: 'id', fetchRows: () => ({ rows: [['7', 'Ada']], totalRows: 1 }) },
    });
    await providerOf(grid).fetchData();
    expect(providerOf(grid).getRowId(0)).toBe('7');
  });

  it('has no id to give when none was configured', async () => {
    const grid = await makeGrid({
      startRows: 1,
      startCols: 1,
      dataProvider: { fetchRows: () => ({ rows: [], totalRows: 0 }) },
    });
    expect(providerOf(grid).getRowId(0)).toBeUndefined();
  });

  it('numbers row headers across the whole dataset, not the loaded page', async () => {
    const grid = await makeGrid({
      startRows: 5,
      startCols: 1,
      rowHeaders: true,
      pagination: { pageSize: 5 },
      dataProvider: { fetchRows: () => ({ rows: [], totalRows: 50 }) },
    });
    await providerOf(grid).setPage(2);
    // Row 0 of page 2 is the sixth row there is.
    expect(grid.getRowHeader(0)).toBe('6');
  });
});

describe('writing', () => {
  /** A grid whose edits go to a recorded, controllable server. */
  async function writable(
    onRowsUpdate: (rows: unknown[]) => Promise<unknown> | unknown,
  ): Promise<{ grid: Awaited<ReturnType<typeof makeGrid>>; plugin: DataProvider }> {
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: ['id', 'name'],
      dataProvider: {
        rowId: 'id',
        fetchRows: () => ({ rows: [['7', 'Ada']], totalRows: 1 }),
        onRowsUpdate,
      },
    });
    const plugin = providerOf(grid);
    await plugin.fetchData();
    return { grid, plugin };
  }

  it('sends an edit as one row of changes, keyed by column name', async () => {
    const sent: unknown[] = [];
    const { grid } = await writable((rows) => {
      sent.push(rows);
    });
    grid.setDataAtCell(0, 1, 'Grace', 'edit');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      { id: '7', changes: { 1: 'Grace' }, rowData: ['7', 'Grace'] },
    ]);
  });

  it('shows the edit at once and takes it back when the server refuses', async () => {
    const errors: unknown[] = [];
    const { grid } = await writable(() => Promise.reject(new Error('conflict')));
    grid.addHook('afterRowsMutationError', (_v: unknown, op: unknown, error: unknown) =>
      errors.push([op, (error as Error).message]),
    );

    grid.setDataAtCell(0, 1, 'Grace', 'edit');
    // Optimistic: it is on screen before the server has said anything.
    expect(grid.getDataAtCell(0, 1)).toBe('Grace');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(grid.getDataAtCell(0, 1)).toBe('Ada');
    expect(errors).toEqual([['update', 'conflict']]);
  });

  it('takes the edit back when a hook refuses it, and never asks the server', async () => {
    const onRowsUpdate = vi.fn();
    const { grid } = await writable(onRowsUpdate);
    grid.addHook('beforeRowsMutation', () => false);

    grid.setDataAtCell(0, 1, 'Grace', 'edit');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRowsUpdate).not.toHaveBeenCalled();
    expect(grid.getDataAtCell(0, 1)).toBe('Ada');
  });

  it('takes the edit back when a validator refuses it', async () => {
    const onRowsUpdate = vi.fn();
    const errors: unknown[] = [];
    const { grid } = await writable(onRowsUpdate);
    grid.setCellMeta(0, 1, 'validator', (value: string) => value !== 'Grace');
    grid.addHook('afterRowsMutationError', (_v: unknown, op: unknown) => errors.push(op));

    grid.setDataAtCell(0, 1, 'Grace', 'edit');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRowsUpdate).not.toHaveBeenCalled();
    expect(grid.getDataAtCell(0, 1)).toBe('Ada');
    expect(errors).toEqual(['update']);
  });

  it('refuses to send a change for a row it cannot name', async () => {
    const onRowsUpdate = vi.fn();
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: ['id', 'name'],
      // No `rowId`: there is nothing stable to send.
      dataProvider: { fetchRows: () => ({ rows: [['7', 'Ada']], totalRows: 1 }), onRowsUpdate },
    });
    await providerOf(grid).fetchData();
    grid.setDataAtCell(0, 1, 'Grace', 'edit');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRowsUpdate).not.toHaveBeenCalled();
    expect(grid.getDataAtCell(0, 1)).toBe('Ada');
  });

  it('refetches after a write goes through, so a server default is seen', async () => {
    let written = false;
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: ['id', 'name'],
      dataProvider: {
        rowId: 'id',
        fetchRows: () => ({ rows: [['7', written ? 'GRACE' : 'Ada']], totalRows: 1 }),
        onRowsUpdate: () => {
          written = true;
        },
      },
    });
    await providerOf(grid).fetchData();
    expect(grid.getDataAtCell(0, 1)).toBe('Ada');

    grid.setDataAtCell(0, 1, 'Grace', 'edit');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The server normalised it, and the refetch is what shows that.
    expect(grid.getDataAtCell(0, 1)).toBe('GRACE');
  });

  it('does not send the rows a fetch just loaded back to the server', async () => {
    const onRowsUpdate = vi.fn();
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: ['id', 'name'],
      dataProvider: {
        rowId: 'id',
        fetchRows: () => ({ rows: [['7', 'Ada']], totalRows: 1 }),
        onRowsUpdate,
      },
    });
    await providerOf(grid).fetchData();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRowsUpdate).not.toHaveBeenCalled();
  });

  it('runs mutations one after another', async () => {
    const order: string[] = [];
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      colHeaders: ['id', 'name'],
      dataProvider: {
        rowId: 'id',
        fetchRows: () => ({ rows: [['7', 'Ada']], totalRows: 1 }),
        onRowsRemove: async (ids: unknown[]) => {
          order.push(`start ${String(ids[0])}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push(`end ${String(ids[0])}`);
        },
      },
    });
    const plugin = providerOf(grid);
    await Promise.all([plugin.removeRows(['a']), plugin.removeRows(['b'])]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('throws rather than removing a row with no id', async () => {
    const onRowsRemove = vi.fn();
    const grid = await makeGrid({
      dataProvider: { fetchRows: () => ({ rows: [], totalRows: 0 }), onRowsRemove },
    });
    await expect(providerOf(grid).removeRows([undefined])).rejects.toThrow(/without an id/);
    expect(onRowsRemove).not.toHaveBeenCalled();
  });

  it('does not create rows past maxRows', async () => {
    const onRowsCreate = vi.fn();
    const grid = await makeGrid({
      startRows: 3,
      startCols: 1,
      maxRows: 3,
      dataProvider: { fetchRows: () => ({ rows: [], totalRows: 0 }), onRowsCreate },
    });
    await providerOf(grid).createRows({ position: 'below', rowsAmount: 1 });
    expect(onRowsCreate).not.toHaveBeenCalled();
  });
});

describe('conflicting settings', () => {
  for (const name of ['trimRows', 'manualRowMove', 'manualColumnMove', 'multiColumnSorting']) {
    it(`stays off when \`${name}\` is on, and says why`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fetchRows = vi.fn(() => ({ rows: [], totalRows: 0 }));
      const grid = await makeGrid({
        startRows: 2,
        startCols: 2,
        [name]: name === 'trimRows' ? [0] : true,
        dataProvider: { fetchRows },
      });
      expect(grid.isPluginEnabled('dataProvider')).toBe(false);
      expect(fetchRows).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
      warn.mockRestore();
    });
  }
});

describe('reporting a failure', () => {
  it('digs the message out of wherever the client buried it', () => {
    expect(messageOf(new Error('plain'), 'fallback')).toBe('plain');
    expect(messageOf('a string rejection', 'fallback')).toBe('a string rejection');
    expect(messageOf({ response: { data: { detail: 'nested' } } }, 'fallback')).toBe('nested');
    expect(messageOf({ body: { error: 'in the body' } }, 'fallback')).toBe('in the body');
    expect(messageOf({ nothing: 'useful' }, 'fallback')).toBe('fallback');
  });

  it('offers to try again, and stays up until someone answers', async () => {
    const grid = await makeGrid({
      notification: true,
      dataProvider: { fetchRows: () => Promise.reject(new Error('network down')) },
    });
    await providerOf(grid).fetchData();

    const toast = grid.view?.overlay.querySelector('.cm-notification');
    expect(toast?.textContent).toContain('network down');
    const action = toast?.querySelector('.cm-notification-action');
    expect(action?.textContent).toBe('Refetch');
  });
});
