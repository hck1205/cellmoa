/**
 * Themes.
 *
 * A theme is a set of CSS custom properties, not a stylesheet: the rules that
 * lay the grid out are the same whichever theme is on, and only the values
 * change. That is what lets a caller override one colour without taking on
 * responsibility for the whole appearance.
 *
 * Two axes sit on top of a theme and are deliberately separate from it.
 * *Colour scheme* is light or dark, or follows the system. *Density* is how
 * much room a row takes. Neither is a different theme — asking for the dark,
 * compact `main` should not mean maintaining nine themes.
 */

/** Light, dark, or whatever the system is set to. */
export type ColorScheme = 'light' | 'dark' | 'auto';

/** How much room the grid gives a row. */
export type DensityType = 'default' | 'compact' | 'comfortable';

/** The custom properties a theme sets, without the `--ht-` prefix. */
export type ThemeTokens = Record<string, string>;

/** A theme as it is declared. */
export interface ThemeDefinition {
  name: string;
  /** Values shared by both colour schemes. */
  base?: ThemeTokens;
  light: ThemeTokens;
  dark: ThemeTokens;
}

/**
 * A theme that has been registered, with its runtime settings.
 *
 * The setters return the theme so they can be chained, which is the shape
 * Handsontable's own API has.
 */
export interface RegisteredTheme {
  readonly name: string;
  readonly definition: ThemeDefinition;
  colorScheme: ColorScheme;
  density: DensityType;
  setColorScheme(scheme: ColorScheme): RegisteredTheme;
  setDensityType(density: DensityType): RegisteredTheme;
  /** The class names this theme wants on the grid's root. */
  classNames(): string[];
  /** The custom properties, resolved for a given scheme. */
  properties(scheme: 'light' | 'dark'): ThemeTokens;
}

/**
 * How much a row grows or shrinks at each density.
 *
 * A multiplier rather than a set of sizes: a caller who set `rowHeights` meant
 * that height, and density should scale their choice rather than replace it.
 */
export const DENSITY_SCALE: Record<DensityType, number> = {
  compact: 0.8,
  default: 1,
  comfortable: 1.25,
};

const registry = new Map<string, RegisteredTheme>();

/** Registers a theme, or returns the one already registered under its name. */
export function registerTheme(definition: ThemeDefinition): RegisteredTheme {
  const existing = registry.get(definition.name);
  if (existing) {
    return existing;
  }
  const theme: RegisteredTheme = {
    name: definition.name,
    definition,
    colorScheme: 'auto',
    density: 'default',
    setColorScheme(scheme) {
      theme.colorScheme = scheme;
      return theme;
    },
    setDensityType(density) {
      theme.density = density;
      return theme;
    },
    classNames() {
      const names = [`ht-theme-${definition.name}`, `cm-theme-${definition.name}`];
      if (theme.colorScheme === 'dark') {
        names.push(`ht-theme-${definition.name}-dark`);
      } else if (theme.colorScheme === 'auto') {
        // The `-auto` variant is the one whose rules are behind a
        // `prefers-color-scheme` query, so the page decides.
        names.push(`ht-theme-${definition.name}-dark-auto`);
      }
      if (theme.density !== 'default') {
        names.push(`cm-density-${theme.density}`);
      }
      return names;
    },
    properties(scheme) {
      return { ...definition.base, ...(scheme === 'dark' ? definition.dark : definition.light) };
    },
  };
  registry.set(definition.name, theme);
  return theme;
}

/** A registered theme by name, or `null`. */
export function getTheme(name: string): RegisteredTheme | null {
  return registry.get(name) ?? null;
}

/** Every registered theme's name. */
export function themeNames(): string[] {
  return [...registry.keys()];
}

/** Forgets a registration, so a test can start again. */
export function unregisterTheme(name: string): void {
  registry.delete(name);
}

/**
 * The spreadsheet-like theme, and the default.
 *
 * Lines between every cell, because the thing being edited is a grid of cells
 * and the lines are what say where one ends.
 */
export const mainTheme: ThemeDefinition = {
  name: 'main',
  base: {
    'border-radius': '0px',
    'cell-horizontal-padding': '4px',
    'cell-vertical-padding': '2px',
    'font-size': '13px',
  },
  light: {
    'background-color': '#ffffff',
    'background-secondary-color': '#f5f5f5',
    'foreground-color': '#111111',
    'border-color': '#d9d9d9',
    'cell-horizontal-border-color': '#d9d9d9',
    'cell-vertical-border-color': '#d9d9d9',
    'accent-color': '#3478f6',
  },
  dark: {
    'background-color': '#1a1a1a',
    'background-secondary-color': '#262626',
    'foreground-color': '#eeeeee',
    'border-color': '#3a3a3a',
    'cell-horizontal-border-color': '#3a3a3a',
    'cell-vertical-border-color': '#3a3a3a',
    'accent-color': '#5a96ff',
  },
};

/**
 * The reading theme.
 *
 * No vertical lines. A table being read rather than edited is a set of rows,
 * and the lines between columns are noise the eye has to step over.
 */
export const horizonTheme: ThemeDefinition = {
  name: 'horizon',
  base: {
    'border-radius': '4px',
    'cell-horizontal-padding': '10px',
    'cell-vertical-padding': '6px',
    'font-size': '13px',
    'cell-vertical-border-color': 'transparent',
  },
  light: {
    'background-color': '#ffffff',
    'background-secondary-color': '#fafafa',
    'foreground-color': '#1c1c1c',
    'border-color': '#ececec',
    'cell-horizontal-border-color': '#ececec',
    'accent-color': '#0f62fe',
  },
  dark: {
    'background-color': '#161616',
    'background-secondary-color': '#1f1f1f',
    'foreground-color': '#f4f4f4',
    'border-color': '#2f2f2f',
    'cell-horizontal-border-color': '#2f2f2f',
    'accent-color': '#78a9ff',
  },
};

/** The old look, kept so an existing page does not change under its users. */
export const classicTheme: ThemeDefinition = {
  name: 'classic',
  base: {
    'border-radius': '0px',
    'cell-horizontal-padding': '3px',
    'cell-vertical-padding': '1px',
    'font-size': '12px',
  },
  light: {
    'background-color': '#ffffff',
    'background-secondary-color': '#f3f3f3',
    'foreground-color': '#000000',
    'border-color': '#cccccc',
    'cell-horizontal-border-color': '#cccccc',
    'cell-vertical-border-color': '#cccccc',
    'accent-color': '#5292f7',
  },
  dark: {
    'background-color': '#0f0f0f',
    'background-secondary-color': '#1c1c1c',
    'foreground-color': '#f0f0f0',
    'border-color': '#444444',
    'cell-horizontal-border-color': '#444444',
    'cell-vertical-border-color': '#444444',
    'accent-color': '#4d84e2',
  },
};

/** The themes that ship with the grid. */
export const BUILT_IN_THEMES: ThemeDefinition[] = [mainTheme, horizonTheme, classicTheme];

for (const definition of BUILT_IN_THEMES) {
  registerTheme(definition);
}
