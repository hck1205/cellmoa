/**
 * What `afterChange` hands its handler, checked against the reference itself.
 *
 * `handsontable@18` is installed for the verification stories, so the contract
 * does not have to be recalled — it can be asked. It is asked here, in the same
 * test, so the two answers are produced by one run and cannot drift apart.
 *
 * jsdom lays nothing out and Handsontable wants two observers it does not have,
 * so both are stubbed. That is fine for this question: nothing here depends on
 * a measurement, only on which arguments a hook receives.
 */
import { describe, expect, it } from 'vitest';
import { makeGrid } from './helpers.js';
// @ts-expect-error - the verification package's copy, on purpose: there is one
// installed Handsontable in the repo and this is where it lives.
import Handsontable from '/home/user/cellmoa/packages/verification/node_modules/handsontable/base.mjs';
// @ts-expect-error - same
import { registerAllModules } from '/home/user/cellmoa/packages/verification/node_modules/handsontable/registry.mjs';

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** `[source, changes]` for every firing, from whichever grid. */
type Firing = [string, number | null];

function fromReference(): Firing[] {
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= NoopObserver;
  g.IntersectionObserver ??= NoopObserver;
  registerAllModules();
  const el = document.createElement('div');
  document.body.append(el);
  const seen: Firing[] = [];
  const hot = new Handsontable(el, {
    data: [['a']],
    licenseKey: 'non-commercial-and-evaluation',
    afterChange: (changes: unknown[] | null, source: string) =>
      seen.push([source, changes === null ? null : changes.length]),
  });
  hot.setDataAtCell(0, 0, 'b');
  return seen;
}

async function fromOurs(): Promise<Firing[]> {
  const seen: Firing[] = [];
  const grid = await makeGrid({
    data: [['a']],
    afterChange: (changes: unknown[] | null, source: string) =>
      seen.push([source, changes === null ? null : changes.length]),
  });
  grid.setDataAtCell(0, 0, 'b');
  return seen;
}

describe('afterChange, against the reference', () => {
  it('hands the load `null` and the edit an array, in both', async () => {
    // We used to send an array on the load: every cell of the default
    // five-by-five grid, twenty-four of them empty becoming empty. The usual
    // handler opens `if (!changes) return;` to skip exactly this firing, so
    // the guard never tripped and a load looked like twenty-five edits.
    expect(await fromOurs()).toEqual(fromReference());
    // Constructing a real Handsontable under jsdom takes a few seconds.
  }, 30_000);

  it('hands a hook passed as a setting its arguments, whatever its prefix', async () => {
    // The settings type declares only `after${string}`, but the reference takes
    // before* and modify* the same way and so, it turns out, do we.
    const order: string[] = [];
    const grid = await makeGrid({
      data: [['a']],
      beforeChange: () => order.push('before'),
      afterChange: (_c: unknown, source: string) => order.push(`after:${source}`),
      modifyColWidth: (width: number) => {
        order.push('modify');
        return width;
      },
    } as never);
    order.length = 0;
    grid.setDataAtCell(0, 0, 'b');
    expect(order).toEqual(['before', 'after:edit']);
    grid.getColWidth(0);
    expect(order).toContain('modify');
  });
});

describe('isEmptyRow and isEmptyCol as settings', () => {
  it('lets the caller decide what empty means', async () => {
    // The default asks whether every source value is `''`. A grid whose rows
    // carry an id is never empty by that rule; the reference lets the caller
    // answer instead, and now so does this.
    const grid = await makeGrid({
      data: [
        ['1', ''],
        ['2', 'x'],
      ],
      // Row 0 has an id in column 0, so the default would call it non-empty.
      isEmptyRow: (row: number) => row === 0,
      isEmptyCol: (col: number) => col === 1,
    } as never);
    expect(grid.isEmptyRow(0)).toBe(true);
    expect(grid.isEmptyRow(1)).toBe(false);
    expect(grid.isEmptyCol(1)).toBe(true);
    expect(grid.isEmptyCol(0)).toBe(false);
  });

  it('falls back to reading the cells when no function is given', async () => {
    const grid = await makeGrid({
      data: [
        ['', ''],
        ['a', ''],
      ],
    });
    expect(grid.isEmptyRow(0)).toBe(true);
    expect(grid.isEmptyRow(1)).toBe(false);
    expect(grid.isEmptyCol(1)).toBe(true);
  });
});
