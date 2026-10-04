/**
 * Every type the reference documents can be imported from this package.
 *
 * A type that does not exist is a compile error here, which is the only way to
 * check a type surface — nothing at run time can tell you a name is missing.
 */

import type {
  BaseEditorInstance, BaseTheme, CellChange, CellCoords, CellMeta, CellProperties,
  CellRange, CellType, CellValue, ChangeSource, ColumnSettings, EditorType, Events,
  GridSettings, HooksRegistry, HotInstance, IndexMapper, OverlayType, RangeType,
  RendererType, RowObject, SelectOptionsObject, SourceRowData, ThemeBuilder,
  ThemeColorScheme, ThemeColorsConfig, ThemeConfig, ThemeDensityConfig,
  ThemeDensitySizes, ThemeIconsConfig, ThemeLightDarkValue, ThemeParams,
  ThemeSizingConfig, ThemeTokenValue, ThemeTokensConfig, ValidatorType,
} from '../src/index.js';

/** Names every imported type, so none is dropped as unused. */
export type Documented = [
  BaseEditorInstance, BaseTheme, CellChange, CellCoords, CellMeta, CellProperties,
  CellRange, CellType, CellValue, ChangeSource, ColumnSettings, EditorType, Events,
  GridSettings, HooksRegistry, HotInstance, IndexMapper, OverlayType, RangeType,
  RendererType, RowObject, SelectOptionsObject, SourceRowData, ThemeBuilder,
  ThemeColorScheme, ThemeColorsConfig, ThemeConfig, ThemeDensityConfig,
  ThemeDensitySizes, ThemeIconsConfig, ThemeLightDarkValue, ThemeParams,
  ThemeSizingConfig, ThemeTokenValue, ThemeTokensConfig, ValidatorType,
];

// The configuration types are usable as configuration.
const columns: ColumnSettings[] = [
  { data: 'name', type: 'text' },
  { data: 'revenue', type: 'numeric', numericFormat: { style: 'currency', currency: 'USD' } },
];
const settings: GridSettings = { columns, licenseKey: 'non-commercial-and-evaluation' };
void settings;

// A hook name that exists type-checks; one that does not is a compile error.
const handler: Events['afterChange'] = () => undefined;
void handler;
// @ts-expect-error `afterchange` is not a hook — the casing is wrong.
const typo: Events['afterchange'] = () => undefined;
void typo;
