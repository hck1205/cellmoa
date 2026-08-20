import { describe, expect, it } from 'vitest';
import { mountGrid } from './helpers.js';

/**
 * What a render costs the engine.
 *
 * A plugin that decorates cells is handed one cell at a time, so the tempting
 * shape is to ask the engine about that cell — which turns one frame into one
 * round trip per visible cell. This is the test that says no.
 */
describe('the render path', () => {
  it('asks the engine a fixed number of times however many cells are drawn', async () => {
    const small = await mountGrid({ startRows: 4, startCols: 3, provenance: true });
    small.grid.setDataAtCell(0, 0, 'x');
    const large = await mountGrid({ startRows: 400, startCols: 40, provenance: true });
    large.grid.setDataAtCell(0, 0, 'x');

    const count = (mounted: Awaited<ReturnType<typeof mountGrid>>): number => {
      let calls = 0;
      const send = mounted.engine.send.bind(mounted.engine);
      (mounted.engine as unknown as { send: typeof send }).send = (request: object) => {
        calls += 1;
        return send(request);
      };
      mounted.grid.render();
      return calls;
    };

    // The window is what is drawn, so a taller sheet is not a longer render.
    expect(count(large)).toBe(count(small));
    expect(count(small)).toBeLessThanOrEqual(2);
  });

  it('still marks the cell an agent touched', async () => {
    const first = await mountGrid({ startRows: 4, startCols: 3, provenance: true });
    const second = await mountGrid({
      engine: first.engine,
      startRows: 4,
      startCols: 3,
      provenance: true,
      actor: { kind: 'agent', id: 'assistant' },
    });
    second.grid.setDataAtCell(1, 1, 'from the agent');
    expect(second.grid.view?.elementAt(1, 1)?.classList.contains('cm-by-agent')).toBe(true);
    expect(second.grid.view?.elementAt(0, 0)?.classList.contains('cm-by-agent')).toBe(false);
  });

  it('marks the row a sorted value is on now, not the row it came from', async () => {
    const person = await mountGrid({ startRows: 3, startCols: 2, columnSorting: true });
    person.grid.setDataAtCells([
      [0, 0, 'c'],
      [1, 0, 'a'],
      [2, 0, 'b'],
    ]);
    const agent = await mountGrid({
      engine: person.engine,
      startRows: 3,
      startCols: 2,
      provenance: true,
      columnSorting: true,
      actor: { kind: 'agent', id: 'assistant' },
    });
    agent.grid.setDataAtCell(2, 0, 'z');

    const sorting = agent.grid.getPlugin('columnSorting') as unknown as {
      sort(config: { column: number; sortOrder: 'asc' | 'desc' }): void;
    };
    sorting.sort({ column: 0, sortOrder: 'asc' });

    // 'z' sorts last; the marker follows the value, not the physical row.
    const last = agent.grid.countRows() - 1;
    expect(agent.grid.getDataAtCell(last, 0)).toBe('z');
    expect(agent.grid.view?.elementAt(last, 0)?.classList.contains('cm-by-agent')).toBe(true);
    expect(agent.grid.view?.elementAt(0, 0)?.classList.contains('cm-by-agent')).toBe(false);
  });
});
