/**
 * A spreadsheet grid for the web, on the cellmoa engine.
 */

export { Engine, EngineError } from './engine.js';
export type { EngineResponse, WasmSource } from './engine.js';

export { Grid } from './grid.js';

export {
  BasePlugin,
  getPluginConstructor,
  pluginNames,
  registerPlugin,
  registeredPlugins,
} from './plugins/base.js';
export type { PluginConstructor } from './plugins/base.js';
export * from './plugins/index.js';
export type { CellChange, ChangeSource, GridOptions } from './grid.js';

export {
  DataSource,
  WriteConflict,
  cellRef,
  columnLetters,
  lettersToColumn,
  parseA1,
  rangeRef,
} from './dataSource.js';
export type { Actor, AlterAction, Edit, SheetInfo, Window } from './dataSource.js';

export { Hooks, EXTRA_HOOK_NAMES, HOOK_NAMES, isHookName } from './hooks.js';
export type { HookHandler, HookName } from './hooks.js';

export { IndexMapper } from './indexMapper.js';

export { CellRange, Selection } from './selection.js';
export type { SelectionMode, SelectionState } from './selection.js';

export {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEADER_WIDTH,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_SETTINGS,
  MetaManager,
  SETTING_COUNT,
  SETTING_NAMES,
  isSettingName,
} from './settings.js';
export type { CellData, CellType, Coords, GridSettings } from './settings.js';

export {
  cellTypeNames,
  editors,
  getCellType,
  getEditor,
  getRenderer,
  getValidator,
  registerCellType,
  registerEditor,
  registerRenderer,
  registerValidator,
  renderers,
  validators,
} from './cellTypes/index.js';
export type {
  CellEditor,
  CellRenderer,
  CellTypeDefinition,
  CellValidator,
  EditorContext,
  EditorInstance,
  RenderContext,
  ValidationResult,
} from './cellTypes/index.js';

export {
  ShortcutContext,
  ShortcutManager,
  combinationOf,
  normalizeCombination,
} from './shortcuts.js';
export type { KeyCombination, ShortcutCallback, ShortcutOptions } from './shortcuts.js';

export { SizeMap } from './sizes.js';
export { View } from './view.js';
export type { CellRenderContext, ColHeaderCell, ViewModel, Viewport } from './view.js';

export { Menu, SEPARATOR, resolve } from './menu.js';
export type { MenuHost, MenuItem, MenuSelection } from './menu.js';

export { CellMap, CellSet } from './cellMap.js';
export { LayoutManager, SLOT_ELEMENT_CLASS } from './layout.js';
export type { LayoutSettings, SlotOptions, SlotSide } from './layout.js';

export {
  DEFAULT_LANGUAGE,
  DICTIONARIES,
  LANGUAGES,
  dictionary,
  hasLanguage,
  languages,
  phrase,
  phraseKeys,
  registerLanguage,
} from './i18n/index.js';
export type { Dictionary, Phrase } from './i18n/index.js';
export { PHRASE } from './i18n/keys.js';
export type { PhraseKey } from './i18n/keys.js';
