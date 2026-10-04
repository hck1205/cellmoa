# cellmoa beside Handsontable

Every story here mounts the same settings twice — once with cellmoa, once with
Handsontable 18 from npm — and puts the two side by side in a real browser.

```
npm install
npm run dev        # http://localhost:61000
npm run build      # a static site under build/
npm run check      # loads every story headless and asserts both halves drew
npm run coverage   # counts stories against the guide's table of contents
npm run verify     # coverage, then build, then check
```

The grid must be built first, since this loads its `dist` and its `.wasm`:

```
cd ../grid && npm run build:wasm && npm run build
```

## Why this exists

The unit suite runs in jsdom, which measures every element as zero and applies
no stylesheet. So it cannot answer "is it visible", "is it in the right place",
or "did the click land" — and a whole class of defect passed a green suite
while failing on screen. All of these were real, and all were found by hand:

- a hidden row that was still drawn
- a column header that heard no click, so sorting could not be reached
- a checkbox that could not be ticked
- a dialog whose backdrop matched no CSS rule
- four toast stacks that all landed in the same corner

Each of them would have been obvious here in a second.

## The tree

`verification > {category} > {name}`. The category is the guide's own section;
the name is one of its pages. There is a story for **every** page in the guide,
which is a claim `npm run coverage` counts rather than one this file asserts.

Roughly a third of the guide is not about a grid feature — release logs,
licences, the reference's own website tooling, and the React/Vue/Angular wrapper
pages this library has no equivalent for. Those pages are in the tree saying
plainly what they are, because leaving them out would make the tree look
complete when it is not, and a reader working through the table of contents
would be left wondering whether they had been missed.

A page about a feature cellmoa genuinely lacks — the filter panel, keyboard
access to the menus, drag-to-resize, modular imports — mounts only the
reference, with nothing beside it. That is the honest picture.

Each story's note says what to look at and what would count as a difference.
Where the two are meant to differ, the note says so and why — a divergence
already reasoned in `docs/handsontable-parity.md` is not a finding.

## What `npm run check` does and does not do

It loads every story headless and asserts that neither panel threw and that
both drew something. That is all a machine can honestly claim here: it cannot
tell you the two look alike. Reading them is the point, and the check only
guarantees there is something to read.

It does catch one useful thing on its own — a story whose reference half fails
to construct. That is how the `multiselect` spelling turned up: Handsontable
registers only the lower-case name, while cellmoa takes both.
