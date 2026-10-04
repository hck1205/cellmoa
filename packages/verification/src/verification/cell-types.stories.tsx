/**
 * Cell types — the 11 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Cell types" };

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

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const CellType = () => (
  <Compare
    settings={{
      colHeaders: [
        "text (the default)",
        "numeric",
        "numeric, renderer: text",
        "password",
      ],
      rowHeaders: true,
      columns: [
        {},
        {
          type: "numeric",
          numericFormat: { style: "currency", currency: "USD" },
        },
        {
          type: "numeric",
          numericFormat: { style: "currency", currency: "USD" },
          renderer: "text",
        },
        { type: "password" },
      ],
    }}
    data={[
      ["Laptop Pro 15", "1499", "1499", "plainTextPassword"],
      ["Wireless mouse", "29.99", "29.99", "txt"],
      ["USB-C hub", "54.5", "54.5", "longer"],
    ]}
    note="A type is three functions under one name, and an explicitly named function beats the type for that function alone. Columns two and three are configured identically apart from renderer: 'text' on the third, so the third must lose the currency formatting and keep everything else — type a letter into it and press Enter, and the numeric validator must still refuse it in both grids. If the third column still shows a dollar sign, the renderer setting lost to the type; if it accepts a letter, the type lost the validator along with the renderer. The fourth column is the reference's own example of a type that carries settings beyond the three functions; what that costs is on the Password cell type story."
  />
);

/**
 * Checkbox: two templates, and the cells that match neither.
 */

export const NumericCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Model", "Year", "Price", "Distance", "Discount"],
      rowHeaders: true,
      locale: "en-US",
      columns: [
        {},
        { type: "numeric" },
        {
          type: "numeric",
          numericFormat: {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
          },
        },
        {
          type: "numeric",
          numericFormat: {
            style: "unit",
            unit: "kilometer",
            useGrouping: true,
          },
        },
        { type: "numeric", numericFormat: { style: "percent" } },
      ],
    }}
    data={[
      ["Laptop Pro 15", "2017", "1499", "12500", "0.15"],
      ["Wireless mouse", "2018", "29.99", "340", "0.05"],
      ["USB-C hub", "2019", "54.5", "78900", "0.325"],
    ]}
    note="One column of numbers per formatting style, all through Intl.NumberFormatOptions, which is what numericFormat takes in both since v17 — the old { pattern, culture } shape is read by neither, and the reference warns to the console if it sees it. Look at the thousands separators, the currency symbol, the unit suffix and the right alignment, and check that Year has none of them because it asked for none. Then open the Price editor: the value being edited must be 1499, not $1,499.00, because a format is not a parser and an editor that hands back its own formatting cannot round-trip."
  />
);

/**
 * A masked value, and what the reference's type carries with it.
 */

export const DateCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Car", "Product date", "Payment date", "Registration date"],
      rowHeaders: true,
      locale: "en-US",
      columns: [
        { type: "text" },
        { type: "intl-date", dateFormat: { dateStyle: "short" } },
        {
          type: "intl-date",
          dateFormat: { month: "long", day: "numeric", year: "numeric" },
        },
        {
          type: "intl-date",
          dateFormat: {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          },
        },
      ],
    }}
    data={[
      ["Mercedes A 160", "2002-06-15", "2002-05-20", "2002-07-01"],
      ["Citroen C4 Coupe", "2007-03-22", "2007-02-28", "2007-04-10"],
      ["Audi A4 Avant", "2011-09-08", "2011-08-15", "2011-09-20"],
      ["Opel Astra", "2012-01-30", "2012-01-10", "2012-02-14"],
    ]}
    note="The three date columns hold the same ISO strings and differ only in dateFormat, which since v17 is an Intl.DateTimeFormatOptions object rather than the old pattern string — so the same object has to be read by both. Compare the three renderings column by column: a column showing the raw 2002-06-15 is a dateFormat nobody read, and two columns showing the same text is one option that was ignored. Then open a cell: the value being edited is the ISO date, not the formatted text, because a format decides how a date is shown and never what is stored."
  />
);

/**
 * Dropdown: the same editor as autocomplete, with the rule closed.
 */

export const TimeCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Shift", "Start", "Break start", "End"],
      rowHeaders: true,
      locale: "en-US",
      columns: [
        { type: "text" },
        { type: "intl-time", timeFormat: { timeStyle: "short" } },
        {
          type: "intl-time",
          timeFormat: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
        },
        {
          type: "intl-time",
          timeFormat: { hour: "numeric", minute: "2-digit", hour12: false },
        },
      ],
    }}
    data={[
      ["Morning", "09:00", "12:00", "17:00"],
      ["Afternoon", "13:30", "16:00", "21:00"],
      ["Night", "22:00", "01:00", "06:00"],
      ["Split", "08:00", "12:30", "20:00"],
    ]}
    note="The same three 24-hour strings per row, shown three ways, with timeFormat as an Intl.DateTimeFormatOptions object in both. Start should pick up the locale's short time — an am/pm suffix under en-US — Break start should show seconds it was never given as :00, and End should stay on the 24-hour clock because hour12 is false. A column that prints 09:00 unchanged did not read timeFormat; a column that shows am/pm where hour12 is false read it and then overrode it. As with dates, editing a cell must show the stored 24-hour value rather than the formatted one."
    height={280}
  />
);

export const CheckboxCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Task", "Done", "Ships in black"],
      rowHeaders: true,
      data: [
        ["Update API docs", true, "yes"],
        ["Deploy hotfix", false, "no"],
        ["Rotate signing keys", null, "maybe"],
      ],
      columns: [
        {},
        { type: "checkbox" },
        {
          type: "checkbox",
          checkedTemplate: "yes",
          uncheckedTemplate: "no",
          label: { position: "after", value: "in stock" },
        },
      ],
    }}
    note="The third row is the one to look at. Its Done cell is null and its Ships in black cell is 'maybe', so neither matches its column's checked or unchecked template, and both must draw an unchecked box carrying the noValue class — faded, visibly different from row two's deliberate false and no. A third row that looks identical to the second is a cell nobody has answered being reported as answered 'no', which is the failure this class exists to prevent. Then click a box in each grid: a checkbox is toggled rather than typed into, so the click itself has to be the edit, and it must go through validation and undo like any other write."
  />
);

/**
 * Dates, formatted through `Intl` on both sides.
 */

export const SelectCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Year", "Make", "In stock"],
      rowHeaders: true,
      colWidths: [80, 120, 90],
      columns: [
        {},
        { type: "select", selectOptions: ["Kia", "Nissan", "Toyota", "Honda"] },
        {},
      ],
    }}
    data={[
      ["2017", "Honda", "10"],
      ["2018", "Toyota", "20"],
      ["2019", "Nissan", "30"],
    ]}
    note="Nothing marks a select cell — it looks like text and a single click only selects it, which the reference's page warns about. Double-click a Make cell, or press Enter on it, and a real HTML <select> must appear in both; that element is the whole feature, so if one grid opens a text box instead it has fallen back to the text editor and selectOptions was never read. Its list is closed in both, so the value written can only be one of the four. Type-ahead inside the open list comes from the browser rather than from either library."
  />
);

/**
 * The default type, and what a validator does when it fails.
 */

export const DropdownCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Car", "Year", "Chassis colour", "Department"],
      rowHeaders: true,
      columns: [
        {},
        { type: "numeric" },
        { type: "dropdown", source: colours, visibleRows: 3 },
        {
          type: "dropdown",
          source: [
            "Research and development",
            "Sales",
            "Facilities management",
          ],
          trimDropdown: false,
        },
      ],
    }}
    data={[
      ["Tesla", "2017", "black", "Sales"],
      ["Nissan", "2018", "blue", "Facilities management"],
      ["Chrysler", "2019", "yellow", "Sales"],
      ["Volvo", "2020", "white", "Research and development"],
    ]}
    note="Dropdown is autocomplete with strict on, so this is the same configuration as the Autocomplete story with the opposite outcome: type 'teal' into a Chassis colour cell and press Enter, and both grids must refuse it as a value. Refusing means marking, not discarding — allowInvalid is on by default, so the typed value is still written and the cell carries the htInvalid class. The reference's stylesheet paints that class red; this grid adds the class and ships no rule for it, so here the rejection is in the DOM and invisible on screen. Inspect the cell if the two look the same."
  />
);

/**
 * A grid inside a cell, against a list inside a cell.
 */

export const AutocompleteCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Car", "Chassis colour", "Bumper colour"],
      rowHeaders: true,
      columns: [
        {
          type: "autocomplete",
          source: ["BMW", "Chrysler", "Nissan", "Suzuki", "Toyota", "Volvo"],
        },
        { type: "autocomplete", source: colours, visibleRows: 4 },
        { type: "autocomplete", source: colours, trimDropdown: false },
      ],
    }}
    data={[
      ["BMW", "black", "black"],
      ["Nissan", "blue", "blue"],
      ["Chrysler", "yellow", "black"],
      ["Volvo", "white", "gray"],
    ]}
    note="Open a cell in the Car column, type a name that is not on the list — Peugeot — and press Enter. Flexible is the default for autocomplete: the value must be kept and the cell must not be marked invalid in either grid. If one of them refuses it, that grid has quietly turned autocomplete into dropdown, and every column configured this way has become a closed list without saying so. The other two columns vary the list rather than the rule: Chassis colour sets visibleRows to 4, so its list shows four options and scrolls, and Bumper colour sets trimDropdown to false, so its list widens past the cell to fit 'orange and another colour' instead of clipping it."
  />
);

/**
 * What a `type` actually is, and what beats it.
 */

export const MultiselectCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Airport", "Shipment"],
      rowHeaders: true,
      colWidths: [220, 260],
      columns: [
        {},
        {
          type: "multiselect",
          source: [
            "Electronics and Gadgets",
            "Medical Supplies",
            "Auto Parts",
            "Fresh Produce",
            "Textiles",
            "Industrial Equipment",
          ],
          maxSelections: 2,
          searchInput: true,
          placeholder: "nothing selected",
        },
      ],
    }}
    data={[
      [
        "Los Angeles International",
        "Electronics and Gadgets, Medical Supplies",
      ],
      ["Chicago O'Hare International", "Auto Parts, Fresh Produce"],
      ["Charles de Gaulle", "Textiles, Industrial Equipment"],
      ["Tokyo Haneda", ""],
    ]}
    note="The spelling is the first finding and it is why this story uses the hyphen-free one: multiselect is the only name the reference registers, and a configuration written as multiSelect throws there while resolving here, because this grid registers both. Nothing on screen shows that; it is a note, not a comparison. What is on screen is the rendering. The reference draws every selected value as a removable chip and shows the placeholder in the empty last row; this grid draws the stored text. Open the editor in both and check that more than one value can be chosen, that the search box filters the list, and that maxSelections stops you at two."
  />
);

/**
 * Numbers, formatted through `Intl.NumberFormat` on both sides.
 */

export const PasswordCellType = () => (
  <Compare
    settings={{
      colHeaders: [
        "User",
        "Password",
        "Fixed hash length",
        "Custom symbol, revealed briefly",
      ],
      rowHeaders: true,
      columns: [
        {},
        { type: "password" },
        { type: "password", hashLength: 8 },
        { type: "password", hashSymbol: "•", hashRevealDelay: 700 },
      ],
    }}
    data={[
      [
        "Chris Right",
        "plainTextPassword",
        "plainTextPassword",
        "plainTextPassword",
      ],
      ["John Honest", "txt", "txt", "txt"],
      ["Greg Well", "longer", "longer", "longer"],
    ]}
    note="The three masking options first: column two masks each character so the mask leaks the length, column three fixes the length at eight so it does not, and column four uses a bullet and shows each character for 700ms as you type it. All three should agree. The divergence is the one the reference's own Cell type page names: there, the password type carries copyable: false along with its renderer and editor, so a password column stays out of the clipboard by default. Here a type is only its three functions and nothing more. Select a Password cell in each grid, press Ctrl+C and paste somewhere: the reference gives you an empty cell and this grid gives you the secret. Setting copyable: false explicitly works in both."
  />
);

/**
 * A native `<select>`, offered as the simplest editor there is.
 */

export const HandsontableCellType = () => (
  <Compare
    settings={{
      colHeaders: ["Car", "Year", "Chassis colour"],
      rowHeaders: true,
      columns: [
        {
          type: "handsontable",
          source: ["BMW", "Chrysler", "Nissan", "Suzuki", "Toyota", "Volvo"],
          handsontable: {
            colHeaders: ["Marque", "Country", "Parent company"],
            licenseKey: "non-commercial-and-evaluation",
            data: [
              ["BMW", "Germany", "Bayerische Motoren Werke AG"],
              ["Chrysler", "USA", "Chrysler Group LLC"],
              ["Nissan", "Japan", "Nissan Motor Company Ltd"],
              ["Suzuki", "Japan", "Suzuki Motor Corporation"],
              ["Toyota", "Japan", "Toyota Motor Corporation"],
              ["Volvo", "Sweden", "Zhejiang Geely Holding Group"],
            ],
          },
        },
        { type: "numeric" },
        { type: "dropdown", source: colours },
      ],
    }}
    data={[
      ["Tesla", "2017", "black"],
      ["Nissan", "2018", "blue"],
      ["Chrysler", "2019", "yellow"],
      ["Volvo", "2020", "white"],
    ]}
    note="Open the first column's editor in each panel. The reference's handsontable type embeds a second grid: three columns, its own headers, navigable with the arrow keys, and the row you land on decides the value. This grid registers handsontable as an alias for autocomplete, so it reads source and ignores the handsontable block entirely, and what opens is a one-column list of the same marques. Both commit the same string, so the data agrees; the editor does not. The difference matters to any configuration that leans on the inner grid — a user picking a marque by recognising its parent company has nothing to recognise it by here."
  />
);

/**
 * Several values in one cell.
 */

// --- the options each type documents ----------------------------------------

export const NumericCellTypeFormatting = () => (
  <Compare
    note={`\`numericFormat\` decides how a number is shown without changing what it is.
      The reference spells it as a numbro pattern; cellmoa reads an Intl descriptor. Both
      spellings are passed here, unchanged, which is why only the right panel formats —
      see docs/known-defects.md. Click into a cell in either: the editor should show the
      raw number, because a format is for reading and an editor is for changing.`}
    settings={
      {
        colHeaders: ["as written", "formatted"],
        rowHeaders: true,
        columns: [
          { type: "numeric" },
          { type: "numeric", numericFormat: { pattern: "0,0.00" } },
        ],
      } as never
    }
    data={[
      ["1234.5678", "1234.5678"],
      ["-42", "-42"],
    ]}
  />
);

export const NumericCellTypeInvalid = () => (
  <Compare
    note={`\`allowInvalid: false\` sends a bad value back rather than storing it marked.
      Type "abc" into either column and watch what happens: the left column should keep
      the value and turn red, the right should refuse it and restore what was there. Both
      behaviours are documented, and a grid that only has the first one silently accepts
      text into a numeric column.`}
    settings={{
      colHeaders: ["allowInvalid: true", "allowInvalid: false"],
      rowHeaders: true,
      columns: [
        { type: "numeric", allowInvalid: true },
        { type: "numeric", allowInvalid: false },
      ],
    }}
    data={[
      ["10", "10"],
      ["20", "20"],
    ]}
  />
);

export const CheckboxCellTypeTemplates = () => (
  <Compare
    note={`\`checkedTemplate\` and \`uncheckedTemplate\` say what the underlying value is
      when the box is ticked. Here they are the strings "yes" and "no" rather than
      booleans, which is what a column loaded from a CSV usually holds. Tick a box and
      ask either grid for the cell: it should read "yes", not \`true\`. A grid that
      accepts the templates for display and writes a boolean anyway corrupts the column
      on the first click.`}
    settings={{
      colHeaders: ["In stock"],
      rowHeaders: true,
      columns: [
        { type: "checkbox", checkedTemplate: "yes", uncheckedTemplate: "no" },
      ],
    }}
    data={[["yes"], ["no"], ["yes"]]}
  />
);

export const DropdownCellTypeStrict = () => (
  <Compare
    note={`A dropdown is an autocomplete that only accepts what is in the list, which is
      \`strict: true\` plus \`filter: false\`. Type something not on the list into either
      panel and it should be refused. The distinction is the whole of the difference
      between this type and autocomplete, so a grid that treats them as one lets a typo
      into a column that is supposed to be closed.`}
    settings={{
      colHeaders: ["Country"],
      rowHeaders: true,
      columns: [
        { type: "dropdown", source: ["UK", "Japan", "Kenya", "Chile"] },
      ],
    }}
    data={[["UK"], ["Japan"], [""]]}
  />
);

export const AutocompleteCellTypeFiltering = () => (
  <Compare
    note={`Autocomplete filters the list as you type and, with \`strict: false\`, accepts
      a value that is not on it. Type "Ke" into either panel: the list should narrow to
      Kenya, and typing "Nowhere" should be kept rather than rejected. \`filter: false\`
      would show the whole list while still matching — worth trying against the dropdown
      story beside this one.`}
    settings={{
      colHeaders: ["Country"],
      rowHeaders: true,
      columns: [
        {
          type: "autocomplete",
          source: ["UK", "Japan", "Kenya", "Chile"],
          strict: false,
        },
      ],
    }}
    data={[["UK"], [""]]}
  />
);

export const PasswordCellTypeMasking = () => (
  <Compare
    note={`\`hashSymbol\` and \`hashLength\` decide what the mask looks like: a fixed
      number of a chosen character, so the length of the mask says nothing about the
      length of the secret. Both panels should show exactly six bullets whatever the
      value is. The other half of the type is that the value must not be copyable — select
      a cell and copy, and the clipboard should not hold the password.`}
    settings={{
      colHeaders: ["Password"],
      rowHeaders: true,
      columns: [{ type: "password", hashSymbol: "•", hashLength: 6 }],
    }}
    data={[["short"], ["a much longer secret"]]}
  />
);

export const DateCellTypeDefaultAndFormat = () => (
  <Compare
    note={`\`dateFormat\` and \`defaultDate\` — the reference's spellings, passed through
      unchanged. Only the right panel formats, because cellmoa reads \`dateFormat\` as an
      Intl descriptor rather than a moment pattern; the difference is recorded in
      docs/known-defects.md and this is what it looks like. \`correctFormat\` is the
      other half of the page: typing a date in another shape should be rewritten rather
      than refused.`}
    settings={
      {
        colHeaders: ["Sell date"],
        rowHeaders: true,
        columns: [
          {
            type: "date",
            dateFormat: "YYYY-MM-DD",
            defaultDate: "2026-01-01",
            correctFormat: true,
          },
        ],
      } as never
    }
    data={[["2026-03-04"], [""]]}
  />
);

export const SelectCellTypeOptions = () => (
  <Compare
    note={`The select type uses the browser's own \`<select>\`, so its list is native and
      its keyboard is the platform's rather than the grid's. Open it in both panels: the
      options should match, and the closed cell should show the chosen value rather than
      its index. This is the simplest of the list types and the one whose keyboard costs
      the grid nothing, which is the reason the page recommends it.`}
    settings={{
      colHeaders: ["Status"],
      rowHeaders: true,
      columns: [
        { type: "select", selectOptions: ["Pending", "Settled", "Refunded"] },
      ],
    }}
    data={[["Pending"], ["Settled"]]}
  />
);

export const TimeCellTypeFormat = () => (
  <Compare
    note={`\`timeFormat\` with \`correctFormat\` should rewrite a loosely typed time into
      the column's shape — type "9:5" and it should become the format the column asks
      for. As with the date type, the reference's format string is a moment pattern and
      this library reads Intl options, so the two panels will not agree on the written
      form even when they agree on the value.`}
    settings={
      {
        colHeaders: ["Starts"],
        rowHeaders: true,
        columns: [
          { type: "time", timeFormat: "h:mm:ss a", correctFormat: true },
        ],
      } as never
    }
    data={[["12:30:00 pm"], [""]]}
  />
);
