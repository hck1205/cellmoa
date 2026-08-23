/**
 * What the grid tells assistive technology, and what a keyboard can reach.
 *
 * This is the section with the largest honest gap, and the one where a green
 * test suite is most misleading: every attribute below exists in the DOM, so
 * an assertion that it is present passes, while the *relationships* between
 * them — which is the whole of ARIA — are broken. The Ladle a11y addon is the
 * tool for this section; open it on the first story and read both panels.
 *
 * The pages are in the order the guide's own sidebar lists them.
 */

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Accessibility" };

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

export const AccessibilityConformanceReport = () => (
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
