/**
 * Formulas, virtual scrolling, and the data the grid is a view of.
 *
 * cellmoa calculates natively in a Rust engine; the reference calls out to
 * HyperFormula. That is a documented divergence, so what these compare is the
 * answer, not the mechanism — and the answers are Excel's either way.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Formulas and data' };

export const Formulas = () => (
  <Compare
    note="The same formulas in both. cellmoa needs no plugin — every grid has an engine. Where the two differ, one of them disagrees with Excel."
    settings={{
      colHeaders: ['a', 'b', 'sum', 'text'],
      rowHeaders: true,
      formulas: { engine: undefined } as never,
    }}
    data={[
      ['2', '3', '=A1+B1', '=CONCAT("row ", 1)'],
      ['10', '4', '=A2*B2', '=UPPER("shout")'],
      ['7', '0', '=IF(B3=0,"n/a",A3/B3)', '=TEXT(0.256,"0.0%")'],
      ['', '', '=SUM(A1:A3)', '=COUNTA(A1:B3)'],
    ]}
  />
);

export const FormulaErrors = () => (
  <Compare
    note="The error literals, each raised the way Excel raises it. An error that formats differently, or a cell that shows a number where Excel shows `#DIV/0!`, is the finding."
    settings={{ colHeaders: ['formula', 'result'], rowHeaders: true }}
    data={[
      ['1/0', '=1/0'],
      ['bad name', '=NOSUCHFUNCTION()'],
      ['bad type', '=SQRT(-1)'],
      ['bad ref', '=SUM(#REF!)'],
    ]}
  />
);

export const LargeGrid = () => (
  <Compare
    note="Ten thousand rows. Scroll both hard: virtual scrolling is a claim about what is in the DOM, and a seam or a blank band while scrolling is what a broken one looks like."
    settings={{ colHeaders: true, rowHeaders: true, width: 520, height: 360 }}
    data={block(10000, 12, (row, col) => `${String.fromCharCode(65 + col)}${row + 1}`)}
    height={380}
  />
);

export const SortedSourceOrder = () => (
  <Compare
    note="Sort by clicking a header, then read the grid back. `getData()` follows the view; `getSourceData()` must follow the dataset, physical indexes and trimmed rows included — cellmoa returned the sorted view, so saving through the documented path lost rows."
    settings={{ colHeaders: ['name', 'qty'], rowHeaders: true, columnSorting: true }}
    data={[
      ['pear', '3'],
      ['apple', '12'],
      ['fig', '7'],
    ]}
  />
);

export const CopyAndPaste = () => (
  <Compare
    note="Copy a block from one grid and paste it into the other. Values, formulas and the tab-separated shape all have to survive the round trip; a formula should shift by the distance it moved."
    settings={{ colHeaders: true, rowHeaders: true, copyPaste: true }}
    data={[
      ['1', '2', '=A1+B1'],
      ['3', '4', '=A2+B2'],
      ['', '', ''],
      ['', '', ''],
    ]}
  />
);
