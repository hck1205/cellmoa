# 문서 149쪽 전수 감사

Handsontable 가이드 149쪽을 다섯 갈래로 나눠 전부 읽고, 각 주장을 코드에
대조했다. 판정 기준은 **"이름이 있는가"가 아니라 "실제로 읽히거나 호출되는가,
테스트가 있는가"**다. 이 저장소는 정확히 그 차이에 여러 번 당했다 —
선언만 된 설정, 문서용 인터페이스에만 있던 메서드, 엉뚱한 키를 읽던 검증기.

아래 file:line은 전부 확인된 것이다. 가장 무거운 것들은 내가 직접 다시
열어봤다.

## 요약

| | |
|---|---|
| 읽은 페이지 | 149 |
| 기능 페이지가 아닌 것 | 약 45 (마이그레이션 로그, 라이선스, 프레임워크 래퍼, HoT 자체 도구) |
| 고친 것 | 3 (아래 "이미 고침") |
| 남은 큰 구멍 | 아래 |

## 이미 고침

0. **선언적 설정이 동작하지 않았다** — 플러그인이 데이터보다 먼저 만들어져서,
   `onEnable`에서 한 번에 일을 끝내는 플러그인은 전부 빈 시트를 봤다.
   `pagination: { pageSize: 3 }`에 8행을 주면 6행이 보였고 합계는 비어 있었다.
   Ladle 스토리를 쓰다가 나왔다.
0. **숨긴 행/열이 화면에 그대로 있었다** — `renderableLength` 계열을 아무도
   읽지 않아 숨김이 내보내기와 수식에만 반영됐다.
0. **`getSourceData*`가 시각 인덱스였다** — 가이드대로 저장하면 정렬된
   순서에 잘린 행이 빠진 데이터가 저장됐다. 이제 물리 인덱스이고,
   그리드 내부는 `getEditableValue`(시각)를 쓴다.
1. **다이얼로그가 sanitizer를 건너뛰었다** — 실제 XSS 경로. HTML이 DOM에
   닿는 경로를 `sanitize.ts` 하나로 모으고, 문서대로 `(content, source)`
   시그니처로 맞췄다.
2. **`beforeChange`가 받은 배열이 버려졌다** — 항목 수정도 `null`로 부분
   취소도 무시되고 있었다. Handsontable 앱에서 가장 많이 쓰는 검증 훅이다.
3. **훅 158개가 발화 불가능** — `scripts/parity.mjs`가 이제 센다.

## 큰 구멍 (구현 안 됨)

### 1. 메뉴에 키보드가 없다
`menu.ts`에 `keydown` 리스너가 **0개**. Shift+F10, Ctrl+Shift+\\,
Shift+Alt+↓로 메뉴를 열 수 없고, 열린 뒤에도 화살표·Home/End·Enter·Escape가
아무것도 하지 않는다. 문서화된 단축키 60개 중 **25개가 미바인딩**.
키보드만 쓰는 사용자는 행 삽입도, 정렬도, 열 숨김도 할 수 없다.

### 2. 필터 UI가 없다
`plugins/filters.ts`는 220줄 전부 API다. DOM이 없다. 문서화된 키 5종
(`filter_by_condition`, `filter_by_value`, `filter_operators`,
`filter_action_bar`, `filter_by_condition2`)이 소스에 없고,
`ITEM.filter`(`menuItems.ts:52`)는 아무것도 가리키지 않는 이름이다.
번역(`Filters:labels.filterByValue` 등)은 21개 언어에 다 있는데 읽는 곳이 없다.

### 3. 드래그로 옮기거나 크기를 바꿀 수 없다
`manualResize.ts`와 `manualMove.ts`에 포인터 리스너가 **0개**. 네 플러그인
모두 프로그램 호출로만 동작한다. 대조표는 ✅였다.

### 4. 서버 데이터가 1페이지 이후로 연극이다
`DataProvider.setPage`/`setSort`/`setFilters`/`setPageSize`가 소스 어디에서도
호출되지 않는다. Pagination은 클라이언트에서 자르고, 정렬은 로드된 조각만
정렬한다. 컨텍스트 메뉴의 행 삽입/삭제도 프로바이더를 거치지 않는다.

### 5. 모듈 진입점이 없다
`package.json`이 노출하는 서브패스는 4개뿐이고 `registerAllModules` 계열이
전무하다. `src/plugins/index.ts`가 부수효과로 모든 플러그인을 등록하고
`"sideEffects": false`도 없어서, 라이브러리 전체가 쪼갤 수 없는 한 덩어리다.

## 조용히 틀리는 것 (더 위험한 쪽)

이름이 맞고 동작이 다르면 사용자는 알아채지 못한다.

| 무엇 | 문서 | 여기 | 증거 |
|---|---|---|---|
| 체크박스 클릭 | 마우스로 토글 | **리스너 없음** — 클릭해도 아무 일 없음 | `renderers.ts:139`, `.cm-checkbox` 리스너 0개 |
| RegExp 검증기 | "함수 또는 RegExp" | 조용히 무시하고 타입 검증기로 넘어감 | `grid.ts:2480-2487` |
| multiSelect | 고른 것 저장 | 검색 후 커밋하면 **고른 것이 사라짐** | `editors.ts:412-416` |
| `allowInvalid: false` | 에디터가 열린 채 남음 | 에디터를 닫고 입력을 버림 | `grid.ts:2199-2212` |
| flexible autocomplete | 커스텀 값 허용 | 모든 커스텀 값을 invalid로 표시 | `validators.ts:65` |
| 알림 옵션 | `variant`/`duration`/`position` | `type`/`timeout`을 읽음 — 심각한 오류가 4초 뒤 사라짐 | `notification.ts:66,97` |
| `layoutDirection: 'inherit'` (기본값) | 문서 `dir` 상속 | 항상 LTR | `grid.ts:1101` |
| 복사 한도 | 기본 `Infinity` (10.0부터) | 기본 1000, 초과분 조용히 잘림 | `copyPaste.ts:232` |
| `filters.filter()` | 자기 것만 | `untrim()` 무인자 — 다른 플러그인의 trim까지 날림 | `filters.ts:178` |
| `cells` 함수 | 다른 모든 옵션을 덮어씀 | `cell`/`setCellMeta`에 짐 | `metaManager.ts:136` |
| `collapsibleColumns` 배열형 | `row: -4` 위쪽 계산 | 음수는 절대 매칭 안 됨 | `collapsibleColumns.ts:96` |
| `nestedRows` | `__children` 데이터 | `__children`이 소스에 없음 | `nestedRows.ts:35` |
| CSV 내보내기 | `sanitizeValues` | 없음 — `=cmd\|'/c calc'!A1`이 살아서 나감 | `exportFile.ts:44` |
| 배열 수식 | `SEQUENCE`/`SORT`/`FILTER` | 전부 `#VALUE!` — 스필 없음 | `operand.rs:190` |

## 이름만 있는 설정 (선언되고 아무도 안 읽음)

`hiddenRows.copyPasteEnabled`, `columnSummary.forceNumeric`,
`columnSummary.suppressDataTypeErrors`, `dragToScroll.interval/rampDistance`,
`comments.style`, `comments.displayDelay`.

지운 것들은 그 뒤에 고쳐졌다 — `indicators`, `uiContainer`, `showPageSize`,
`columnSorting.indicator`, `pasteMode`, `autofill.direction`/`autoInsertRow`,
`dialog.animation`, 그리고 `alter()`의 v13 철자. 고쳐진 것을 목록에 남겨두는
것은 이 문서가 잡으려는 실패를 반대 방향으로 저지르는 것이다.

`PHRASE` 키 11개(`ok`, `cancel`, 테두리 6종, `readOnlyComment`,
`copyWithHeaders`, `copyHeadersOnly`)도 21개 언어에 번역이 다 있고 읽는 곳이
없다. `EmptyDataState:*` 7종도 마찬가지 — 플러그인이 영어를 하드코딩한다.

## 접근성

역할(role)은 나가는데 관계가 끊겨 있다. `role="grid"`가 루트 `<div>`에
있고 행은 `div[role=grid] > div.cm-pane > table > tbody > tr[role=row]`에
있어서, 중간의 `<table>`(암묵적 `role="table"`)이 grid→row 관계를 끊는다.
페인이 6개니 그런 테이블이 6개다. VPAT가 Handsontable에 대해 기록한
"Mixed table/ARIA semantics (Critical)"를 그대로 재현하고 있다.

`aria-selected` 0개, `aria-multiselectable` 0개, roving tabindex 없음,
`aria-sort` 없음, `aria-readonly` 없음, 그리드 이름(`aria-label`) 없음,
열 메뉴 버튼(`▾`)에 접근 가능한 이름 없음.

## 기능 페이지가 아닌 것

- `upgrade-and-migration` 30쪽 중 24쪽 — 릴리스 로그와 정책
- `technical-specification` 4쪽 — 라이선스, 지원 브라우저
- `ai-tools` 3쪽 — Handsontable 자체 웹사이트 도구
- 프레임워크 래퍼 9쪽 — React/Vue/Angular. 이 라이브러리는 `@cellmoa/grid`
  하나만 낸다. 범위 밖이 맞다.
- `tools-and-building` 6쪽 중 3쪽 — HoT 자체 빌드·CI

마이그레이션 페이지는 로그지만 **철자 변경은 검사 가능한 주장**이라
표본을 뽑아 확인했다. `fixedColumnsLeft`→`fixedColumnsStart`는 둘 다 받고,
`stretchH`도 둘 다 읽는다. `beforeRender`/`afterRender`는 옛 이름만 발화하고
새 이름(`beforeViewRender`/`afterViewRender`)은 죽어 있다.
