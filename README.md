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
```
