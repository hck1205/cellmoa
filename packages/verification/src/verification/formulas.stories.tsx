/**
 * Formulas — the 2 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare } from "../Compare.js";
import type Handsontable from "handsontable";

export default { title: "Verification/Formulas" };

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const Installation = () => (
  <Compare
    note={`Since version 18 the reference no longer bundles an engine: you install
      hyperformula separately, match its version, and hand it the
      'internal-use-in-handsontable' key, and until you do the Formulas plugin does
      nothing. cellmoa has no such step — the engine is its own Rust compiled to
      WebAssembly and ships in the package — but there is one thing to install here that
      the reference does not have, which is that .wasm file itself, fetched at startup.

      Both panels compute the same sheet, which is the point: whatever the installation
      story, the answers should agree. B4 sums the column above it and C4 multiplies. If
      the right panel shows the formula text instead of a number, its engine is not wired
      up, which is exactly the failure the page exists to prevent.`}
    settings={{
      colHeaders: ["Item", "Amount", "With tax"],
      rowHeaders: true,
      formulas: true,
    }}
    data={[
      ["Rent", "1200", "=B1*1.2"],
      ["Cloud", "640", "=B2*1.2"],
      ["Travel", "180", "=B3*1.2"],
      ["Total", "=SUM(B1:B3)", "=SUM(C1:C3)"],
    ]}
  />
);

export const FormulaCalculation = () => (
  <Compare
    note="Column A holds a formula, column B the answer it should give, and column C what that answer is testing. Read down the left panel and check each row against column B: these are the places a home-grown engine usually drifts — rounding half away from zero rather than to even, an untaken IF branch that must not be evaluated even though it divides by zero, a division by zero that must be the error value `#DIV/0!` rather than blank or Infinity, `1/3` printed to the fifteen significant digits a spreadsheet prints, a boolean stringifying in upper case, and a self-reference that must settle as `#CYCLE!` rather than hang. Excel is the arbiter for all but the last: Excel answers a circular reference with zero and a warning dialog, which is not something a grid can do, so both this engine and HyperFormula give the error value instead. The last three rows are the recorded divergence rather than a disagreement about arithmetic: `SEQUENCE`, `SORT` and `FILTER` return arrays, cellmoa has no spilling, and an array collapsed to a single cell is `#VALUE!` — listed as a gap in `docs/gap-audit.md`. The right-hand panel cannot answer any of this. Handsontable 18 unbundled HyperFormula, this workspace does not install it, and the Formulas plugin warns about the missing `engine` key and stays off — so the reference shows the formulas as the text they are. Column B is the arbiter here, not the panel beside it."
    settings={{
      colHeaders: ["formula", "should say", "what it is testing"],
      rowHeaders: true,
      colWidths: [200, 140, 250],
      formulas: true,
    }}
    data={[
      ["=ROUND(2.5, 0)", "3", "half away from zero, not to even"],
      ["=ROUND(-2.5, 0)", "-3", "and away from zero downwards too"],
      ['=IF(TRUE, "yes", 1/0)', "yes", "the untaken branch is not evaluated"],
      ["=1/0", "#DIV/0!", "the error value, not blank and not Infinity"],
      [
        "=1/3",
        "0.333333333333333",
        "fifteen significant digits, as a sheet prints",
      ],
      [
        '=CONCATENATE("a", 1, TRUE)',
        "a1TRUE",
        "a boolean stringifies in upper case",
      ],
      ['=LEN(TRIM("  a  b  "))', "3", "TRIM collapses inner runs to one space"],
      ["=A8", "#CYCLE!", "a cycle settles as an error, it does not hang"],
      [
        "=SEQUENCE(3)",
        "#VALUE!",
        "recorded gap: no spilling, so an array cannot land",
      ],
      ["=SORT({3;1;2})", "#VALUE!", "recorded gap: same reason"],
      ["=FILTER({1;2;3}, {1;0;1})", "#VALUE!", "recorded gap: same reason"],
    ]}
    height={320}
  />
);
