/**
 * Two pages, and the largest architectural difference between the libraries.
 *
 * Handsontable does not calculate. It hands cells to HyperFormula, a separate
 * package you install and license yourself, and draws what comes back.
 * cellmoa's engine is not a plugin and cannot be switched off: the workbook is
 * the engine, formulas are first class, and `formulas: false` says so on the
 * console rather than pretending to disable anything. That divergence is
 * already argued in `docs/handsontable-parity.md`, so the thing to check here
 * is not the architecture but the arithmetic — both are claiming to be Excel,
 * and only one of them can be wrong about `=ROUND(2.5, 0)`.
 */

import { Compare, NotAFeature } from '../Compare.js';

export default { title: 'Verification/Formulas' };

export const Installation = () => (
  <NotAFeature
    page="Installation"
    path="formulas-installation"
    why="`npm install hyperformula`, matching its version to Handsontable's, and passing the `'internal-use-in-handsontable'` license key. Since Handsontable 18 the engine is no longer bundled and the Formulas plugin does nothing until you supply it. cellmoa has no equivalent step and no equivalent choice: the calculation engine is compiled into the WebAssembly module the grid loads before it can be constructed, so there is no second package, no version to match, and no key. Worth knowing rather than comparing — it is also why the reference panel in the next story shows formula text instead of answers, since this workspace has no HyperFormula installed."
  />
);

export const FormulaCalculation = () => (
  <Compare
    note="Column A holds a formula, column B the answer Excel gives, and column C says what to compare. Read down the left panel and check each result against column B: these are the cases where a home-grown engine usually drifts — banker's rounding, an empty cell in a SUM, text in an AVERAGE, a division by zero that must be `#DIV/0!` rather than blank or Infinity, a circular reference that must be `#REF!` rather than a hang, and `1/3` printed to the precision a spreadsheet prints it at. The last three rows are the recorded divergence: `SEQUENCE`, `SORT` and `FILTER` return arrays, and cellmoa has no spilling, so every array-returning function yields `#VALUE!` rather than filling the cells below and to the right. That is a gap, not a rounding disagreement, and it is listed as one in `docs/gap-audit.md`. The right-hand panel cannot answer any of this: Handsontable 18 unbundled HyperFormula and this workspace does not install it, so the reference shows the formulas as the text they are. Column B is the arbiter here, not the panel beside it."
    settings={{
      colHeaders: ['formula', 'Excel says', 'what to check'],
      rowHeaders: true,
      colWidths: [190, 130, 260],
      formulas: true,
    }}
    data={[
      ['=ROUND(2.5, 0)', '3', 'half away from zero, not banker’s rounding'],
      ['=SUM(1, "", 2)', '3', 'an empty argument counts as nothing, not as an error'],
      ['=AVERAGE(1, "x", 3)', '2', 'text is skipped by AVERAGE, not coerced to zero'],
      ['=1/0', '#DIV/0!', 'the error value itself, not blank and not Infinity'],
      ['=A5', '#REF!', 'a self-reference is a cycle error, not a hang'],
      ['=1/3', '0.333333333333333', 'fifteen significant digits, as a spreadsheet prints'],
      ['=IF(TRUE, "yes", 1/0)', 'yes', 'the untaken branch is not evaluated'],
      ['=CONCATENATE("a", 1, TRUE)', 'a1TRUE', 'a boolean stringifies in upper case'],
      ['=SEQUENCE(3)', '1 spilled down 3 rows', 'cellmoa: #VALUE! — no spilling'],
      ['=SORT({3;1;2})', '1 spilled down 3 rows', 'cellmoa: #VALUE! — no spilling'],
      ['=FILTER({1;2;3}, {1;0;1})', '1 spilled down 2 rows', 'cellmoa: #VALUE! — no spilling'],
    ]}
    height={320}
  />
);
