# Examples

`budget.xlsx` is a small workbook used by the CI pipeline to demonstrate what a
spreadsheet becomes once it has a command line: something a build can fail on.

It is generated rather than checked in blind — regenerate it with

```
cargo run -p cellmoa-cli --example make_budget -- examples/budget.xlsx
```

The pipeline then runs three checks against it:

```
cellmoa calc examples/budget.xlsx
cellmoa verify examples/budget.xlsx --expect examples/budget.expect.json
cellmoa fingerprint examples/budget.xlsx      # compared with budget.fingerprint
```

`verify` fails the build when a number moves. `fingerprint` fails it when the
workbook changes at all, which is the check you want on a file that is supposed
to be stable — a rate table, a set of constants, a signed-off model.
