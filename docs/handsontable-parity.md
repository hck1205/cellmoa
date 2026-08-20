# Handsontable 기능 대조표

Handsontable 저장소(`handsontable/handsontable`)의 소스와 문서에서 직접 추출한 API 계약이다.
"가능한 똑같이"를 판정하려면 무엇이 전부인지부터 세어야 한다.

| 표면 | 개수 | 출처 |
|---|--:|---|
| 설정 옵션 | 162 | `src/dataMap/metaManager/metaSchema.ts` |
| 훅 | 253 | `src/core/hooks/constants.ts` |
| 코어 메서드 | 134 | `src/core.ts` |
| 플러그인 | 42 | `src/plugins/` |
| 셀 타입 | 13 | `src/cellTypes/` |

문서 가이드 섹션(`docs/content/guides/`)은 15개 기능 카테고리로 나뉜다:
접근성, 액세서리·메뉴, 셀 기능, 셀 함수, 셀 타입, 컬럼, 데이터 관리, 다이얼로그,
수식, 시작하기, 국제화, 내비게이션, 최적화, 행, 스타일링.

## 상태 표기

| 기호 | 의미 |
|:--:|---|
| ✅ | 구현 완료 (테스트 있음) |
| 🔨 | 구현 중 |
| ⬜ | 미착수 |
| ➕ | Handsontable에 없는 cellmoa 고유 기능 (VisiGrid 계열) |

---

## 플러그인 (42개)

| 플러그인 | 상태 | 비고 |
|---|:--:|---|
| `autoColumnSize` | ⬜ | |
| `autoRowSize` | ⬜ | |
| `autofill` | ⬜ | |
| `bindRowsWithHeaders` | ⬜ | |
| `collapsibleColumns` | ⬜ | |
| `columnSorting` | ⬜ | |
| `columnSummary` | ⬜ | |
| `comments` | ⬜ | |
| `contextMenu` | ⬜ | |
| `copyPaste` | ⬜ | |
| `customBorders` | ⬜ | |
| `dataProvider` | ⬜ | |
| `dialog` | ⬜ | |
| `dragToScroll` | ⬜ | |
| `dropdownMenu` | ⬜ | |
| `emptyDataState` | ⬜ | |
| `exportFile` | ⬜ | |
| `filters` | ⬜ | |
| `formulas` | ⬜ | |
| `hiddenColumns` | ⬜ | |
| `hiddenRows` | ⬜ | |
| `loading` | ⬜ | |
| `manualColumnFreeze` | ⬜ | |
| `manualColumnMove` | ⬜ | |
| `manualColumnResize` | ⬜ | |
| `manualResize` | ⬜ | |
| `manualRowMove` | ⬜ | |
| `manualRowResize` | ⬜ | |
| `mergeCells` | ⬜ | |
| `moveCells` | ⬜ | |
| `multiColumnSorting` | ⬜ | |
| `multipleSelectionHandles` | ⬜ | |
| `nestedHeaders` | ⬜ | |
| `nestedRows` | ⬜ | |
| `notification` | ⬜ | |
| `pagination` | ⬜ | |
| `search` | ⬜ | |
| `selectionHandles` | ⬜ | |
| `stretchColumns` | ⬜ | |
| `touchScroll` | ⬜ | |
| `trimRows` | ⬜ | |
| `undoRedo` | ⬜ | |

## 셀 타입 (13개)

| 타입 | 상태 |
|---|:--:|
| `autocomplete` | ✅ |
| `checkbox` | ✅ |
| `date` | ✅ |
| `dropdown` | ✅ |
| `handsontable` | ✅ |
| `intlDate` | ✅ |
| `intlTime` | ✅ |
| `multiSelect` | ✅ |
| `numeric` | ✅ |
| `password` | ✅ |
| `select` | ✅ |
| `text` | ✅ |
| `time` | ✅ |

### 셀 타입 상태

13종 모두 렌더러 구현. 에디터는 checkbox를 뺀 12종(체크박스는 타이핑이 아니라
토글이라 에디터가 없는 것이 정상). 검증기는 text/numeric/date/time/dropdown/
autocomplete/select/multiSelect 8종.

## 코어 (Handsontable 코어 메서드 134개 중)

| 영역 | 상태 | 비고 |
|---|:--:|---|
| 설정 계층 (global→table→column→cell) | ✅ | `MetaManager`, `cells` 함수 포함 |
| 훅 253개 | ✅ | 이름 전량 등록, `before*` veto 지원 |
| 인덱스 맵 (물리/시각/렌더) | ✅ | trim·hide·move·insert·remove |
| 데이터 읽기/쓰기 | ✅ | 창 단위 캐시, revision 가드 |
| 선택 (단일·범위·다중) | ✅ | |
| 가상 스크롤 + 4-pane 고정 | ✅ | |
| 키보드 (Handsontable 단축키표 전량) | ✅ | 이동·확장·엣지·Tab·Enter·Delete·undo |
| 편집 (열기·커밋·취소·검증) | ✅ | allowInvalid, 비동기 검증기 |
| 마우스 선택 (클릭·shift·ctrl) | ✅ | |
| 행/열 크기 (기본값 + 오버라이드) | ✅ | |
| 헤더 (배열·함수·기본 A1 표기) | ✅ | |
| batch / suspendRender | ✅ | |

## cellmoa 고유 기능 ➕

Handsontable에는 대응물이 없고 VisiGrid 축에서 가져오는 것들. 그리드가 이걸
노출해야 "둘 다 그린"이 성립한다.

| 기능 | 상태 | 비고 |
|---|:--:|---|
| 셀 provenance 표시 (누가·언제·왜) | ⬜ | 셀 우클릭 → 변경 이력 |
| 에이전트 편집 하이라이트 | ⬜ | 사람 편집과 시각적으로 구분 |
| 에이전트 변경만 undo | ⬜ | `undo(only_by)` |
| revision 충돌 표시 | ⬜ | 낙관적 동시성 거부를 UI로 |
| 워크북 fingerprint 표시 | ⬜ | 상태 표시줄 |
| verify 결과 오버레이 | ⬜ | 실패한 셀 표시 |
| diff 뷰 (두 버전 비교) | ⬜ | 변경 셀 강조 |

---

## 부록: 설정 옵션 전체 (162개)

`activeHeaderClassName` `allowEmpty` `allowHtml` `allowInsertColumn` `allowInsertRow` `allowInvalid`
`allowRemoveColumn` `allowRemoveRow` `ariaTags` `autoColumnSize` `autoRowSize` `autoWrapCol`
`autoWrapRow` `bindRowsWithHeaders` `cell` `cells` `checkedTemplate` `className`
`colHeaders` `colWidths` `collapsibleColumns` `columnHeaderHeight` `columnSorting` `columnSummary`
`columns` `commentedCellClassName` `comments` `contextMenu` `copyPaste` `copyable`
`currentColClassName` `currentHeaderClassName` `currentRowClassName` `customBorders` `customBordersProgressive` `data`
`dataDotNotation` `dataProvider` `dataSchema` `dateFormat` `defaultDate` `dialog`
`disableVisualSelection` `dragToScroll` `dropdownMenu` `editor` `emptyDataState` `enterBeginsEditing`
`enterCommits` `enterMoves` `exportFile` `fillHandle` `filter` `filterSelectedItems`
`filteringCaseSensitive` `filters` `fixedColumnsLeft` `fixedColumnsStart` `fixedRowsBottom` `fixedRowsTop`
`formulas` `fragmentSelection` `hashLength` `hashRevealDelay` `hashSymbol` `headerClassName`
`height` `hiddenColumns` `hiddenRows` `imeFastEdit` `initialState` `injectCoreCss`
`invalidCellClassName` `label` `language` `layout` `layoutDirection` `licenseKey`
`loading` `locale` `manualColumnFreeze` `manualColumnMove` `manualColumnResize` `manualRowMove`
`manualRowResize` `maxCols` `maxRows` `maxSelections` `mergeCells` `minCols`
`minRowHeights` `minRows` `minSpareCols` `minSpareRows` `moveCells` `multiColumnSorting`
`navigableHeaders` `nestedHeaders` `nestedRows` `noWordWrapClassName` `notification` `numericFormat`
`observeDOMVisibility` `outsideClickDeselects` `pagination` `parsePastedValue` `placeholder` `placeholderCellClassName`
`preserveNumericLiteral` `preventOverflow` `preventWheel` `readOnly` `readOnlyCellClassName` `renderAllColumns`
`renderAllRows` `renderer` `rowHeaderWidth` `rowHeaders` `rowHeights` `sanitizer`
`search` `searchInput` `selectOptions` `selectionHandles` `selectionMode` `skipColumnOnPaste`
`skipRowOnPaste` `sortByRelevance` `source` `sourceDataValidator` `sourceDataWarningMessage` `sourceSortFunction`
`startCols` `startRows` `stretchH` `strict` `tabMoves` `tabNavigation`
`tableClassName` `textEllipsis` `theme` `themeName` `timeFormat` `title`
`trimDropdown` `trimRows` `trimWhitespace` `type` `uncheckedTemplate` `undo`
`validator` `valueFormatter` `valueGetter` `valueParser` `valueSetter` `viewportColumnRenderingOffset`
`viewportColumnRenderingThreshold` `viewportRowRenderingOffset` `viewportRowRenderingThreshold` `visibleRows` `width` `wordWrap`

## 부록: 훅 전체 (253개)

`afterAddChild` `afterAutofill` `afterBeginEditing` `afterCellMetaReset` `afterChange` `afterColumnCollapse`
`afterColumnExpand` `afterColumnFreeze` `afterColumnMove` `afterColumnResize` `afterColumnSequenceCacheUpdate` `afterColumnSequenceChange`
`afterColumnSort` `afterColumnUnfreeze` `afterContextMenuDefaultOptions` `afterContextMenuHide` `afterContextMenuShow` `afterCopy`
`afterCopyLimit` `afterCreateCol` `afterCreateRow` `afterCustomBordersUpdate` `afterCut` `afterDataProviderFetch`
`afterDataProviderFetchAbort` `afterDataProviderFetchError` `afterDeselect` `afterDestroy` `afterDetachChild` `afterDialogFocus`
`afterDialogHide` `afterDialogShow` `afterDocumentKeyDown` `afterDrawSelection` `afterDropdownMenuDefaultOptions` `afterDropdownMenuHide`
`afterDropdownMenuShow` `afterEmptyDataStateHide` `afterEmptyDataStateShow` `afterFilter` `afterFormulasValuesUpdate` `afterGetCellMeta`
`afterGetColHeader` `afterGetColumnHeaderRenderers` `afterGetRowHeader` `afterGetRowHeaderRenderers` `afterHideColumns` `afterHideRows`
`afterInit` `afterLanguageChange` `afterListen` `afterLoadData` `afterLoadingHide` `afterLoadingShow`
`afterMergeCells` `afterModifyTransformEnd` `afterModifyTransformFocus` `afterModifyTransformStart` `afterMomentumScroll` `afterMoveCells`
`afterNamedExpressionAdded` `afterNamedExpressionRemoved` `afterNotificationHide` `afterNotificationShow` `afterOnCellContextMenu` `afterOnCellCornerDblClick`
`afterOnCellCornerMouseDown` `afterOnCellMouseDown` `afterOnCellMouseOut` `afterOnCellMouseOver` `afterOnCellMouseOverOutside` `afterOnCellMouseUp`
`afterOnSelectionEdgeMouseDown` `afterOnSelectionHandleMouseDown` `afterPageChange` `afterPageCounterVisibilityChange` `afterPageNavigationVisibilityChange` `afterPageSizeChange`
`afterPageSizeVisibilityChange` `afterPaste` `afterPluginsInitialized` `afterRedo` `afterRedoStackChange` `afterRefreshDimensions`
`afterRemoveCellMeta` `afterRemoveCol` `afterRemoveRow` `afterRender` `afterRenderer` `afterRowMove`
`afterRowResize` `afterRowSequenceCacheUpdate` `afterRowSequenceChange` `afterRowsMutation` `afterRowsMutationError` `afterScroll`
`afterScrollHorizontally` `afterScrollVertically` `afterSelectAll` `afterSelectColumns` `afterSelectRows` `afterSelection`
`afterSelectionByProp` `afterSelectionEnd` `afterSelectionEndByProp` `afterSelectionFocusSet` `afterSetCellMeta` `afterSetDataAtCell`
`afterSetDataAtRowProp` `afterSetSourceDataAtCell` `afterSetTheme` `afterSheetAdded` `afterSheetRemoved` `afterSheetRenamed`
`afterTrimRow` `afterUndo` `afterUndoStackChange` `afterUnhideColumns` `afterUnhideRows` `afterUnlisten`
`afterUnmergeCells` `afterUntrimRow` `afterUpdateData` `afterUpdateSettings` `afterValidate` `afterViewRender`
`afterViewportColumnCalculatorOverride` `afterViewportRowCalculatorOverride` `beforeAddChild` `beforeAlter` `beforeAutofill` `beforeBeginEditing`
`beforeCellAlignment` `beforeChange` `beforeChangeRender` `beforeColumnCollapse` `beforeColumnExpand` `beforeColumnFreeze`
`beforeColumnMove` `beforeColumnResize` `beforeColumnSort` `beforeColumnUnfreeze` `beforeColumnWrap` `beforeCompositionStart`
`beforeContextMenuSetItems` `beforeContextMenuShow` `beforeCopy` `beforeCreateCol` `beforeCreateRow` `beforeCut`
`beforeDataProviderFetch` `beforeDetachChild` `beforeDialogHide` `beforeDialogShow` `beforeDrawBorders` `beforeDropdownMenuSetItems`
`beforeDropdownMenuShow` `beforeEmptyDataStateHide` `beforeEmptyDataStateShow` `beforeFilter` `beforeGetCellMeta` `beforeHeightChange`
`beforeHideColumns` `beforeHideRows` `beforeHighlightingColumnHeader` `beforeHighlightingRowHeader` `beforeInit` `beforeInitWalkontable`
`beforeKeyDown` `beforeLanguageChange` `beforeLoadData` `beforeLoadingHide` `beforeLoadingShow` `beforeMergeCells`
`beforeMoveCells` `beforeNotificationHide` `beforeNotificationShow` `beforeOnCellContextMenu` `beforeOnCellMouseDown` `beforeOnCellMouseOut`
`beforeOnCellMouseOver` `beforeOnCellMouseOverOutside` `beforeOnCellMouseUp` `beforePageChange` `beforePageSizeChange` `beforePaste`
`beforeRedo` `beforeRedoStackChange` `beforeRefreshDimensions` `beforeRemoveCellClassNames` `beforeRemoveCellMeta` `beforeRemoveCol`
`beforeRemoveRow` `beforeRender` `beforeRenderer` `beforeRowMove` `beforeRowResize` `beforeRowWrap`
`beforeRowsMutation` `beforeSelectAll` `beforeSelectColumns` `beforeSelectRows` `beforeSelectionFocusSet` `beforeSelectionHighlightSet`
`beforeSetCellMeta` `beforeSetRangeEnd` `beforeSetRangeStart` `beforeSetRangeStartOnly` `beforeStretchingColumnWidth` `beforeTouchScroll`
`beforeTrimRow` `beforeUndo` `beforeUndoStackChange` `beforeUnhideColumns` `beforeUnhideRows` `beforeUnmergeCells`
`beforeUntrimRow` `beforeUpdateData` `beforeValidate` `beforeValueRender` `beforeViewRender` `beforeViewportScroll`
`beforeViewportScrollHorizontally` `beforeViewportScrollVertically` `beforeWidthChange` `construct` `dialogFocusNextElement` `dialogFocusPreviousElement`
`hasExternalDataSource` `init` `modifyAutoColumnSizeSeed` `modifyAutofillRange` `modifyColHeader` `modifyColWidth`
`modifyColumnHeaderHeight` `modifyColumnHeaderValue` `modifyCopyableRange` `modifyData` `modifyFiltersMultiSelectValue` `modifyFocusOnTabNavigation`
`modifyFocusedElement` `modifyGetCellCoords` `modifyGetCoordsElement` `modifyRowData` `modifyRowHeader` `modifyRowHeaderWidth`
`modifyRowHeight` `modifyRowHeightByOverlayName` `modifySinglePassLayout` `modifySourceData` `modifyTransformEnd` `modifyTransformFocus`
`modifyTransformStart`

## 부록: 코어 메서드 전체 (134개)

`addHook` `addHookOnce` `alter` `batch` `batchExecution` `batchRender`
`clear` `colToProp` `countColHeaders` `countCols` `countEmptyCols` `countEmptyRows`
`countRenderedCols` `countRenderedRows` `countRowHeaders` `countRows` `countSourceCols` `countSourceRows`
`countVisibleCols` `countVisibleRows` `deselectCell` `destroy` `destroyEditor` `emptySelectedCells`
`getActiveEditor` `getActiveSelectionLayerIndex` `getCell` `getCellEditor` `getCellMeta` `getCellMetaAtRow`
`getCellMetaTransient` `getCellRenderer` `getCellValidator` `getCellsMeta` `getColHeader` `getColWidth`
`getColumnMeta` `getCoords` `getCopyableData` `getCopyableSourceData` `getCopyableText` `getData`
`getDataAtCell` `getDataAtCol` `getDataAtProp` `getDataAtRow` `getDataAtRowProp` `getDataType`
`getDirectionFactor` `getFirstFullyVisibleColumn` `getFirstFullyVisibleRow` `getFirstPartiallyVisibleColumn` `getFirstPartiallyVisibleRow` `getFirstRenderedVisibleColumn`
`getFirstRenderedVisibleRow` `getFocusManager` `getFocusScopeManager` `getInitialColumnCount` `getInstance` `getLastFullyVisibleColumn`
`getLastFullyVisibleRow` `getLastPartiallyVisibleColumn` `getLastPartiallyVisibleRow` `getLastRenderedVisibleColumn` `getLastRenderedVisibleRow` `getLayoutManager`
`getPlugin` `getPluginName` `getRowHeader` `getRowHeight` `getSchema` `getSelected`
`getSelectedActive` `getSelectedLast` `getSelectedRange` `getSelectedRangeActive` `getSelectedRangeLast` `getSettings`
`getShortcutManager` `getSourceData` `getSourceDataArray` `getSourceDataAtCell` `getSourceDataAtCol` `getSourceDataAtRow`
`getTranslatedPhrase` `getValue` `hasColHeaders` `hasHook` `hasRowHeaders` `init`
`initIndexMappers` `isColumnModificationAllowed` `isEmptyCol` `isEmptyRow` `isExecutionSuspended` `isListening`
`isLtr` `isRenderSuspended` `isRtl` `listen` `loadData` `populateFromArray`
`propToCol` `refreshDimensions` `removeCellMeta` `removeHook` `render` `resumeExecution`
`resumeRender` `runHooks` `scrollToFocusedCell` `scrollViewportTo` `selectAll` `selectCell`
`selectCells` `selectColumns` `selectRows` `setCellMeta` `setCellMetaObject` `setDataAtCell`
`setDataAtRowProp` `setSourceDataAtCell` `spliceCellsMeta` `spliceCol` `spliceRow` `suspendExecution`
`suspendRender` `unlisten` `updateData` `updateSettings` `validateCell` `validateCells`
`validateColumns` `validateRows`
