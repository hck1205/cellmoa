/**
 * Rows — the 11 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Rows" };

const coord = (row: number, col: number) => `${row}, ${col}`;

const finance = [
  ["42000", "31000", "11000"],
  ["45500", "33200", "12300"],
  ["48700", "35100", "13600"],
  ["51200", "36800", "14400"],
  ["54800", "38900", "15900"],
  ["57300", "40100", "17200"],
];

const months = ["January", "February", "March", "April", "May", "June"];

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

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
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

// --- more of what each page documents ---------------------------------------

export const RowHeadersFromAFunction = () => (
  <Compare
    note={`\`rowHeaders\` takes true, an array, or a function of the visual index. The
      function form is the one worth checking, because it is called on every render for
      every visible row — so a grid that memoised the wrong thing shows stale labels
      after a sort. These should read "row 1" downwards, and keep doing so after you
      scroll.`}
    settings={{
      colHeaders: true,
      rowHeaders: (index: number) => `row ${index + 1}`,
    }}
    data={block(8, 3)}
  />
);

export const RowHeadersWidth = () => (
  <Compare
    note={`\`rowHeaderWidth\` fixes the header column's width. Long labels are the test:
      at 140px both panels should show the whole word, and at the default they would
      clip. A grid that accepts the number without applying it looks right until a label
      is longer than the default, which is why these labels are long.`}
    settings={{
      colHeaders: true,
      rowHeaders: ["Reconciliation", "Adjustments", "Provisions", "Total"],
      rowHeaderWidth: 140,
    }}
    data={block(4, 3)}
  />
);

export const RowHeightsPerRow = () => (
  <Compare
    note={`\`rowHeights\` as an array gives each row its own height and as a number gives
      them all the same. The array here is shorter than the table, so the last rows
      should fall back to the default rather than collapsing — the same fallback the
      column widths story checks, and the same failure if it is missing.`}
    settings={{ colHeaders: true, rowHeaders: true, rowHeights: [60, 24, 60] }}
    data={block(5, 3)}
  />
);

export const RowFreezingTopAndBottom = () => (
  <Compare
    height={260}
    note={`\`fixedRowsTop\` pins rows to the top and \`fixedRowsBottom\` to the bottom.
      Scroll each panel: two rows should stay above and one below, with the middle
      sliding between them. The bottom one is the harder half — it has to be measured
      from the end of the data rather than the start, so a grid that gets top right and
      bottom wrong is measuring from the wrong edge.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      height: 260,
      fixedRowsTop: 2,
      fixedRowsBottom: 1,
    }}
    data={block(30, 4)}
  />
);

export const RowVirtualizationRenderAll = () => (
  <Compare
    height={240}
    note={`\`renderAllRows: true\` puts every row in the DOM. Count \`tr\` elements: with
      three hundred rows there should be three hundred, against the twenty or so the
      default keeps. The setting exists for pages that print the grid or measure it from
      outside, and the count is the whole of what it costs.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      height: 240,
      renderAllRows: true,
    }}
    data={block(300, 3)}
  />
);

export const RowsSortingInitial = () => (
  <Compare
    note={`\`columnSorting.initialConfig\` sorts on load rather than on a click. Both
      panels should come up already sorted by Amount descending, with the header showing
      the indicator. What this catches that the click story cannot: a grid that wires
      sorting to the header handler only sorts when clicked, and arrives here unsorted
      while looking entirely correct.`}
    settings={{
      colHeaders: ["Item", "Amount"],
      rowHeaders: true,
      columnSorting: {
        initialConfig: { column: 1, sortOrder: "desc" },
        indicator: true,
      },
    }}
    data={[
      ["Rent", "1200"],
      ["Cloud", "640"],
      ["Travel", "180"],
      ["Salaries", "8400"],
    ]}
  />
);

export const RowsSortingMultiColumn = () => (
  <Compare
    note={`\`multiColumnSorting\` sorts by more than one column at once: click Region,
      then shift-click Amount, and the rows should order by region first and by amount
      within each region. The indicators should show the order the columns were added,
      because without that a reader cannot tell which sort is the tie-breaker.`}
    settings={{
      colHeaders: ["Region", "Amount"],
      rowHeaders: true,
      multiColumnSorting: { indicator: true },
    }}
    data={[
      ["East", "30"],
      ["West", "10"],
      ["East", "10"],
      ["West", "30"],
      ["East", "20"],
    ]}
  />
);

export const RowsPaginationSizeList = () => (
  <Compare
    height={300}
    note={`The pager's own controls: a page-size list, the counter, and the navigation.
      Change the size and watch both the rows and the counter — a pager that redraws the
      rows without updating the counter is the common half-wired case, and it reads as
      correct until the numbers disagree.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      height: 300,
      pagination: {
        pageSize: 5,
        pageSizeList: [5, 10, "auto"],
        showPageSize: true,
        showCounter: true,
        showNavigation: true,
      },
    }}
    data={block(23, 3)}
  />
);

export const RowPrePopulatingSpareRows = () => (
  <Compare
    note={`\`minSpareRows\` keeps empty rows at the bottom so there is always somewhere to
      type. Type into the last row of either panel and another should appear beneath it.
      The count is what to watch: the setting is a minimum, so after typing there should
      still be two blank rows, not one.`}
    settings={{ colHeaders: true, rowHeaders: true, minSpareRows: 2 }}
    data={[
      ["a", "b"],
      ["c", "d"],
    ]}
  />
);

export const RowTrimmingHidesFromEverything = () => (
  <Compare
    note={`Trimming differs from hiding in what the rest of the grid can still see. A
      hidden row is out of the view but still in the data; a trimmed row is out of both,
      so \`countRows\` drops and a copy of the whole table leaves it out. Rows 2 and 4 are
      trimmed here — check the row headers renumber on both sides rather than skipping.`}
    settings={{ colHeaders: true, rowHeaders: true, trimRows: [1, 3] }}
    data={block(6, 3)}
  />
);
