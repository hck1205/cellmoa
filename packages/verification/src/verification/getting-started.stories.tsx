/**
 * The first twenty-four pages of the guide.
 *
 * This is the widest section and the least uniform. Four pages are prose — an
 * introduction, a showcase, an npm command, a licence — and eight are
 * React/Vue/Angular wrapper pages for a wrapper this library does not ship.
 * What is left is the part a reader should actually study: how data gets in
 * (`Binding to data`), how settings cascade (`Configuration options`), what the
 * grid tells you about a change (`Events and hooks`, `Saving data`), which
 * index a method means (`Understanding data and indexes`), and the five pages
 * on server-backed rows, where cellmoa does half of what the guide describes
 * and the half it skips is not obvious from looking at it.
 */

import { Compare, NotAFeature, block } from '../Compare.js';
import type { DataProvider, TrimRows } from '@cellmoa/grid';

export default { title: 'Verification/Getting started' };

// --- pages that are not about the grid ------------------------------------

export const Introduction = () => (
  <NotAFeature
    page="Introduction"
    path=""
    why="A landing page: which framework to pick, and links to sandboxes. There is no configuration on it and nothing to draw twice."
  />
);

export const Demo = () => (
  <NotAFeature
    page="Demo"
    path="demo"
    why="A showcase — one grid with sorting, a context menu, cell types and a theme switched on at once, to be clicked at. Every feature it displays has its own page and its own story elsewhere in this tree, so a second copy of all of them here would compare nothing that is not compared better somewhere else."
  />
);

export const Installation = () => (
  <NotAFeature
    page="Installation"
    path="installation"
    why="`npm install`, a `<script>` tag, and which stylesheet to import. Two things about cellmoa differ and neither is visible in a grid. It ships one package with four subpaths and no per-plugin entry points, so there is no equivalent of the reference's modular build — `src/plugins/index.ts` registers every plugin as a side effect and the package does not declare `sideEffects: false`, which means a bundler cannot drop any of it. And a cellmoa grid needs a calculation engine before it can exist: `Engine.load(fetch(wasmUrl))` is awaited and the result passed as `engine`, because formulas are built in rather than added by a plugin."
  />
);

export const LicenseKey = () => (
  <NotAFeature
    page="License key"
    path="license-key"
    why="A commercial term. cellmoa needs no key. `licenseKey` is accepted and ignored so that a Handsontable configuration works here unchanged, and the grid says so once on the console rather than silently — a setting that looks accepted and does nothing is the kind of thing a reader should be told about rather than left to assume."
  />
);

// --- pages about a framework wrapper this library does not ship ------------

export const InstanceMethods = () => (
  <NotAFeature
    page="Instance methods"
    path="instance-methods"
    why="How to reach the grid instance through the React wrapper's ref. cellmoa ships one package, `@cellmoa/grid`, with no React, Vue or Angular wrapper: the instance is whatever `new Grid(container, options)` returned, so there is no ref to reach through."
  />
);

export const InstanceAccess = () => (
  <NotAFeature
    page="Instance access"
    path="instance-access"
    why="The same question for the Angular wrapper: read `hotInstance` off the `<hot-table>` component. There is no Angular wrapper here to read it off."
  />
);

export const InstanceReference = () => (
  <NotAFeature
    page="Instance reference"
    path="vue-instance-reference"
    why="The same question for Vue 3: a template ref on `HotTable` and `hotRef.value.hotInstance`. There is no Vue wrapper here."
  />
);

export const HotColumnComponent = () => (
  <NotAFeature
    page="HotColumn component"
    path="vue-hot-column"
    why="A Vue component that declares one column as markup, so a column's renderer and editor can be written as Vue components. cellmoa configures columns with the `columns` option only, and its renderers and editors are functions, not components of any framework."
  />
);

export const IntegrationWithRedux = () => (
  <NotAFeature
    page="Integration with Redux"
    path="redux"
    why="Holding the grid's data in a Redux store and feeding it back through the React wrapper's props. Without a React wrapper there is no prop to feed; the equivalent here is calling `loadData` or `updateData` from whatever holds your state, which is not something the reference's page is about."
  />
);

export const VuexStateManagement = () => (
  <NotAFeature
    page="Vuex state management"
    path="vue-vuex"
    why="The same pattern in Vuex, through the Vue wrapper. Out of scope for a library with no Vue wrapper."
  />
);

export const PiniaStateManagement = () => (
  <NotAFeature
    page="Pinia state management"
    path="vue-pinia"
    why="The same pattern again in Pinia. Out of scope for the same reason."
  />
);

export const UseHandsontableInNuxt = () => (
  <NotAFeature
    page="Use Handsontable in Nuxt"
    path="vue-nuxt"
    why="Getting the Vue wrapper past Nuxt's server-side rendering, where `window` does not exist during the render. cellmoa has the same constraint — a grid needs a DOM and a fetched WebAssembly module — but no wrapper and no Nuxt plugin to configure, so there is nothing on this page to hold up against it."
  />
);

// --- pages about the grid --------------------------------------------------

export const ConfigurationOptions = () => (
  <Compare
    note="The cascade, drawn as a single column of cells. Every layer the page names is set on column 0 at once: the grid says `className: 'htLeft'`, the column says `htCenter`, the `cell` array says `htRight` for row 2, and the `cells` function says `htCenter` again for row 4. The page states three times that `cells` overwrites all other options, so row 4 must be centred even though a narrower layer spoke, and row 2 must be right-aligned because `cell` beats the column. cellmoa ran `cells` before the per-cell map until recently, which meant conditional formatting worked until a cell also had explicit meta and then quietly stopped for that cell alone — if row 4 comes out left- or right-aligned here, that regression is back."
    settings={{
      colHeaders: ['cascade', 'b', 'c'],
      rowHeaders: true,
      className: 'htLeft',
      columns: [{ className: 'htCenter' }, {}, {}],
      cell: [{ row: 2, col: 0, className: 'htRight' }],
      cells: (row: number, col: number) =>
        row === 4 && col === 0 ? { className: 'htCenter' } : {},
    }}
    data={block(6, 3)}
  />
);

export const GridSize = () => (
  <Compare
    note="`width` and `height` as the page describes them: a bare number is pixels, a string is CSS as written. Both grids are asked for `320` and `55%` of the panel, so the two should end up the same size with the same scrollbars. Two things on this page cellmoa does not do. A function-valued `width` or `height` — which the reference accepts — is read as neither a number nor a string and comes out as no size at all, so the container decides. And there is no window-resize observer and no `ResizeObserver` anywhere in the library: the reference re-measures on a debounced window resize and lets you decline that through `beforeRefreshDimensions`, while here nothing re-measures until something else causes a render. Resize the browser window and watch which of the two keeps its scrollbars honest."
    settings={{ colHeaders: true, rowHeaders: true, width: 320, height: '55%' }}
    data={block(40, 8)}
    height={300}
  />
);

export const CustomIdClassAndStyle = () => (
  <Compare
    note="The page's two rules. `tableClassName` puts a class on the table and `className` cascades to every cell — both are set here to `htCenter`, so all the values should be centred in both grids, and a column of left-aligned text on either side means the class never reached the cells. The other rule does differ: the reference overwrites the container's `id` with a generated `ht_<random>` whenever it is absent or already starts with `ht_`, and cellmoa never touches the container's `id` at all. Inspect the two host elements — the right one has an `id`, the left one has none. Neither behaviour is wrong, but code that reads the container back by `id` after construction only works against the reference."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      tableClassName: 'cm-verification-table',
      className: 'htCenter',
    }}
    data={block(5, 4)}
  />
);

export const ServerSideData = () => (
  <Compare
    note="The whole `dataProvider` contract on one page. Both grids are given the same in-memory server and the same five callbacks; the rows arrive asynchronously, so both start empty and fill in. What works here on both sides is the fetch itself — the query object, the `AbortSignal`, `totalRows`, the error path with its Refetch toast, and the mutation callbacks with their optimistic write and rollback. What differs is the row shape: the reference wants row objects keyed by each column's `data`, and cellmoa's `fetchRows` is typed for and reads rows of text by position, because its workbook holds cells at addresses rather than under keys. The demo server below returns arrays that also carry the named properties, purely so one settings object can feed both — a real application would have to pick one. Watch the row headers too: both number rows globally through `modifyRowHeader`, so page 2 starts at 6."
    settings={{
      colHeaders: ['id', 'sku', 'qty'],
      rowHeaders: true,
      columns: [{ data: 'id' }, { data: 'sku' }, { data: 'qty' }],
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
    note="The page is a seven-point checklist for moving off a static `data` array. Six of the seven hold here: stable `rowId`, `fetchRows` replacing `loadData`, the three CRUD callbacks, dropping `afterChange` as a save hook, and enabling `filters`. Point four is the one to read carefully. It says to set `pagination` so `fetchRows` receives the page — and cellmoa reads `pagination.pageSize` once when the provider starts and never again. `Pagination.setPage` in this library trims the loaded rows client-side; it does not call `DataProvider.setPage`, which nothing in the source calls. So the first page is genuinely server-driven and every page after it is a slice of the first page's rows. Click through to page 2 in both: the reference fetches five more rows, cellmoa shows an empty page."
    settings={{
      colHeaders: ['id', 'sku', 'qty'],
      rowHeaders: true,
      columns: [{ data: 'id' }, { data: 'sku' }, { data: 'qty' }],
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
      colHeaders: ['id', 'query fetchRows received', 'qty'],
      rowHeaders: true,
      columns: [{ data: 'id' }, { data: 'sku' }, { data: 'qty' }],
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
      colHeaders: ['id', 'sku', 'qty'],
      rowHeaders: true,
      columns: [{ data: 'id' }, { data: 'sku' }, { data: 'qty' }],
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
      colHeaders: ['id', 'sku', 'qty'],
      rowHeaders: true,
      columns: [{ data: 'id' }, { data: 'sku' }, { data: 'qty' }],
      pagination: { pageSize: 5 },
      loading: true,
      notification: true,
      dataProvider: inventory({ latency: 400 }),
    }}
    afterMount={{
      cellmoa: (grid) => {
        const plugin = grid.getPlugin<DataProvider>('dataProvider');
        void plugin?.fetchData({ page: 1 });
        void plugin?.fetchData({ page: 2 });
        void plugin?.fetchData({ page: 3 });
      },
      handsontable: (hot) => {
        const plugin = hot.getPlugin('dataProvider');
        void plugin.fetchData({ page: 1 });
        void plugin.fetchData({ page: 2 });
        void plugin.fetchData({ page: 3 });
      },
    }}
    height={300}
  />
);

export const BindingToData = () => (
  <Compare
    note="An array of objects, with `columns[].data` naming which property each column holds — the shape most applications actually have, because it is what an API answers with. The columns are deliberately given out of the objects' own key order and one key is left out entirely, so a grid that ignored `data` and fell back to `Object.keys` would show four columns in the wrong order. Two things on this page cellmoa does not do. A function-valued `columns` is supported, but a function-valued `columns[].data` is not: `colToProp` accepts a string or a number and nothing else, so a column that computes its own value has no way to say so. And `dataSchema` and `dataDotNotation`, which the page uses for nested objects, are read only to print a notice — a workbook addresses cells rather than keying them, and the mapping belongs in `valueGetter` / `valueSetter`."
    settings={{
      colHeaders: ['Model', 'Year', 'Price'],
      rowHeaders: true,
      columns: [{ data: 'model' }, { data: 'year' }, { data: 'price' }],
      data: [
        { year: '2018', model: 'Ford', price: '21400', vin: 'ignored' },
        { year: '2020', model: 'Audi', price: '38900', vin: 'ignored' },
        { year: '2019', model: 'BMW', price: '35200', vin: 'ignored' },
        { year: '2021', model: 'Toyota', price: '27750', vin: 'ignored' },
      ],
    }}
  />
);

export const SavingData = () => (
  <Compare
    note="The page's whole recommendation is one hook: `afterChange` carries `[row, prop, oldValue, newValue]` for every accepted change, and that array is what you POST. Both grids write the hook's first two arguments into the last column, so the payload is readable without a console — edit any cell in the first three columns. The row numbers agree; the second slot does not, and that is the finding. The reference fills it with the column's `prop`, so an edit to the middle column reports `qty`, which is the key a server can act on. cellmoa builds its change array from the column index and reports `1` — the same number a Handsontable grid would report only for array-of-arrays data. Code following this page against named columns would send a body keyed by position. The `source` argument does agree, which is what the page's feedback-loop warning relies on: the write these handlers make from inside `afterChange` carries a source they test for instead of recursing."
    settings={{
      colHeaders: ['sku', 'qty', 'note', 'afterChange said'],
      rowHeaders: true,
      columns: [{ data: 'sku' }, { data: 'qty' }, { data: 'note' }, { data: 'log' }],
      data: [
        { sku: 'A-100', qty: '4', note: 'edit me', log: '' },
        { sku: 'A-101', qty: '9', note: 'or me', log: '' },
        { sku: 'A-102', qty: '2', note: '', log: '' },
      ],
    }}
    afterMount={{
      cellmoa: (grid) => {
        grid.hooks.add('afterChange', (changes: unknown, source: unknown) => {
          const list = changes as Array<[number, string | number, string, string]> | null;
          if (!list || source === 'saved') {
            return;
          }
          for (const [row, prop] of list) {
            if (prop === 'log' || prop === 3) {
              continue;
            }
            grid.setDataAtCell(row, 3, `row ${row}, prop ${String(prop)}`, 'saved');
          }
        });
      },
      handsontable: (hot) => {
        hot.addHook('afterChange', (changes, source) => {
          if (!changes || source === 'saved') {
            return;
          }
          for (const [row, prop] of changes) {
            if (prop === 'log' || prop === 3) {
              continue;
            }
            hot.setDataAtCell(row, 3, `row ${row}, prop ${String(prop)}`, 'saved');
          }
        });
      },
    }}
  />
);

export const EventsAndHooks = () => (
  <Compare
    note="The page's claim is that a hook is both an event and a middleware: `after`-prefixed hooks report, `before`-prefixed ones can change or refuse what is about to happen. Both are wired here. `beforeChange` upper-cases whatever you type and refuses the word `no` outright by nulling its entry, and `afterChange` writes the accepted value into the fourth column — so typing `no` should leave the cell as it was, on both sides. cellmoa threw away the array `beforeChange` handed back until recently, which meant neither the edit nor the veto worked; it is the most-used validation hook in a Handsontable application, so this is the one to watch. The count is the honest part of this page: cellmoa names all 255 hooks and, at the time of writing, 107 of them can actually be fired — `node scripts/parity.mjs` counts them, and the other 148 are names with nothing behind them."
    settings={{
      colHeaders: ['type here', 'b', 'c', 'afterChange said'],
      rowHeaders: true,
    }}
    data={block(5, 4, (row, col) => (col === 3 ? '' : `${String.fromCharCode(65 + col)}${row + 1}`))}
    afterMount={{
      cellmoa: (grid) => {
        grid.hooks.add('beforeChange', (changes: unknown) => {
          const list = changes as Array<[number, number, string, string] | null>;
          list.forEach((change, index) => {
            if (!change) {
              return;
            }
            if (String(change[3]).toLowerCase() === 'no') {
              list[index] = null;
            } else {
              change[3] = String(change[3]).toUpperCase();
            }
          });
        });
        grid.hooks.add('afterChange', (changes: unknown, source: unknown) => {
          const list = changes as Array<[number, number, string, string]> | null;
          if (!list || source === 'hook') {
            return;
          }
          for (const [row, col, , value] of list) {
            if (col !== 3) {
              grid.setDataAtCell(row, 3, String(value), 'hook');
            }
          }
        });
      },
      handsontable: (hot) => {
        hot.addHook('beforeChange', (changes) => {
          changes.forEach((change, index) => {
            if (!change) {
              return;
            }
            if (String(change[3]).toLowerCase() === 'no') {
              changes[index] = null;
            } else {
              change[3] = String(change[3]).toUpperCase();
            }
          });
        });
        hot.addHook('afterChange', (changes, source) => {
          if (!changes || source === 'hook') {
            return;
          }
          for (const [row, col, , value] of changes) {
            if (col !== 3) {
              hot.setDataAtCell(row, 3, String(value), 'hook');
            }
          }
        });
      },
    }}
  />
);

export const UnderstandingDataAndIndexes = () => (
  <Compare
    note="The page's central distinction, made visible. Physical row 1 — the one holding `A2` — is trimmed, so it is gone from the view and every row below it has shifted up one visual position. Each grid then reads the same coordinate two ways and writes both answers into column 3: `getDataAtCell(1, 0)` follows the view and must say `A3`, while `getSourceDataAtCell(1, 0)` takes a physical index into the dataset as provided and must say `A2` — the trimmed row, which is still there. If the two agree, one of them is lying. cellmoa's `getSourceData*` family took visual indexes until recently, which meant following the guide and persisting `getSourceData()` saved the sorted view with the trimmed rows missing; that is the failure this story exists to catch."
    settings={{
      colHeaders: ['A', 'B', 'C', 'read back'],
      rowHeaders: true,
      trimRows: true,
    }}
    data={block(5, 4, (row, col) => (col === 3 ? '' : `${String.fromCharCode(65 + col)}${row + 1}`))}
    afterMount={{
      cellmoa: (grid) => {
        // Trimmed after the values are in, not through the setting: the
        // harness loads `data` after construction, and a row trimmed before
        // that would take one of the loaded values with it.
        grid.getPlugin<TrimRows>('trimRows')?.trimRows([1]);
        grid.setDataAtCell(0, 3, `view (1,0): ${grid.getDataAtCell(1, 0)}`);
        grid.setDataAtCell(1, 3, `source (1,0): ${grid.getSourceDataAtCell(1, 0)}`);
      },
      handsontable: (hot) => {
        hot.getPlugin('trimRows').trimRows([1]);
        hot.render();
        hot.setDataAtCell(0, 3, `view (1,0): ${String(hot.getDataAtCell(1, 0))}`);
        hot.setDataAtCell(1, 3, `source (1,0): ${String(hot.getSourceDataAtCell(1, 0))}`);
      },
    }}
  />
);

// --- the demo server the five server-side stories share --------------------

/**
 * One row, readable by both grids.
 *
 * The two libraries disagree about what a fetched row is: the reference reads
 * an object keyed by each column's `data`, and cellmoa reads a row of text by
 * position. An array carrying the same values as named properties satisfies
 * both, which is what lets one settings object feed the pair. It is a device
 * for this file, not advice — an application picks one shape.
 */
function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

const CATALOG: string[][] = Array.from({ length: 23 }, (_, index) =>
  row(String(index + 1), `SKU-${String(index + 1).padStart(3, '0')}`, String((index * 7) % 90)),
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
function inventory(options: ServerOptions = {}) {
  const { latency = 250, echoQuery = false, maxQty } = options;
  let rows = CATALOG.map((values) => row(values[0]!, values[1]!, values[2]!));

  const wait = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, latency);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });

  return {
    rowId: 'id',
    fetchRows: async (
      query: { page: number; pageSize: number; sort: unknown; filters: unknown },
      { signal }: { signal: AbortSignal },
    ) => {
      await wait(signal);
      const start = (query.page - 1) * query.pageSize;
      const page = rows.slice(start, start + query.pageSize);
      if (echoQuery && page[0]) {
        const sort = query.sort ? JSON.stringify(query.sort) : 'null';
        page[0] = row(
          page[0][0]!,
          `page ${query.page} · size ${query.pageSize} · sort ${sort}`,
          page[0][2]!,
        );
      }
      return { rows: page, totalRows: rows.length };
    },
    onRowsCreate: async (payload: { referenceRowId?: unknown; rowsAmount: number }) => {
      const at = rows.findIndex((values) => values[0] === String(payload.referenceRowId));
      const made = Array.from({ length: payload.rowsAmount }, (_, index) =>
        row(`new-${Date.now()}-${index}`, 'SKU-new', '0'),
      );
      rows.splice(at < 0 ? rows.length : at + 1, 0, ...made);
    },
    onRowsUpdate: async (updates: Array<{ id: unknown; changes: Record<string, string> }>) => {
      for (const update of updates) {
        const target = rows.findIndex((values) => values[0] === String(update.id));
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
