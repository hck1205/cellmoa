/**
 * Cell features: the things done to cells rather than the things cells are.
 *
 * Most of this section is settings that both libraries read, so the stories
 * are mostly about gestures — drag the fill handle, copy a range, right-click,
 * hover a marked corner. Two of them are not: this grid applies the reference's
 * documented class names to the element and ships no stylesheet rule for
 * several of them, so `htCenter` centres nothing here and `htInvalid` marks
 * nothing. That is a real gap and the notes say where to look for it rather
 * than pretending the panels agree.
 */

import { Compare } from "../Compare.js";

const quarters = [
  ["Northwind Traders", "12.4", "-3.1", "8.9", "14.2"],
  ["Contoso Ltd", "4.8", "6.2", "-1.5", "3.3"],
  ["Fabrikam Inc", "-2.7", "11.6", "13.8", "9.4"],
  ["Adventure Works", "7.1", "2.9", "5.5", "-0.8"],
];

export default { title: "Verification/Cell features" };

/**
 * The fill handle, and the rules about where it may go.
 */
export const AutofillValues = () => (
  <Compare
    settings={{
      colHeaders: ["Year", "Sales", "Region"],
      rowHeaders: true,
      fillHandle: { direction: "vertical", autoInsertRow: true },
    }}
    data={[
      ["2018", "10", "North"],
      ["2019", "20", "South"],
      ["2020", "", "East"],
      ["2021", "", "West"],
    ]}
    note="Click cell B2, find the small square at the bottom-right corner of the selection, and drag it down. Both grids must draw that handle, both must let it move only downward because direction is 'vertical', and dragging past the last row must add rows because autoInsertRow is on — a handle that fills sideways has ignored the direction, and one that stops at the last row has ignored the insert. Then double-click the handle instead of dragging it. The reference fills down to the last row where the neighbouring column still has data, which here is row four; this grid has no double-click on the handle at all, so nothing happens. That is a gap rather than a divergence, and it is easy to miss because the drag works."
  />
);

/**
 * Copy, cut and paste, and the cells that stay out of it.
 */
export const Clipboard = () => (
  <Compare
    settings={{
      colHeaders: ["Product", "Price", "Stock", "Internal note"],
      rowHeaders: true,
      contextMenu: true,
      copyPaste: { copyColumnHeaders: true },
      columns: [
        {},
        { type: "numeric" },
        { type: "numeric" },
        { copyable: false },
      ],
    }}
    data={[
      ["Laptop Pro 15", "1499", "42", "reorder from Hamburg"],
      ["Wireless mouse", "29.99", "218", "discontinued Q3"],
      ["USB-C hub", "54.5", "0", "supplier dispute"],
    ]}
    note="Select the first three columns of all three rows and press Ctrl+C, then paste into a plain text editor and into a spreadsheet: both grids write text/plain as tab-separated rows and text/html as a table, so the text editor should show tabs and the spreadsheet should show cells. Now include the last column in the selection and copy again — it is copyable: false, so it must come out empty in both while still being visible and selectable on screen. Right-click for the third claim: with copyColumnHeaders on, the menu gains the copy-with-headers items, and the pasted block should carry Product, Price and Stock as its first row. A menu without those items is a copyPaste option that was not read."
    height={240}
  />
);

/**
 * A note attached to a cell rather than a value written into it.
 */
export const Comments = () => (
  <Compare
    settings={{
      colHeaders: ["Task", "Owner", "Status"],
      rowHeaders: true,
      comments: true,
      contextMenu: true,
      cell: [
        {
          row: 0,
          col: 2,
          comment: {
            value: "Blocked on the API review — chase Ana on Monday.",
          },
        },
        {
          row: 1,
          col: 1,
          comment: { value: "James is on leave until the 14th." },
        },
      ],
    }}
    data={[
      ["Update API docs", "Ana Garcia", "In progress"],
      ["Deploy hotfix", "James Okafor", "Blocked"],
      ["Rotate signing keys", "Priya Raman", "Not started"],
    ]}
    note="Two cells arrive with comments on them and both grids must mark them the same way: a corner triangle drawn by the commentedCellClassName class, which defaults to htCommentCell in each. Now hover one of the marked cells. The reference opens a floating, editable box; this grid has no hover listener and instead puts the comment text in the cell's title attribute, so after a pause you get the browser's own tooltip and no box. Right-click a marked cell and an unmarked one: both menus must offer Add/Edit comment and offer Delete comment only where there is one. A comment is metadata in both — check that adding one leaves the cell's value and any formula reading it untouched."
  />
);

/**
 * Styling driven by the value in the cell.
 */
export const ConditionalFormatting = () => (
  <Compare
    settings={{
      colHeaders: ["Company", "Q1", "Q2", "Q3", "Q4"],
      rowHeaders: true,
      columns: [
        { className: "htDimmed" },
        { type: "numeric" },
        { type: "numeric" },
        { type: "numeric" },
        { type: "numeric" },
      ],
      cells: (row, col) => {
        if (col === 0) {
          return {};
        }
        const value = Number(quarters[row]?.[col] ?? "");
        if (value < 0) {
          return { className: "htDimmed" };
        }
        return value > 10 ? { className: "htSearchResult" } : {};
      },
    }}
    data={quarters}
    note="The cells callback runs for every cell and gets to look at the row and column before deciding, which is what makes it the right place for formatting that follows the data. Here it dims the losing quarters and highlights the ones above ten, on top of a static className the Company column sets through its columns entry — two levels of the cascade at once, and the callback is documented as the last word, so it must win wherever they overlap. The two class names are ones both stylesheets already define, so the effect shows without a stylesheet of your own; with a name of your own you supply the rule, and both grids will still put the class on the <td>. Count the dimmed and highlighted cells panel against panel: eight cells should change, and a panel where the Company column is not dimmed has lost the columns layer to the callback rather than merging them. One difference that this data cannot show: the reference passes the callback physical row and column indexes and this grid passes visual ones, so the two diverge as soon as the grid is sorted or rows are moved."
    height={240}
  />
);

/**
 * Static styling, and borders drawn on the cell rather than round the table.
 */
export const FormattingCells = () => (
  <Compare
    settings={{
      colHeaders: ["SKU", "Product", "Category", "Price", "Stock"],
      rowHeaders: true,
      cell: [{ row: 0, col: 0, className: "htSearchResult" }],
      customBorders: [
        {
          range: { from: { row: 1, col: 1 }, to: { row: 3, col: 4 } },
          top: { width: 2, color: "#5292F7", style: "dotted" },
          bottom: { width: 2, color: "red" },
          start: { width: 2, color: "orange", style: "dashed" },
          end: { width: 2, color: "magenta" },
        },
      ],
    }}
    data={[
      ["SKU-4821", "Laptop Pro 15", "Electronics", "1499", "42"],
      ["SKU-0093", "Wireless mouse", "Peripherals", "29.99", "218"],
      ["SKU-7712", "USB-C hub", "Peripherals", "54.5", "0"],
      ["SKU-3305", "Mech. keyboard", "Peripherals", "89.99", "67"],
      ["SKU-9140", '4K monitor 27"', "Electronics", "349.99", "15"],
    ]}
    note="The top-left cell carries a className, which both grids put on the <td>; the name chosen here is one both stylesheets already define so the effect is visible without a stylesheet of your own, and any other name works the same way once you supply the rule. The borders are the finding. This is the reference's own configuration, in the reference's own spelling: start and end for the vertical edges, and a style of 'dotted' or 'dashed'. The reference draws all four edges of the block and honours the dash patterns. This grid reads only top and bottom and only draws solid, so the block gets a blue top and a red bottom with nothing down its sides and no dashes anywhere. A configuration written from the guide therefore loses half its borders here without any error."
    height={300}
  />
);

/**
 * One cell spanning several.
 */
export const MergeCells = () => (
  <Compare
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: true,
      mergeCells: [
        { row: 1, col: 1, rowspan: 2, colspan: 2 },
        { row: 3, col: 3, rowspan: 2, colspan: 2 },
      ],
    }}
    data={[
      ["A1", "B1", "C1", "D1", "E1"],
      ["A2", "B2", "C2", "D2", "E2"],
      ["A3", "B3", "C3", "D3", "E3"],
      ["A4", "B4", "C4", "D4", "E4"],
      ["A5", "B5", "C5", "D5", "E5"],
    ]}
    note="Two blocks are merged before the first render, in visual coordinates. Both grids must draw one cell where four were, keep only the upper-left value — B2 and D4 — and clear the rest in the underlying data rather than just hiding it, which is what the reference means when it says it merges the way Excel does. Check that with a click: select the merged block and read what it holds, then unmerge it from the context menu and see whether C2, B3 and C3 come back empty in both. Arrow-key across the merged region too: a merged cell is one navigation stop, so moving right from A2 should land on the block and then on D2. A grid where the covered cells still hold their old values has hidden them rather than merged them."
    height={280}
  />
);

/**
 * Cells that can be read and not written.
 */
export const ReadOnlyCells = () => (
  <Compare
    settings={{
      colHeaders: ["Car", "Year", "Chassis colour", "Bumper colour"],
      rowHeaders: true,
      columns: [{}, { readOnly: true }, {}, { editor: false }],
      cells: (row, col) =>
        row === 1 && col !== 1 && col !== 3 ? { readOnly: true } : {},
    }}
    data={[
      ["Tesla", "2017", "black", "black"],
      ["Nissan", "2018", "blue", "blue"],
      ["Chrysler", "2019", "yellow", "black"],
      ["Volvo", "2020", "white", "gray"],
    ]}
    note="Three ways of locking a cell, and the distinction the page draws between two of them. The Year column and the whole of row two are readOnly, so they must carry the htDimmed class and look dimmed in both grids. The last column is editor: false instead, which refuses the editor and adds no class — so it must look exactly like an ordinary column while still not opening. That difference is the point: readOnly says 'this value is not yours to change' and shows it, editor: false only says 'not by typing'. Test the rest of the contract by hand: copying from a readOnly cell must work, pasting into one must not, and dragging the fill handle over one must leave it alone, while all three of those go through on the editor: false column."
  />
);

/**
 * What is selected, and how much of it may be.
 */
export const Selection = () => (
  <Compare
    settings={{
      colHeaders: true,
      rowHeaders: true,
      selectionMode: "multiple",
    }}
    data={[
      ["A1", "B1", "C1", "D1", "E1"],
      ["A2", "B2", "C2", "D2", "E2"],
      ["A3", "B3", "C3", "D3", "E3"],
      ["A4", "B4", "C4", "D4", "E4"],
      ["A5", "B5", "C5", "D5", "E5"],
    ]}
    afterMount={{
      cellmoa: (grid) => {
        grid.selectCells([
          [1, 1, 2, 2],
          [3, 3, 4, 4],
        ]);
      },
      handsontable: (hot) => {
        hot.selectCells([
          [1, 1, 2, 2],
          [3, 3, 4, 4],
        ]);
      },
    }}
    note="Two non-adjacent ranges are selected programmatically as each grid comes up, which selectionMode: 'multiple' is what permits. Both must show two blocks highlighted with one focused cell between them, and Ctrl-clicking a third block must add it rather than replace it; setting the mode to 'single' or 'range' must then take that away. Where the two part company is the class names. The reference marks a selected cell with 'area' and gives each additional layer a numbered class — area-1 for the second, area-2 for the third — so a stylesheet can colour the layers apart. This grid marks selection with cm-selected and the focused cell with cm-current, and has no per-layer class at all, so the layer-colouring the page demonstrates has nothing to hook on to here. Click a column header and a row header in each as well: both should select the whole column and the whole row."
  />
);

/**
 * Alignment, set as a class name.
 */
export const TextAlignment = () => (
  <Compare
    settings={{
      colHeaders: ["Left (default)", "htCenter", "htRight", "htJustify"],
      rowHeaders: true,
      contextMenu: ["alignment"],
      colWidths: [130, 130, 130, 170],
      columns: [
        {},
        { className: "htCenter" },
        { className: "htRight" },
        { className: "htJustify" },
      ],
      cells: (row) => (row === 2 ? { className: "htCenter htBottom" } : {}),
    }}
    data={[
      [
        "Northwind",
        "Northwind",
        "Northwind",
        "A longer line of text so that justify has something to spread",
      ],
      [
        "Contoso",
        "Contoso",
        "Contoso",
        "A longer line of text so that justify has something to spread",
      ],
      [
        "Fabrikam",
        "Fabrikam",
        "Fabrikam",
        "A longer line of text so that justify has something to spread",
      ],
    ]}
    note="Alignment in both libraries is a class name and nothing else — htLeft, htCenter, htRight and htJustify horizontally, htTop, htMiddle and htBottom vertically — set through className on a column, through the cells callback for a row, or through the context menu's Align submenu. Every one of those paths works here: inspect a cell and the class is on the <td>, and the alignment item in the context menu writes it. What this grid does not ship is the rules. Its stylesheet defines no htCenter, htRight, htJustify or htBottom, so all four columns stay left-aligned on screen while carrying the correct classes, and the reference's three columns visibly move. A stylesheet written against the reference's class names would fix it, which is worth knowing: the contract is kept and only the default styling is missing."
    height={260}
  />
);
