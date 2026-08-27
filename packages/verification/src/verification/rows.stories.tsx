/**
 * Rows.
 *
 * Eleven guide pages about the vertical axis: which rows are on screen, in
 * what order, how tall, and how many at a time. Almost all of it is index
 * work — hiding, trimming, freezing, paging and sorting each take rows out of
 * the visual space or reorder it without touching a single value — so the
 * thing to look at is nearly always the row headers. If the two grids disagree
 * about which numbers appear beside which values, they disagree about the
 * index maps, and every feature built on those maps is affected.
 *
 * Two pages have nothing on our side to put beside the reference. `Row moving`
 * is a drag, and `manualRowMove` here has no pointer handlers at all — it is
 * `moveRows()` and nothing else. `Row parent-child` reads a `__children`
 * property out of the data source, and this library describes nesting with a
 * separate tree instead.
 */

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Rows" };

const coord = (row: number, col: number) => `${row}, ${col}`;

const months = ["January", "February", "March", "April", "May", "June"];

const finance = [
  ["42000", "31000", "11000"],
  ["45500", "33200", "12300"],
  ["48700", "35100", "13600"],
  ["51200", "36800", "14400"],
  ["54800", "38900", "15900"],
  ["57300", "40100", "17200"],
];

const products = [
  ["Trail Helmet", "1298.14", "2025-08-31", "true"],
  ["Windbreaker Jacket", "178.90", "2025-05-10", "false"],
  ["Cycling Cap", "288.10", "2025-09-15", "true"],
  ["HL Mountain Frame", "94.49", "2025-01-17", "false"],
  ["Racing Socks", "430.38", "2025-05-10", "true"],
  ["Aero Bottle", "1571.13", "2025-05-24", "true"],
  ["Carbon Handlebar", "1080.70", "2025-10-24", "false"],
  ["Speed Gloves", "635.13", "2025-11-17", "true"],
];

export function RowFreezing() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: "100%",
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
        fixedRowsTop: 2,
        fixedRowsBottom: 1,
      }}
      data={block(60, 12, coord)}
      note={`Scroll the body downwards in both panels. Rows 1 and 2 must stay under the
        column header and row 60 must stay on the floor, keeping their own row-header
        numbers, while everything between them moves. Freezing is drawn by splitting the
        table into panes rather than by pinning elements, so what would count as a
        difference is a frozen row that drifts with the body, a frozen row that shows
        values from the wrong physical row, or a visible seam where a pane meets the
        scrolling middle — each of those means one pane is being handed the wrong index
        range, not that the setting was ignored.`}
    />
  );
}

export function RowHeaders() {
  return (
    <Compare
      height={240}
      settings={{
        height: 240,
        colHeaders: ["Revenue", "Expenses", "Profit"],
        rowHeaders: months,
        rowHeaderWidth: 80,
      }}
      data={finance}
      note={`The leftmost column should read January through June rather than 1 through 6,
        and should be 80 pixels wide in both. Two things are being checked at once: that an
        array given to rowHeaders replaces the numbering rather than being ignored, and
        that rowHeaderWidth is honoured — a header column that has snapped back to its
        default width would still show the labels, so a reader who only checks the text
        would miss it. The page also documents a function form, which resolves through the
        same path as the array.`}
    />
  );
}

export function RowHeights() {
  return (
    <Compare
      height={280}
      settings={{
        height: 280,
        width: "100%",
        colHeaders: true,
        rowHeaders: true,
        minRowHeights: [60, 28, 44, 28, 60],
        manualRowResize: true,
      }}
      data={block(5, 5)}
      note={`Rows 1, 3 and 5 should be visibly taller than rows 2 and 4, by the same
        amounts on both sides. Despite the name, minRowHeights is the guide's current
        spelling for per-row heights and not a floor, so a grid that read it as a minimum
        and then measured content would draw five equal rows — that is what a difference
        here would mean. The page's other half, dragging the border between two row
        headers, cannot be shown: manualRowResize is accepted and drives the same sizes
        through the API, but the plugin registers no pointer listeners, so no drag handle
        appears on the left. That gap is recorded, not new.`}
    />
  );
}

export function RowHiding() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        colHeaders: true,
        rowHeaders: true,
        contextMenu: true,
        hiddenRows: {
          rows: [3, 5, 9],
          indicators: true,
          copyPasteEnabled: false,
        },
      }}
      data={block(12, 5)}
      note={`Rows 4, 6 and 10 should be missing from both grids while the numbering still
        runs 1 to 12 with those numbers simply absent — keeping the visual index is the
        whole difference between hiding and trimming, and a left-hand grid renumbered 1 to
        9 would be doing the latter. The headers on either side of each gap carry a mark,
        which is what indicators asks for; hiding was tracked correctly here long before
        it reached the renderer, so a row that is "hidden" and still drawn is the exact
        defect this panel exists to catch. Right-click for the show and hide items. One
        part of the page is not honoured: copyPasteEnabled is declared and nothing reads
        it, so a copy spanning a hidden row will still include that row.`}
    />
  );
}

export function RowMoving() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: "100%",
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
        manualRowMove: true,
      }}
      data={block(30, 8, coord)}
      note={`Select a row and drag the handle that appears above its header. On the right
        the row moves; on the left there is no handle to grab. manualRowMove is accepted
        here and the plugin's moveIndexes() works — it is only the pointer half that is
        missing, since the plugin registers no listeners. Both grids are mounted on purpose:
        with one of them the claim "there is nothing on our side" has to be believed, and
        with two it can be tried. The parity table claimed this feature outright until the
        audit.`}
    />
  );
}

export function RowParentChild() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        rowHeaders: true,
        colHeaders: ["Category", "Nominee"],
        contextMenu: true,
        nestedRows: true,
        columns: [{ data: "category" }, { data: "nominee" }],
        data: [
          {
            category: "Best Rock Performance",
            nominee: "",
            __children: [
              { category: "", nominee: "Twenty One Pilots" },
              { category: "", nominee: "Coldplay" },
            ],
          },
          {
            category: "Best Metal Performance",
            nominee: "",
            __children: [
              { category: "", nominee: "August Burns Red" },
              { category: "", nominee: "Ghost" },
            ],
          },
        ],
      }}
      note={`The same nested data on both sides. The tree should draw the same: parent rows
        with a collapse arrow, children indented beneath. What to check is the context menu,
        which the reference fills with the four nesting entries — insert child, detach from
        parent, and the two row-insert entries that respect the tree — and which here has
        the ordinary row entries only, so a child cannot be created by hand. Collapsing and
        expanding work on both.`}
    />
  );
}

export function RowPrePopulating() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        colHeaders: ["Name", "Team", "Role"],
        rowHeaders: true,
        minSpareRows: 1,
      }}
      data={[
        ["Ana García", "Engineering", "Senior Engineer"],
        ["James Okafor", "Marketing", "Product Manager"],
        ["Li Wei", "Engineering", "Staff Engineer"],
      ]}
      note={`Both grids should show exactly one empty row under the third name. Type into
        it: a fourth name should land in row 4 and one new empty row should appear beneath,
        never two. The count is taken from the extent of the data rather than from the
        current number of rows for that reason — a grid that measured itself instead would
        add a row on every render and grow without being touched, which is what a
        difference here would look like after a few keystrokes rather than immediately.`}
    />
  );
}

export function RowTrimming() {
  return (
    <Compare
      height={280}
      settings={{
        height: 280,
        colHeaders: true,
        rowHeaders: true,
        trimRows: [1, 2, 5],
      }}
      data={block(8, 5)}
      note={`Physical rows 1, 2 and 5 are trimmed, so both grids should show A1, A4, A5,
        A7 and A8 under row headers numbered 1 to 5. The renumbering is the point and is
        what separates this page from Row hiding: a trimmed row leaves the visual dataset
        entirely, so the rows below it shift up, whereas a hidden row keeps its number and
        leaves a gap in the sequence. If the left grid shows headers 1, 4, 5, 7, 8 it has
        implemented trimming as hiding, and every index the caller receives afterwards
        will be off by the number of trimmed rows above it.`}
    />
  );
}

export function RowVirtualization() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: "100%",
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
        viewportRowRenderingOffset: 10,
      }}
      data={block(2000, 12, coord)}
      note={`Two thousand rows, of which only a viewport's worth plus a ten-row margin
        should ever be in the DOM. Drag the scrollbar quickly from top to bottom in both
        panels: the numbers in the cells say which row you are on, so a band of blank rows
        that fills in afterwards, a jump that lands on the wrong row, or a scrollbar whose
        travel does not correspond to 2000 rows all mean the calculator is disagreeing with
        the renderer about the visible range. The page's escape hatch, renderAllRows: true,
        draws every row and is the configuration to reach for when the browser's own find
        has to see the whole grid.`}
    />
  );
}

export function RowsPagination() {
  return (
    <Compare
      height={340}
      settings={{
        height: 340,
        colHeaders: ["Model", "Price", "Sell date", "In stock"],
        rowHeaders: true,
        pagination: {
          pageSize: 5,
          pageSizeList: [5, 10, 20],
          initialPage: 2,
          showPageSize: true,
          showCounter: true,
          showNavigation: true,
        },
      }}
      data={block(23, 4, (row, col) => `r${row + 1}c${col + 1}`)}
      note={`Both grids should open on page 2 — rows 6 to 10 — with a bar underneath
        carrying a page-size select, a counter reading 2 / 5, and navigation. Paging is
        trimming, so the row headers renumber to 1 to 5 on every page; the values are
        untouched in the workbook. What a difference would mean is specific here: if the
        left grid shows all 23 rows and its counter reads 1 / 1, the Pagination plugin
        applied itself when it was enabled, which happens before the data setting is loaded
        into the workbook, and nothing re-pages it when the rows arrive. Changing the page
        size or pressing next would then correct it, which is the signature of that
        ordering rather than of a missing feature.`}
    />
  );
}

export function RowsSorting() {
  return (
    <Compare
      height={300}
      settings={{
        height: 300,
        colHeaders: ["Model", "Price", "Sell date", "In stock"],
        rowHeaders: true,
        columnSorting: {
          indicator: true,
          headerAction: true,
          initialConfig: { column: 0, sortOrder: "desc" },
        },
      }}
      data={products}
      note={`Click the Model header in both panels. The rows should reorder, an arrow
        should appear in that header, and a second and third click should give descending
        and then no sort at all. This is worth watching rather than reading: the header
        click was routed through a code path no real browser ever reached, so the feature
        passed its unit tests and did nothing on screen. Then click Price, where a
        difference is likelier — these are text cells holding numbers, and a grid sorting
        them as strings puts 1080.70 above 178.90. The initialConfig above asks for Model
        descending on load; if only the right-hand grid arrives sorted, the plugin read the
        setting before the data reached the workbook rather than failing to read it.`}
    />
  );
}
