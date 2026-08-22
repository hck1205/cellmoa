/**
 * The renderers.
 *
 * A renderer's whole job is to put the cell's current state into an element.
 * It never reads the workbook and never writes to it, which is what makes it
 * safe to call tens of thousands of times while a grid scrolls.
 */

import { writeHtml } from '../sanitize.js';
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

/**
 * Puts text into a cell, escaping it unless HTML was asked for.
 *
 * `allowHtml` is off by default, and that is the important half: cell content
 * comes from a file someone sent you, and writing it as HTML is how a
 * spreadsheet becomes an injection vector. When it is switched on, a
 * `sanitizer` may be supplied to clean the markup first — and a grid that
 * allows HTML without one is trusting whoever wrote the file.
 */
function write(td: HTMLTableCellElement, text: string, meta: RenderContext['meta']): void {
  if (meta.allowHtml !== true) {
    td.textContent = text;
    return;
  }
  writeHtml(td, text, meta.sanitizer, 'innerHTML');
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
  write(td, text, meta);
};

/** Right-aligned, with tabular figures so columns of numbers line up. */
export const numericRenderer: CellRenderer = (context) => {
  const { td, cell, meta } = context;
  applyCommon(context);
  const text = formatNumeric(cell?.text ?? '', cell?.value, meta);
  write(td, text === '' && meta.placeholder ? String(meta.placeholder) : text, meta);
  td.classList.add('cm-numeric');
};

/**
 * The cache behind `numericFormat`.
 *
 * Building an `Intl.NumberFormat` is expensive enough that doing it per cell
 * would show while scrolling, and the options a grid uses are few — so they are
 * kept, keyed by locale and options together.
 */
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats a number for display, when `numericFormat` asks for it.
 *
 * The value has to be a number, not merely look like one: a cell holding text
 * that happens to read as a number keeps its text, because formatting it would
 * silently claim a type it does not have. Without `numericFormat` the engine's
 * own rendering is used, which is what makes an unformatted grid show exactly
 * what the workbook holds.
 */
export function formatNumeric(
  text: string,
  value: unknown,
  meta: RenderContext['meta'],
): string {
  // `preserveNumericLiteral` keeps what was typed when reading it as a number
  // would lose something — `9.0` staying `9.0`, and a value past the
  // safe-integer limit staying exact rather than rounding.
  if (meta.preserveNumericLiteral === true && text !== '') {
    return text;
  }
  const format = meta.numericFormat as Intl.NumberFormatOptions | undefined;
  if (!format || typeof value !== 'number' || !Number.isFinite(value)) {
    return text;
  }
  const locale = typeof meta.locale === 'string' ? meta.locale : undefined;
  const key = `${locale ?? ''}:${JSON.stringify(format)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, format);
    } catch {
      // An unusable option is not worth losing the value over.
      return text;
    }
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

/**
 * Text, but always as HTML.
 *
 * Asking for this renderer is the consent that `allowHtml` otherwise withholds,
 * so it does not check the setting — but it still runs the sanitizer when one
 * is configured.
 */
export const htmlRenderer: CellRenderer = (context) => {
  applyCommon(context);
  write(context.td, context.cell?.text ?? '', { ...context.meta, allowHtml: true });
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

/** Hides the value behind a row of symbols. */
export const passwordRenderer: CellRenderer = (context) => {
  applyCommon(context);
  const { td, cell, meta } = context;
  const text = cell?.text ?? '';
  const symbol = String(meta.hashSymbol ?? '*');
  // The mask is as long as the value, as Handsontable's is. `hashLength` fixes
  // it instead, which is what hides how long the secret is — worth asking for,
  // and not something to impose on a caller who only wanted the value covered.
  const length = typeof meta.hashLength === 'number' ? meta.hashLength : text.length;
  td.textContent = text === '' ? '' : symbol.repeat(Math.max(length, 0));
};

/**
 * The cache behind `dateFormat` and `timeFormat`.
 *
 * Building an `Intl.DateTimeFormat` costs enough to show while scrolling, and
 * a grid uses very few distinct ones.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats an ISO value for display, when a format was configured.
 *
 * The source has to be ISO — `YYYY-MM-DD` for a date, `HH:mm[:ss]` for a time —
 * because that is what sorts and compares correctly. Anything else is shown as
 * it is rather than guessed at: a value that is not a date should not become
 * one because a column said `type: 'date'`.
 */
export function formatTemporal(
  text: string,
  options: Intl.DateTimeFormatOptions | undefined,
  locale: string | undefined,
  kind: 'date' | 'time',
): string {
  if (!options || text === '') {
    return text;
  }
  const iso = kind === 'date' ? text : `1970-01-01T${text}`;
  const at = new Date(kind === 'date' ? `${text}T00:00:00` : iso);
  if (Number.isNaN(at.getTime())) {
    return text;
  }
  const key = `${locale ?? ''}:${kind}:${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, options);
    } catch {
      return text;
    }
    dateFormatters.set(key, formatter);
  }
  return formatter.format(at);
}

export const dateRenderer: CellRenderer = (context) => {
  const { td, cell, meta } = context;
  applyCommon(context);
  const shown = formatTemporal(
    cell?.text ?? '',
    meta.dateFormat as Intl.DateTimeFormatOptions | undefined,
    typeof meta.locale === 'string' ? meta.locale : undefined,
    'date',
  );
  write(td, shown, meta);
  td.classList.add('cm-date');
};

export const timeRenderer: CellRenderer = (context) => {
  const { td, cell, meta } = context;
  applyCommon(context);
  const shown = formatTemporal(
    cell?.text ?? '',
    meta.timeFormat as Intl.DateTimeFormatOptions | undefined,
    typeof meta.locale === 'string' ? meta.locale : undefined,
    'time',
  );
  write(td, shown, meta);
  td.classList.add('cm-time');
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
