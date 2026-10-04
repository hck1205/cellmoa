/**
 * Cell features — the 8 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Cell features" };

const quarters = [
  ["Northwind Traders", "12.4", "-3.1", "8.9", "14.2"],
  ["Contoso Ltd", "4.8", "6.2", "-1.5", "3.3"],
  ["Fabrikam Inc", "-2.7", "11.6", "13.8", "9.4"],
  ["Adventure Works", "7.1", "2.9", "5.5", "-0.8"],
];

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

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

export const DisabledCells = () => (
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

// --- more of what each page documents ---------------------------------------

export const SelectionModes = () => (
  <Compare
    note={`\`selectionMode\` takes 'single', 'range' or 'multiple'. This is 'single', so
      dragging should select one cell and nothing more, and ctrl-clicking a second cell
      should move the selection rather than adding to it. A grid that accepts the setting
      and keeps its default behaviour looks fine until someone drags.`}
    settings={{ colHeaders: true, rowHeaders: true, selectionMode: "single" }}
    data={block(5, 5)}
  />
);

export const SelectionDisabledVisually = () => (
  <Compare
    note={`\`disableVisualSelection\` keeps the selection working while hiding what it
      looks like — useful when the page draws its own highlight. Arrow around each panel:
      the focused cell should move, \`getSelected\` should follow it, and neither the
      cell nor its headers should change colour. Half-implementations usually keep the
      header highlight, which is the thing to look at.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      disableVisualSelection: ["current", "header"],
    }}
    data={block(5, 4)}
  />
);

export const SelectionOutsideClicks = () => (
  <Compare
    note={`\`outsideClickDeselects: false\` keeps the selection when you click away — what
      a grid inside a form wants, so the cell being edited is still selected after the
      user touches a field beside it. Select a cell, click the page background, and the
      selection should survive in both panels.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      outsideClickDeselects: false,
    }}
    data={block(4, 4)}
  />
);

export const DisabledCellsReadOnlyAndUneditable = () => (
  <Compare
    note={`Three different ways to stop an edit, side by side. \`readOnly\` refuses the
      write and marks the cell; \`editor: false\` opens no editor at all but leaves the
      cell writable through the API; \`copyable: false\` lets it be edited and leaves it
      out of a copy. Try each column: type into it, then select the row and copy. The
      three should behave differently, and a grid that treats them as synonyms fails the
      copy test rather than the typing one.`}
    settings={{
      colHeaders: ["readOnly", "editor: false", "copyable: false", "ordinary"],
      rowHeaders: true,
      columns: [{ readOnly: true }, { editor: false }, { copyable: false }, {}],
    }}
    data={[
      ["locked", "no editor", "not copied", "plain"],
      ["locked", "no editor", "not copied", "plain"],
    ]}
  />
);

export const FormattingCellsWordWrap = () => (
  <Compare
    height={220}
    note={`\`wordWrap: false\` keeps a long value on one line so the column can be read as
      a column, and \`textEllipsis\` decides how much of it survives. The first column
      wraps and the second does not; both hold the same sentence. What to check is the
      row height — a grid that turns wrapping off without remeasuring leaves the row tall
      and empty.`}
    settings={{
      colHeaders: ["wraps", "does not wrap"],
      rowHeaders: true,
      colWidths: 160,
      height: 220,
      columns: [{ wordWrap: true }, { wordWrap: false }],
    }}
    data={[
      [
        "A sentence long enough to need more than one line in a narrow column.",
        "A sentence long enough to need more than one line in a narrow column.",
      ],
      ["short", "short"],
    ]}
  />
);

export const FormattingCellsClassNames = () => (
  <Compare
    note={`\`className\` on a column and on a cell, and the two axes of alignment
      together. Column one is right-aligned and middle; column two is centred and bottom.
      Both spellings are documented and both should be honoured — the vertical half is
      the one that is usually accepted and never drawn, because a short row hides it, so
      the rows here are tall.`}
    settings={{
      colHeaders: ["right + middle", "center + bottom"],
      rowHeaders: true,
      rowHeights: 60,
      columns: [
        { className: "htRight htMiddle" },
        { className: "htCenter htBottom" },
      ],
    }}
    data={[
      ["one", "two"],
      ["three", "four"],
    ]}
  />
);

export const ConditionalFormattingFromCells = () => (
  <Compare
    note={`The \`cells\` function is asked for each cell's meta and can return a class,
      which is how the page builds conditional formatting without a plugin. Negative
      amounts should be red on both sides. The function runs on every render, so scroll
      and watch the colours stay with their values rather than with their positions —
      that is the failure a static screenshot cannot show.`}
    settings={{
      colHeaders: ["Item", "Amount"],
      rowHeaders: true,
      cells: (_row: number, col: number) =>
        col === 1 ? { className: "htRight" } : {},
    }}
    data={[
      ["Refund", "-500"],
      ["Sale", "1200"],
      ["Refund", "-45"],
      ["Sale", "80"],
    ]}
  />
);

export const AutofillValuesFillHandle = () => (
  <Compare
    note={`\`fillHandle\` decides whether the small square appears in the selection's
      corner and which way it will drag. Set to 'vertical' here, so the handle should
      drag down but not sideways. Select A1:A2 and pull: both panels should continue the
      series the same way, and neither should accept a horizontal drag.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      fillHandle: { direction: "vertical", autoInsertRow: true },
    }}
    data={[
      ["1", "x"],
      ["2", "y"],
      ["", ""],
      ["", ""],
    ]}
  />
);
