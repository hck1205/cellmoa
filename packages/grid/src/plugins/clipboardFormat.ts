/**
 * The clipboard's own formats, read and written.
 *
 * Nothing here knows there is a grid. A clipboard carries tab-separated text
 * and an HTML table, and turning those into rows of strings and back is a
 * question about the formats — which is why it can be checked without mounting
 * anything, and why it is worth having apart from the plugin that calls it.
 *
 * The plugin re-exports all of it, so a caller's imports are unchanged.
 */

export function parseClipboardText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // An empty field and a field that is not there are the same string, so
  // without this a last row whose one cell is `""` cannot be told from the
  // trailing line break spreadsheets end their clipboard text with, and one of
  // the two is a row that has to survive.
  let wasQuoted = false;
  let index = 0;

  while (index < text.length) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
      index += 1;
      continue;
    }
    if (character === '\t') {
      row.push(field);
      field = '';
      wasQuoted = false;
      index += 1;
      continue;
    }
    if (character === '\n' || character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      wasQuoted = false;
      // A CRLF is one line break, not two.
      index += character === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== '' || wasQuoted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Writes a value the way the clipboard's text flavour expects. */
export function escapeClipboardValue(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Turns a rectangle of values into tab-separated text. */
export function toClipboardText(rows: string[][]): string {
  return rows.map((row) => row.map(escapeClipboardValue).join('\t')).join('\n');
}

/** Turns it into an HTML table, for applications that prefer one. */
export function toClipboardHtml(rows: string[][]): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

/**
 * Reads the rows back out of an HTML table.
 *
 * The clipboard's HTML flavour is what a paste should look at first: it says
 * where every cell ends, so a value that itself contains a tab or a line break
 * survives, where the plain flavour can only guess. Returns `null` when there
 * is no table, which is the signal to fall back to the text.
 *
 * Parsed with `DOMParser` rather than into an element of this page. The markup
 * came from wherever the user last copied from, and an inert document runs no
 * script and fetches nothing while it is being read for its text.
 */
export function parseClipboardHtml(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html)) {
    return null;
  }
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) {
    return null;
  }
  const rows: string[][] = [];
  for (const line of Array.from(table.querySelectorAll('tr'))) {
    rows.push(Array.from(line.querySelectorAll('th, td'), (cell) => cell.textContent ?? ''));
  }
  return rows.length > 0 ? rows : null;
}

/**
 * The block a paste writes, repeated to cover a selection larger than it.
 *
 * `populateFromArray` does this itself for an ordinary paste. The shift modes
 * have to do it up front, because what they append below or beside the block
 * has to go after the last repetition rather than after the first.
 */
export function repeatBlock(values: string[][], rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) => {
    const line = values[r % values.length] ?? [];
    return Array.from({ length: cols }, (_, c) =>
      line.length === 0 ? '' : (line[c % line.length] ?? ''),
    );
  });
}

/**
 * How far a paste reaches.
 *
 * A selection larger than the pasted block repeats it, which is how pasting one
 * value down a column fills the column, so the extent is whichever of the two
 * is larger. Folded rather than spread into `Math.max`: pasting a CSV of a few
 * hundred thousand rows is an ordinary thing to do, and that many arguments
 * overflows the call stack.
 */
export function pasteExtent(
  values: string[][],
  rowCount: number,
  colCount: number,
): { rows: number; cols: number } {
  let cols = colCount;
  for (const line of values) {
    if (line.length > cols) {
      cols = line.length;
    }
  }
  return { rows: Math.max(rowCount, values.length), cols };
}



/**
 * Reads a pasted string as the value it looks like.
 *
 * Only when `parsePastedValue` asks for it. The default is to write what was
 * pasted, because guessing is how a part number becomes a date.
 */
export function parsePastedValue(text: string, locale = 'en-US'): string {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('=')) {
    return text;
  }
  // The separators this locale actually uses, rather than an assumption about
  // commas: `1.234,5` is twelve hundred in German and malformed in English.
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';

  const escape = (character: string): string => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Groups of three, then at most one decimal part — checked before anything is
  // stripped. Stripping first would read `1,234.5` as a German number and turn
  // it into `1.2345`, which is not what was pasted and not what it means.
  const shape = new RegExp(
    `^[+-]?\\d{1,3}(?:${escape(group)}\\d{3})*(?:${escape(decimal)}\\d+)?$` +
      `|^[+-]?\\d+(?:${escape(decimal)}\\d+)?(?:e[+-]?\\d+)?$`,
    'i',
  );
  if (!shape.test(trimmed)) {
    return text;
  }
  return trimmed.split(group).join('').replace(decimal, '.');
}
