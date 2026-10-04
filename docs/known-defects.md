# 알려진 결함

고치지 않은 채로 아는 것들. 병렬 리팩토링 중에 나왔고, 각각 **재현되었다** —
추측이 아니다. 고치지 않은 이유는 하나씩 적어뒀다. 이 목록이 있는 이유는
채팅 스크롤백이 저장소가 아니기 때문이다.

---

## 1. 행위자별 언두가 다른 행위자의 편집을 지운다

`Document::undo`의 주석은 사람이 에이전트의 편집만 되돌릴 수 있다고 말한다.
그렇지 않다.

```
agent  : A1 = 10
human  : A1 = 99
undo(에이전트로 한정)  →  A1 = Blank      // human의 99가 사라진다
```

저장된 역연산은 에이전트 커밋 **이전**의 상태이고, 그 뒤에 들어온 커밋에
맞춰 재배치되지 않는다. 기존 테스트는 서로 겹치지 않는 셀만 다룬다.

**왜 안 고쳤나.** 제대로 고치려면 operational transform이거나, 셀이 그
사이에 움직인 언두를 거부/건너뛰는 것이다. 둘 다 `undo`가 하는 일을
바꾼다 — 결정이 필요하다.

이건 이 라이브러리의 간판 기능이다. 우선순위가 가장 높다.

## 2. 삭제된 시트에 쓰면 성공했다고 답하고, 나중에 그 언두가 데이터를 지운다

`SetCell`을 tombstone된 시트에 적용하면 `Ok`와 새 리비전을 돌려주지만
`perform`은 그걸 버린다. 기록된 역연산은 `SetCell → Empty`다. 시트를
복구하고 그 유령 커밋을 언두하면, 쓴 적도 없는 셀이 비워진다.

**왜 안 고쳤나.** 쓰기를 `UnknownSheet`로 거부하면 지금 성공하는 호출이
모든 호출자에게 오류가 되고, no-op `Op` 변종을 추가하면 직렬화되는 저널
enum이 바뀐다.

## 3. `Engine::touched_by_undo`가 잘못된 커밋을 고른다

커밋을 거꾸로 훑어서 `Document::undo`가 무엇을 고를지 **다시 유도한다**.
순서를 벗어난 리두 뒤에는 언두 스택의 꼭대기가 마지막 비-언두 `Edit`이
아니므로, 엔진이 엉뚱한 셀을 새로 계산한다.

**한 줄이면 된다:** `doc.undoable().last()`가 이미 정확한 답을 준다.
`cellmoa-engine`에 있어서 그 에이전트의 담당이 아니었다.

## 4. 평평한 연산자 사슬이 스택을 넘긴다

```rust
let src = format!("1{}", "+1".repeat(5000));   // 약 10 KB
parse(&src).unwrap().to_string();              // 치명적: 스택 오버플로
```

파싱은 반복문이라 통과한다. 재귀는 `ast.rs`의 `impl Display for Expr`와
(더 크면) 파생된 `Drop`에 있다.

**왜 안 고쳤나.** 명시적 작업 목록으로 다시 쓰면 깔끔한 40줄 `match`가
상당히 나빠진다. 여기에 닿으려면 Excel 자신의 8192자 한도보다 긴 수식이
필요하므로 Excel이 쓴 `.xlsx`로는 불가능하지만, 손으로 만든 파일이나 API
직접 호출로는 가능하다. **수입 단계에서 수식 길이를 제한하는 쪽**이 더 나은
수정일 수 있다.

## 5. `SEARCH`가 Excel의 와일드카드를 무시한다

Excel의 `SEARCH`는 `?`와 `*`를 와일드카드로 본다. 여기서는 문자 그대로
찾으므로 `=SEARCH("?","abc")`가 `#VALUE!`인데 Excel은 `1`이다.

**왜 안 고쳤나.** 리팩토링보다 큰 변경이고, `functions/criteria.rs`에 이미
매처가 있으니 그걸 공유해야 한다.

## 6. `SEARCH`가 원본에 없는 위치를 답할 수 있다

소문자로 바꾼 문자열에서 위치를 재기 때문에, 소문자 형태가 더 긴 문자
(`İ` U+0130은 두 글자가 된다)가 있으면 그 뒤 위치가 전부 한 칸씩 밀린다.

**왜 안 고쳤나.** 기존 동작이고 원래 주석도 이 절충을 인정하고 있었다.
리팩토링에 끼워 동작을 바꾸지 않았다.

## 7. `Grid.alter`가 행을 지운 뒤 선택을 다시 가두지 않는다

`moveBy`를 고쳐서 키보드로는 되돌아올 수 있게 됐지만, 사용자가 움직이거나
클릭하기 전까지 하이라이트는 아무 데도 그려지지 않는다.

## 8. `CellRange.from`/`.to`가 `readonly` 뒤에서 변경 가능하다

`readonly` 바인딩이 가리키는 객체는 변경 가능하다. 호출자가
`getSelectedRangeLast().from.row = n`으로 살아 있는 선택을 바꿀 수 있다.
생성자는 입력은 복제하지만 출력은 복제하지 않는다.

---

## 참고: `cargo fmt`가 못 보던 것 — 고쳐졌다

`categories!` 매크로가 `pub mod`를 만들어내서 rustfmt이 함수 파일 11개로
내려가지 못했다. 선언을 매크로 밖으로 꺼내고, 매크로가 지키던 보장은
디렉터리를 읽는 테스트로 대신했다.

## The engine reads `$1,200.00` as text, not as 1200

Typing `$1,200.00` into Excel, Google Sheets or Handsontable stores the number
1200 and a currency format. cellmoa stores the string. `ISNUMBER` says FALSE
and `SUM` skips it.

Found while wiring `convert | calc` together: `convert --where 'Amount>1000'`
matches such a cell, because the filter strips `$` and `,` before comparing,
but `calc "=SUM(A:A)"` over the same column ignores it. Two parts of the same
tool disagreeing about whether a cell is a number is worse than either answer
on its own.

The filter is right for its job — it is reading a file someone exported, and
`$1,200.00` is what banks write. The gap is in `parse_input`, which decides
what a cell holds. Closing it means teaching that function currency symbols,
thousands separators, parenthesised negatives and trailing `%`, and attaching
the number format that Excel attaches, so a round trip through .xlsx does not
lose the formatting. That is an engine change with a wide blast radius — every
existing cell whose text happens to look like money would change meaning — so
it is written down here rather than done as a side effect of a CLI page.

Reproduce:

    printf '$1,200.00\n-500\n' | cellmoa calc "=SUM(A:A)" -f csv   # -500
    printf '1200\n-500\n'      | cellmoa calc "=SUM(A:A)" -f csv   # 700

## `dateFormat` and `numericFormat` take Intl options, not the reference's strings

Handsontable spells these the way its dependencies do: `dateFormat: 'YYYY-MM-DD'`
is a moment format string and `numericFormat: { pattern: '0,0.00' }` is a
numbro pattern. cellmoa reads both as Intl descriptors —
`{ year: 'numeric', month: '2-digit', day: '2-digit' }` and
`{ minimumFractionDigits: 2 }` — because the engine already carries Intl and
neither moment nor numbro is worth a dependency.

The cost is that a configuration copied from the reference does not fail. Both
options are accepted at settings time, so the grid draws, and the cell simply
renders unformatted — which reads as "the format option does nothing here"
rather than as "that spelling is a different library's".

Found while converting `Verification/Getting started/Demo` from a prose page
into a real side-by-side: the TypeScript types rejected the reference's own
documented spelling, which is how it surfaced at all. The story now passes both
spellings through to both grids so the difference is on screen.

Closing it means either accepting both shapes — sniffing a string as moment and
an object with `pattern` as numbro, and translating what is translatable — or
rejecting the foreign spelling loudly at settings time. The first is a real
translation layer with its own wrong answers at the edges; the second breaks
configurations that currently load. Neither is a change to make quietly.

## `moveRows`, `moveColumns`, `dragRows` and `dragColumns` do not exist

The manual move plugin's whole API is `moveIndexes(indexes, target)`. The
reference documents `moveRow`, `moveRows`, `dragRow`, `dragRows` and their
column equivalents, and none of them is defined anywhere in this library.

Two Ladle stories asserted otherwise — `Verification/Columns/ColumnMoving`
said "moveColumns() and dragColumns() work" and `Verification/Rows/RowMoving`
said "moveRows() and dragRows() both work". A story claiming a method works
when calling it does nothing is worse than the gap it was describing, because
the story is the thing a reader checks the claim against. Both notes are
corrected.

It surfaced from writing a test that called `moveRows`: `?.moveRows?.([0], 2)`
did nothing and reported nothing, because optional chaining over a method that
is not there is silent. `scripts/parity.mjs` did not catch it either — its
method list is the reference's *core* methods, and these live on a plugin.

Closing it is a small piece of work — the names are aliases over `moveIndexes`
with the row/column axis fixed — but `drag*` differs from `move*` in the
reference (drag counts the target as a drop position, move as a destination
index), so the two are not the same function under two names.

## There was no prettier configuration, so `prettier --write` rewrote 74 files

Running `npx prettier --write` over `packages/grid` reformatted the whole
package to prettier's defaults — double quotes throughout — because no config
existed anywhere in the repository. The codebase had been written to a
consistent style by hand, and nothing recorded what that style was.

It was noticed because `scripts/parity.mjs` reports `settings 0/0 read`
afterwards: it extracts the setting names with `/'([^']+)'/g`, and the names
were no longer in single quotes. A tool that reads source with a regex is the
canary for this, and it only sounded because the numbers went to zero rather
than to something plausible.

The reformatting was reverted rather than kept: a three-thousand-line diff of
quote characters would have buried the thirty-three-file change it was mixed
in with, and nobody reviewing it could have told the two apart.

No configuration was adopted, because none works. `printWidth: 100` leaves 37
files failing and wider settings leave more, so the package is simply not
prettier-formatted — it was written by hand to something close to but not the
same as prettier's output. A config that fails on 37 files is worse than none:
it reads as an invitation to run `--write` and get the churn again.
`packages/grid/.prettierignore` stops that mechanically instead.
`packages/verification` is genuinely prettier-formatted and is left alone.

## Two ARIA numbering defects, and a header row that was never drawn

Found by writing a tool that compares the *text* the two panels put in their
cells rather than only checking that both drew — `packages/verification/
divergence.mjs`. The first run reported 153 of 214 stories differing, which was
too many to be a coincidence and turned out to be one cause with three parts.

**`aria-rowindex` did not count the header row.** The header `<tr>` carried no
index at all, and the first data row said 1 where the reference says 2. The
attribute is one-based across every row of the table, headers included, so a
screen reader was announcing every row one lower than it is.

**`aria-colindex` did not count the header column.** Same shape: the row-header
`<th>` had no index and the first data cell claimed column 1. The reference
gives the header column 1 and starts the data at 2.

**`aria-rowcount` and `aria-colcount` were counted the other way**, so the
totals disagreed with the indexes beside them — a four-row table would tell a
screen reader "row 3 of 4" about its last row. Both now count the headers, and
the row and column header cells carry `scope`.

**A column that declares a `title` was not asking for a header row.**
`getColHeader` had handled `columns: [{ title: 'ID' }]` correctly all along;
`hasColHeaders` only ever looked at the `colHeaders` setting, so nothing asked
for a header row and the titles were computed into nowhere. The guide's Column
headers page configures exactly that shape, and our panel had been drawing no
header at all against a reference that draws five. `colHeaders: false` still
wins, because that is an instruction rather than an absence.

## A column declared `type: 'text'` still loses its leading zeros

    columns: [{ type: 'text' }]
    data: [['004821'], ['000093']]

draws `4821` and `93`. The reference draws them as written.

The engine's `parse_input` decides what a loaded string becomes, and a string
of digits becomes a number — which is right for a cell someone typed into and
wrong for a column that has declared it holds text. A leading apostrophe forces
text, but that is a convention for a person at a keyboard, not something a
`data` array carries.

The fix has a shape already: `Engine::apply_contents` writes literal contents
without reinterpreting them, added for `cellmoa fill`. The load path would
consult the column's `type` and use it for a text column instead of `set`. What
makes it more than a one-liner is deciding the scope — a `text` column is
clear, but `cells`/`cell` can set the type per cell, and the meta has to be
resolved before the data is written rather than after.

Found by `packages/verification/divergence.mjs`, which compares the values the
two panels show. It is the same family as the `$1,200.00` note above and a
worse case: there the column said nothing about its type, and here it says
exactly what it is and is not listened to.

## The same filename gets two answers from two commands

`cellmoa peek data.qqq` reads the file as CSV and prints it. `cellmoa diff
data.qqq other.csv --key a` refuses with `cannot tell the format of
"data.qqq" from its name; pass --from`. Same file, same CLI, two answers.

The leniency is deliberate and now says so at `commands/inspect.rs`: peek
shows a file, and a bad guess there costs a glance at a badly split table,
where the same guess in `convert` writes the mistake to disk. The reference
documents the extensions peek knows — `.csv`, `.tsv`, `.tab`, `.txt`,
`.xlsx`, `.ods`, `.sheet` — and says nothing about anything else, so the
fallback is our choice and not its rule.

What is left unresolved is that a user meets both behaviours without being
told which command is which. The options are to make peek refuse too (loses
a genuinely useful convenience), or to have it say on stderr that it guessed
— which is what it already does for `--sheet`, so there is a precedent in
the same command. The second is probably right; it is not done.

## Three names the reference declares and this does not

`scripts/api-audit.mjs` reads `handsontable@18`'s own `.d.ts` files — the copy
installed for the verification stories — and compares them with what this
grid has. As of writing:

| | present |
|---|---|
| `HotInstance` methods | 135 / 135 |
| `GridSettings` settings | 151 / 153 |
| hooks | 241 / 242 |

The three that are missing:

- **`afterChangesObserved`** — a hook. Adding the name is easy and would be
  worse than leaving it out: nothing here would fire it, so it would join
  the hooks that exist only as strings. It needs the change-observation it
  reports on before it means anything.
- **`handsontable`** — the settings object a `handsontable` cell type hands
  to the grid nested inside a cell. The cell type is registered; what is
  missing is the option that configures the inner grid.
- **`getValue`** — a cell-level function the reference calls to read a value
  in place of the cell's own, used by `columnSummary` and by the nested
  `handsontable` type.

Two of the three are the same feature, so the nested-grid cell type is the
one piece of the reference's API surface genuinely absent rather than
incomplete.

The audit was wrong four times before it was right, each time in the
flattering direction — every wrong version reported either no gap or a gap
that was not there. It read whole `.d.ts` files rather than one named
interface, and called four methods missing that Handsontable puts on
`GridHelperInstance` and `ViewportScrollerInstance`. It read our
`GridSettings` interface rather than `SETTING_NAMES`, and called eleven
settings missing that the grid has always read. It counted every hook as a
missing setting. And its first version matched nothing at all and reported
`0/0 present`, which looked like a pass. It now refuses to answer when a
parse returns fewer than twenty names.
