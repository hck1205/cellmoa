/**
 * Rows and columns: hiding, freezing, sizing, sorting, grouping.
 *
 * Almost every claim here is about what is on screen and where, which is
 * exactly what a jsdom suite cannot see. Hiding is the sharpest example: it was
 * tracked in the index map, honoured by the export and the formulas, and never
 * reached the renderer at all — a hidden row stayed fully visible while every
 * test passed.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Rows and columns' };

export const HiddenRowsAndColumns = () => (
  <Compare
    note="Row 2 and column C are hidden. Both grids should skip them entirely and close the gap; `indicators` marks the headers on either side of the gap."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      hiddenRows: { rows: [1], indicators: true },
      hiddenColumns: { columns: [2], indicators: true },
    }}
    data={block(5, 5)}
  />
);

export const FrozenRowsAndColumns = () => (
  <Compare
    note="Two rows frozen at the top and one column at the start. Scroll each: the frozen bands must stay put and stay aligned with the body."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      fixedRowsTop: 2,
      fixedColumnsStart: 1,
      width: 420,
      height: 240,
    }}
    data={block(40, 12)}
    height={260}
  />
);

export const ColumnWidthsAndRowHeights = () => (
  <Compare
    note="Explicit sizes per index. Drag a border between two column headers — cellmoa has no pointer handler for that at all, so only the reference resizes."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      colWidths: [60, 160, 100],
      rowHeights: [22, 44, 22],
      manualColumnResize: true,
      manualRowResize: true,
    }}
    data={block(4, 3)}
  />
);

export const StretchColumns = () => (
  <Compare
    note="`stretchH: 'all'` shares the spare width. A column given an explicit width should be left out of the stretch, which is where the two are most likely to differ."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      stretchH: 'all',
      colWidths: [80, undefined, undefined] as unknown as number[],
      width: 600,
    }}
    data={block(3, 3)}
  />
);

export const Sorting = () => (
  <Compare
    note="Click a column header. cellmoa could not do this in a browser until recently: a header carries `data-col` and no `data-row`, so the coordinate lookup returned nothing and the click reached no handler. The indicator is drawn by the header renderer."
    settings={{ colHeaders: ['name', 'qty'], rowHeaders: true, columnSorting: true }}
    data={[
      ['pear', '3'],
      ['apple', '12'],
      ['fig', '7'],
      ['date', '1'],
    ]}
  />
);

export const NestedHeaders = () => (
  <Compare
    note="Two header rows, the upper one spanning. The settings are the whole header — the reference draws exactly the rows given and appends nothing, which cellmoa used to get wrong by adding a row of column letters underneath."
    settings={{
      rowHeaders: true,
      colHeaders: true,
      nestedHeaders: [
        [{ label: 'measures', colspan: 2 }, { label: 'meta', colspan: 2 }],
        ['qty', 'price', 'sku', 'bin'],
      ],
    }}
    data={block(4, 4)}
  />
);

export const CollapsibleColumns = () => (
  <Compare
    note="Click the toggle in the group header. The array form counts levels upward from the first table row, so `row` is negative — a configuration that matched nothing in cellmoa until the sign was honoured."
    settings={{
      rowHeaders: true,
      colHeaders: true,
      nestedHeaders: [
        [{ label: 'group', colspan: 3 }, 'alone'],
        ['a', 'b', 'c', 'd'],
      ],
      collapsibleColumns: [{ row: -2, col: 0, collapsible: true }],
    }}
    data={block(4, 4)}
  />
);

export const SpareRows = () => (
  <Compare
    note="`minSpareRows` keeps an empty row below the data so there is always somewhere to type. Type in the last row of each: another should appear."
    settings={{ colHeaders: true, rowHeaders: true, minSpareRows: 1, minSpareCols: 1 }}
    data={block(3, 3)}
  />
);
