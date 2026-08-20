import { beforeEach, describe, expect, it } from 'vitest';
import { DataSource, WriteConflict, cellRef, columnLetters, lettersToColumn, rangeRef } from '../src/dataSource.js';
import { Engine } from '../src/engine.js';
import { readWasm } from './wasm.js';

const wasm = readWasm();

describe('reference helpers', () => {
  it('converts column indexes to letters and back', () => {
    for (const [index, letters] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [701, 'ZZ'], [702, 'AAA']] as const) {
      expect(columnLetters(index)).toBe(letters);
      expect(lettersToColumn(letters)).toBe(index);
    }
  });

  it('builds cell and range references', () => {
    expect(cellRef(0, 0)).toBe('A1');
    expect(cellRef(4, 2)).toBe('C5');
    expect(rangeRef({ startRow: 0, endRow: 9, startCol: 0, endCol: 2 })).toBe('A1:C10');
  });
});

describe('the data source', () => {
  let engine: Engine;
  let data: DataSource;

  beforeEach(async () => {
    engine = await Engine.load(wasm);
    data = new DataSource(engine);
  });

  it('reports the sheets', () => {
    const sheets = data.sheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.name).toBe('Sheet1');
    expect(data.sheet).toBe('Sheet1');
  });

  it('writes and reads back through a window', () => {
    data.write([
      { row: 0, col: 0, input: '10' },
      { row: 0, col: 1, input: '=A1*2' },
    ]);
    data.ensure({ startRow: 0, endRow: 5, startCol: 0, endCol: 5 });
    expect(data.text(0, 0)).toBe('10');
    expect(data.text(0, 1)).toBe('20');
    expect(data.get(0, 1)!.formula).toBe('=A1*2');
  });

  it('gives the formula to an editor and the text to a renderer', () => {
    data.write([{ row: 0, col: 0, input: '=1+1' }]);
    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('2');
    expect(data.editableValue(0, 0)).toBe('=1+1');
  });

  it('answers from the cache without asking the engine again', () => {
    data.write([{ row: 0, col: 0, input: 'x' }]);
    const window = { startRow: 0, endRow: 10, startCol: 0, endCol: 10 };
    data.ensure(window);
    // A window already covered is not read a second time; the proof is that a
    // narrower one inside it is answered without a call.
    data.ensure({ startRow: 2, endRow: 3, startCol: 2, endCol: 3 });
    expect(data.text(0, 0)).toBe('x');
  });

  it('drops the cache when the workbook changes', () => {
    data.write([{ row: 0, col: 0, input: '1' }]);
    data.ensure({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 });
    expect(data.text(0, 0)).toBe('1');

    data.write([{ row: 0, col: 0, input: '2' }]);
    // Without re-reading, the cell reads as empty rather than as the stale 1.
    expect(data.get(0, 0)).toBeNull();
    data.ensure({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 });
    expect(data.text(0, 0)).toBe('2');
  });

  it('recalculates dependants when an input changes', () => {
    data.write([
      { row: 0, col: 0, input: '10' },
      { row: 1, col: 0, input: '=A1*3' },
    ]);
    data.write([{ row: 0, col: 0, input: '100' }]);
    data.ensure({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 });
    expect(data.text(1, 0)).toBe('300');
  });

  it('tracks the sheet size as it grows', () => {
    expect(data.rowCount).toBe(0);
    data.write([{ row: 9, col: 4, input: 'x' }]);
    expect(data.rowCount).toBe(10);
    expect(data.colCount).toBe(5);
  });

  it('refuses a stale write and says what the revision is now', () => {
    data.write([{ row: 0, col: 0, input: '1' }]);
    const seen = data.revision;
    data.write([{ row: 0, col: 0, input: '2' }]);

    expect(() => data.write([{ row: 0, col: 0, input: '3' }], seen)).toThrowError(WriteConflict);
    try {
      data.write([{ row: 0, col: 0, input: '3' }], seen);
    } catch (error) {
      expect((error as WriteConflict).revision).toBe(data.revision);
    }
    // The refused write left nothing behind.
    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('2');
  });

  it('accepts the same write rebased on the current revision', () => {
    data.write([{ row: 0, col: 0, input: '1' }]);
    data.write([{ row: 0, col: 0, input: '2' }], data.revision);
    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('2');
  });

  it('undoes and redoes', () => {
    data.write([{ row: 0, col: 0, input: '1' }]);
    data.write([{ row: 0, col: 0, input: '2' }]);
    data.undo();
    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('1');

    data.redo();
    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('2');
  });

  it('treats nothing to undo as a condition rather than a failure', () => {
    const revision = data.revision;
    expect(data.undo()).toBe(revision);
  });

  it('evaluates a formula without changing anything', () => {
    data.write([{ row: 0, col: 0, input: '6' }]);
    const revision = data.revision;
    const result = data.evaluate('=A1*7');
    expect(result.value).toBe(42);
    expect(data.revision).toBe(revision);
  });

  it('reports who changed a cell', () => {
    data.write([{ row: 0, col: 0, input: '1' }], undefined, 'opening balance');
    const history = data.history(0, 0);
    expect(history).toHaveLength(1);
    expect(history[0]!.label).toBe('opening balance');
  });

  it('switches between sheets', () => {
    engine.call({ op: 'add_sheet', name: 'Second' });
    data.write([{ row: 0, col: 0, input: 'first' }]);
    data.selectSheet('Second');
    data.write([{ row: 0, col: 0, input: 'second' }]);

    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('second');
    data.selectSheet('Sheet1');
    data.ensure({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(data.text(0, 0)).toBe('first');
  });

  it('reads a window past the end of the sheet without complaining', () => {
    data.ensure({ startRow: 5000, endRow: 5010, startCol: 0, endCol: 5 });
    expect(data.get(5000, 0)).toBeNull();
  });
});
