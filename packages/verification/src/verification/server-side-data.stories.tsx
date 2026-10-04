/**
 * Server-side data — the 5 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare } from "../Compare.js";
import type { DataProvider } from "@cellmoa/grid";

export default { title: "Verification/Server-side data" };

function inventory(options: ServerOptions = {}) {
  const { latency = 250, echoQuery = false, maxQty } = options;
  let rows = CATALOG.map((values) => row(values[0]!, values[1]!, values[2]!));

  const wait = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, latency);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });

  return {
    rowId: "id",
    fetchRows: async (
      query: {
        page: number;
        pageSize: number;
        sort: unknown;
        filters: unknown;
      },
      { signal }: { signal: AbortSignal },
    ) => {
      await wait(signal);
      const start = (query.page - 1) * query.pageSize;
      const page = rows.slice(start, start + query.pageSize);
      if (echoQuery && page[0]) {
        const sort = query.sort ? JSON.stringify(query.sort) : "null";
        page[0] = row(
          page[0][0]!,
          `page ${query.page} · size ${query.pageSize} · sort ${sort}`,
          page[0][2]!,
        );
      }
      return { rows: page, totalRows: rows.length };
    },
    onRowsCreate: async (payload: {
      referenceRowId?: unknown;
      rowsAmount: number;
    }) => {
      const at = rows.findIndex(
        (values) => values[0] === String(payload.referenceRowId),
      );
      const made = Array.from({ length: payload.rowsAmount }, (_, index) =>
        row(`new-${Date.now()}-${index}`, "SKU-new", "0"),
      );
      rows.splice(at < 0 ? rows.length : at + 1, 0, ...made);
    },
    onRowsUpdate: async (
      updates: Array<{ id: unknown; changes: Record<string, string> }>,
    ) => {
      for (const update of updates) {
        const target = rows.findIndex(
          (values) => values[0] === String(update.id),
        );
        if (target < 0) {
          continue;
        }
        const next = [...rows[target]!];
        if (update.changes.sku !== undefined) {
          next[1] = update.changes.sku;
        }
        if (update.changes.qty !== undefined) {
          if (maxQty !== undefined && Number(update.changes.qty) > maxQty) {
            throw new Error(`quantity above ${maxQty} refused by the server`);
          }
          next[2] = update.changes.qty;
        }
        rows[target] = row(next[0]!, next[1]!, next[2]!);
      }
    },
    onRowsRemove: async (ids: unknown[]) => {
      const gone = new Set(ids.map(String));
      rows = rows.filter((values) => !gone.has(values[0]!));
    },
  };
}

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

const CATALOG: string[][] = Array.from({ length: 23 }, (_, index) =>
  row(
    String(index + 1),
    `SKU-${String(index + 1).padStart(3, "0")}`,
    String((index * 7) % 90),
  ),
);

interface ServerOptions {
  /** Milliseconds before an answer, so an overtaken request is visible. */
  latency?: number;
  /** Write the received query into the second column of the first row. */
  echoQuery?: boolean;
  /** Reject an update that pushes a quantity above this. */
  maxQty?: number;
}

/**
 * An in-memory server, built fresh for each story.
 *
 * Both panels in a story share it, because one settings object goes to both —
 * so a row created on the left turns up on the right at its next fetch. That is
 * an artefact of the harness rather than of either library.
 */

export const ServerSideData = () => (
  <Compare
    note="The whole `dataProvider` contract on one page. Both grids are given the same in-memory server and the same five callbacks; the rows arrive asynchronously, so both start empty and fill in. What works here on both sides is the fetch itself — the query object, the `AbortSignal`, `totalRows`, the error path with its Refetch toast, and the mutation callbacks with their optimistic write and rollback. What differs is the row shape: the reference wants row objects keyed by each column's `data`, and cellmoa's `fetchRows` is typed for and reads rows of text by position, because its workbook holds cells at addresses rather than under keys. The demo server below returns arrays that also carry the named properties, purely so one settings object can feed both — a real application would have to pick one. Watch the row headers too: both number rows globally through `modifyRowHeader`, so page 2 starts at 6."
    settings={{
      colHeaders: ["id", "sku", "qty"],
      rowHeaders: true,
      columns: [{ data: "id" }, { data: "sku" }, { data: "qty" }],
      pagination: { pageSize: 5 },
      loading: true,
      notification: true,
      dataProvider: inventory(),
    }}
    height={300}
  />
);

export const MigrateToServerSideData = () => (
  <Compare
    note="The page is a seven-point checklist for moving off a static `data` array. Six of the seven hold here: stable `rowId`, `fetchRows` replacing `loadData`, the three CRUD callbacks, dropping `afterChange` as a save hook, and enabling `filters`. Point four is the one to read carefully. It says to set `pagination` so `fetchRows` receives the page — and cellmoa reads `pagination.pageSize` once when the provider starts and never again. `Pagination.setPage` in this library trims the loaded rows client-side; it does not call `DataProvider.setPage`, which nothing in the source calls. Look at the two pagers first: the server holds 23 rows at five to a page, so the reference offers five pages, while cellmoa's pager counts only the rows it has and offers one. There is no page two to click. The first page is genuinely server-driven and there is nothing after it."
    settings={{
      colHeaders: ["id", "sku", "qty"],
      rowHeaders: true,
      columns: [{ data: "id" }, { data: "sku" }, { data: "qty" }],
      pagination: { pageSize: 5 },
      loading: true,
      dataProvider: inventory(),
    }}
    height={300}
  />
);

export const ServerSideConfiguration = () => (
  <Compare
    note="What `fetchRows` is handed. The page names four fields — `page`, `pageSize`, `sort`, `filters` — and the demo server writes the query it received into the `sku` column of the first row, so you can read it off the screen rather than the console. Both should show page 1 at the configured size. Then sort by clicking the `qty` header: the reference sends `sort: { prop: 'qty', order: 'asc' }` and refetches, and cellmoa sorts the five rows it already has without telling the server anything, because `ColumnSorting` never calls `DataProvider.setSort`. The same is true of `filters` — `DataProvider.setFilters` exists and has no caller. Both methods are reachable by hand from `getPlugin('dataProvider')`; nothing in the grid reaches them."
    settings={{
      colHeaders: ["id", "query fetchRows received", "qty"],
      rowHeaders: true,
      columns: [{ data: "id" }, { data: "sku" }, { data: "qty" }],
      pagination: { pageSize: 5 },
      columnSorting: true,
      loading: true,
      dataProvider: inventory({ echoQuery: true }),
    }}
    height={300}
  />
);

export const ServerSideCrud = () => (
  <Compare
    note="Create, update and remove. Edit a `qty` cell in either grid: the new value appears immediately, `onRowsUpdate` receives one entry of `{ id, changes, rowData }`, and the demo server rejects any quantity above 500 — so type 999 and the cell should snap back. That much matches on both sides, rollback included, and cellmoa serialises mutations so the server sees them in the order they were made. The gap is the context menu. Right-click a row header and insert or remove a row: the reference routes that through `onRowsCreate` / `onRowsRemove` and refetches, while cellmoa's menu commands alter the workbook directly and the provider is never told, so the grid and the server drift apart with nothing on screen saying so. `createRows`, `updateRows` and `removeRows` on the plugin do work — it is only the menu that bypasses them."
    settings={{
      colHeaders: ["id", "sku", "qty"],
      rowHeaders: true,
      columns: [{ data: "id" }, { data: "sku" }, { data: "qty" }],
      pagination: { pageSize: 5 },
      contextMenu: true,
      loading: true,
      notification: true,
      dataProvider: inventory({ maxQty: 500 }),
    }}
    height={300}
  />
);

export const ServerSideFetchingAndExamples = () => (
  <Compare
    note="The fetch lifecycle and its hooks. Each grid is told to fetch three times in quick succession after mounting; the demo server takes 400 ms to answer, so the first two requests are overtaken. Both should abort the stale ones and draw only the third answer — an aborted request that still lands would show as rows flickering back to an older page. cellmoa keeps one `AbortController` and bumps a generation counter, reports the superseded ones through `afterDataProviderFetchAbort`, and deliberately does not clear the loading overlay on an abort, which is what the page specifies. `beforeDataProviderFetch` can veto a fetch on both sides, and the `skipLoading` flag it carries is not passed on to `fetchRows` on either."
    settings={{
      colHeaders: ["id", "sku", "qty"],
      rowHeaders: true,
      columns: [{ data: "id" }, { data: "sku" }, { data: "qty" }],
      pagination: { pageSize: 5 },
      loading: true,
      notification: true,
      dataProvider: inventory({ latency: 400 }),
    }}
    afterMount={{
      cellmoa: (grid) => {
        const plugin = grid.getPlugin<DataProvider>("dataProvider");
        void plugin?.fetchData({ page: 1 });
        void plugin?.fetchData({ page: 2 });
        void plugin?.fetchData({ page: 3 });
      },
      handsontable: (hot) => {
        const plugin = hot.getPlugin("dataProvider");
        void plugin.fetchData({ page: 1 });
        void plugin.fetchData({ page: 2 });
        void plugin.fetchData({ page: 3 });
      },
    }}
    height={300}
  />
);
