/**
 * The first twenty-four pages of the guide.
 *
 * This is the widest section and the least uniform. Twelve of its pages are
 * about something other than a grid setting — a landing page, a showcase, an
 * npm command, a licence, and eight React/Vue/Angular wrapper pages for a
 * wrapper this library does not ship. They are still drawn twice rather than
 * described: a wrapper page is teaching something the wrapper only wraps —
 * reaching the instance, feeding it from a store, configuring one column — and
 * that part is answerable here. The rest is the part a reader should study: how data gets in
 * (`Binding to data`), how settings cascade (`Configuration options`), what the
 * grid tells you about a change (`Events and hooks`, `Saving data`), which
 * index a method means (`Understanding data and indexes`), and the five pages
 * on server-backed rows, where cellmoa does half of what the guide describes
 * and the half it skips is not obvious from looking at it.
 */

import type Handsontable from "handsontable";
import { Compare, block } from "../Compare.js";
import type { ColumnSettings, DataProvider, TrimRows } from "@cellmoa/grid";

export default { title: "Verification/Getting started" };

// --- pages that are not about the grid ------------------------------------

export const Introduction = () => (
  <Compare
    note={`The landing page picks a framework and links to sandboxes, so there is no
      configuration on it to copy. What can be compared is what you get with none: the
      same data and nothing else, in both grids. Headers, widths, selection and the
      keyboard should behave the same before a single option is set — if the two panels
      differ here, every later story is comparing on top of a difference.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(6, 5)}
  />
);

export const Demo = () => (
  <Compare
    height={320}
    note={`The showcase page turns several features on at once and invites clicking. Doing
      that in one grid demonstrates; doing it in two compares, which is why this is a pair
      rather than a link. Sort by a header, open the context menu, edit the checkbox and
      the dropdown. Each of these has its own story elsewhere with a much narrower claim —
      this one is here to catch the case where two features are each fine alone and
      interfere when switched on together.

      One difference should be visible without clicking anything. The date and numeric
      columns carry the reference's own spellings — \`dateFormat: 'YYYY-MM-DD'\` and
      \`numericFormat: { pattern: '0,0.00' }\` — and only the right panel honours them.
      cellmoa reads both options as Intl descriptors, so a moment format string and a
      numbro pattern are not things it can use, and the cells render unformatted. Both are
      accepted at settings time rather than rejected, which is why this shows as plain text
      rather than an error.`}
    settings={{
      height: 320,
      colHeaders: ["Company", "Country", "Sell date", "In stock", "Rating"],
      rowHeaders: true,
      columnSorting: true,
      contextMenu: true,
      columns: [
        { type: "text" },
        { type: "dropdown", source: ["UK", "Japan", "Kenya", "Chile"] },
        // The reference's own spelling, passed through unchanged on purpose —
        // see the note. The cast is what lets it reach both grids identically.
        { type: "date", dateFormat: "YYYY-MM-DD" } as unknown as ColumnSettings,
        { type: "checkbox" },
        {
          type: "numeric",
          numericFormat: { pattern: "0,0.00" },
        } as unknown as ColumnSettings,
      ],
    }}
    data={[
      ["Tagcat", "UK", "2025-01-11", "true", "4"],
      ["Zoombox", "Japan", "2025-03-04", "false", "2"],
      ["Wordtune", "Kenya", "2025-07-19", "true", "5"],
      ["Yodel", "Chile", "2025-11-02", "false", "3"],
    ]}
  />
);

export const Installation = () => (
  <Compare
    note={`The page is an npm command and a stylesheet import, and the thing worth checking
      after following it is that a grid appears at all. Both panels here were built from a
      plain install of each package, so this is that check. Two differences are real and
      neither is visible: cellmoa ships one package with five subpaths — the module, two
      stylesheets, the themes, and the WebAssembly file the engine needs — with no
      per-plugin entry points, and that .wasm has to be fetched, so a bundler that inlines
      everything else still has one asset to serve.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(4, 4)}
  />
);

export const LicenseKey = () => (
  <Compare
    note={`Both grids are given \`licenseKey: 'non-commercial-and-evaluation'\`. The
      reference needs one; cellmoa is MIT and needs none. The point of the pair is that a
      configuration carried over from Handsontable keeps working: the option is accepted
      rather than rejected, so nothing here should look different from a grid without it.
      It is reported once on the console rather than dropped in silence — a setting that
      does nothing should say so, or the next person spends an afternoon on why their key
      has no effect.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      licenseKey: "non-commercial-and-evaluation",
    }}
    data={block(4, 4)}
  />
);

export const InstanceMethods = () => (
  <Compare
    note={`The page answers "how do I reach the grid from my code" for the React wrapper,
      via a ref. cellmoa has no wrapper, so the answer is that \`new Grid(container,
      options)\` returns the instance directly — but the question underneath is the same,
      and it is answerable on both. After mount each grid is asked to select A1:B2 and set
      A1 through its own instance API. Both should show the same selection and the same
      value, which is the actual claim the page is making.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(5, 4)}
    afterMount={{
      cellmoa: (grid) => {
        grid.setDataAtCell(0, 0, "set via instance");
        grid.selectCell(0, 0, 1, 1);
      },
      handsontable: (hot) => {
        hot.setDataAtCell(0, 0, "set via instance");
        hot.selectCell(0, 0, 1, 1);
      },
    }}
  />
);

export const InstanceAccess = () => (
  <Compare
    note={`The same question as the previous page, asked of the Angular wrapper: read
      \`hotInstance\` off the \`<hot-table>\` component. There is no Angular wrapper
      here, and no Angular in this story either — what both panels show is the part that
      survives the wrapper's absence, which is that the instance exposes the same methods
      under the same names. Each grid is asked for its own row count after mount and writes
      it into A1.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(5, 3)}
    afterMount={{
      cellmoa: (grid) =>
        grid.setDataAtCell(0, 0, "countRows() = " + String(grid.countRows())),
      handsontable: (hot) =>
        hot.setDataAtCell(0, 0, "countRows() = " + String(hot.countRows())),
    }}
  />
);

export const InstanceReference = () => (
  <Compare
    note={`The Vue 3 form of the same question — a template ref on \`HotTable\`, then
      \`hotRef.value.hotInstance\`. Again there is no wrapper here. What is comparable is
      whether the instance behaves the same once you have it: both grids are told to load
      a different array after mount, which is what a component would do when its props
      change.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(3, 3)}
    afterMount={{
      cellmoa: (grid) =>
        grid.loadData([
          ["replaced", "after"],
          ["the", "mount"],
        ]),
      handsontable: (hot) =>
        hot.loadData([
          ["replaced", "after"],
          ["the", "mount"],
        ]),
    }}
  />
);

export const HotColumnComponent = () => (
  <Compare
    note={`\`HotColumn\` lets a Vue or React user declare one column as markup and pass a
      component as its renderer. cellmoa configures columns through the \`columns\` option
      only. The capability the page is really about — per-column type, width, alignment and
      read-only — is set here the other way and shown on both sides. What is genuinely
      missing is the component: a renderer here is a function that writes into a cell, not
      a Vue or React tree.`}
    settings={{
      colHeaders: ["Read only", "Numeric", "Checkbox", "Wide"],
      rowHeaders: true,
      columns: [
        { readOnly: true },
        {
          type: "numeric",
          numericFormat: { pattern: "0,0.00" },
        } as unknown as ColumnSettings,
        { type: "checkbox" },
        { width: 160, className: "htRight" },
      ],
    }}
    data={[
      ["locked", "1234.5", "true", "right aligned"],
      ["locked", "99", "false", "right aligned"],
    ]}
  />
);

export const IntegrationWithRedux = () => (
  <Compare
    note={`The page holds the grid's data in a Redux store and feeds it back through the
      React wrapper's props. Without a wrapper there is no prop, but the shape of the
      problem is the same in any store: something outside the grid owns the array, and the
      grid has to be told when it changes. Both panels are mounted with one array and
      handed a second one afterwards, which is exactly what a store subscription would do.
      Watch that neither grid keeps a stale row.`}
    settings={{ colHeaders: ["Item", "Qty"], rowHeaders: true }}
    data={[["from initial state", "1"]]}
    afterMount={{
      cellmoa: (grid) =>
        grid.loadData([
          ["dispatched", "2"],
          ["from the store", "3"],
        ]),
      handsontable: (hot) =>
        hot.loadData([
          ["dispatched", "2"],
          ["from the store", "3"],
        ]),
    }}
  />
);

export const VuexStateManagement = () => (
  <Compare
    note={`The same pattern in Vuex. What is comparable without a Vue wrapper is the half
      that matters: a mutation replaces the array and the grid is updated in place. Both
      grids get \`updateData\` rather than \`loadData\` here — the distinction the page
      leans on, since one keeps the index map, the selection and the scroll position and
      the other resets them. Select a cell before the swap and see whether the selection
      survives on both.`}
    settings={{ colHeaders: ["Item", "Qty"], rowHeaders: true }}
    data={[
      ["committed", "1"],
      ["by a mutation", "2"],
    ]}
    afterMount={{
      cellmoa: (grid) => {
        grid.selectCell(1, 0);
        grid.updateData([
          ["committed", "10"],
          ["by a mutation", "20"],
        ]);
      },
      handsontable: (hot) => {
        hot.selectCell(1, 0);
        hot.updateData([
          ["committed", "10"],
          ["by a mutation", "20"],
        ]);
      },
    }}
  />
);

export const PiniaStateManagement = () => (
  <Compare
    note={`Pinia, and the same shape again. This pair asks the narrower question the three
      store pages share: after the store writes into the grid, does reading back out of the
      grid give the store what it just wrote? Each panel writes a value through its
      instance and then puts what \`getDataAtCell\` returns beside it.`}
    settings={{ colHeaders: ["Written", "Read back"], rowHeaders: true }}
    data={[["", ""]]}
    afterMount={{
      cellmoa: (grid) => {
        grid.setDataAtCell(0, 0, "42");
        grid.setDataAtCell(0, 1, String(grid.getDataAtCell(0, 0)));
      },
      handsontable: (hot) => {
        hot.setDataAtCell(0, 0, "42");
        hot.setDataAtCell(0, 1, String(hot.getDataAtCell(0, 0)));
      },
    }}
  />
);

export const UseHandsontableInNuxt = () => (
  <Compare
    note={`The page is about getting the Vue wrapper past server-side rendering, where
      \`window\` does not exist while the page is being built. cellmoa has the same
      constraint and one more: the engine is WebAssembly and has to be fetched, so a grid
      here cannot be constructed during a server render either. Both panels are mounted the
      way a client-only component would mount them — after the first paint — which is the
      workaround the page describes, and both should end up in the same place.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(4, 4)}
  />
);

export const ConfigurationOptions = () => (
  <Compare
    note="The cascade, drawn as a single column of cells. Every layer the page names is set on column 0 at once: the grid says `className: 'htLeft'`, the column says `htCenter`, the `cell` array says `htRight` for row 2, and the `cells` function says `htCenter` again for row 4. The page states three times that `cells` overwrites all other options, so row 4 must be centred even though a narrower layer spoke, and row 2 must be right-aligned because `cell` beats the column. cellmoa ran `cells` before the per-cell map until recently, which meant conditional formatting worked until a cell also had explicit meta and then quietly stopped for that cell alone — if row 4 comes out left- or right-aligned here, that regression is back."
    settings={{
      colHeaders: ["cascade", "b", "c"],
      rowHeaders: true,
      className: "htLeft",
      columns: [{ className: "htCenter" }, {}, {}],
      cell: [{ row: 2, col: 0, className: "htRight" }],
      cells: (row: number, col: number) =>
        row === 4 && col === 0 ? { className: "htCenter" } : {},
    }}
    data={block(6, 3)}
  />
);

export const GridSize = () => (
  <Compare
    note="`width` and `height` as the page describes them: a bare number is pixels, a string is CSS as written. Both grids are asked for `320` and `55%` of the panel, so the two should end up the same size with the same scrollbars. Two things on this page cellmoa does not do. A function-valued `width` or `height` — which the reference accepts — is read as neither a number nor a string and comes out as no size at all, so the container decides. And there is no window-resize observer and no `ResizeObserver` anywhere in the library: the reference re-measures on a debounced window resize and lets you decline that through `beforeRefreshDimensions`, while here nothing re-measures until something else causes a render. Resize the browser window and watch which of the two keeps its scrollbars honest."
    settings={{ colHeaders: true, rowHeaders: true, width: 320, height: "55%" }}
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
      tableClassName: "cm-verification-table",
      className: "htCenter",
    }}
    data={block(5, 4)}
  />
);

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

export const BindingToData = () => (
  <Compare
    note="An array of objects, with `columns[].data` naming which property each column holds — the shape most applications actually have, because it is what an API answers with. The columns are deliberately given out of the objects' own key order and one key is left out entirely, so a grid that ignored `data` and fell back to `Object.keys` would show four columns in the wrong order. Two things on this page cellmoa does not do. A function-valued `columns` is supported, but a function-valued `columns[].data` is not: `colToProp` accepts a string or a number and nothing else, so a column that computes its own value has no way to say so. And `dataSchema` and `dataDotNotation`, which the page uses for nested objects, are read only to print a notice — a workbook addresses cells rather than keying them, and the mapping belongs in `valueGetter` / `valueSetter`."
    settings={{
      colHeaders: ["Model", "Year", "Price"],
      rowHeaders: true,
      columns: [{ data: "model" }, { data: "year" }, { data: "price" }],
      data: [
        { year: "2018", model: "Ford", price: "21400", vin: "ignored" },
        { year: "2020", model: "Audi", price: "38900", vin: "ignored" },
        { year: "2019", model: "BMW", price: "35200", vin: "ignored" },
        { year: "2021", model: "Toyota", price: "27750", vin: "ignored" },
      ],
    }}
  />
);

export const SavingData = () => (
  <Compare
    note="The page's whole recommendation is one hook: `afterChange` carries `[row, prop, oldValue, newValue]` for every accepted change, and that array is what you POST. Both grids write the hook's first two arguments into the last column, so the payload is readable without a console — edit any cell in the first three columns. The row numbers agree; the second slot does not, and that is the finding. The reference fills it with the column's `prop`, so an edit to the middle column reports `qty`, which is the key a server can act on. cellmoa builds its change array from the column index and reports `1` — the same number a Handsontable grid would report only for array-of-arrays data. Code following this page against named columns would send a body keyed by position. The `source` argument does agree, which is what the page's feedback-loop warning relies on: the write these handlers make from inside `afterChange` carries a source they test for instead of recursing."
    settings={{
      colHeaders: ["sku", "qty", "note", "afterChange said"],
      rowHeaders: true,
      columns: [
        { data: "sku" },
        { data: "qty" },
        { data: "note" },
        { data: "log" },
      ],
      data: [
        { sku: "A-100", qty: "4", note: "edit me", log: "" },
        { sku: "A-101", qty: "9", note: "or me", log: "" },
        { sku: "A-102", qty: "2", note: "", log: "" },
      ],
    }}
    afterMount={{
      cellmoa: (grid) => {
        grid.hooks.add("afterChange", (changes: unknown, source: unknown) => {
          const list = changes as Array<
            [number, string | number, string, string]
          > | null;
          if (!list || source === "saved") {
            return;
          }
          for (const [row, prop] of list) {
            if (prop === "log" || prop === 3) {
              continue;
            }
            grid.setDataAtCell(
              row,
              3,
              `row ${row}, prop ${String(prop)}`,
              "saved",
            );
          }
        });
      },
      handsontable: (hot) => {
        hot.addHook(
          "afterChange",
          (changes: Handsontable.CellChange[] | null, source: string) => {
            if (!changes || source === "saved") {
              return;
            }
            for (const [row, prop] of changes) {
              if (prop === "log" || prop === 3) {
                continue;
              }
              hot.setDataAtCell(
                row,
                3,
                `row ${row}, prop ${String(prop)}`,
                "saved",
              );
            }
          },
        );
      },
    }}
  />
);

export const EventsAndHooks = () => (
  <Compare
    note="The page's claim is that a hook is both an event and a middleware: `after`-prefixed hooks report, `before`-prefixed ones can change or refuse what is about to happen. Both are wired here. `beforeChange` upper-cases whatever you type and refuses the word `no` outright by nulling its entry, and `afterChange` writes the accepted value into the fourth column — so typing `no` should leave the cell as it was, on both sides. cellmoa threw away the array `beforeChange` handed back until recently, which meant neither the edit nor the veto worked; it is the most-used validation hook in a Handsontable application, so this is the one to watch. The count is the honest part of this page: cellmoa names all 255 hooks and, at the time of writing, 107 of them can actually be fired — `node scripts/parity.mjs` counts them, and the other 148 are names with nothing behind them."
    settings={{
      colHeaders: ["type here", "b", "c", "afterChange said"],
      rowHeaders: true,
    }}
    data={block(5, 4, (row, col) =>
      col === 3 ? "" : `${String.fromCharCode(65 + col)}${row + 1}`,
    )}
    afterMount={{
      cellmoa: (grid) => {
        grid.hooks.add("beforeChange", (changes: unknown) => {
          const list = changes as Array<
            [number, number, string, string] | null
          >;
          list.forEach((change, index) => {
            if (!change) {
              return;
            }
            if (String(change[3]).toLowerCase() === "no") {
              list[index] = null;
            } else {
              change[3] = String(change[3]).toUpperCase();
            }
          });
        });
        grid.hooks.add("afterChange", (changes: unknown, source: unknown) => {
          const list = changes as Array<
            [number, number, string, string]
          > | null;
          if (!list || source === "hook") {
            return;
          }
          for (const [row, col, , value] of list) {
            if (col !== 3) {
              grid.setDataAtCell(row, 3, String(value), "hook");
            }
          }
        });
      },
      handsontable: (hot) => {
        hot.addHook(
          "beforeChange",
          (changes: Array<Handsontable.CellChange | null>) => {
            changes.forEach((change, index) => {
              if (!change) {
                return;
              }
              if (String(change[3]).toLowerCase() === "no") {
                changes[index] = null;
              } else {
                change[3] = String(change[3]).toUpperCase();
              }
            });
          },
        );
        hot.addHook(
          "afterChange",
          (changes: Handsontable.CellChange[] | null, source: string) => {
            if (!changes || source === "hook") {
              return;
            }
            for (const [row, col, , value] of changes) {
              if (col !== 3) {
                hot.setDataAtCell(row, 3, String(value), "hook");
              }
            }
          },
        );
      },
    }}
  />
);

export const UnderstandingDataAndIndexes = () => (
  <Compare
    note="The page's central distinction, made visible. Physical row 1 — the one holding `A2` — is trimmed, so it is gone from the view and every row below it has shifted up one visual position. Each grid then reads the same coordinate two ways and writes both answers into column 3: `getDataAtCell(1, 0)` follows the view and must say `A3`, while `getSourceDataAtCell(1, 0)` takes a physical index into the dataset as provided and must say `A2` — the trimmed row, which is still there. If the two agree, one of them is lying. cellmoa's `getSourceData*` family took visual indexes until recently, which meant following the guide and persisting `getSourceData()` saved the sorted view with the trimmed rows missing; that is the failure this story exists to catch."
    settings={{
      colHeaders: ["A", "B", "C", "read back"],
      rowHeaders: true,
      trimRows: true,
    }}
    data={block(5, 4, (row, col) =>
      col === 3 ? "" : `${String.fromCharCode(65 + col)}${row + 1}`,
    )}
    afterMount={{
      cellmoa: (grid) => {
        // Trimmed after the values are in, not through the setting: the
        // harness loads `data` after construction, and a row trimmed before
        // that would take one of the loaded values with it.
        grid.getPlugin<TrimRows>("trimRows")?.trimRows([1]);
        grid.setDataAtCell(0, 3, `view (1,0): ${grid.getDataAtCell(1, 0)}`);
        grid.setDataAtCell(
          1,
          3,
          `source (1,0): ${grid.getSourceDataAtCell(1, 0)}`,
        );
      },
      handsontable: (hot) => {
        hot.getPlugin("trimRows").trimRows([1]);
        hot.render();
        hot.setDataAtCell(
          0,
          3,
          `view (1,0): ${String(hot.getDataAtCell(1, 0))}`,
        );
        hot.setDataAtCell(
          1,
          3,
          `source (1,0): ${String(hot.getSourceDataAtCell(1, 0))}`,
        );
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
