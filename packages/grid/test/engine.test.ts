import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, EngineError } from '../src/engine.js';
import { readWasm } from './wasm.js';

const wasm = readWasm();

describe('the engine bridge', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await Engine.load(wasm);
  });

  it('reports its version', () => {
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('writes and reads cells', () => {
    engine.call({
      op: 'write',
      cells: [
        { cell: 'A1', input: '10' },
        { cell: 'B1', input: '=A1*2' },
      ],
    });
    const cells = engine.call({ op: 'read', range: 'A1:B1' }).cells as Array<Record<string, unknown>>;
    expect(cells).toHaveLength(2);
    expect(cells[1]!.text).toBe('20');
    expect(cells[1]!.formula).toBe('=A1*2');
  });

  it('carries a revision on every response', () => {
    const before = engine.call({ op: 'sheets' }).revision!;
    const after = engine.call({ op: 'write', cells: [{ cell: 'C1', input: '1' }] }).revision!;
    expect(after).toBe(before + 1);
  });

  it('throws an EngineError with a code when a command is refused', () => {
    expect(() => engine.call({ op: 'read', range: 'not a range' })).toThrowError(EngineError);
    try {
      engine.call({ op: 'read', range: 'not a range' });
    } catch (error) {
      expect((error as EngineError).code).toBe('bad_range');
    }
  });

  it('returns a refusal rather than throwing when asked to send', () => {
    const response = engine.send({ op: 'nonsense' });
    expect(response.ok).toBe(false);
    expect(typeof response.code).toBe('string');
  });

  it('handles text outside the ASCII range', () => {
    engine.call({ op: 'write', cells: [{ cell: 'A5', input: '한국어 🎉' }] });
    const cells = engine.call({ op: 'read', range: 'A5' }).cells as Array<Record<string, unknown>>;
    expect(cells[0]!.text).toBe('한국어 🎉');
  });

  it('survives a payload large enough to grow the heap', () => {
    // A write big enough that the allocation moves the heap: a view taken
    // before the allocation would be detached by now.
    const cells = Array.from({ length: 5000 }, (_, i) => ({
      cell: `A${i + 100}`,
      input: `row ${i} ${'x'.repeat(50)}`,
    }));
    expect(engine.call({ op: 'write', cells }).written).toBe(5000);
    const read = engine.call({ op: 'read', range: 'A5099' }).cells as Array<Record<string, unknown>>;
    expect(read[0]!.text).toContain('row 4999');
  });

  it('saves and reopens a workbook as bytes', async () => {
    const source = await Engine.load(wasm);
    source.call({ op: 'write', cells: [{ cell: 'A1', input: '=6*7' }] });
    const bytes = source.save();
    expect(bytes.length).toBeGreaterThan(0);

    const target = await Engine.load(wasm);
    expect(target.open(bytes).ok).toBe(true);
    const cells = target.call({ op: 'read', range: 'A1' }).cells as Array<Record<string, unknown>>;
    expect(cells[0]!.text).toBe('42');
    source.close();
    target.close();
  });

  it('reports a file it cannot open rather than trapping', async () => {
    const other = await Engine.load(wasm);
    const response = other.open(new TextEncoder().encode('not a workbook'));
    expect(response.ok).toBe(false);
    expect(response.code).toBe('cannot_open');
    other.close();
  });

  it('refuses to be used after it is closed', async () => {
    const other = await Engine.load(wasm);
    other.close();
    expect(() => other.send({ op: 'sheets' })).toThrowError(/closed/);
    // Closing twice is harmless.
    other.close();
  });
});
