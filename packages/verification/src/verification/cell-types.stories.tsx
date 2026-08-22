/**
 * The thirteen cell types, each in the state that shows what it is for.
 *
 * A renderer is the one thing a test in jsdom cannot check: it measures every
 * element as zero and applies no stylesheet, so "is the box ticked" and "is the
 * mask the right length" are questions only a browser can answer.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Cell types' };

export const Text = () => (
  <Compare
    note="The default. Nothing is formatted; the cell shows what the workbook holds."
    settings={{ colHeaders: true, rowHeaders: true, columns: [{ type: 'text' }, { type: 'text' }] }}
    data={[['plain', 'text'], ['with  spaces', '  padded  ']]}
  />
);

export const Numeric = () => (
  <Compare
    note="Right-aligned, and formatted by `numericFormat`. cellmoa formats through `Intl`; Handsontable 18 does too, since it dropped numbro. A number that differs in grouping or currency placement is a real difference."
    settings={{
      colHeaders: ['plain', 'currency', 'percent'],
      rowHeaders: true,
      columns: [
        { type: 'numeric' },
        { type: 'numeric', numericFormat: { style: 'currency', currency: 'USD' } },
        { type: 'numeric', numericFormat: { style: 'percent', minimumFractionDigits: 1 } },
      ],
    }}
    data={[
      ['1234.5', '1234.5', '0.256'],
      ['-99', '-99', '1'],
      ['0', '0', '0'],
    ]}
  />
);

export const Checkbox = () => (
  <Compare
    note="Click a box in each. It did nothing in cellmoa until recently — the input was drawn with `tabIndex = -1` and nothing listened. The third column uses `yes`/`no` templates; the fourth holds a value matching neither, which the reference marks with a `noValue` class."
    settings={{
      colHeaders: ['bool', 'readOnly', 'yes/no', 'neither'],
      rowHeaders: true,
      columns: [
        { type: 'checkbox' },
        { type: 'checkbox', readOnly: true },
        { type: 'checkbox', checkedTemplate: 'yes', uncheckedTemplate: 'no' },
        { type: 'checkbox', checkedTemplate: 'yes', uncheckedTemplate: 'no' },
      ],
    }}
    data={[
      ['true', 'true', 'yes', 'maybe'],
      ['false', 'false', 'no', ''],
    ]}
  />
);

export const Password = () => (
  <Compare
    note="The mask hides the length by default. `hashLength` fixes it; `hashSymbol` changes the character. A mask whose length tracks the secret is the defect to look for."
    settings={{
      colHeaders: ['default', 'fixed length', 'other symbol'],
      rowHeaders: true,
      columns: [
        { type: 'password' },
        { type: 'password', hashLength: 6 },
        { type: 'password', hashSymbol: '•' },
      ],
    }}
    data={[
      ['short', 'short', 'short'],
      ['a much longer secret', 'a much longer secret', 'a much longer secret'],
    ]}
  />
);

export const DateAndTime = () => (
  <Compare
    note="Double-click to edit. Both should open a native picker. The source is ISO in cellmoa — `dateFormat` is `Intl.DateTimeFormatOptions`, not a moment pattern, which is the documented v18 shape."
    settings={{
      colHeaders: ['date', 'time'],
      rowHeaders: true,
      columns: [
        { type: 'date', dateFormat: { year: 'numeric', month: 'short', day: 'numeric' } },
        { type: 'time', timeFormat: { hour: '2-digit', minute: '2-digit' } },
      ],
    }}
    data={[
      ['2024-03-15', '09:30'],
      ['2024-12-01', '17:45:30'],
    ]}
  />
);

export const DropdownAndAutocomplete = () => (
  <Compare
    note="Double-click and type. `dropdown` is strict — an off-list value is refused. `autocomplete` is flexible by default and must accept one; cellmoa marked every typed value invalid until the editor and the validator were made to read the same `strict`."
    settings={{
      colHeaders: ['dropdown (strict)', 'autocomplete (flexible)', 'autocomplete strict'],
      rowHeaders: true,
      columns: [
        { type: 'dropdown', source: ['red', 'green', 'blue'] },
        { type: 'autocomplete', source: ['red', 'green', 'blue'] },
        { type: 'autocomplete', source: ['red', 'green', 'blue'], strict: true },
      ],
    }}
    data={[
      ['red', 'red', 'red'],
      ['', 'not on the list', ''],
    ]}
  />
);

export const Select = () => (
  <Compare
    note="A native `<select>`. Double-click or press Enter to open it."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      columns: [{ type: 'select', selectOptions: ['one', 'two', 'three'] }],
    }}
    data={[['one'], ['two']]}
  />
);

export const MultiSelect = () => (
  <Compare
    note="The type is spelled  — the reference registers only that, while cellmoa accepts the camel-cased spelling too. Open the editor, tick three, then type in the search box and press Enter. cellmoa used to drop the ticks the search had hidden — the value was read from the drawn checkboxes rather than from what was chosen."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      columns: [{ type: 'multiselect', source: ['alpha', 'beta', 'gamma', 'delta'] }],
    }}
    data={[['alpha, beta'], ['']]}
    height={300}
  />
);

export const ReadOnlyAndInvalid = () => (
  <Compare
    note="A read-only cell dims and refuses an edit; an invalid one is marked and, with `allowInvalid: false`, is not written at all. Both are class names, so both are invisible to a test that cannot see a stylesheet."
    settings={{
      colHeaders: ['editable', 'readOnly', 'numeric, allowInvalid false'],
      rowHeaders: true,
      allowInvalid: false,
      columns: [{}, { readOnly: true }, { type: 'numeric' }],
    }}
    data={[
      ['type here', 'locked', '42'],
      ['', 'locked', 'not a number'],
    ]}
  />
);
