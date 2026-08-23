/**
 * Getting around the grid without a mouse, and finding a value in it.
 *
 * This is the section where cellmoa is furthest behind, and the gap is not
 * visible in a screenshot: the arrow keys work, the selection moves, the
 * grid looks finished. What is missing is everything that leads *into* a
 * widget — no keystroke opens a menu, nothing focusable exists outside the
 * table, and a search marks its hits without recording on the cells that they
 * are hits. A reader should try each of these with the mouse behind their
 * back; that is the only way the difference shows.
 */

import { Compare, block } from "../Compare.js";
import type { Search } from "@cellmoa/grid";

export default { title: "Verification/Navigation" };

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
