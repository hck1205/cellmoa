/**
 * Data management — the 6 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, NotAFeature, block } from "../Compare.js";
import type { Notification as CmNotification, ExportFile } from "@cellmoa/grid";
import type Handsontable from "handsontable";

export default { title: "Verification/Data management" };

const colours = [
  "yellow",
  "red",
  "orange and another colour",
  "green",
  "blue",
  "gray",
  "black",
  "white",
  "purple",
  "lime",
  "olive",
  "cyan",
];

const log = (page: string, path: string, what: string) => () => (
  <NotAFeature page={page} why={what} path={path} />
);

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const BindingToData = () => (
  <Compare
    note="An array of objects, with `columns[].data` naming which property each column holds — the shape most applications actually have, because it is what an API answers with. The columns are deliberately given out of the objects' own key order and one key is left out entirely, so a grid that ignored `data` and fell back to `Object.keys` would show four columns in the wrong order. Two things on this page cellmoa does not do. A function-valued `columns` is supported, but a function-valued `columns[].data` is not: `colToProp` accepts a string or a number and nothing else, so a column that computes its own value has no way to say so. And `dataSchema` and `dataDotNotation`, which the page uses for nested objects, are read only to print a notice — a workbook addresses cells rather than keying them, and the mapping belongs in `valueGetter` / `valueSetter`."
    settings={{
      colHeaders: ["Model", "Year", "Price"],
      rowHeaders: true,
      columns: [{ data: "model" }, { data: "year" }, { data: "price" }],
      data: [
        { year: "2018", model: "Ford", price: "21400", vin: "ignored" },
        { year: "2020", model: "Audi", price: "38900", vin: "ignored" },
        { year: "2019", model: "BMW", price: "35200", vin: "ignored" },
        { year: "2021", model: "Toyota", price: "27750", vin: "ignored" },
      ],
    }}
  />
);

export const SavingData = () => (
  <Compare
    note="The page's whole recommendation is one hook: `afterChange` carries `[row, prop, oldValue, newValue]` for every accepted change, and that array is what you POST. Both grids write the hook's first two arguments into the last column, so the payload is readable without a console — edit any cell in the first three columns. The row numbers agree; the second slot does not, and that is the finding. The reference fills it with the column's `prop`, so an edit to the middle column reports `qty`, which is the key a server can act on. cellmoa builds its change array from the column index and reports `1` — the same number a Handsontable grid would report only for array-of-arrays data. Code following this page against named columns would send a body keyed by position. The `source` argument does agree, which is what the page's feedback-loop warning relies on: the write these handlers make from inside `afterChange` carries a source they test for instead of recursing."
    settings={{
      colHeaders: ["sku", "qty", "note", "afterChange said"],
      rowHeaders: true,
      columns: [
        { data: "sku" },
        { data: "qty" },
        { data: "note" },
        { data: "log" },
      ],
      data: [
        { sku: "A-100", qty: "4", note: "edit me", log: "" },
        { sku: "A-101", qty: "9", note: "or me", log: "" },
        { sku: "A-102", qty: "2", note: "", log: "" },
      ],
    }}
    afterMount={{
      cellmoa: (grid) => {
        grid.hooks.add("afterChange", (changes: unknown, source: unknown) => {
          const list = changes as Array<
            [number, string | number, string, string]
          > | null;
          if (!list || source === "saved") {
            return;
          }
          for (const [row, prop] of list) {
            if (prop === "log" || prop === 3) {
              continue;
            }
            grid.setDataAtCell(
              row,
              3,
              `row ${row}, prop ${String(prop)}`,
              "saved",
            );
          }
        });
      },
      handsontable: (hot) => {
        hot.addHook(
          "afterChange",
          (changes: Handsontable.CellChange[] | null, source: string) => {
            if (!changes || source === "saved") {
              return;
            }
            for (const [row, prop] of changes) {
              if (prop === "log" || prop === 3) {
                continue;
              }
              hot.setDataAtCell(
                row,
                3,
                `row ${row}, prop ${String(prop)}`,
                "saved",
              );
            }
          },
        );
      },
    }}
  />
);

export const EventsAndHooks = () => (
  <Compare
    note="The page's claim is that a hook is both an event and a middleware: `after`-prefixed hooks report, `before`-prefixed ones can change or refuse what is about to happen. Both are wired here. `beforeChange` upper-cases whatever you type and refuses the word `no` outright by nulling its entry, and `afterChange` writes the accepted value into the fourth column — so typing `no` should leave the cell as it was, on both sides. cellmoa threw away the array `beforeChange` handed back until recently, which meant neither the edit nor the veto worked; it is the most-used validation hook in a Handsontable application, so this is the one to watch. The count is the honest part of this page: cellmoa names all 255 hooks and, at the time of writing, 107 of them can actually be fired — `node scripts/parity.mjs` counts them, and the other 148 are names with nothing behind them."
    settings={{
      colHeaders: ["type here", "b", "c", "afterChange said"],
      rowHeaders: true,
    }}
    data={block(5, 4, (row, col) =>
      col === 3 ? "" : `${String.fromCharCode(65 + col)}${row + 1}`,
    )}
    afterMount={{
      cellmoa: (grid) => {
        grid.hooks.add("beforeChange", (changes: unknown) => {
          const list = changes as Array<
            [number, number, string, string] | null
          >;
          list.forEach((change, index) => {
            if (!change) {
              return;
            }
            if (String(change[3]).toLowerCase() === "no") {
              list[index] = null;
            } else {
              change[3] = String(change[3]).toUpperCase();
            }
          });
        });
        grid.hooks.add("afterChange", (changes: unknown, source: unknown) => {
          const list = changes as Array<
            [number, number, string, string]
          > | null;
          if (!list || source === "hook") {
            return;
          }
          for (const [row, col, , value] of list) {
            if (col !== 3) {
              grid.setDataAtCell(row, 3, String(value), "hook");
            }
          }
        });
      },
      handsontable: (hot) => {
        hot.addHook(
          "beforeChange",
          (changes: Array<Handsontable.CellChange | null>) => {
            changes.forEach((change, index) => {
              if (!change) {
                return;
              }
              if (String(change[3]).toLowerCase() === "no") {
                changes[index] = null;
              } else {
                change[3] = String(change[3]).toUpperCase();
              }
            });
          },
        );
        hot.addHook(
          "afterChange",
          (changes: Handsontable.CellChange[] | null, source: string) => {
            if (!changes || source === "hook") {
              return;
            }
            for (const [row, col, , value] of changes) {
              if (col !== 3) {
                hot.setDataAtCell(row, 3, String(value), "hook");
              }
            }
          },
        );
      },
    }}
  />
);

export const ExportToExcel = () => (
  <Compare
    note="A moment after mount each grid is asked for an `.xlsx` blob and reports what it got in a toast. This is the one place in the section where the two are built differently on purpose. Handsontable writes the workbook in the browser with ExcelJS, which you must install and hand it as `exportFile: { engines: { xlsx: ExcelJS } }`; nothing here does, so its toast should say the format is unavailable, and that is correct behaviour rather than a failure. cellmoa asks its engine to save, because the engine is where the formulas, the number formats and the defined names already live — rebuilding the workbook from the rendered DOM, which is how the reference reads styling, would quietly drop every one of them. So expect a byte count on the left and a refusal on the right. What that costs is real and should be said: the reference's DOM-reading export carries background colours and borders that a caller set purely in CSS, and an engine-side export cannot see those at all."
    settings={{
      colHeaders: ["Item", "Qty", "Total"],
      rowHeaders: true,
      notification: true,
      exportFile: true,
    }}
    data={[
      ["Widget", "3", "=B1*10"],
      ["Gasket", "7", "=B2*10"],
      ["Flange", "2", "=B3*10"],
    ]}
    height={220}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          const toast = grid.getPlugin<CmNotification>("notification");
          try {
            const blob = grid
              .getPlugin<ExportFile>("exportFile")
              ?.exportAsBlob("xlsx");
            toast?.showMessage({
              title: "xlsx",
              message: `built by the engine: ${blob ? blob.size : 0} bytes`,
              variant: "success",
              duration: 0,
              position: "top-end",
            });
          } catch (cause: unknown) {
            toast?.showMessage({
              title: "xlsx",
              message: String(cause),
              variant: "error",
              duration: 0,
              position: "top-end",
            });
          }
        }, 800);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          const toast = hot.getPlugin("notification");
          try {
            const blob = hot.getPlugin("exportFile").exportAsBlob("xlsx");
            toast.showMessage({
              title: "xlsx",
              message: `built in the browser: ${blob.size} bytes`,
              variant: "success",
              duration: 0,
              position: "top-end",
            });
          } catch (cause: unknown) {
            toast.showMessage({
              title: "xlsx",
              message: String(cause),
              variant: "error",
              duration: 0,
              position: "top-end",
            });
          }
        }, 800);
      },
    }}
  />
);

export const ExportToCsv = () => (
  <Compare
    note="The first column holds three values a spreadsheet would execute if it read them out of a CSV: one leading `@`, one leading `+`, one leading tab. A moment after mount each grid exports itself with `sanitizeValues: true` and puts the first two lines of the result in a toast, with the line break shown as ⏎. Read the toasts against each other. Every dangerous value should come out prefixed with an apostrophe and wrapped in quotes, and — this is the part worth checking rather than assuming — *every* field should be quoted once sanitizing is on, because a file where half the fields are quoted and half are not is a file whose readers disagree about where a field begins. cellmoa had no `sanitizeValues` at all until recently and shipped `=cmd|'/c calc'!A1` straight through; the option now exists with the same three forms the reference documents, off by default in both, since escaping changes what the file says and a grid holding its own data is entitled to a faithful export."
    settings={{
      colHeaders: ["Payload", "Note"],
      rowHeaders: true,
      notification: true,
      exportFile: true,
    }}
    data={[
      ["@SUM(1+1)", "leading at-sign"],
      ["+1-1", "leading plus"],
      ["\tcmd", "leading tab"],
      ["plain, with a comma", "quoted for the delimiter"],
    ]}
    height={240}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          const csv = grid
            .getPlugin<ExportFile>("exportFile")
            ?.exportAsString("csv", { colHeaders: true, sanitizeValues: true });
          grid.getPlugin<CmNotification>("notification")?.showMessage({
            title: "csv, sanitized",
            message: (csv ?? "").split("\r\n").slice(0, 2).join(" ⏎ "),
            variant: "info",
            duration: 0,
            position: "top-end",
          });
        }, 800);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          const csv = hot
            .getPlugin("exportFile")
            .exportAsString("csv", { colHeaders: true, sanitizeValues: true });
          hot.getPlugin("notification").showMessage({
            title: "csv, sanitized",
            message: csv.split("\r\n").slice(0, 2).join(" ⏎ "),
            variant: "info",
            duration: 0,
            position: "top-end",
          });
        }, 800);
      },
    }}
  />
);

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

// --- more of what each page documents ---------------------------------------

export const BindingToDataObjects = () => (
  <Compare
    note={`An array of objects rather than an array of arrays, with \`columns[].data\`
      naming the property each column reads. Edit a cell and the object's property should
      change — not a positional copy of it. The distinction matters when a row is moved
      or sorted: with objects the identity travels with the row, so a grid that quietly
      converts to arrays loses whichever properties no column mentioned.`}
    settings={
      {
        colHeaders: ["Item", "Amount"],
        rowHeaders: true,
        columns: [{ data: "item" }, { data: "amount" }],
        data: [
          { item: "Rent", amount: "1200", note: "a property no column shows" },
          {
            item: "Cloud",
            amount: "640",
            note: "and it should still be there",
          },
        ],
      } as never
    }
  />
);

export const BindingToDataNested = () => (
  <Compare
    note={`\`dataDotNotation\` lets a column reach into a nested object with
      \`'address.city'\`. Both panels should show the city, and editing it should write
      back into the nested object rather than creating a flat key beside it. Turning the
      setting off is the other half: the same string then means a property literally
      called "address.city", which is a real shape in some exports.`}
    settings={
      {
        colHeaders: ["Name", "City"],
        rowHeaders: true,
        dataDotNotation: true,
        columns: [{ data: "name" }, { data: "address.city" }],
        data: [
          { name: "Ada", address: { city: "London" } },
          { name: "Grace", address: { city: "New York" } },
        ],
      } as never
    }
  />
);

export const SavingDataAfterChange = () => (
  <Compare
    note={`\`afterChange\` is how a page knows to save. Edit a cell in either panel and
      the hook fires with the changes and a source string — and the source is the part
      worth watching, because it is what stops a save handler from saving its own
      writes back. Load the grid and nothing should fire; type and one should.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(3, 3)}
  />
);

export const ClipboardCopyRange = () => (
  <Compare
    note={`\`copyPaste\` bounds what a copy may take: \`rowsLimit\` and \`columnsLimit\`
      cap the range, and the grid is expected to say so rather than silently truncating.
      Select the whole table and copy in each panel — with limits of two, the clipboard
      should hold four cells, and something should tell you the rest was left out.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      copyPaste: { rowsLimit: 2, columnsLimit: 2 },
    }}
    data={block(5, 5)}
  />
);
