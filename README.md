# cellmoa

Handsontable + HyperFormula 급의 계산 엔진과, VisiGrid 급의 툴체인
(CLI · diff · verify · replay · provenance)을 하나로 합친 스프레드시트 라이브러리.

```
cargo run -p cellmoa-cli -- eval "SUMPRODUCT((A1:A9>5)*B1:B9)"
cargo run -p cellmoa-cli -- verify budget.xlsx --expect budget.expect.json
cargo run -p cellmoa-cli -- diff before.xlsx after.xlsx
```

## 무엇이 들어있나

| 크레이트 | 내용 |
|---|---|
| `cellmoa-core` | 문서 모델 · 값 · 참조 · revision · provenance 저널 · fingerprint |
| `cellmoa-formula` | Excel 호환 렉서 · 파서 · 왕복 가능한 AST |
| `cellmoa-engine` | 의존성 그래프 · 증분 재계산 · **411개 내장 함수** · verify |
| `cellmoa-xlsx` | ZIP·OOXML 자체 구현 XLSX import/export |
| `cellmoa-diff` | 행 정렬 기반 워크북 diff |
| `cellmoa-cli` | `cellmoa` 명령줄 |
| `cellmoa-mcp` | MCP 서버 (stdio · HTTP) |
| `cellmoa-wasm` | 브라우저용 C ABI 바인딩 |
| `cellmoa-api` | 셋이 공유하는 JSON 명령 표면 |

| 패키지 | 내용 |
|---|---|
| `packages/grid` | 웹 그리드 UI. Handsontable API 계약 전량 + provenance·diff·verify |

## 그리드

```
cd packages/grid && npm install && npm run build:wasm && npm run build
```

```ts
import { Engine, Grid } from '@cellmoa/grid';
import '@cellmoa/grid/style.css';

const engine = await Engine.load('/cellmoa_wasm.wasm');
const grid = new Grid(document.querySelector('#grid'), {
  engine,
  actor: { kind: 'human', id: 'you' },
  colHeaders: true,
  rowHeaders: true,
  contextMenu: true,
  columnSorting: true,
  filters: true,
  // Handsontable에 대응물이 없는 것들
  provenance: true,
  statusBar: true,
  diffView: true,
});
```

Handsontable의 API 계약 — 설정 162개 · 훅 253개 · 코어 메서드 134개 ·
플러그인 42개 · 셀 타입 13종 — 을 소스에서 추출해 전량 구현했다. 코드는 한 줄도
가져오지 않았다. 항목별 상태는 [대조표](docs/handsontable-parity.md).

브라우저에서 직접 만져 보려면 [`examples/grid/`](examples/grid/).

## 설계상 정한 것

**결정성이 기능이다.** `RAND()`는 셀 주소와 워크북 시드에서 값을 유도하고,
`TODAY()`/`NOW()`는 호스트가 시계를 주입해야 동작하며, XLSX 저장은 타임스탬프를
고정해 바이트가 동일하다. 이 셋 중 하나라도 어기면 replay도 fingerprint도
verify도 의미를 잃는다.

**모르는 것은 지우지 않는다.** 엔진이 모델링하지 않는 XLSX 파트(서식·테마)는
바이트 단위로 보존한다. 엔진에 의견이 없다는 이유로 사용자의 서식을 날리는 건
파일을 아예 못 여는 것보다 나쁜 실패다.

**Excel의 이상한 점까지 재현한다.** `-2^2 = 4`, `2^3^2 = 64`,
`ROUND(2.675,2) = 2.68`, 1900년 윤년 버그, `SUM(TRUE)=1`이지만 셀에 든 TRUE는
무시되는 비대칭 — 전부 테스트로 고정돼 있다.

## 현재 상태

[기능 매트릭스](docs/feature-matrix.md) — 레퍼런스 대비 무엇이 되고 무엇이 남았는지.

## 개발

```
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check

cd packages/grid && npm test && npm run typecheck
```
