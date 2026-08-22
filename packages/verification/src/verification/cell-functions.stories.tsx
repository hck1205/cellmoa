/**
 * Cell functions: the renderer, the editor and the validator, taken one at a
 * time.
 *
 * A cell type is a bundle of these three; this section is about setting them
 * separately, which is where the two libraries stop agreeing. The names and
 * the cascade match — `renderer`, `editor`, `validator`, resolved cell over
 * column over grid — but the *shapes* do not. The reference calls a renderer
 * with seven positional arguments and this grid calls it with one context
 * object; the reference's editor is a class extending `BaseEditor` and this
 * grid's is a function returning an editor instance. So a configuration that
 * names a built-in function by its alias ports unchanged, and one that supplies
 * its own does not port at all. Every story below is built on the part that
 * ports, with the part that does not stated in the note.
 */

import { Compare, NotAFeature } from '../Compare.js';

/**
 * One renderer, answering to both calling conventions.
 *
 * The reference hands a renderer `(instance, td, row, col, prop, value,
 * cellProperties)`; this grid hands it a single `{ row, col, td, cell, meta }`.
 * Neither shape is wrong and neither is readable by the other, so a renderer
 * that is to run in both panels has to look at what it was given and pick the
 * `td` and the value out of it. That is the cost of the divergence, written
 * out rather than described.
 *
 * The return type is `string` because `renderer` is declared as the alias of a
 * registered renderer; a function is accepted at run time by both, and the
 * cast is what the type cannot say.
 */
function bothWays(paint: (td: HTMLTableCellElement, value: string) => void): string {
  const renderer = (...args: unknown[]): void => {
    const first = args[0];
    if (args.length === 1 && typeof first === 'object' && first !== null && 'td' in first) {
      const context = first as { td: HTMLTableCellElement; cell: { text?: string } | null };
      // This grid expects the renderer to reset the element, so a renderer that
      // does not would leave last render's classes on a recycled cell.
      context.td.className = 'cm-cell';
      paint(context.td, context.cell?.text ?? '');
      return;
    }
    const value = args[5];
    paint(args[1] as HTMLTableCellElement, value === null || value === undefined ? '' : String(value));
  };
  return renderer as unknown as string;
}

/** A green-to-red wash over a percentage, drawn at render time. */
const heat = bothWays((td, value) => {
  const number = Number(value);
  td.textContent = value;
  td.style.textAlign = 'right';
  td.style.background = '';
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
  const valid = /^(\d{1,3}\.){3}\d{1,3}$/.test(String(value ?? ''));
  if (typeof second === 'function') {
    (second as (ok: boolean) => void)(valid);
  }
  return valid;
}

export default { title: 'Verification/Cell functions' };

/**
 * Choosing an editor without choosing a type.
 */
export const CellEditor = () => (
  <Compare
    settings={{
      colHeaders: [
        'numeric, editor: text',
        'text, editor: password',
        'editor: false',
        'readOnly: true',
      ],
      rowHeaders: true,
      columns: [
        { type: 'numeric', editor: 'text' },
        { type: 'text', editor: 'password' },
        { editor: false },
        { readOnly: true },
      ],
    }}
    data={[
      ['1499', 'hunter2', 'not editable', 'read only'],
      ['29.99', 'correct horse', 'not editable', 'read only'],
      ['54.5', 'battery staple', 'not editable', 'read only'],
    ]}
    note="Every built-in editor has an alias, and an alias is the one form of this setting that ports between the two libraries. The first column keeps the numeric renderer and validator and edits through the plain text editor; the second is a text column whose editor masks — the value is drawn in the clear and typed in the dark, which is only possible because the three functions are independent. Try to open the third and fourth: editor: false and readOnly: true both refuse the editor, and the reference's page draws the distinction between them — only readOnly adds the htDimmed class and only readOnly blocks paste and fill. Check that the fourth column is visibly dimmed in both and the third is not. What does not port is a custom editor: the reference wants a class extending BaseEditor, this grid wants a function returning an editor instance, and the lifecycle is the same while the shape is not. This grid also registers no checkbox editor at all, because a checkbox is toggled rather than typed into."
  />
);

/**
 * The three functions, and the four layers they are resolved through.
 */
export const CellFunctions = () => (
  <Compare
    settings={{
      colHeaders: ['numeric (column)', 'grid default', 'numeric + renderer'],
      rowHeaders: true,
      type: 'text',
      columns: [
        { type: 'numeric', numericFormat: { style: 'currency', currency: 'USD' } },
        {},
        { type: 'numeric', numericFormat: { style: 'currency', currency: 'USD' }, renderer: 'text' },
      ],
      cell: [{ row: 0, col: 0, type: 'checkbox', checkedTemplate: '1', uncheckedTemplate: '0' }],
    }}
    data={[
      ['1', 'Laptop Pro 15', '1499'],
      ['1499', 'Wireless mouse', '29.99'],
      ['29.99', 'USB-C hub', '54.5'],
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
      colHeaders: ['Region', 'renderer: numeric (percent)', 'custom renderer'],
      rowHeaders: true,
      colWidths: [140, 190, 150],
      columns: [{}, { renderer: 'numeric', numericFormat: { style: 'percent' } }, { renderer: heat }],
    }}
    data={[
      ['North', '0.82', '82'],
      ['South', '0.41', '41'],
      ['East', '0.13', '13'],
      ['West', '0.67', '67'],
    ]}
    note="Two ways of naming a renderer. The middle column names a built-in one by its alias on a column that has no type at all, so the values are drawn as percentages while the editor stays the plain text one — that alias form is the part of this page that ports unchanged. The third column supplies a function, and the function had to be written twice over to appear here: the reference calls a renderer with seven positional arguments and this grid calls it with a single context object, so the same rule can only be put in both panels by inspecting what it was handed. Look at whether the wash and the alignment match column for column. They should, because the rule is one function; what does not match is that neither library could have run the other's renderer as written."
  />
);

/**
 * Rejecting a value, and the two independent things that happen next.
 */
export const CellValidator = () => (
  <Compare
    settings={{
      colHeaders: ['Host', 'IP (function)', 'Port (RegExp)', 'Port, allowInvalid: false'],
      rowHeaders: true,
      columns: [
        {},
        { validator: looksLikeAnIp },
        { validator: /^\d{2,5}$/ },
        { validator: /^\d{2,5}$/, allowInvalid: false },
      ],
    }}
    data={[
      ['gateway', '10.0.0.1', '8080', '8080'],
      ['registry', '10.0.0.2', '5000', '5000'],
      ['broker', 'not-an-ip', 'http', '9092'],
    ]}
    note="Row three arrives already wrong, and the two validator shapes the page names are both here: a function on the IP column, a RegExp on the Port column. Select each of those cells and press Enter twice to revalidate them. The reference paints a rejected cell red through the htInvalid class its stylesheet defines; this grid adds the same class and ships no rule for it, so a rejection is in the DOM and not on screen — that is a real gap, and inspecting the element is the only way to see the class here. The last column is the other half of the page: commit behaviour and visual marking are independent, and allowInvalid: false is meant to hold the editor open until the value passes. Type 'http' into it and press Enter. The reference keeps the editor open; this grid closes it and discards what was typed, so a rule that was supposed to stop bad data silently stops the data instead."
  />
);

/**
 * The declarative cell-definition page, which is a wrapper page.
 */
export const CustomCells = () => (
  <NotAFeature
    page="Custom Cells"
    why="This page is about the framework wrappers and the factories built for them: React's EditorComponent and useHotEditor hook, Angular's HotCellEditorAdvancedComponent and HotCellRendererAdvancedComponent, Vue's mount helpers, and the editorFactory and rendererFactory shorthands that go with them. This library publishes one package, @cellmoa/grid, with no React, Vue or Angular wrapper and no cell factory, so there is no second thing to put beside the reference here. The underlying cell functions the page is a shorthand for are compared on the Cell renderer, Cell editor and Cell validator stories, including the signature differences that would have to be settled before a factory of this kind could exist."
    path="custom-cells"
  />
);
