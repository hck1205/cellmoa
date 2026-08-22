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
    note="Column A holds a formula, column B the answer it should give, and column C what that answer is testing. Read down the left panel and check each row against column B: these are the places a home-grown engine usually drifts — rounding half away from zero rather than to even, an untaken IF branch that must not be evaluated even though it divides by zero, a division by zero that must be the error value `#DIV/0!` rather than blank or Infinity, `1/3` printed to the fifteen significant digits a spreadsheet prints, a boolean stringifying in upper case, and a self-reference that must settle as `#CYCLE!` rather than hang. Excel is the arbiter for all but the last: Excel answers a circular reference with zero and a warning dialog, which is not something a grid can do, so both this engine and HyperFormula give the error value instead. The last three rows are the recorded divergence rather than a disagreement about arithmetic: `SEQUENCE`, `SORT` and `FILTER` return arrays, cellmoa has no spilling, and an array collapsed to a single cell is `#VALUE!` — listed as a gap in `docs/gap-audit.md`. The right-hand panel cannot answer any of this. Handsontable 18 unbundled HyperFormula, this workspace does not install it, and the Formulas plugin warns about the missing `engine` key and stays off — so the reference shows the formulas as the text they are. Column B is the arbiter here, not the panel beside it."
    settings={{
      colHeaders: ['formula', 'should say', 'what it is testing'],
      rowHeaders: true,
      colWidths: [200, 140, 250],
      formulas: true,
    }}
    data={[
      ['=ROUND(2.5, 0)', '3', 'half away from zero, not to even'],
      ['=ROUND(-2.5, 0)', '-3', 'and away from zero downwards too'],
      ['=IF(TRUE, "yes", 1/0)', 'yes', 'the untaken branch is not evaluated'],
      ['=1/0', '#DIV/0!', 'the error value, not blank and not Infinity'],
      ['=1/3', '0.333333333333333', 'fifteen significant digits, as a sheet prints'],
      ['=CONCATENATE("a", 1, TRUE)', 'a1TRUE', 'a boolean stringifies in upper case'],
      ['=LEN(TRIM("  a  b  "))', '3', 'TRIM collapses inner runs to one space'],
      ['=A8', '#CYCLE!', 'a cycle settles as an error, it does not hang'],
      ['=SEQUENCE(3)', '#VALUE!', 'recorded gap: no spilling, so an array cannot land'],
      ['=SORT({3;1;2})', '#VALUE!', 'recorded gap: same reason'],
      ['=FILTER({1;2;3}, {1;0;1})', '#VALUE!', 'recorded gap: same reason'],
    ]}
    height={320}
  />
);
