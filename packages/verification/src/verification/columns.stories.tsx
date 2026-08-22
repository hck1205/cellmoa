/**
 * Columns.
 *
 * Eleven guide pages about the horizontal axis. Three of them — hiding,
 * freezing and virtualization — are the column-shaped twins of the row pages
 * and are read the same way, by watching the header strip rather than the
 * cells. The rest are about things only columns have: a header that is more
 * than one row deep, a summary written under a column, a width that stretches,
 * and a filter panel hanging off the header.
 *
 * Two pages have nothing to draw beside the reference, for different reasons.
 * `Column filter` is the largest single gap in this library: the plugin is 220
 * lines of API with no DOM at all, so there is no panel to open. `Column
 * moving` is a drag, and the move plugins here have no pointer handlers. One
 * page, `Column component`, is not about a grid at all — it is the React
 * wrapper's prop reference, and this library ships one package with no wrapper.
 */

import { Compare, NotAFeature, OnlyReference, block } from '../Compare.js';

export default { title: 'Verification/Columns' };

const coord = (row: number, col: number) => `${row}, ${col}`;

const staff = [
  ['Ana García', 'Engineering', 'Senior Engineer', '2021-04-12'],
  ['James Okafor', 'Marketing', 'Product Manager', '2022-08-30'],
  ['Li Wei', 'Engineering', 'Staff Engineer', '2019-02-18'],
  ['Sofia Rossi', 'Sales', 'Account Executive', '2023-01-09'],
  ['Diego Fernández', 'Design', 'UX Designer', '2020-11-23'],
  ['Amara Singh', 'Engineering', 'Engineering Manager', '2018-06-05'],
];

export function AddingAndRemovingColumns() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        colHeaders: ['Name', 'Department', 'Title', 'Hire date'],
        rowHeaders: true,
        contextMenu: ['col_left', 'col_right', 'remove_col'],
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

export function ColumnFilter() {
  return (
    <OnlyReference
      height={320}
      settings={{
        height: 320,
        colHeaders: ['Model', 'Price', 'Sell date', 'In stock'],
        rowHeaders: true,
        filters: true,
        dropdownMenu: true,
      }}
      data={[
        ['Trail Helmet', '1298.14', '2025-08-31', 'true'],
        ['Windbreaker Jacket', '178.90', '2025-05-10', 'false'],
        ['Cycling Cap', '288.10', '2025-09-15', 'true'],
        ['HL Mountain Frame', '94.49', '2025-01-17', 'false'],
        ['Racing Socks', '430.38', '2025-05-10', 'true'],
        ['Aero Bottle', '1571.13', '2025-05-24', 'true'],
      ]}
      note={`Open the arrow on any header on the right: a condition list, a value list with
        checkboxes, an operator choice and an action bar. None of it exists here. The
        filters plugin is 220 lines and every one of them is API — filter(), addCondition(),
        clearConditions() — with no DOM, so the five documented menu keys
        (filter_by_condition, filter_by_value, filter_operators, filter_action_bar,
        filter_by_condition2) match nothing in the source, and the menu entry named
        ITEM.filter points at nothing. The labels for all of it are translated into 21
        languages and no code reads them. This is the largest gap in the library, not a
        divergence, and mounting an empty panel beside the reference is the honest picture.`}
    />
  );
}

export function ColumnFreezing() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: '100%',
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
          ['A', { label: 'B', colspan: 8 }, 'C'],
          ['D', { label: 'E', colspan: 4 }, { label: 'F', colspan: 4 }, 'G'],
          [
            'H',
            { label: 'I', colspan: 2 },
            { label: 'J', colspan: 2 },
            { label: 'K', colspan: 2 },
            { label: 'L', colspan: 2 },
            'M',
          ],
          ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],
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
          { title: 'ID' },
          { title: 'Full name' },
          { title: 'Position' },
          { title: 'Country' },
          { title: 'Start date' },
        ],
      }}
      data={[
        ['1', 'Ana García', 'Product Manager', 'Spain', '2022-03-14'],
        ['2', 'James Okafor', 'Senior Engineer', 'Nigeria', '2021-07-02'],
        ['3', 'Li Wei', 'Data Analyst', 'China', '2023-01-19'],
        ['4', 'Sofia Rossi', 'UX Designer', 'Italy', '2020-11-30'],
        ['5', 'Mateo Fernández', 'Engineering Lead', 'Argentina', '2019-05-08'],
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
    <OnlyReference
      height={320}
      settings={{
        height: 320,
        width: '100%',
        colWidths: 100,
        rowHeaders: true,
        colHeaders: true,
        manualColumnMove: true,
      }}
      data={block(40, 20, coord)}
      note={`Grab a column header on the right and drag it. There is nothing on our side to
        show: manualColumnMove is accepted, moveColumns() and dragColumns() work and the
        array form sets an initial order, but the plugin registers no pointer listeners at
        all, so there is no drag handle and no drop indicator. The page also documents what
        moving does to the data — nothing; the order lives in the index map and
        getSourceData() still returns the original sequence — and that part is true of both
        libraries. It is only the gesture that is missing here.`}
    />
  );
}

export function ColumnSummary() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        colHeaders: ['sum', 'min', 'max', 'count', 'average'],
        rowHeaders: true,
        columnSummary: [
          { sourceColumn: 0, type: 'sum', destinationRow: 3, ranges: [[0, 2]] },
          { sourceColumn: 1, type: 'min', destinationRow: 3, ranges: [[0, 2]] },
          { sourceColumn: 2, type: 'max', destinationRow: 3, ranges: [[0, 2]] },
          { sourceColumn: 3, type: 'count', destinationRow: 3, ranges: [[0, 2]] },
          {
            sourceColumn: 4,
            type: 'average',
            destinationRow: 3,
            roundFloat: 2,
            ranges: [[0, 2]],
          },
        ],
      }}
      data={[
        ['1', '2', '3', '4', '5'],
        ['6', '7', '8', '9', '12.345'],
        ['11', '12', '13', '', '15'],
        ['', '', '', '', ''],
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
        them.`}
    />
  );
}

export function ColumnVirtualization() {
  return (
    <Compare
      height={320}
      settings={{
        height: 320,
        width: '100%',
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

export function ColumnWidths() {
  return (
    <Compare
      height={260}
      settings={{
        height: 260,
        width: '100%',
        colHeaders: true,
        rowHeaders: true,
        colWidths: [50, 100, 200, 400],
        stretchH: 'last',
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

export function ColumnComponent() {
  return (
    <NotAFeature
      page="Column component"
      why={`This page documents the props of HotColumn, a React component in the
        @handsontable/react-wrapper package — how to declare per-column settings as JSX
        children of HotTable, and how to pass a React component as a renderer or an editor.
        It describes a wrapper, not a grid feature: everything it configures is the columns
        setting, which the Column headers story on this page already compares. This library
        ships one package, @cellmoa/grid, with no framework wrapper, so there is no
        component here whose props could be set beside those. The reference's own guide
        marks the page react-only.`}
      path="hot-column"
    />
  );
}
