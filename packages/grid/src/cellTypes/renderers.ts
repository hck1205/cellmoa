/**
 * The renderers.
 *
 * A renderer's whole job is to put the cell's current state into an element.
 * It never reads the workbook and never writes to it, which is what makes it
 * safe to call tens of thousands of times while a grid scrolls.
 */

import type { CellRenderer, RenderContext } from './types.js';

/** Applies what every renderer does, whatever the type. */
function applyCommon({ td, cell, meta }: RenderContext): void {
  td.className = 'cm-cell';
  if (meta.className) {
    td.className += ` ${String(meta.className)}`;
  }
  if (meta.readOnly) {
    td.classList.add(String(meta.readOnlyCellClassName ?? 'htDimmed'));
  }
  if (meta.wordWrap === false) {
    td.classList.add(String(meta.noWordWrapClassName ?? 'htNoWrap'));
  }
  if (cell?.error) {
    td.classList.add('cm-error');
    td.title = cell.error;
  } else {
    td.removeAttribute('title');
  }
}

/** Puts text into a cell, escaping it unless HTML was asked for. */
function write(td: HTMLTableCellElement, text: string, allowHtml: boolean): void {
  if (allowHtml) {
    // Only when the grid was configured for it: writing arbitrary cell content
    // as HTML is how a spreadsheet becomes an injection vector.
    td.innerHTML = text;
  } else {
    td.textContent = text;
  }
}

/** The default: whatever the engine says the cell shows. */
export const textRenderer: CellRenderer = (context) => {
  applyCommon(context);
  const { td, cell, meta } = context;
  const text = cell?.text ?? '';
  if (text === '' && meta.placeholder) {
    td.textContent = String(meta.placeholder);
    td.classList.add(String(meta.placeholderCellClassName ?? 'htPlaceholder'));
    return;
  }
  write(td, text, meta.allowHtml === true);
};

/** Right-aligned, with tabular figures so columns of numbers line up. */
export const numericRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-numeric');
};

/** Text, but always as HTML. */
export const htmlRenderer: CellRenderer = (context) => {
  applyCommon(context);
  write(context.td, context.cell?.text ?? '', true);
};

/** A checkbox, checked when the cell matches the checked template. */
export const checkboxRenderer: CellRenderer = (context) => {
  applyCommon(context);
  const { td, cell, meta } = context;
  const checkedTemplate = meta.checkedTemplate ?? true;
  const value = cell?.value;

  td.replaceChildren();
  const input = td.ownerDocument.createElement('input');
  input.type = 'checkbox';
  input.className = 'cm-checkbox';
  input.checked = value === checkedTemplate || value === true || value === 'true';
  input.disabled = meta.readOnly === true;
  // The cell holds the truth; the input only shows it. Toggling goes through
  // the grid so that it is recorded like any other edit.
  input.tabIndex = -1;
  td.appendChild(input);

  const label = meta.label as { value?: string; position?: string } | undefined;
  if (label?.value) {
    const text = td.ownerDocument.createElement('span');
    text.className = 'cm-checkbox-label';
    text.textContent = label.value;
    if (label.position === 'before') {
      td.insertBefore(text, input);
    } else {
      td.appendChild(text);
    }
  }
};

/** Text with a marker showing the cell opens a list. */
export const dropdownRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-dropdown');
};

export const autocompleteRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-autocomplete');
};

/** Hides the value behind a fixed number of symbols. */
export const passwordRenderer: CellRenderer = (context) => {
  applyCommon(context);
  const { td, cell, meta } = context;
  const text = cell?.text ?? '';
  const symbol = String(meta.hashSymbol ?? '*');
  // A fixed length by default, so the mask does not leak how long the secret is.
  const length = typeof meta.hashLength === 'number' ? meta.hashLength : text.length;
  td.textContent = text === '' ? '' : symbol.repeat(Math.max(length, 0));
};

/** Dates and times render as text; the engine has already formatted them. */
export const dateRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-date');
};

export const timeRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-time');
};

/** Several chosen values, shown as a comma-separated list. */
export const multiSelectRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-multi-select');
};

export const selectRenderer: CellRenderer = (context) => {
  textRenderer(context);
  context.td.classList.add('cm-select');
};
