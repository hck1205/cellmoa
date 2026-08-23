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
