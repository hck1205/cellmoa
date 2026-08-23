/**
 * How the grid looks, and how far a caller can move it.
 *
 * A theme in either library is a bundle of CSS custom properties rather than a
 * stylesheet: the rules that lay the table out never change, only the values
 * do. That design is what makes the section measurable — you can count how many
 * of the reference's properties this stylesheet actually reads, and the answer
 * is the honest measure of how much of a theme survives the move.
 *
 * It is eleven. `ht-theme-main.css` defines 328 `--ht-*` custom properties;
 * `packages/grid/src/themes/themes.css` consumes `--ht-accent-color`,
 * `--ht-background-color`, `--ht-background-secondary-color`,
 * `--ht-border-color`, `--ht-border-radius`, `--ht-cell-horizontal-border-color`,
 * `--ht-cell-horizontal-padding`, `--ht-cell-vertical-border-color`,
 * `--ht-cell-vertical-padding`, `--ht-font-size` and `--ht-foreground-color`.
 * All eleven are real names the reference also uses, so those overrides carry;
 * the other 317 land on nothing. The customization story below makes that
 * visible with one property from each set.
 *
 * One harness note that shapes every story here: `Compare.tsx` hands
 * Handsontable `themeName: 'ht-theme-main'` after the shared settings, because
 * that is the only theme stylesheet this package imports. So a story cannot
 * move Handsontable off `main`, and the comparisons below all run inside it.
 *
 * The pages are in the order the guide's own sidebar lists them.
 */

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Styling" };

/** The element the theme's class landed on, which is where an override has to go. */
function themed(root: HTMLElement): HTMLElement {
  if (/ht-theme-/.test(root.className)) {
    return root;
  }
  return root.querySelector<HTMLElement>('[class*="ht-theme-"]') ?? root;
}

export const Themes = () => (
  <Compare
    note="Both grids are asked for the `main` theme and drawn side by side, which is the comparison this whole section reduces to: the same theme name, and how much of what it means survives. Look at the cell padding, the border colour between cells, the header background, the font size and the accent on the selected cell — those are the properties cellmoa's stylesheet reads, and they should agree closely. Then look at everything else: header hover, the sort indicator, the fill handle, the row-header stripes, the editor's own background. Those come from properties cellmoa never consults, so it falls back to its own values and the two will visibly part. That is not a bug to file per token; it is the shape of the gap, and it is why the number in this file's header is worth keeping current. Two naming differences are real and will bite a caller. Handsontable's `theme`/`themeName` takes the CSS class name — `'ht-theme-main'`; cellmoa's takes the bare theme name — `'main'`, and would register an empty theme called `ht-theme-main` if handed the other spelling. And cellmoa's default colour scheme is `auto`, so it adds `ht-theme-main-dark-auto` and follows the browser's dark preference, where Handsontable's `ht-theme-main` means light until you ask for `-dark` or `-dark-auto` yourself. On a machine set to dark, expect the left panel to go dark and the right to stay light."
    settings={{
      colHeaders: ["Region", "Owner", "Stage", "Value"],
      rowHeaders: true,
      themeName: "main",
      columnSorting: true,
    }}
    data={block(8, 4)}
    height={300}
    afterMount={{
      cellmoa: (grid) => grid.selectCell(1, 1),
      handsontable: (hot) => hot.selectCell(1, 1),
    }}
  />
);

export const DesignSystem = () => (
  <Compare
    note={`The page is a Figma file and the script that turns its exported tokens into CSS,
      so the page's own content is an embedded viewer and a link. The tokens are the part
      that reaches a grid, and both panels here are given the same ones. What should match
      is the handful cellmoa reads; what will not is everything else the design system
      defines, because there is no equivalent variable on this side to receive it. Nothing
      warns about that — an unrecognised custom property is valid CSS — so the way to find
      the boundary is to look at two grids that were handed the same tokens.`}
    settings={
      {
        colHeaders: true,
        rowHeaders: true,
        style: {
          "--ht-background-color": "#fffbeb",
          "--ht-foreground-color": "#78350f",
          "--ht-accent-color": "#d97706",
          "--ht-border-color": "#fcd34d",
        },
      } as never
    }
    data={block(5, 4)}
  />
);

export const ThemeCustomization = () => (
  <Compare
    note="A moment after mount, two CSS custom properties are set on whichever element carries the theme class in each panel — the same two values, written the same way, on both sides. `--ht-accent-color` becomes a burnt orange, and `--ht-header-background-color` becomes a pale green. A cell is selected so the accent has somewhere to show. Watch what moves. The accent should move in both, because it is one of the eleven properties cellmoa's stylesheet reads: the selection outline and the selected-range wash are drawn from it. The header background should move only on the right, because cellmoa paints its headers from `--ht-background-secondary-color` and never consults `--ht-header-background-color` at all. That pair is the whole point of the story: overriding a token in cellmoa is not an error and produces no warning — it simply has no effect for 317 of the 328 names, and the only way to find out which is to look. Everything the page describes above the CSS layer is a separate matter. Both libraries have a `registerTheme()` that returns a chainable object with `setColorScheme()` and `setDensityType()`, and the two accept different definition shapes, so a theme object written for one cannot be handed to the other."
    settings={{
      colHeaders: ["Region", "Owner", "Stage", "Value"],
      rowHeaders: true,
      themeName: "main",
    }}
    data={block(8, 4)}
    height={300}
    afterMount={{
      cellmoa: (grid) => {
        grid.selectCell(1, 1);
        setTimeout(() => {
          const root = themed(grid.container);
          root.style.setProperty("--ht-accent-color", "#c2410c");
          root.style.setProperty("--ht-header-background-color", "#dcfce7");
        }, 400);
      },
      handsontable: (hot) => {
        hot.selectCell(1, 1);
        setTimeout(() => {
          const root = themed(hot.rootElement);
          root.style.setProperty("--ht-accent-color", "#c2410c");
          root.style.setProperty("--ht-header-background-color", "#dcfce7");
        }, 400);
      },
    }}
  />
);

export const LegacyStyle = () => (
  <Compare
    note={`A removal notice: handsontable.full.min.css was the default stylesheet through
      version 15, was superseded by the Classic theme in 16.1, and was deleted in 17.0.0.
      There is nothing to install here, but there is something to check, which is that the
      theme that replaced it looks the same on both sides. Both panels ask for the Classic
      theme by name. A grid that silently ignored themeName would draw in its default
      colours and look fine on its own — beside one that honoured it, it does not.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      themeName: "ht-theme-classic",
    }}
    data={block(5, 4)}
  />
);
