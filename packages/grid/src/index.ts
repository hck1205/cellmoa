/**
 * A spreadsheet grid for the web, on the cellmoa engine.
 */

export { Engine, EngineError } from './engine.js';
export type { EngineResponse, WasmSource } from './engine.js';

export { Grid } from './grid.js';
export type { CellChange, ChangeSource, GridOptions } from './grid.js';

export { DataSource, WriteConflict, cellRef, columnLetters, lettersToColumn, rangeRef } from './dataSource.js';
export type { Edit, SheetInfo, Window } from './dataSource.js';

export { Hooks, HOOK_NAMES, isHookName } from './hooks.js';
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

export { SizeMap } from './sizes.js';
export { View } from './view.js';
export type { CellRenderContext, ViewModel, Viewport } from './view.js';
