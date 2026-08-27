/**
 * Columns — the 10 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";
import type Handsontable from "handsontable";

export default { title: "Verification/Columns" };

const coord = (row: number, col: number) => `${row}, ${col}`;

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export function ColumnHeaders() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        rowHeaders: true,
        columnHeaderHeight: 50,
        colWidths: [70, 140, 140, 120, 120],
        columns: [
          { title: "ID" },
          { title: "Full name" },
          { title: "Position" },
          { title: "Country" },
          { title: "Start date" },
        ],
      }}
      data={[
        ["1", "Ana García", "Product Manager", "Spain", "2022-03-14"],
        ["2", "James Okafor", "Senior Engineer", "Nigeria", "2021-07-02"],
        ["3", "Li Wei", "Data Analyst", "China", "2023-01-19"],
        ["4", "Sofia Rossi", "UX Designer", "Italy", "2020-11-30"],
        ["5", "Mateo Fernández", "Engineering Lead", "Argentina", "2019-05-08"],
      ]}
      note={`There is no colHeaders setting here at all: the labels come from the title
        property inside columns, which is the third of the page's four routes to a heading
        and the one that goes through the settings cascade rather than through a top-level
        array. Both header strips should read ID through Start date and be 50 pixels tall.
        A grid that fell back to A, B, C, D, E is resolving the header from the global
        layer and never consulting the column layer — which would also mean type, renderer
        and readOnly declared the same way are being missed, so the interesting failure is
        much larger than a wrong label.`}
    />
  );
}

export function ColumnGroups() {
  return (
    <Compare
      height={300}
      settings={{
        height: 300,
        colHeaders: true,
        rowHeaders: true,
        colWidths: 60,
        nestedHeaders: [
          ["A", { label: "B", colspan: 8 }, "C"],
          ["D", { label: "E", colspan: 4 }, { label: "F", colspan: 4 }, "G"],
          [
            "H",
            { label: "I", colspan: 2 },
            { label: "J", colspan: 2 },
            { label: "K", colspan: 2 },
            { label: "L", colspan: 2 },
            "M",
          ],
          ["N", "O", "P", "Q", "R", "S", "T", "U", "V", "W"],
        ],
        collapsibleColumns: [
          { row: -4, col: 1, collapsible: true },
          { row: -3, col: 1, collapsible: true },
          { row: -2, col: 1, collapsible: true },
          { row: -2, col: 3, collapsible: true },
        ],
      }}
      data={block(5, 10)}
      note={`Count the header rows first: there must be exactly four in both, ending in N
        through W. The nestedHeaders setting is the whole header, so colHeaders: true does
        not add a fifth row of A, B, C underneath — a grid showing one is drawing the
        default header as well as the configured one. Then use the fold buttons on B, E, I
        and K. The array form of collapsibleColumns counts levels upward from the first
        table row, which is why row is negative; a build that compared -4 against a level
        index counted downwards matched nothing and gave a configuration that silently
        collapsed nothing at all, so a left-hand grid with no buttons means exactly that.
        Two properties from the same page, visibleWhen and columnDropMode, are not read
        here and are left out rather than shown not working.`}
    />
  );
}

export function ColumnHiding() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        colHeaders: true,
        rowHeaders: true,
        contextMenu: true,
        hiddenColumns: { columns: [3, 5, 9], indicators: true },
      }}
      data={block(5, 12)}
      note={`Columns D, F and J should be absent from both while the remaining headers keep
        their own letters — A, B, C, E, G, H, I, K, L — rather than closing up into a
        contiguous run. Keeping the letter is keeping the visual index, which is what makes
        a hidden column different from a trimmed one and what keeps a formula pointing at
        the right place. The headers flanking each gap carry a mark, which is what
        indicators asks for; that setting is read on the header hook, so a hidden column
        with unmarked neighbours means the hook never fired rather than that the column is
        still there. Right-click for the show and hide items.`}
    />
  );
}

export function ColumnMoving() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: "100%",
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
        manualColumnMove: true,
      }}
      data={block(40, 20, coord)}
      note={`Grab a column header and drag it. On the right it moves; on the left it does
        not. manualColumnMove is accepted here and the plugin's moveIndexes() works,
        and the array form sets an initial order — what is missing is the gesture, because
        the plugin registers no pointer listeners, so there is no drag handle and no drop
        indicator. Both grids are mounted so that can be tried rather than taken on trust.
        The page also documents what moving does to the data — nothing; the order lives in
        the index map and getSourceData() still returns the original sequence — and that
        part is true of both.`}
    />
  );
}

export function ColumnFreezing() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: "100%",
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
        fixedColumnsStart: 2,
        manualColumnFreeze: true,
        contextMenu: true,
      }}
      data={block(40, 30, coord)}
      note={`Scroll sideways. The first two columns must hold their place against the row
        headers while the rest move, and the numbers in them must stay 0 and 1 — a frozen
        pane that keeps drawing but reads a shifted column index is the failure that looks
        like success. Then right-click a header further right and freeze it: the column
        should move to the end of the frozen block rather than being duplicated there,
        because manualColumnFreeze reorders the index map and raises fixedColumnsStart
        rather than copying anything. The older spelling fixedColumnsLeft is accepted by
        both and resolves to the same setting.`}
    />
  );
}

export function ColumnWidths() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        width: "100%",
        colHeaders: true,
        rowHeaders: true,
        colWidths: [50, 100, 200, 400],
        stretchH: "last",
        manualColumnResize: true,
      }}
      data={block(5, 4)}
      note={`The first three columns should be 50, 100 and 200 pixels wide in both, and the
        fourth should absorb whatever space is left over rather than sitting at its
        declared 400. That is the interesting part: stretchH computes the stretch from the
        declared widths, not from the widths it has already produced, so a grid that
        measured its own output would grow the last column a little more on every render
        and the panel would drift wider as you resize the window. Widen the browser and
        watch whether the first three columns hold their sizes. The page's other half,
        dragging the border between two column headers, is not demonstrable on the left:
        manualColumnResize accepts an array and drives the same sizes through the API, but
        the plugin has no pointer listeners, so no drag handle and no double-click autofit.`}
    />
  );
}

export function ColumnSummary() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        colHeaders: ["sum", "min", "max", "count", "average"],
        rowHeaders: true,
        columnSummary: [
          {
            sourceColumn: 0,
            type: "sum",
            destinationRow: 3,
            destinationColumn: 0,
            ranges: [[0, 2]],
          },
          {
            sourceColumn: 1,
            type: "min",
            destinationRow: 3,
            destinationColumn: 1,
            ranges: [[0, 2]],
          },
          {
            sourceColumn: 2,
            type: "max",
            destinationRow: 3,
            destinationColumn: 2,
            ranges: [[0, 2]],
          },
          {
            sourceColumn: 3,
            type: "count",
            destinationRow: 3,
            destinationColumn: 3,
            ranges: [[0, 2]],
          },
          {
            sourceColumn: 4,
            type: "average",
            destinationRow: 3,
            destinationColumn: 4,
            roundFloat: 2,
            ranges: [[0, 2]],
          },
        ],
      }}
      data={[
        ["1", "2", "3", "4", "5"],
        ["6", "7", "8", "9", "12.345"],
        ["11", "12", "13", "", "15"],
        ["", "", "", "", ""],
      ]}
      note={`Row 4 is the destination row and should read 18, 2, 13, 2 and 10.78 in both.
        The two get there differently, and that is recorded rather than being a finding:
        the reference computes the totals and writes numbers, while this library writes
        =SUM(A1:A3) and lets the engine evaluate it, so the total follows the values above
        it and survives an .xlsx export as a real total. Edit a number in column A and the
        sum should move on both sides. The same choice is why customFunction is a formula
        template string here — 'SUMPRODUCT({{range}})' — where the reference takes a
        JavaScript function; a function is refused by name at settings time rather than
        throwing mid-render. If row 4 is blank on the left, the plugin wrote its formulas
        when it was enabled, before the data reached the workbook, and the load cleared
        them. Every endpoint here names a destinationColumn because the reference
        throws without one; this library infers it from sourceColumn, which is a
        difference in strictness rather than in result.`}
    />
  );
}

export function ColumnVirtualization() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: "100%",
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
      }}
      data={block(60, 500, coord)}
      note={`Five hundred columns, of which only the visible band should be in the DOM.
        Scroll sideways in both panels and read the second number in each cell: it names
        the column, so a band that arrives blank and fills in, or a horizontal scrollbar
        whose travel does not reach column 499, means the column calculator and the
        renderer disagree about the visible range. Column virtualization is the harder of
        the two axes because a column's width is not uniform once colWidths or stretching
        is involved, so the offset has to be computed from accumulated widths rather than
        multiplied. renderAllColumns: true turns it off, which is what the page recommends
        when the whole grid has to be searchable by the browser.`}
    />
  );
}

export const ColumnMenu = () => (
  <Compare
    note="Both grids draw a button in every column header; click one in each. The menu that opens is the same widget as the context menu, so the shared items should match what the previous story showed. The difference to look for is underneath: `filters: true` is set here, and Handsontable answers by putting the whole filtering interface into the column menu — a condition select, a value list with checkboxes, and an OK/Cancel bar, which are the documented `filter_by_condition`, `filter_by_value` and `filter_action_bar` items. cellmoa's filter plugin is 220 lines of API with no DOM at all: none of those five keys exists in its source, so its column menu opens without them. Check the button itself too. cellmoa renders a bare `▾` with no accessible name, and Shift+Alt+Down from a cell and Ctrl+Enter from a focused header — the two shortcuts this page documents — are unbound."
    settings={{
      colHeaders: ["Region", "Owner", "Stage", "Value"],
      rowHeaders: true,
      dropdownMenu: true,
      filters: true,
    }}
    data={[
      ["North", "Ada", "Won", "1200"],
      ["South", "Grace", "Open", "800"],
      ["North", "Ada", "Open", "450"],
      ["East", "Alan", "Lost", "90"],
      ["South", "Grace", "Won", "2300"],
    ]}
    height={300}
  />
);

export function ColumnFilter() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        colHeaders: ["Model", "Price", "Sell date", "In stock"],
        rowHeaders: true,
        filters: true,
        dropdownMenu: true,
      }}
      data={[
        ["Trail Helmet", "1298.14", "2025-08-31", "true"],
        ["Windbreaker Jacket", "178.90", "2025-05-10", "false"],
        ["Cycling Cap", "288.10", "2025-09-15", "true"],
        ["HL Mountain Frame", "94.49", "2025-01-17", "false"],
        ["Racing Socks", "430.38", "2025-05-10", "true"],
        ["Aero Bottle", "1571.13", "2025-05-24", "true"],
      ]}
      note={`Open the arrow on a header on the right and a filter menu appears: a condition
        list, a value list with checkboxes, an operator choice and an action bar. Open the
        same header on the left and nothing opens — that is the finding, and it is worth
        looking at rather than reading, which is why both grids are here. The filters plugin
        is API only: filter(), addCondition() and clearConditions() all work and change what
        the grid shows, but none of them has a menu attached, so the five documented menu
        keys have nothing to be keys of. Everything else about the two panels should match.`}
    />
  );
}

// --- more of what each page documents ---------------------------------------
//
// One story per page shows a page exists; it cannot show what the page says.
// The Column headers page alone documents four spellings of `colHeaders`, a
// header height, a per-column class and nested headers. These are the rest.

export const ColumnHeadersFromAFunction = () => (
  <Compare
    note={`\`colHeaders\` as a function is called with the visual index and returns the
      label, so a header can be computed rather than listed. Both should show A1..E1
      spelled out in words. Watch what happens past the end of a short array elsewhere
      on this page: the function form has no end, so there is nothing to fall back to.`}
    settings={{
      colHeaders: (index: number) => `col ${index + 1}`,
      rowHeaders: true,
    }}
    data={block(4, 5)}
  />
);

export const ColumnHeadersShorterThanTheTable = () => (
  <Compare
    note={`Three labels for five columns. The reference falls back to the spreadsheet
      letter for the columns the array does not reach, so the headers should read
      Alpha, Beta, Gamma, D, E on both sides. A grid that instead showed blanks — or
      that ran off the end of the array — would be reporting a column that has no name
      rather than one whose name it was not given.`}
    settings={{ colHeaders: ["Alpha", "Beta", "Gamma"], rowHeaders: true }}
    data={block(3, 5)}
  />
);

export const ColumnHeadersHeightAndClass = () => (
  <Compare
    note={`\`columnHeaderHeight\` sets the header row's height and \`headerClassName\`
      puts a class on every header cell — here \`htRight\`, so the labels should sit
      against the right edge of their cells in both panels. The height is the easier of
      the two to get wrong invisibly: a grid that accepts the number and does not apply
      it looks identical until you measure, which is why the value here is large enough
      to see.`}
    settings={{
      colHeaders: ["One", "Two", "Three"],
      rowHeaders: true,
      columnHeaderHeight: 56,
      headerClassName: "htRight",
    }}
    data={block(3, 3)}
  />
);

export const ColumnHeadersNested = () => (
  <Compare
    height={240}
    note={`Two header rows, the upper one spanning groups. Count the rows first — a
      nested header array of N levels should draw exactly N rows, and an off-by-one here
      draws an empty band that looks like padding. Then check the spans: \`{ label,
      colspan }\` should cover the columns beneath it, and the leaf row underneath
      should stay aligned with the data.`}
    settings={{
      rowHeaders: true,
      nestedHeaders: [
        [
          { label: "Identity", colspan: 2 },
          { label: "Amounts", colspan: 3 },
        ],
        ["Code", "Name", "Q1", "Q2", "Q3"],
      ],
    }}
    data={block(4, 5)}
  />
);

export const ColumnHidingWithIndicators = () => (
  <Compare
    note={`\`indicators: true\` marks the headers either side of a hidden column, because
      hiding leaves no gap and without a mark there is nothing on screen to say a column
      is missing. Column C is hidden here, so B and D should carry the indicator on both
      sides. The data is unchanged underneath: ask either grid for row 0 and it still has
      five values.`}
    settings={{
      colHeaders: ["A", "B", "C", "D", "E"],
      rowHeaders: true,
      hiddenColumns: { columns: [2], indicators: true },
    }}
    data={block(4, 5)}
  />
);

export const ColumnWidthsPerColumn = () => (
  <Compare
    note={`\`colWidths\` as an array gives each column its own width, and a single number
      gives them all the same one. Here the first column is wide and the rest are narrow.
      What to look for is the last column: the array is shorter than the table, and both
      grids should fall back to the default rather than collapsing it.`}
    settings={{ colHeaders: true, rowHeaders: true, colWidths: [220, 60, 60] }}
    data={block(3, 5)}
  />
);

export const ColumnWidthsFromAFunction = () => (
  <Compare
    note={`\`colWidths\` as a function is asked for each column's width by index. This one
      alternates, so the table should read wide, narrow, wide, narrow. A grid that called
      the function once and reused the answer would draw five equal columns — which looks
      deliberate, and is the reason this story alternates rather than growing.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      colWidths: (index: number) => (index % 2 === 0 ? 180 : 70),
    }}
    data={block(3, 5)}
  />
);

export const ColumnWidthsStretched = () => (
  <Compare
    height={200}
    note={`\`stretchH: 'all'\` spreads the spare horizontal space across every column so
      the table fills its container; \`'last'\` gives it all to the final column. With
      three narrow columns in a wide panel the difference is unmistakable — and a grid
      that ignores the setting leaves a gap on the right, which is the failure this is
      here to make visible.`}
    settings={{
      colHeaders: ["One", "Two", "Three"],
      rowHeaders: true,
      width: "100%",
      height: 200,
      stretchH: "all",
    }}
    data={block(4, 3)}
  />
);

export const ColumnFreezingFixedStart = () => (
  <Compare
    height={240}
    note={`\`fixedColumnsStart: 2\` freezes the first two columns. Scroll each panel
      sideways: the frozen pair should stay put while the rest slide underneath, and the
      boundary should be a clean edge rather than a seam that drifts. This is the setting
      \`manualColumnFreeze\` moves a column into, so a grid that draws this correctly and
      the manual version wrongly has a gesture problem rather than a layout one.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      width: 420,
      height: 240,
      colWidths: 110,
      fixedColumnsStart: 2,
    }}
    data={block(8, 10, coord)}
  />
);

export const ColumnVirtualizationRenderAll = () => (
  <Compare
    height={240}
    note={`\`renderAllColumns: true\` turns column virtualization off, so every column is
      in the DOM whether or not it is on screen. Open the element inspector and count
      \`td\` elements in a row: with forty columns there should be forty, against the
      screenful the default draws. This is the setting to reach for when something
      outside the grid measures the table, and the cost is exactly what the count shows.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      width: 420,
      height: 240,
      colWidths: 90,
      renderAllColumns: true,
    }}
    data={block(6, 40, coord)}
  />
);

export const ColumnSummaryAcrossFunctions = () => (
  <Compare
    height={260}
    note={`The five summary functions the page lists, one per column: sum, min, max,
      count and average. Row 5 is the destination row. The two libraries get there
      differently — the reference computes the number and writes it, while this one
      writes \`=SUM(A1:A4)\` and lets the engine evaluate it — so edit a number above and
      watch both totals move. \`roundFloat\` on the average should give two decimals on
      both sides.`}
    settings={{
      height: 260,
      colHeaders: ["sum", "min", "max", "count", "average"],
      rowHeaders: true,
      columnSummary: [0, 1, 2, 3, 4].map((source) => ({
        sourceColumn: source,
        destinationColumn: source,
        destinationRow: 4,
        type: (["sum", "min", "max", "count", "average"] as const)[source],
        roundFloat: 2,
        ranges: [[0, 3]],
      })),
    }}
    data={[
      ["1", "2", "3", "4", "5"],
      ["6", "7", "8", "9", "12.345"],
      ["11", "12", "13", "", "15"],
      ["2", "3", "4", "5", "6"],
      ["", "", "", "", ""],
    ]}
  />
);
