import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import { resolve } from '../src/menu.js';
import type { ContextMenu } from '../src/plugins/index.js';
import { ITEM } from '../src/plugins/index.js';
import type {
  Conflicts,
  DiffView,
  Provenance,
  StatusBar,
  VerifyOverlay,
} from '../src/plugins/index.js';
import { readWasm } from './wasm.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 4, startCols: 3, ...settings }).then((m) => m.grid);

const wasm = readWasm();

describe('provenance', () => {
  it('says who set a cell to what, newest first on screen', async () => {
    const grid = await makeGrid({ provenance: true, actor: { kind: 'human', id: 'ada' } });
    grid.setDataAtCell(0, 0, '1');
    grid.setDataAtCell(0, 0, '2');

    const plugin = grid.getPlugin('provenance') as unknown as Provenance;
    const history = plugin.getHistory(0, 0);
    expect(history).toHaveLength(2);
    expect(history[0]?.actor).toEqual({ kind: 'human', id: 'ada' });
    expect(history[0]?.input).toBe('1');
    expect(history[1]?.input).toBe('2');

    plugin.show(0, 0);
    const entries = plugin.panel?.querySelectorAll('.cm-provenance-entry');
    expect(entries).toHaveLength(2);
    // Newest first: the most recent change is the one being asked about.
    expect(entries?.[0]?.textContent).toContain('2');
  });

  it('distinguishes a value that came with the file from one nobody changed', async () => {
    const grid = await makeGrid({ provenance: true });
    const plugin = grid.getPlugin('provenance') as unknown as Provenance;
    plugin.show(0, 0);
    expect(plugin.panel?.querySelector('.cm-provenance-empty')?.textContent).toContain(
      'came with the file',
    );
  });

  it('marks a cell an agent last touched, and stops when a person edits it', async () => {
    const engine = await Engine.load(wasm);
    const agent = await makeGrid({
      engine,
      provenance: true,
      actor: { kind: 'agent', id: 'assistant' },
    });
    agent.setDataAtCell(0, 0, 'from the agent');
    expect(agent.view?.elementAt(0, 0)?.classList.contains('cm-by-agent')).toBe(true);
    expect(agent.view?.elementAt(0, 0)?.dataset['actor']).toBe('assistant');

    const person = await makeGrid({
      engine,
      provenance: true,
      actor: { kind: 'human', id: 'ada' },
    });
    person.setDataAtCell(0, 0, 'corrected by hand');
    expect(person.view?.elementAt(0, 0)?.classList.contains('cm-by-agent')).toBe(false);
  });

  it('takes its class name from the settings', async () => {
    const grid = await makeGrid({
      provenance: { agentClassName: 'robot' },
      actor: { kind: 'agent', id: 'a' },
    });
    grid.setDataAtCell(0, 0, 'x');
    expect(grid.view?.elementAt(0, 0)?.classList.contains('robot')).toBe(true);
  });

  it('is offered on the context menu', async () => {
    const grid = await makeGrid({ provenance: true, contextMenu: [ITEM.provenance] });
    grid.selectCell(0, 0);
    const menu = grid.getPlugin('contextMenu') as unknown as ContextMenu;
    const item = menu.getItems().find((entry) => entry.key === ITEM.provenance);
    expect(resolve(item?.name, '')).toBe('Where did this come from?');
    menu.open(0, 0);
    menu.executeCommand(ITEM.provenance);
    expect((grid.getPlugin('provenance') as unknown as Provenance).panel).not.toBeNull();
  });
});

describe('revision conflicts', () => {
  it('reports a write the revision guard refused', async () => {
    const grid = await makeGrid({ conflicts: true, notification: true });
    const plugin = grid.getPlugin('conflicts') as unknown as Conflicts;
    expect(plugin.getRefusals()).toEqual([]);

    // The grid raises this hook when the engine refuses a stale write; firing
    // it directly is how the reaction is checked without racing two writers.
    grid.hooks.notify('afterRevisionConflict', 7);

    expect(plugin.getRefusals().map((r) => r.revision)).toEqual([7]);
    const notifications = grid.view?.wrapper.querySelectorAll('.cm-notification');
    expect(notifications).toHaveLength(1);
    expect(notifications?.[0]?.textContent).toContain('revision 7');
  });

  it('stays quiet when it was asked to', async () => {
    const grid = await makeGrid({ conflicts: { notify: false }, notification: true });
    grid.hooks.notify('afterRevisionConflict', 3);
    expect(grid.view?.wrapper.querySelectorAll('.cm-notification')).toHaveLength(0);
    // Still recorded, though: silence is about the message, not the fact.
    expect((grid.getPlugin('conflicts') as unknown as Conflicts).getRefusals()).toHaveLength(1);
  });

  it('takes a message of its own', async () => {
    const grid = await makeGrid({
      conflicts: { message: (revision: number) => `busy at ${revision}` },
    });
    expect((grid.getPlugin('conflicts') as unknown as Conflicts).messageFor(9)).toBe('busy at 9');
  });
});

describe('the status bar', () => {
  it('shows the revision, the selection and the fingerprint', async () => {
    const grid = await makeGrid({ statusBar: true });
    grid.setDataAtCell(0, 0, '1');
    grid.selectCell(1, 1);

    const plugin = grid.getPlugin('statusBar') as unknown as StatusBar;
    plugin.refresh();
    const text = plugin.getText();
    expect(text).toContain('B2');
    expect(text).toContain(`r${grid.revision}`);

    const field = plugin.element?.querySelector('[data-field="fingerprint"]') as HTMLElement;
    expect(field.textContent).toHaveLength(12);
    // The abbreviation is for reading; the real digest is on the element.
    expect(field.dataset['workbook']).toHaveLength(64);
    expect(field.dataset['workbook']?.startsWith(field.textContent ?? '')).toBe(true);
  });

  it('changes the fingerprint when the workbook changes', async () => {
    const grid = await makeGrid({ statusBar: true });
    const plugin = grid.getPlugin('statusBar') as unknown as StatusBar;
    const before = plugin.getFingerprint();
    grid.setDataAtCell(0, 0, 'something');
    const after = plugin.getFingerprint();
    expect(after.workbook).not.toBe(before.workbook);
    expect(after.inputs).not.toBe(before.inputs);
  });

  it('leaves out the fields it was told to leave out', async () => {
    const grid = await makeGrid({ statusBar: { showFingerprint: false, showSelection: false } });
    const plugin = grid.getPlugin('statusBar') as unknown as StatusBar;
    plugin.refresh();
    expect(plugin.element?.querySelector('[data-field="fingerprint"]')).toBeNull();
    expect(plugin.element?.querySelector('[data-field="revision"]')).not.toBeNull();
  });
});

describe('the verify overlay', () => {
  it('marks the cell a failed check points at', async () => {
    const grid = await makeGrid({ verifyOverlay: true });
    grid.setDataAtCells([
      [0, 0, '2'],
      [0, 1, '=A1*2'],
    ]);
    const plugin = grid.getPlugin('verifyOverlay') as unknown as VerifyOverlay;
    const report = plugin.run({
      expect: [
        { cell: 'B1', equals: 4, label: 'doubled' },
        { cell: 'B1', equals: 5, label: 'wrong on purpose' },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.passed).toBe(true);
    expect(grid.view?.elementAt(0, 1)?.classList.contains('cm-verify-failed')).toBe(true);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-verify-failed')).toBe(false);
    expect(plugin.failureAt(0, 1)?.expected).toContain('5');
  });

  it('leaves nothing marked when everything passes', async () => {
    const grid = await makeGrid({ verifyOverlay: true });
    grid.setDataAtCell(0, 0, '3');
    const plugin = grid.getPlugin('verifyOverlay') as unknown as VerifyOverlay;
    expect(plugin.run({ expect: [{ cell: 'A1', equals: 3 }] }).passed).toBe(true);
    expect(plugin.getFailures()).toEqual([]);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-verify-failed')).toBe(false);
  });

  it('takes the marks off again', async () => {
    const grid = await makeGrid({ verifyOverlay: true });
    const plugin = grid.getPlugin('verifyOverlay') as unknown as VerifyOverlay;
    plugin.run({ expect: [{ cell: 'A1', equals: 99 }] });
    expect(plugin.getFailures()).toHaveLength(1);
    plugin.clear();
    expect(plugin.getResults()).toEqual([]);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-verify-failed')).toBe(false);
  });

  it('runs a specification given in the settings', async () => {
    const grid = await makeGrid({
      verifyOverlay: { spec: { expect: [{ cell: 'A1', equals: 1 }] } },
    });
    expect((grid.getPlugin('verifyOverlay') as unknown as VerifyOverlay).getResults()).toHaveLength(
      1,
    );
  });
});

describe('the diff view', () => {
  it('marks what changed since a snapshot was taken', async () => {
    const grid = await makeGrid({ diffView: true });
    grid.setDataAtCell(0, 0, 'original');
    const plugin = grid.getPlugin('diffView') as unknown as DiffView;
    plugin.snapshot('before the agent');
    expect(plugin.getSnapshots()).toEqual(['before the agent']);

    grid.setDataAtCells([
      [0, 0, 'changed'],
      [1, 1, 'added'],
    ]);
    const result = plugin.compare('before the agent');

    // Row 2 held nothing before, so it is reported as an inserted row rather
    // than as a cell change — one change for the row, not one per column.
    expect(result.summary.cells).toBe(1);
    expect(result.summary.rows).toBe(1);
    expect(plugin.getBaseline()).toBe('before the agent');
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-diff-changed')).toBe(true);
    expect(grid.view?.elementAt(0, 0)?.title).toBe('was original');
    // A cell that did not exist before is marked as added, not merely changed.
    expect(grid.view?.elementAt(1, 1)?.classList.contains('cm-diff-added')).toBe(true);
    expect(grid.view?.elementAt(0, 1)?.classList.contains('cm-diff-changed')).toBe(false);
  });

  it('reports the formula behind a changed value', async () => {
    const grid = await makeGrid({ diffView: true });
    grid.setDataAtCells([
      [0, 0, '2'],
      [0, 1, '=A1*2'],
    ]);
    const plugin = grid.getPlugin('diffView') as unknown as DiffView;
    plugin.snapshot();
    grid.setDataAtCell(0, 1, '=A1*3');
    plugin.compare();
    expect(plugin.changeAt(0, 1)?.before?.formula).toBe('=A1*2');
    expect(plugin.changeAt(0, 1)?.after?.formula).toBe('=A1*3');
  });

  it('finds nothing when nothing changed', async () => {
    const grid = await makeGrid({ diffView: true });
    grid.setDataAtCell(0, 0, 'x');
    const plugin = grid.getPlugin('diffView') as unknown as DiffView;
    plugin.snapshot();
    expect(plugin.compare().changes).toEqual([]);
  });

  it('takes the marks off again', async () => {
    const grid = await makeGrid({ diffView: true });
    const plugin = grid.getPlugin('diffView') as unknown as DiffView;
    plugin.snapshot();
    grid.setDataAtCell(0, 0, 'new');
    plugin.compare();
    plugin.clear();
    expect(plugin.getBaseline()).toBeNull();
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-diff-changed')).toBe(false);
  });
});
