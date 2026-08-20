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
| `autoColumnSize` | ✅ | |
| `autoRowSize` | ✅ | |
| `autofill` | ✅ | 수식은 상대 참조를 이동시켜 채움 ➕ |
| `bindRowsWithHeaders` | ✅ | 헤더가 위치가 아니라 행에 붙음 |
| `collapsibleColumns` | ✅ | 접기는 숨김일 뿐 — 수식은 계속 그 열을 읽음 |
| `columnSorting` | ✅ | |
| `columnSummary` | ✅ | 고정된 숫자가 아니라 수식을 씀 — 위 값이 바뀌면 따라감 ➕ |
| `comments` | ✅ | 주석은 셀 메타에만 저장 — 워크북/수식에 영향 없음 |
| `contextMenu` | ✅ | 항목 키는 Handsontable과 동일. 켜져 있는 플러그인의 명령만 나타남. "에이전트 변경 되돌리기" 추가 ➕ |
| `copyPaste` | ✅ | `text/plain` + `text/html` 양쪽 기록. 자기 복사본 붙여넣기는 수식 참조 이동 ➕ |
| `customBorders` | ✅ | 테두리는 셀 메타 — 수식이 읽는 값은 그대로 |
| `dataProvider` | ✅ | 정렬·필터·페이지를 질의로 서버에 보냄. 늦게 온 응답은 버림 |
| `dialog` | ✅ | 모달 — 열려 있는 동안 키보드가 셀에 닿지 않음 |
| `dragToScroll` | ✅ | 경계 밖으로 나간 만큼만 스크롤 |
| `dropdownMenu` | ✅ | 열 헤더 버튼. contextMenu와 메뉴 위젯 공유 |
| `emptyDataState` | ✅ | 빈 표와 필터가 비운 표를 구분해서 말함 |
| `exportFile` | ✅ | CSV는 화면 값으로, `.xlsx`는 엔진이 직접 (수식·스타일 보존) ➕ |
| `filters` | ✅ | |
| `formulas` | ✅ | 엔진 내장 (플러그인이 아니라 일급) |
| `hiddenColumns` | ✅ | |
| `hiddenRows` | ✅ | |
| `loading` | ✅ | 참조 카운트 — 먼저 끝난 작업이 나중 작업의 오버레이를 걷어가지 않음 |
| `manualColumnFreeze` | ✅ | |
| `manualColumnMove` | ✅ | |
| `manualColumnResize` | ✅ | |
| `manualResize` | ✅ | Handsontable에서도 등록된 플러그인이 아니라 공유 유틸 디렉터리. 여기서는 공유 기반 클래스 + `manualResize: true` 축약 |
| `manualRowMove` | ✅ | |
| `manualRowResize` | ✅ | |
| `mergeCells` | ✅ | 코너 셀만 값 유지, 나머지는 비움 |
| `moveCells` | ✅ | 이동은 참조를 그대로 두고, 복사 드래그만 옮김 ➕ |
| `multiColumnSorting` | ✅ | |
| `multipleSelectionHandles` | ✅ | 양끝 핸들 — 손가락으로는 shift-클릭을 못 하니까 |
| `nestedHeaders` | ✅ | 뷰가 헤더를 다단으로 그림 |
| `nestedRows` | ✅ | 접기는 trim일 뿐 — 접힌 행을 읽는 수식은 계속 읽음 |
| `notification` | ✅ | 메시지마다 id. 서로 밀어내지 않고 쌓임 |
| `pagination` | ✅ | 페이지 밖 행은 trim. 값은 워크북에 그대로 |
| `search` | ✅ | 표시된 값을 검색 (수식 결과 기준) |
| `selectionHandles` | ✅ | 채우기는 autofill에 위임 — 채우기의 뜻은 한 군데에만 있어야 함 |
| `stretchColumns` | ✅ | `last` / `all`. 늘린 결과가 아니라 원래 너비에서 계산 |
| `touchScroll` | ✅ | |
| `trimRows` | ✅ | |
| `undoRedo` | ✅ | 엔진 저널 기반. 액터별 undo/redo 가능 ➕. `clear()`는 감사 추적을 지울 수 없으므로 예외를 던짐 |

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
