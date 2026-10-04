/**
 * Cell functions — the 5 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";
import type Handsontable from "handsontable";

export default { title: "Verification/Cell functions" };

const heat = bothWays((td, value) => {
  const number = Number(value);
  td.textContent = value;
  td.style.textAlign = "right";
  td.style.background = "";
  if (Number.isFinite(number)) {
    const ratio = Math.min(Math.max(number / 100, 0), 1);
    td.style.background = `rgb(${Math.round(230 + 25 * ratio)}, ${Math.round(
      245 - 60 * ratio,
    )}, ${Math.round(230 - 60 * ratio)})`;
  }
});

/**
 * A validator written to both calling conventions.
 *
 * The reference calls `validator(value, callback)` and reads the answer from
 * the callback; this grid calls `validator(value, meta)` and reads the returned
 * value. Answering both ways at once costs one line, and unlike the renderer
 * the two conventions do not collide — a validator that both calls its second
 * argument when it is callable and returns the verdict satisfies each of them.
 */

function looksLikeAnIp(value: unknown, second: unknown): boolean {
  const valid = /^(\d{1,3}\.){3}\d{1,3}$/.test(String(value ?? ""));
  if (typeof second === "function") {
    (second as (ok: boolean) => void)(valid);
  }
  return valid;
}

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

function bothWays(
  paint: (td: HTMLTableCellElement, value: string) => void,
): string {
  const renderer = (...args: unknown[]): void => {
    const first = args[0];
    if (
      args.length === 1 &&
      typeof first === "object" &&
      first !== null &&
      "td" in first
    ) {
      const context = first as {
        td: HTMLTableCellElement;
        cell: { text?: string } | null;
      };
      // This grid expects the renderer to reset the element, so a renderer that
      // does not would leave last render's classes on a recycled cell.
      context.td.className = "cm-cell";
      paint(context.td, context.cell?.text ?? "");
      return;
    }
    const value = args[5];
    paint(
      args[1] as HTMLTableCellElement,
      value === null || value === undefined ? "" : String(value),
    );
  };
  return renderer as unknown as string;
}

/** A green-to-red wash over a percentage, drawn at render time. */

export const CellFunctions = () => (
  <Compare
    settings={{
      colHeaders: ["numeric (column)", "grid default", "numeric + renderer"],
      rowHeaders: true,
      type: "text",
      columns: [
        {
          type: "numeric",
          numericFormat: { style: "currency", currency: "USD" },
        },
        {},
        {
          type: "numeric",
          numericFormat: { style: "currency", currency: "USD" },
          renderer: "text",
        },
      ],
      cell: [
        {
          row: 0,
          col: 0,
          type: "checkbox",
          checkedTemplate: "1",
          uncheckedTemplate: "0",
        },
      ],
    }}
    data={[
      ["1", "Laptop Pro 15", "1499"],
      ["1499", "Wireless mouse", "29.99"],
      ["29.99", "USB-C hub", "54.5"],
    ]}
    note="Three claims from the page, all visible at once. The grid says type: 'text' and the first column overrides it with numeric, so rows two and three of that column are currency; cell [0, 0] overrides the column with checkbox, so the top-left cell is a box and not a number — cell beats column beats grid. The third column sets renderer alongside type, and an explicitly named function beats the type for that function only, so it loses the currency formatting and keeps the numeric editor and validator. A first column with three numbers means the cell layer was not consulted; a third column still showing dollars means the renderer setting was."
  />
);

/**
 * What a renderer is allowed to do to a cell.
 */

export const CellRenderer = () => (
  <Compare
    settings={{
      colHeaders: ["Region", "renderer: numeric (percent)", "custom renderer"],
      rowHeaders: true,
      colWidths: [140, 190, 150],
      columns: [
        {},
        { renderer: "numeric", numericFormat: { style: "percent" } },
        { renderer: heat },
      ],
    }}
    data={[
      ["North", "0.82", "82"],
      ["South", "0.41", "41"],
      ["East", "0.13", "13"],
      ["West", "0.67", "67"],
    ]}
    note="Two ways of naming a renderer. The middle column names a built-in one by its alias on a column that has no type at all, so the values are drawn as percentages while the editor stays the plain text one — that alias form is the part of this page that ports unchanged. The third column supplies a function, and the function had to be written twice over to appear here: the reference calls a renderer with seven positional arguments and this grid calls it with a single context object, so the same rule can only be put in both panels by inspecting what it was handed. Look at whether the wash and the alignment match column for column. They should, because the rule is one function; what does not match is that neither library could have run the other's renderer as written."
  />
);

/**
 * Rejecting a value, and the two independent things that happen next.
 */

export const CellEditor = () => (
  <Compare
    settings={{
      colHeaders: [
        "numeric, editor: text",
        "text, editor: password",
        "editor: false",
        "readOnly: true",
      ],
      rowHeaders: true,
      columns: [
        { type: "numeric", editor: "text" },
        { type: "text", editor: "password" },
        { editor: false },
        { readOnly: true },
      ],
    }}
    data={[
      ["1499", "hunter2", "not editable", "read only"],
      ["29.99", "correct horse", "not editable", "read only"],
      ["54.5", "battery staple", "not editable", "read only"],
    ]}
    note="Every built-in editor has an alias, and an alias is the one form of this setting that ports between the two libraries. The first column keeps the numeric renderer and validator and edits through the plain text editor; the second is a text column whose editor masks — the value is drawn in the clear and typed in the dark, which is only possible because the three functions are independent. Try to open the third and fourth: editor: false and readOnly: true both refuse the editor, and the reference's page draws the distinction between them — only readOnly adds the htDimmed class and only readOnly blocks paste and fill. Check that the fourth column is visibly dimmed in both and the third is not. What does not port is a custom editor: the reference wants a class extending BaseEditor, this grid wants a function returning an editor instance, and the lifecycle is the same while the shape is not. This grid also registers no checkbox editor at all, because a checkbox is toggled rather than typed into."
  />
);

/**
 * The three functions, and the four layers they are resolved through.
 */

export const CellValidator = () => (
  <Compare
    settings={{
      colHeaders: [
        "Host",
        "IP (function)",
        "Port (RegExp)",
        "Port, allowInvalid: false",
      ],
      rowHeaders: true,
      columns: [
        {},
        { validator: looksLikeAnIp },
        { validator: /^\d{2,5}$/ },
        { validator: /^\d{2,5}$/, allowInvalid: false },
      ],
    }}
    data={[
      ["gateway", "10.0.0.1", "8080", "8080"],
      ["registry", "10.0.0.2", "5000", "5000"],
      ["broker", "not-an-ip", "http", "9092"],
    ]}
    note="Row three arrives already wrong, and the two validator shapes the page names are both here: a function on the IP column, a RegExp on the Port column. Select each of those cells and press Enter twice to revalidate them. The reference paints a rejected cell red through the htInvalid class its stylesheet defines; this grid adds the same class and ships no rule for it, so a rejection is in the DOM and not on screen — that is a real gap, and inspecting the element is the only way to see the class here. The last column is the other half of the page: commit behaviour and visual marking are independent, and allowInvalid: false is meant to hold the editor open until the value passes. Type 'http' into it and press Enter. The reference keeps the editor open; this grid closes it and discards what was typed, so a rule that was supposed to stop bad data silently stops the data instead."
  />
);

/**
 * The declarative cell-definition page, which is a wrapper page.
 */

export const CustomCells = () => (
  <Compare
    note={`The page is written around the framework wrappers — React's EditorComponent and
      useHotEditor, Angular's advanced renderer and editor components, Vue's mount helpers.
      None of those exist here. Underneath them is a plain function that paints a cell, and
      that does exist on both sides: the same bar, proportional to the number, with the
      value written beside it.

      The signatures are not the same, and that is the finding. Handsontable calls a
      renderer with positional arguments — (instance, td, row, col, prop, value,
      cellProperties) — and cellmoa calls one with a single context object,
      ({ row, col, td, cell, meta }). The function below reads whichever shape it is handed,
      which is exactly the adapter a real port needs; without it, a renderer copied from the
      reference receives the context object as its first argument and paints nothing. The
      type said renderer?: string as well, so the function form was unreachable from
      TypeScript even though the runtime had always accepted it. That is now fixed.`}
    settings={{
      colHeaders: ["Product", "Share"],
      rowHeaders: true,
      columns: [
        {},
        {
          renderer: ((...args: unknown[]) => {
            // One function, two calling conventions.
            const context = args[0] as {
              td?: HTMLElement;
              cell?: { value?: unknown };
            };
            const positional = args.length > 2;
            const td = (positional ? args[1] : context?.td) as
              | HTMLElement
              | undefined;
            const value = positional ? args[5] : context?.cell?.value;
            if (!td) {
              return;
            }
            const share = Number(value) || 0;
            td.textContent = "";
            const bar = document.createElement("div");
            bar.style.cssText =
              "display:inline-block;height:10px;vertical-align:middle;background:#3b82f6;width:" +
              String(Math.min(share, 100)) +
              "px";
            const label = document.createElement("span");
            label.textContent = " " + String(share) + "%";
            label.style.cssText = "font:11px/1.4 ui-monospace, monospace";
            td.appendChild(bar);
            td.appendChild(label);
          }) as never,
        },
      ],
    }}
    data={[
      ["Alpha", "80"],
      ["Beta", "45"],
      ["Gamma", "12"],
    ]}
  />
);

// --- more of what each page documents ---------------------------------------

export const CellValidatorAsync = () => (
  <Compare
    note={`A validator may answer later — the page's example is a server check — and the
      grid has to keep the cell open until it does. Type into either panel and watch: the
      cell should stay marked as pending rather than committing and then turning red,
      because a value that is written before it is checked has already been read by
      whatever was listening.`}
    settings={
      {
        colHeaders: ["Code (must be AA-1234)"],
        rowHeaders: true,
        columns: [
          {
            validator: (value: unknown, callback: (valid: boolean) => void) => {
              setTimeout(
                () => callback(/^[A-Z]{2}-\d{4}$/.test(String(value ?? ""))),
                150,
              );
            },
          },
        ],
      } as never
    }
    data={[["AB-1234"], ["nope"]]}
  />
);

export const CellValidatorAllowInvalid = () => (
  <Compare
    note={`\`allowInvalid: false\` is the difference between marking a bad value and
      refusing it. The left column keeps what you typed and turns red; the right restores
      what was there. Both are documented and they are not interchangeable: a form that
      must not hold a bad value needs the second, and a sheet a person is still filling
      in needs the first.`}
    settings={{
      colHeaders: ["marks it", "refuses it"],
      rowHeaders: true,
      columns: [
        { type: "numeric", allowInvalid: true },
        { type: "numeric", allowInvalid: false },
      ],
    }}
    data={[
      ["1", "1"],
      ["2", "2"],
    ]}
  />
);

export const CellEditorDisabled = () => (
  <Compare
    note={`\`editor: false\` opens nothing while leaving the cell writable through the
      API — different from \`readOnly\`, which refuses the write as well. Double-click
      the first column in each panel and nothing should happen; the second should open.
      A grid that maps \`editor: false\` onto \`readOnly\` passes every visual check and
      then refuses a programmatic write it should have allowed.`}
    settings={{
      colHeaders: ["no editor", "ordinary"],
      rowHeaders: true,
      columns: [{ editor: false }, {}],
    }}
    data={[
      ["try me", "try me"],
      ["try me", "try me"],
    ]}
  />
);
