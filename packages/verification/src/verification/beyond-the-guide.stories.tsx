/**
 * Pages the guide's sidebar does not list.
 *
 * Release notes, migration guides, and the framework-wrapper pages that belong
 * to the React, Vue and Angular variants of the documentation rather than to
 * the JavaScript one this tree mirrors. Kept, because the work behind them is
 * real; separated, because otherwise "every page in the guide has a story"
 * would be counting pages that are not in the guide.
 */

import { Compare, NotAFeature, block } from "../Compare.js";
import { registerRenderer as registerCellmoaRenderer } from "@cellmoa/grid";
import { registerRenderer as registerHotRenderer } from "handsontable/renderers";
import type { ColumnSettings, TrimRows } from "@cellmoa/grid";
import type Handsontable from "handsontable";

export default { title: "Beyond the guide" };

const alert = {
  template: {
    type: "alert" as const,
    title: "Unsaved changes",
    description: "Three cells have been edited since the last save.",
    buttons: [
      { text: "Discard", type: "secondary" as const },
      { text: "Save", type: "primary" as const },
    ],
  },
  background: "semi-transparent" as const,
  contentBackground: true,
  closable: true,
  a11y: { role: "dialog", ariaLabel: "Unsaved changes" },
};

const log = (page: string, path: string, what: string) => () => (
  <NotAFeature page={page} why={what} path={path} />
);

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

const staff = [
  ["Ana García", "Engineering", "Senior Engineer", "2021-04-12"],
  ["James Okafor", "Marketing", "Product Manager", "2022-08-30"],
  ["Li Wei", "Engineering", "Staff Engineer", "2019-02-18"],
  ["Sofia Rossi", "Sales", "Account Executive", "2023-01-09"],
  ["Diego Fernández", "Design", "UX Designer", "2020-11-23"],
  ["Amara Singh", "Engineering", "Engineering Manager", "2018-06-05"],
];

function flagButton(doc: Document, on: boolean): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.innerHTML = on ? FLAG_ON : FLAG_OFF;
  // The name goes on the control, never on the decorative `<svg>`.
  button.setAttribute(
    "aria-label",
    on ? "Flagged. Click to clear." : "Not flagged. Click to flag.",
  );
  button.style.cssText =
    "border:0;background:none;cursor:pointer;padding:0;line-height:1";
  return button;
}

registerCellmoaRenderer("flag", ({ td, cell }) => {
  td.textContent = "";
  td.appendChild(flagButton(td.ownerDocument, cell?.text === "yes"));
});

registerHotRenderer("flag", (_instance, td, _row, _col, _prop, value) => {
  td.textContent = "";
  td.appendChild(flagButton(td.ownerDocument, value === "yes"));
});

const FLAG_ON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 3h11l-2 4 2 4H8v10H6z"/></svg>';

const FLAG_OFF =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" d="M6.5 3.5h9.5l-2 3.5 2 3.5H6.5zM6.5 3.5v17"/></svg>';

// The `flag` renderer, registered in both libraries under the same name so the
// story can hand both grids the identical `columns: [{ renderer: 'flag' }]`.
// These are statements rather than declarations, which is why they did not
// travel with the story when the tree was rearranged — the left panel drew and
// the right one came up empty, and the browser check was the only thing that
// noticed.
registerCellmoaRenderer("flag", ({ td, cell }) => {
  td.textContent = "";
  td.appendChild(flagButton(td.ownerDocument, cell?.text === "yes"));
});

registerHotRenderer("flag", (_instance, td, _row, _col, _prop, value) => {
  td.textContent = "";
  td.appendChild(flagButton(td.ownerDocument, value === "yes"));
});

export const HowToUseIconsInCells = () => (
  <Compare
    note="The first column is drawn by a custom renderer registered under the name `flag` in both libraries' renderer registries, so the settings the two grids receive are byte-identical: `columns: [{ renderer: 'flag' }, …]`. The icon should appear filled where the value is `yes` and outlined otherwise, and it should survive scrolling, since both grids reuse cell elements between renders — an icon that duplicates or disappears as you scroll means the renderer is appending instead of replacing. The accessibility point is the one the page makes: the `<svg>` is `aria-hidden` and the name lives on the `<button>` around it, which you can confirm with Ladle's a11y addon in either panel. The renderer contracts themselves differ and cannot be made to match. cellmoa hands a renderer one object — `{ row, col, td, cell, meta }` — while Handsontable passes seven positional arguments; and cellmoa takes only a registered name in `renderer`, where Handsontable also accepts an inline function. Porting a renderer means rewriting its signature, which is worth knowing before you count this page as parity."
    settings={{
      colHeaders: ["Flag", "Item", "Qty"],
      rowHeaders: true,
      columns: [{ renderer: "flag" }, {}, {}],
    }}
    data={[
      ["yes", "Harbor Goods", "142"],
      ["no", "Alpine Supply Co.", "0"],
      ["yes", "Vertex Industries", "67"],
      ["no", "Meridian Works", "31"],
    ]}
    height={220}
  />
);

export const TextCellType = () => (
  <Compare
    settings={{
      colHeaders: ["SKU (text)", "Product", "Order code (must be AA-1234)"],
      rowHeaders: true,
      columns: [
        { type: "text" },
        {},
        { type: "text", validator: /^[A-Z]{2}-\d{4}$/, allowInvalid: false },
      ],
    }}
    data={[
      ["004821", "Laptop Pro 15", "AB-1234"],
      ["000093", "Wireless mouse", "CD-5678"],
      ["007712", "USB-C hub", "EF-9012"],
    ]}
    note="The first column is why the type is worth stating even though it is the default: 004821 is a code, and text is what keeps its leading zeros from being read away by a numeric type set higher up. The third column carries a RegExp, which both libraries document as a validator in its own right. Type xx into one of its cells and press Enter. The reference keeps the editor open — allowInvalid: false means the edit does not finish until the value passes or Escape restores the old one. This grid closes the editor and drops what was typed, leaving the previous value in place. That is a real difference and the more dangerous half of it is the silence: nothing tells the person their entry was thrown away."
  />
);

/**
 * Times, formatted through `Intl` on both sides.
 */

export function AddingAndRemovingColumns() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        colHeaders: ["Name", "Department", "Title", "Hire date"],
        rowHeaders: true,
        contextMenu: ["col_left", "col_right", "remove_col"],
        minSpareCols: 1,
      }}
      data={staff}
      note={`Both grids should carry one empty column to the right of Hire date, and a
        right-click should offer exactly three items — insert left, insert right, remove —
        because the context menu was given those keys and nothing else. Insert one and the
        header labels should shift with the data rather than staying put, which is the
        thing worth watching: a header array is positional, and a grid that inserts a
        column into the data but not into the labels leaves every heading describing its
        neighbour. The same operations are reachable as alter('insert_col_start') and
        alter('remove_col'); both grids accept the v13 spellings and the pre-v13 ones.`}
    />
  );
}

export function ColumnComponent() {
  return (
    <Compare
      note={`The page documents HotColumn, a React component in @handsontable/react-wrapper:
        declare a column as JSX and pass a React component as its renderer or editor. There
        is no wrapper here, so the component form is genuinely absent. What the component
        configures is not: every prop it takes is a key of the columns option, and both
        grids are given the same one below — a width, a read-only column, a type, a class.
        The two panels should be identical. The gap is the authoring style, not the
        capability, and the way to see that is to have the configured result in front of
        you rather than a sentence about it.`}
      settings={{
        colHeaders: ["Locked", "Amount", "Done", "Wide"],
        rowHeaders: true,
        columns: [
          { readOnly: true },
          { type: "numeric" },
          { type: "checkbox" },
          { width: 180, className: "htRight" },
        ],
      }}
      data={[
        ["locked", "1200", "true", "right aligned"],
        ["locked", "84", "false", "right aligned"],
      ]}
    />
  );
}

export const Collaboration = () => (
  <Compare
    note="The page is about applying a remote change without clobbering a local one. cellmoa's engine goes further than the guide asks: every commit carries an actor and a revision, and a write against a stale revision is refused rather than merged — which is what `afterRevisionConflict` reports. What it does not have is the grid-side guard the page's own example uses, `getActiveEditor().isOpened()`, so a remote change can land on a cell somebody is editing. Type into a cell in each and watch what a programmatic write does to it."
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(5, 4)}
    afterMount={{
      cellmoa: (grid) => {
        // A change arriving from somewhere else, a moment later.
        setTimeout(
          () => grid.setDataAtCell(0, 0, "from elsewhere", "api"),
          2500,
        );
      },
      handsontable: (hot) => {
        setTimeout(() => hot.setDataAtCell(0, 0, "from elsewhere"), 2500);
      },
    }}
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

export const Changelog = log(
  "Changelog",
  "changelog",
  "The release log. Nothing to mount — but the entries are where several of the renames below come from.",
);

export const Changelog6 = log(
  "Changelog 6.2.2",
  "changelog-6",
  "A release log.",
);

export const Changelog7 = log(
  "Older versions",
  "changelog-7",
  "A release log.",
);

export const Changelog8 = log("Changelog 8.0", "changelog-8", "A release log.");

export const Changelog9 = log("Changelog 9.0", "changelog-9", "A release log.");

export const Changelog10 = log(
  "Changelog 10.0",
  "changelog-10",
  "A release log.",
);

export const Changelog11 = log(
  "Changelog 11.0",
  "changelog-11",
  "A release log.",
);

export const Changelog12 = log(
  "Changelog 12.0",
  "changelog-12",
  "A release log.",
);

export const Changelog13 = log(
  "Changelog 13.0",
  "changelog-13",
  "A release log.",
);

export const Changelog14 = log(
  "Changelog 14.0",
  "changelog-14",
  "A release log.",
);

export const Changelog15 = log(
  "Changelog 15.0",
  "changelog-15",
  "A release log.",
);

export const Changelog16 = log(
  "Changelog 16.0",
  "changelog-16",
  "A release log.",
);

export const Changelog17 = log(
  "Changelog 17.0",
  "changelog-17",
  "A release log.",
);

export const Changelog18 = log(
  "Changelog 18.0",
  "changelog-18",
  "A release log.",
);

export const ChangesBetweenVersions = log(
  "Changes between versions",
  "changes-between-versions",
  "A widget on the reference’s own site that diffs two versions. Not a grid feature.",
);

export const DeprecationPolicy = log(
  "Deprecation policy",
  "deprecation-policy",
  "How long a deprecated API survives. Policy, not behaviour.",
);

export const LongTermSupport = log(
  "Long Term Support (LTS)",
  "long-term-support",
  "Which versions are supported for how long. Policy, not behaviour.",
);

export const VersioningPolicy = log(
  "Versioning policy",
  "versioning-policy",
  "What a major, minor and patch mean here. Policy, not behaviour.",
);

export const MigratingFrom74To80 = log(
  "Migrate from 7.4 to 8.0",
  "migrating-from-7.4-to-8.0",
  "Introduced the index mappers and removed `RecordTranslator`. cellmoa exposes the mappers as `rowIndex` / `colIndex` rather than `rowIndexMapper` / `columnIndexMapper`, so the names in this guide do not resolve.",
);

export const MigratingFrom84To90 = log(
  "Migrating from 8.4 to 9.0",
  "migrating-from-8.4-to-9.0",
  "Replaced the formulas plugin with HyperFormula. cellmoa calculates natively in its engine, which is a divergence recorded in the parity table — there is no plugin to configure either way.",
);

export const MigratingFrom90To100 = () => (
  <Compare
    note="10.0 turned the copy limits off: `rowsLimit` and `columnsLimit` became `Infinity`. cellmoa kept the old default of 1000 and clipped silently until recently. Select more than a thousand rows in each and copy — a clipped copy is the failure, and `afterCopyLimit` is what should report it."
    settings={{ colHeaders: true, rowHeaders: true, copyPaste: true }}
    data={block(1200, 3)}
    height={240}
  />
);

export const MigratingFrom100To110 = log(
  "Migrating from 10.0 to 11.0",
  "migrating-from-10.0-to-11.0",
  "Introduced modular imports and per-module type files. cellmoa has no modular entry points at all — its plugin barrel registers every plugin as a side effect, so the whole library is one indivisible bundle. Nothing to mount; the gap is in the package, not on screen.",
);

export const MigratingFrom111To120 = () => (
  <Compare
    note="12.0 split `loadData` from `updateData`: the first resets the configuration and the index maps, the second keeps them. Sort a column, then watch what a reload does to the sort. cellmoa routes `updateSettings({ data })` through `loadData` and never fires `beforeUpdateData`."
    settings={{
      colHeaders: ["name", "qty"],
      rowHeaders: true,
      columnSorting: true,
    }}
    data={[
      ["pear", "3"],
      ["apple", "12"],
      ["fig", "7"],
    ]}
  />
);

export const MigratingFrom124To130 = () => (
  <Compare
    note="13.0 replaced `insert_row` with `insert_row_above` / `_below` and `insert_col` with `insert_col_start` / `_end`. Every code sample written since uses the new names; they fell through every branch in cellmoa and did nothing at all — not an error, nothing. Both spellings are accepted now. Right-click a row header to try it."
    settings={{ colHeaders: true, rowHeaders: true, contextMenu: true }}
    data={block(5, 3)}
    height={300}
  />
);

export const MigratingFrom131To140 = () => (
  <Compare
    note="14.0 added `imeFastEdit` for composing input methods, and changed the menus' `open()` to take `{ top, left }` or a native event. cellmoa reads `imeFastEdit`; its `open()` still takes `(x, y)`, so the documented call shape does not apply. Switch to a Korean or Japanese keyboard and type into a cell."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      imeFastEdit: true,
      contextMenu: true,
    }}
    data={block(4, 3)}
  />
);

export const MigratingFrom146To150 = log(
  "Migrating from 14.6 to 15.0",
  "migrating-from-14.6-to-15.0",
  "A React-wrapper release. cellmoa ships no React wrapper, so nothing here applies.",
);

export const MigratingFrom153To160 = () => (
  <Compare
    note="16.0 moved to CSS custom properties and renamed the DOM classes. cellmoa uses its own `cm-*` classes and its own token set — a divergence recorded in the parity table — so a stylesheet written against `ht-*` will not reach it. What is worth comparing is whether the same theme setting produces the same look."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      themeName: "ht-theme-main",
      theme: "main",
    }}
    data={block(5, 4)}
  />
);

export const MigratingFrom160To161 = log(
  "Migrating from 16.0 to 16.1",
  "migrating-from-16.0-to-16.1",
  "Moved the pre-16 look into an opt-in `classic` theme. cellmoa registers a `classic` theme of its own; whether the two look alike is a question for the Styling section.",
);

export const MigratingFrom162To170 = () => (
  <Compare
    note="17.0 moved numbers and dates onto `Intl`: `numericFormat` takes `Intl.NumberFormatOptions` and the date types are spelled `intl-date` / `intl-time`. cellmoa follows the same shape and registers both spellings. A number that groups or places its currency differently is the difference to look for."
    settings={{
      colHeaders: ["Intl currency", "intl-date"],
      rowHeaders: true,
      columns: [
        {
          type: "numeric",
          numericFormat: { style: "currency", currency: "EUR" },
        },
        { type: "intl-date", dateFormat: { dateStyle: "medium" } },
      ],
    }}
    data={[
      ["1234.5", "2024-03-15"],
      ["-99", "2024-12-01"],
    ]}
  />
);

export const MigratingFrom171To180 = () => (
  <Compare
    note="18.0 dropped numbro, moment and the bundled sanitizer. HTML is written through the caller's `sanitizer` or not at all — cellmoa's dialog bypassed that entirely until recently, which was a live XSS path. Both grids here allow HTML with a sanitizer that strips scripts; the cell should show `bold` in bold and no script should run."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      allowHtml: true,
      sanitizer: (html: string) =>
        html.replace(/<script[\s\S]*?<\/script>/g, ""),
    }}
    data={[["<b>bold</b><script>alert(1)</script>", "plain"]]}
    height={180}
  />
);
