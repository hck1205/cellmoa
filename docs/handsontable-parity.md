# Handsontable 기능 대조표

Handsontable 저장소(`handsontable/handsontable`)의 소스와 문서에서 직접 추출한 API 계약이다.
"가능한 똑같이"를 판정하려면 무엇이 전부인지부터 세어야 한다.

| 표면 | 개수 | 출처 |
|---|--:|---|
| 설정 옵션 | 162 | `src/dataMap/metaManager/metaSchema.ts` |
| 훅 | 253 | `src/core/hooks/constants.ts` |
| 코어 메서드 | 146 | `src/core.ts` |
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
| `dataProvider` | ✅ | 읽기(`fetchRows`·abort·페이지·정렬·필터)와 쓰기(CRUD 3종·낙관적 반영·롤백·직렬화) |
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

## 코어 (Handsontable 코어 메서드 146개)

`node scripts/parity.mjs`가 이름 하나하나를 소스에서 찾아 센다. 아래 표는
영역별 요약이고, 숫자를 주장하는 것은 스크립트다.

```
methods   146/146 present  (0 named by the reference and missing)
```

### 이름은 같고 뜻이 다른 것

| 메서드 | 차이 |
|---|---|
| `getCell` | 여기서는 셀의 **값**을 돌려준다. `<td>` 엘리먼트는 `getCellElement`다. |

개수만 세면 이 차이가 묻힌다. 그래서 스크립트가 이 목록을 따로 출력한다.

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

## TypeScript 타입 (`tools-and-building/typescript-types`)

문서가 이름을 대는 타입 36개를 전부 내보낸다. `test/types.test-d.ts`가
36개를 하나하나 import하는데, 타입 표면은 그 방법으로만 확인할 수 있다 —
없는 이름은 컴파일 에러가 되고, 런타임에는 아무것도 알려주지 않는다.

대부분은 우리 타입에 참조 이름을 붙인 별칭이다(`HotInstance` = `Grid`,
`CellCoords` = `Coords`, `CellProperties` = `GridSettings`…). `src/types.ts`가
각각이 여기서 무엇인지, 그리고 **정말 다른 곳은 어디인지** 적어둔다:

| 타입 | 차이 |
|---|---|
| `CellValue` | `string`이다. 워크북은 텍스트를 담고 뜻은 엔진이 정한다 |
| `Events` | 훅 **이름**은 검사하고 인자는 검사하지 않는다. 253개 훅의 인자를 따로 타이핑하지 않았고, 타입이 그렇다고 말한다 |
| `OverlayType` | 6개다. 참조는 10개 |
| `CellMeta` / `CellProperties` | 같은 타입이다. `getCellMeta`가 매번 새 병합본을 주므로 변경 가능한 쪽이 따로 없다 |

### 테스트를 타입 검사한 적이 없었다

`tsconfig.json`의 `include`가 `src`뿐이어서 `test/`는 한 번도 타입
검사를 받지 않았다. `tsconfig.test.json`을 추가하고 `npm test`가 그것을
먼저 돌리게 했다. 처음 돌리자 36개가 나왔고, 그중 다섯은 **공개 타입이
구현과 모순되는 것**이었다 — 아래 커밋 참고.

## 배치 (`optimization/batch-operations`)

문서는 "렌더링"과 "실행"을 구분한다. 실행은 **그리기가 아닌 모든 것** —
여기서는 인덱스 맵과 그리드 범위를 데이터에 맞추는 일이다.

| 메서드 | 그리기 | 실행 |
|---|:--:|:--:|
| `batchRender` / `suspendRender` · `resumeRender` | 보류 | 그때그때 |
| `batchExecution` / `suspendExecution` · `resumeExecution` | 그때그때 | 보류 |
| `batch` | 보류 | 보류 |

`suspendRender`를 5번 부르면 `resumeRender`도 5번 불러야 한다. 두 카운터는
서로 독립이다 — 예전에는 `suspendExecution`이 `suspendRender`를 부르는
별칭이어서 `batchExecution`이 그리기까지 막았고, `isExecutionSuspended()`가
그리기만 멈춘 상태에서도 참을 답했다.

## 플러그인 생명주기 (`tools-and-building/custom-plugins`)

`isEnabled` → `enablePlugin` → (`updatePlugin`)* → `disablePlugin` → `destroy`.
Handsontable와 같은 순서라서 그쪽에 맞춰 쓴 플러그인이 그대로 옮겨온다.

| 항목 | 여기 | 참조 |
|---|---|---|
| 플러그인 이름 | `static pluginName` | `static get PLUGIN_KEY()` |
| 갱신 대상 설정 | `static get settingKeys()` | `static get SETTING_KEYS()` |
| 그리드 참조 | `this.grid` | `this.hot` |
| 훅 등록 (자동 해제) | `this.addHook` | `this.addHook` |
| DOM 리스너 (자동 해제) | `this.listen` | `this.eventManager` |

`settingKeys`의 기본값은 참조와 같이 `[pluginName]` — 자기 설정이 페이로드에
없으면 그 플러그인은 건드리지 않는다. 참조를 따라 다르게 선언한 것들:

| 플러그인 | `settingKeys` | 이유 |
|---|---|---|
| `undoRedo` | `['undo']` | 설정 이름이 플러그인 이름과 다르다 |
| `copyPaste` | `+ fragmentSelection` | 선택을 복사할 수 있는지를 그게 정한다 |
| `collapsibleColumns` | `+ nestedHeaders` | 접을 그룹이 거기서 나온다 |
| `customBorders` | `+ customBordersProgressive` | 그리는 방식이 바뀐다 |
| `dataProvider` | `+ 충돌 설정 4종` | 그중 하나가 켜지면 비활성이 되어야 한다 |
| `autoColumnSize` · `autoRowSize` · `stretchColumns` · `touchScroll` | `true` | 설정 전반에 의존한다 |

## 서버 데이터 (`dataProvider`)

문서 5쪽(개요·설정·CRUD·페칭·마이그레이션)의 계약을 그대로 구현했다.

| 항목 | 상태 |
|---|:--:|
| `fetchRows(query, { signal })` · 앞선 요청 abort | ✅ |
| `rowId` (열 이름 또는 함수) | ✅ |
| `onRowsCreate` / `onRowsUpdate` / `onRowsRemove` | ✅ |
| 낙관적 반영 → 서버 거부 시 롤백 | ✅ |
| 검증기 실패 시 전송 안 함 + 롤백 | ✅ |
| `beforeRowsMutation` veto · `afterRowsMutation(Error)` | ✅ |
| 뮤테이션 직렬화 (서버가 보는 순서 = 사용자 순서) | ✅ |
| 성공 후 `skipLoading` 재조회 | ✅ |
| `page`/`pageSize`를 Pagination에서 가져옴 | ✅ |
| `modifyRowHeader` 전역 행 번호 | ✅ |
| 충돌 설정 4종(`trimRows`·`manualRowMove`·`manualColumnMove`·`multiColumnSorting`) 시 비활성 + 경고 | ✅ |
| Notification 오류 토스트 + **Refetch** 버튼 | ✅ |
| `fetchData` · `getQueryParameters` · `getRowId` · `createRows` · `updateRows` · `removeRows` | ✅ |

### 하나 다른 것: 언두 스택

Handsontable은 `onRowsUpdate`가 있으면 일부 편집 소스를 **로컬 언두 스택에
쌓지 않는다** — 클라이언트 언두가 서버 데이터와 싸우지 않게 하려는 것이다.

여기에는 로컬 언두 스택이 없다. 언두는 엔진 저널을 되짚는다(그래서 행위자별
언두가 가능하다). 쌓지 않을 스택이 없으므로 이 규칙은 구현할 대상이 없다.
비워둔 것이 아니라 해당 사항이 없는 것이고, 그 차이를 적어둔다.

## 설정 162개

이름만 있고 아무 동작도 안 하는 설정이 없는지는 `node scripts/parity.mjs`가
센다. 대조표가 코드보다 더 주장하지 못하게 하려는 것이다 — 설정은 선언되고
타입이 붙고 export까지 되면서 읽히지 않을 수 있고, 그 상태로 "162개 지원"이라고
적으면 거짓이 된다.

```
$ node scripts/parity.mjs
settings  162/162 read  (0 declared but never consulted)
```

이 중 넷은 *동작*이 아니라 *답변*이다. 조용히 무시하면 호출자가 뭔가 되고 있다고
믿게 되므로, 한 번 말하고 넘어간다.

| 설정 | 답변 |
|---|---|
| `licenseKey` | cellmoa는 키가 필요 없다. Handsontable 설정을 그대로 써도 되도록 받되 무시한다고 알린다 |
| `formulas: false` | 엔진이 플러그인이 아니라 내장이라 이걸로 꺼지지 않는다 |
| `dataSchema` · `dataDotNotation` | 객체 배열 데이터 소스의 모양을 describe하는 설정이다. 워크북은 셀을 주소로 다루지 키로 다루지 않는다 — `valueGetter`/`valueSetter`로 매핑하라고 알린다 |

## 문서 가이드 섹션 (플러그인 밖)

| 섹션 | 상태 | 비고 |
|---|:--:|---|
| 접근성 (`ariaTags`, 역할·인덱스) | ✅ | `role="grid"`/`row`/`gridcell`/`columnheader`, `aria-rowindex`·`aria-colindex`는 창이 아니라 표 전체 기준 |
| 국제화 — 언어 (`language`) | ✅ | Handsontable 언어 파일 21종 · 구문 108개를 소스에서 추출. 빠진 키는 en-US로 메움 |
| 국제화 — 로케일 (`locale`) | ✅ | 언어와 분리. 영어 UI + 독일식 숫자 서식이 가능해야 함 |
| 국제화 — 레이아웃 방향 (`layoutDirection`) | ✅ | `dir` + 화살표 키 좌우 반전 (화살표는 데이터가 아니라 화면 기준) |
| 스타일링 — 테마 (`themes`) | ✅ | `main`·`horizon`·`classic` 3종, 각각 light/dark. Theme API(`registerTheme().setColorScheme().setDensityType()`)와 CSS 클래스 양쪽 |
| 스타일링 — 테마 커스터마이즈 | ✅ | `--ht-*` CSS 변수. 테마는 스타일시트가 아니라 변수 묶음이라 색 하나만 덮어쓸 수 있음 |
| 스타일링 — 밀도 | ✅ | `compact`/`default`/`comfortable`. 행 높이는 *배율*이라 caller가 정한 높이를 버리지 않음 |
| 행 — 여분 행 (`minSpareRows`/`Cols`) | ✅ | 데이터 기준으로 계산 — 아니면 렌더마다 한 줄씩 늘어남 |
| 보안 (`allowHtml`, `sanitizer`) | ✅ | 기본은 텍스트. HTML 허용 시 sanitizer를 통과 |
| 최적화 — batch / suspendRender | ✅ | |
| 내비게이션 — 단축키 · 검색 | ✅ | `ShortcutManager`, `search` 플러그인 |
| 데이터 관리 — 서버 데이터 | ✅ | `dataProvider` 플러그인 (아래 참고) |
| 셀 기능 — 조건부 서식 | ✅ | `cells` 함수 (Handsontable과 동일한 방식) |
| 셀 기능 — 숫자 서식 (`numericFormat`) | ✅ | `Intl.NumberFormat`. 숫자가 아닌 값은 건드리지 않음 |
| 내비게이션 — 헤더 이동 (`navigableHeaders`) | ✅ | 헤더는 인덱스 -1 |
| 내비게이션 — 포커스 범위 (`tabNavigation`) | ✅ | 끄면 Tab이 브라우저로 넘어감 (폼 안의 그리드) |
| 국제화 — IME (`imeFastEdit`) | ✅ | 조합 중 키는 에디터에 심지 않고 빈 에디터를 엶 |
| 액세서리 — 레이아웃 슬롯 (`layout`, `getLayoutManager`) | ✅ | top / grid / bottom / overlay. 상태 표시줄과 페이저가 슬롯에 들어감 |
| 액세서리 — 아이콘 팩 | — | Handsontable에서도 라이브러리 기능이 아니라 별도 SVG 배포물 |

## cellmoa 고유 기능 ➕

Handsontable에는 대응물이 없고 VisiGrid 축에서 가져오는 것들. 그리드가 이걸
노출해야 "둘 다 그린"이 성립한다.

| 기능 | 상태 | 비고 |
|---|:--:|---|
| 셀 provenance 표시 (누가·언제·왜) | ✅ | `provenance` 플러그인. 컨텍스트 메뉴 "이 값은 어디서 왔나?". 마커는 창 단위 `actors` 한 번으로 채움 |
| 에이전트 편집 하이라이트 | ✅ | `.cm-by-agent` — 사람이 고치면 표시가 사라짐 |
| 에이전트 변경만 undo | ✅ | 컨텍스트 메뉴 "에이전트 변경 되돌리기" + `undoRedo.undoBy()` |
| revision 충돌 표시 | ✅ | `conflicts` 플러그인 — 거부된 쓰기를 알림으로 |
| 워크북 fingerprint 표시 | ✅ | `statusBar` 플러그인 — revision · 선택 · 세 가지 digest |
| verify 결과 오버레이 | ✅ | `verifyOverlay` 플러그인 |
| diff 뷰 (두 버전 비교) | ✅ | `diffView` 플러그인 + `snapshot`/`diff` 명령 |

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

## 부록: 코어 메서드 전체 (146개)

`addHook` `addHookOnce` `alter` `batch` `batchExecution` `batchRender`
`clear` `colToProp` `countColHeaders` `countCols` `countEmptyCols` `countEmptyRows`
`countRenderedCols` `countRenderedRows` `countRowHeaders` `countRows` `countSourceCols` `countSourceRows`
`countVisibleCols` `countVisibleRows` `deselectCell` `destroy` `destroyEditor` `emptySelectedCells`
`getActiveEditor` `getActiveSelectionLayerIndex` `getCell` `getCellEditor` `getCellMeta` `getCellMetaAtRow`
`getCellMetaTransient` `getCellRenderer` `getCellValidator` `getCellsMeta` `getColHeader` `getColWidth`
`getColumnMeta` `getCoords` `getCopyableData` `getCopyableSourceData` `getCopyableText` `getCurrentThemeName`
`getData` `getDataAtCell` `getDataAtCol` `getDataAtProp` `getDataAtRow` `getDataAtRowProp`
`getDataType` `getDirectionFactor` `getFirstFullyVisibleColumn` `getFirstFullyVisibleRow` `getFirstPartiallyVisibleColumn` `getFirstPartiallyVisibleRow`
`getFirstRenderedVisibleColumn` `getFirstRenderedVisibleRow` `getFocusManager` `getFocusScopeManager` `getInitialColumnCount` `getInstance`
`getLastFullyVisibleColumn` `getLastFullyVisibleRow` `getLastPartiallyVisibleColumn` `getLastPartiallyVisibleRow` `getLastRenderedVisibleColumn` `getLastRenderedVisibleRow`
`getLayoutManager` `getPlugin` `getPluginName` `getPluginsNames` `getRowHeader` `getRowHeight`
`getSchema` `getSelected` `getSelectedActive` `getSelectedLast` `getSelectedRange` `getSelectedRangeActive`
`getSelectedRangeLast` `getSettings` `getShortcutManager` `getSourceData` `getSourceDataArray` `getSourceDataAtCell`
`getSourceDataAtCol` `getSourceDataAtRow` `getTableHeight` `getTableWidth` `getTranslatedPhrase` `getValue`
`hasColHeaders` `hasHook` `hasRowHeaders` `init` `initIndexMappers` `isColumnModificationAllowed`
`isEmptyCol` `isEmptyRow` `isExecutionSuspended` `isListening` `isLtr` `isRenderSuspended`
`isRtl` `listen` `loadData` `populateFromArray` `propToCol` `refreshDimensions`
`registerAllShortcutContexts` `removeCellMeta` `removeHook` `render` `resumeExecution` `resumeRender`
`runHooks` `scrollToFocusedCell` `scrollViewportTo` `selectAll` `selectCell` `selectCells`
`selectColumns` `selectRows` `setCellMeta` `setCellMetaObject` `setDataAtCell` `setDataAtRowProp`
`setSourceDataAtCell` `spliceCellsMeta` `spliceCol` `spliceRow` `suspendExecution` `suspendRender`
`toHTML` `toPhysicalColumn` `toPhysicalRow` `toTableElement` `toVisualColumn` `toVisualRow`
`unlisten` `updateData` `updateSettings` `useTheme` `validateCell` `validateCells`
`validateColumns` `validateRows`
