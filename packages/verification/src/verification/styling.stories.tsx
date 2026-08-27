/**
 * Styling — the 4 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";
import type Handsontable from "handsontable";

export default { title: "Verification/Styling" };

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

// --- more of what each page documents ---------------------------------------

export const ThemesHorizon = () => (
  <Compare
    note={`The second built-in theme, asked for by name. Both panels should change
      together: background, borders, header weight and the selection colour. A theme that
      is accepted and not applied leaves the grid in its default colours, which looks
      deliberate — so the thing to check is that this panel differs from the Themes story
      above it rather than that it looks like anything in particular.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      themeName: "ht-theme-horizon",
    }}
    data={block(5, 4)}
  />
);

export const ThemeCustomizationDensity = () => (
  <Compare
    note={`A theme carries a density as well as colours, and the row height follows it.
      Set beside the default theme, the rows here should be visibly tighter in both
      panels. Density is the part of a theme most often half-applied — the colours land
      because they are custom properties, and the spacing does not because it needs the
      layout to be recomputed.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      themeName: "ht-theme-main-dark",
    }}
    data={block(6, 4)}
  />
);
