/**
 * Accessibility and navigation — the 6 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";
import type { Search } from "@cellmoa/grid";
import type Handsontable from "handsontable";

export default { title: "Verification/Accessibility and navigation" };

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const KeyboardShortcuts = () => (
  <Compare
    note="The page tabulates sixty shortcuts; cellmoa binds thirty-five of them. Everything for moving and selecting is here and should behave identically: arrows, Ctrl+arrow to the edge of the block, Home and End with and without Ctrl, Page Up and Page Down, Tab and Shift+Tab following `tabMoves`, Ctrl+A, Shift+arrow to extend, F2 and Enter to edit, Escape to abandon, Ctrl+Z and Ctrl+Y, and the clipboard three. The twenty-five that are missing are all one thing: `menu.ts` registers no `keydown` listener at all. Shift+F10 and Ctrl+Shift+backslash do not open the context menu, Shift+Alt+Down does not open the column menu, and once a menu is open by mouse the arrow keys, Home, End, Enter and Escape do nothing inside it. Try Shift+F10 on a selected cell in each panel — the right one opens a menu you can then drive with the arrow keys, the left one does nothing. Ctrl+Alt+M for a comment and Alt+A to clear filters are unbound for the same reason. A keyboard-only user of the left grid cannot insert a row, sort a column, or hide one."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: true,
      dropdownMenu: true,
      columnSorting: true,
      navigableHeaders: true,
      comments: true,
    }}
    data={block(8, 6)}
  />
);

export const CustomShortcuts = () => (
  <Compare
    note="`getShortcutManager()`, a named context, and `addShortcut({ keys, callback, group, runOnlyIf })` — the API the page documents is present here with the same spelling, the same nested `keys` array, the same group so a plugin can take back everything it registered, and the same `runOnlyIf` guard. Both grids bind Ctrl+B to write `bold` into the focused cell and Ctrl+K to a shortcut guarded to the first column only. Select a cell in column A and press each; then select one in column C and press Ctrl+K, where the guard should decline and nothing should happen. Two differences worth knowing rather than watching: cellmoa's contexts are `grid` and `editor` only, where the reference also has one per menu and per plugin — which follows from menus having no keyboard at all — and a callback returning `false` here declines the keystroke and leaves it to the browser, which is how the editor lets a real Tab through."
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(6, 4)}
    afterMount={{
      cellmoa: (grid) => {
        const context = grid.getShortcutManager().getContext("grid");
        context?.addShortcut({
          keys: [["control", "b"]],
          group: "verification",
          callback: () => {
            const cell = grid.getSelectedLast();
            if (cell) {
              grid.setDataAtCell(cell[0], cell[1], "bold", "api");
            }
          },
        });
        context?.addShortcut({
          keys: [["control", "k"]],
          group: "verification",
          runOnlyIf: () => (grid.getSelectedLast()?.[1] ?? -1) === 0,
          callback: () => {
            const cell = grid.getSelectedLast();
            if (cell) {
              grid.setDataAtCell(cell[0], cell[1], "column A only", "api");
            }
          },
        });
      },
      handsontable: (hot) => {
        const context = hot.getShortcutManager().getContext("grid");
        context?.addShortcut({
          keys: [["control", "b"]],
          group: "verification",
          callback: () => {
            const cell = hot.getSelectedLast();
            if (cell) {
              hot.setDataAtCell(cell[0], cell[1], "bold");
            }
          },
        });
        context?.addShortcut({
          keys: [["control", "k"]],
          group: "verification",
          runOnlyIf: () => (hot.getSelectedLast()?.[1] ?? -1) === 0,
          callback: () => {
            const cell = hot.getSelectedLast();
            if (cell) {
              hot.setDataAtCell(cell[0], cell[1], "column A only");
            }
          },
        });
      },
    }}
  />
);

export const FocusScopes = () => (
  <Compare
    note="Tab through both grids and watch where focus goes. On the right it enters the pagination controls below the table and leaves again, because the page is about `getFocusScopeManager().registerScope(name, element, { type, shortcutsContextName, onActivate })` — a way for a widget outside the table to take focus and bring its own shortcut context with it, and for a `modal` scope to keep focus inside a dialog. On the left focus stays on the table: `getFocusScopeManager()` exists and returns the grid itself, so a chained call does not throw, but there is no `registerScope`, no scope registry and no per-scope shortcut context. Both are mounted so the difference can be tabbed through rather than read. `tabNavigation` does work here — switching it off hands Tab back to the browser so a grid inside a form does not trap it — but that is the whole of it."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      pagination: { pageSize: 5 },
      tabNavigation: true,
      navigableHeaders: true,
    }}
    data={block(20, 5)}
    height={320}
  />
);

export const SearchingValues = () => (
  <Compare
    note="Both grids are queried for `3` on mount and mark what they found with the same default class, `htSearchResult`, so the highlighted cells should be the same cells. `query(text, callback, queryMethod)` returns the same `{ row, col, data }` array on both, `searchResultClass` is honoured on both, and a `queryMethod` given at initialization is used by both. Three things differ. The reference's contract is that `query()` writes `isSearchResult` onto each cell's meta and the renderer reads it back; cellmoa keeps a list of hits inside the plugin and adds the class from `afterRenderer`, so `getCellMeta(row, col).isSearchResult` is undefined here and a custom `callback` that relied on the default writing it will find nothing to read. `queryMethod` is called with `(query, value)` and not the documented third argument, the cell's meta — so a matcher that switched on the cell's `type` or `locale` cannot. And neither `queryMethod` nor `callback` can be overridden per cell or per column: the plugin reads its own settings only, so the page's `columns: [{}, { search: { queryMethod } }]` example has no effect."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      search: true,
    }}
    data={block(
      7,
      5,
      (row, col) => `${String.fromCharCode(65 + col)}${row + 1}`,
    )}
    afterMount={{
      cellmoa: (grid) => {
        grid.getPlugin<Search>("search")?.query("3");
      },
      handsontable: (hot) => {
        hot.getPlugin("search").query("3");
        hot.render();
      },
    }}
  />
);

export const Accessibility = () => (
  <Compare
    note="Both grids have `ariaTags: true`, navigable headers, and virtualization switched off with `renderAllRows`/`renderAllColumns`, which is what the page recommends for screen readers — a complete accessibility tree rather than a window onto one. Open Ladle's a11y addon and inspect each panel; then walk both with Tab and the arrow keys and watch what focus does. What you should find on the cellmoa side, all of it verified in the source rather than guessed: a `grid` role sits on the root `<div>`, but the rows live at `div[role=grid] > div.cm-pane > table > tbody > tr[role=row]`, and the `<table>` in between carries an implicit `table` role that severs the grid-to-row relationship — there are six panes, so six such tables. No cell ever gets `aria-selected` and the grid never gets `aria-multiselectable`, so a screen reader is told nothing about a selection that a sighted user can see. There is no roving tabindex: the root takes `tabindex=0` and no cell is ever focusable, so Tab reaches the grid and stops. There is no `aria-sort` on a sorted header, no `aria-readonly`, no accessible name on the grid, and no accessible name on the column-menu button, which renders as a bare `▾`. `aria-rowindex` and `aria-colindex` are emitted and are counted against the whole table rather than the rendered window, which is the correct choice and the one thing here that is right. Handsontable is not clean either, and its own VPAT says so: the December 2025 Kinaole audit records “Mixed table/ARIA semantics” as Critical against 1.3.1 for combining native table elements with grid roles, along with row headers in a separate table that is not linked to the data cells. cellmoa reproduces that same defect without having inherited the parts Handsontable got right."
    settings={{
      colHeaders: ["Region", "Owner", "Stage", "Value"],
      rowHeaders: true,
      ariaTags: true,
      navigableHeaders: true,
      tabNavigation: true,
      renderAllRows: true,
      renderAllColumns: true,
      columnSorting: true,
      dropdownMenu: true,
    }}
    data={block(8, 4)}
    height={300}
    afterMount={{
      cellmoa: (grid) => grid.selectCell(1, 1),
      handsontable: (hot) => hot.selectCell(1, 1),
    }}
  />
);

export const AccessibilityConformanceReportVpat = () => (
  <Compare
    height={300}
    note={`The page itself is a VPAT — a procurement document about one product, dated and
      externally audited — so there is no setting on it to copy. What a reader of that
      document actually wants to know is checkable, and it is what these two panels are
      for: open the browser's accessibility tree, or tab in and listen. Both grids should
      expose a grid role with rowcount and colcount, columnheader and rowheader cells,
      aria-selected on the focused cell, and aria-sort on a sorted header. cellmoa has no
      audit behind it and no report to show; it has the attributes, and those can be
      inspected here rather than taken on trust.`}
    settings={{
      height: 300,
      colHeaders: ["Name", "Role", "Active"],
      rowHeaders: true,
      columnSorting: true,
      navigableHeaders: true,
      columns: [{}, {}, { type: "checkbox" }],
    }}
    data={[
      ["Ada", "Engineer", "true"],
      ["Grace", "Admiral", "true"],
      ["Alan", "Analyst", "false"],
    ]}
  />
);
