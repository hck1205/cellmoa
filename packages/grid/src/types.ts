/**
 * The reference's type names, over this grid's types.
 *
 * A Handsontable codebase being ported writes `CellProperties` and
 * `HotInstance`; this grid calls those `GridSettings` and `Grid`. Rather than
 * make every such file rename its imports, the reference's names are exported
 * here as aliases — one line each, saying what the thing is here.
 *
 * An alias is not a claim of sameness. Where the two differ, the comment says
 * so, because a name that quietly means something else is worse than a name
 * that is missing.
 */

import type { Grid } from './grid.js';
import type { Coords, GridSettings } from './settings.js';
import type { CellEditor, CellRenderer, CellValidator, EditorInstance } from './cellTypes/index.js';
import type { HookHandler, HookName } from './hooks.js';
import type { ColorScheme, DensityType, RegisteredTheme, ThemeDefinition, ThemeTokens } from './themes/index.js';

// --- configuration ---------------------------------------------------------

/**
 * Per-column overrides.
 *
 * The same shape as the whole settings object, because a column may override
 * anything a table can set — which is Handsontable's rule too, and is why its
 * `ColumnSettings` is a subset of `GridSettings` rather than a separate thing.
 */
export type ColumnSettings = GridSettings;

/**
 * The settings in force for one cell, after global → column → cell cascading.
 *
 * The reference distinguishes `CellProperties` (read-only at render time) from
 * `CellMeta` (mutable, what `getCellMeta` hands back). Here both are the same
 * resolved object: `getCellMeta` returns a fresh merge each call, so writing to
 * it changes nothing and there is no mutable variant to name separately.
 */
export type CellProperties = GridSettings;
export type CellMeta = GridSettings;

// --- data ------------------------------------------------------------------

/** A cell's address. The reference calls this `CellCoords`. */
export type CellCoords = Coords;

/**
 * What a cell holds.
 *
 * `string` here, not `any`. The workbook stores text and the engine decides
 * what it means — a cell holding `1` and a cell holding `'1'` are the same
 * cell — so the type says so rather than promising a union it cannot keep.
 */
export type CellValue = string;

/** A row of an array-of-objects data source. */
export type RowObject = Record<string, unknown>;

/** The same row as the source holds it, before the grid read it. */
export type SourceRowData = RowObject;

// --- functions -------------------------------------------------------------

export type RendererType = CellRenderer;
export type EditorType = CellEditor;
export type ValidatorType = CellValidator;

/** An open editor. The reference calls this `BaseEditorInstance`. */
export type BaseEditorInstance = EditorInstance;

/** What `selectOptions` may be given as. */
export type SelectOptionsObject =
  | string[]
  | Record<string, string>
  | ((row: number, col: number) => string[]);

// --- the instance ----------------------------------------------------------

/** The grid itself. The reference calls this `HotInstance`. */
export type HotInstance = Grid;

/**
 * Every hook, by name.
 *
 * The names are checked, the arguments are not: a handler is
 * `(...args) => unknown` whichever hook it is on. That is a real guarantee and
 * a real limit, and both are worth stating — `addHook('afterchange', …)`
 * becomes a compile error instead of a handler that never runs, but the
 * arguments inside it are still up to the author to get right.
 *
 * The reference types each hook's arguments individually. Doing the same for
 * 253 hooks is work this has not done, and the type says so by not pretending.
 */
export type Events = Record<HookName, HookHandler>;

/** The hook registry's shape. */
export type HooksRegistry = Events;

/**
 * Which pane a cell is drawn in.
 *
 * The reference calls these overlays and has ten of them; this grid has six,
 * because it does not draw a separate overlay for a corner that no frozen row
 * or column reaches.
 */
export type OverlayType = 'main' | 'top' | 'left' | 'corner' | 'bottom' | 'bottomLeft';

/** What a selection covers. */
export type RangeType = 'single' | 'range' | 'multiple';

// --- theming ---------------------------------------------------------------

/** A theme as it is declared. The reference calls this `ThemeConfig`. */
export type ThemeConfig = ThemeDefinition;

/** A registered theme, with its runtime settings. */
export type ThemeBuilder = RegisteredTheme;

/** Light, dark, or the system's choice. */
export type ThemeColorScheme = ColorScheme;

/** The custom properties a theme sets. */
export type ThemeTokensConfig = ThemeTokens;

/** One custom property's value. */
export type ThemeTokenValue = string;

/**
 * A value that differs between the colour schemes.
 *
 * The reference lets one token carry both; here a theme declares `light` and
 * `dark` as whole sets, so this is the pair a caller builds those from.
 */
export interface ThemeLightDarkValue {
  light: string;
  dark: string;
}

/** The colour half of a theme. */
export interface ThemeColorsConfig {
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** How much room a row takes. */
export type ThemeDensityConfig = DensityType;

/** What each density multiplies sizes by. */
export type ThemeDensitySizes = Record<DensityType, number>;

/** The sizing half of a theme, which here is ordinary tokens. */
export type ThemeSizingConfig = ThemeTokens;

/** The icon half, likewise. */
export type ThemeIconsConfig = ThemeTokens;

/** Everything a theme is given when it is built. */
export interface ThemeParams {
  name: string;
  colors?: ThemeColorsConfig;
  sizing?: ThemeSizingConfig;
  icons?: ThemeIconsConfig;
  density?: ThemeDensityConfig;
}

/**
 * The theme every other theme starts from.
 *
 * `main` is this grid's built-in default, and registering a theme without one
 * of its tokens leaves that token at `main`'s value.
 */
export type BaseTheme = RegisteredTheme;
