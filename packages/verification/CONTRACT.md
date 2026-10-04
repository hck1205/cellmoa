# The contract every stories file follows

Location: `packages/verification/src/verification/{section}.stories.tsx`
where `{section}` is the doc's own folder name (e.g. `cell-types`, `rows`).

Top of file: a module doc comment saying what the section is and what a reader
should be looking for across it.

Then, exactly:

```tsx
export default { title: 'Verification/{Section Title}' };
```

`{Section Title}` is the section name in sentence case: `Cell types`, `Rows`,
`Getting started`, `Upgrade and migration`.

Then **one named export per documentation page in that section**, in the order
the pages appear. The export name is the page title in PascalCase, so the tree
reads `verification > {section} > {page}`.

Three shapes, all from `../Compare.js`:

1. `<Compare settings={...} data={...} note="..." />` — the normal case. The
   same settings go to both grids. `afterMount` is available for a story that
   must open or press something; `height` sets the panel height.

2. `<OnlyReference settings={...} data={...} note="..." />` — the page is about
   a grid feature this library does not have. Only Handsontable is mounted,
   because there is nothing on our side to put beside it.

3. `<NotAFeature page="..." why="..." path="..." />` — the page is not about a
   grid feature at all: a release log, a licence, the reference's own website
   tooling, a React/Vue/Angular wrapper page. Say plainly what it is. `path` is
   the doc slug, e.g. `"changelog"`.

`block(rows, cols)` builds a block of values.

## The note is the point

Every `note` says **what to look at** and **what would count as a difference**.
Not "this shows sorting" — that is visible. Say what the reader should compare
and what a mismatch would mean. Where the two are meant to differ, say so and
why: a divergence already reasoned in `docs/handsontable-parity.md` is not a
finding, and calling it one wastes the reader.

Write prose, full sentences, no marketing. Match the voice of `Compare.tsx`.

## Honesty

Do not invent a passing comparison. If a setting works in only one of them,
that is what the story should show and what the note should say. Several of
these pages describe features cellmoa genuinely lacks — the filter panel,
keyboard access to menus, drag-to-resize, modular imports. Those are
`OnlyReference` or, where even the reference cannot demonstrate it in a grid
(bundle size, build tooling), a `NotAFeature` explaining the gap.

Read `docs/gap-audit.md` first: it lists what is known missing and what is a
reasoned divergence.
