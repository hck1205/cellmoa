/**
 * Showing who changed a cell, when, and why.
 *
 * The engine records every edit with its actor, so the grid can answer "where
 * did this number come from?" without anyone having kept notes. That question
 * is the reason for the journal, and a spreadsheet you cannot ask it of is a
 * spreadsheet you have to take on trust.
 *
 * Handsontable has no counterpart for this.
 */

import { CellMap } from '../../cellMap.js';
import { BasePlugin, registerPlugin } from '../base.js';

/** One entry in a cell's history, as the engine reports it. */
export interface HistoryEntry {
  revision: number;
  actor: { kind: string; id: string };
  label?: string | null;
  at?: number | null;
  /** What the cell became at that revision. */
  input?: string;
  value?: string;
}

export interface ProvenanceSettings {
  /** Mark cells an agent last touched. */
  markAgentEdits?: boolean;
  /** The class put on such a cell. */
  agentClassName?: string;
}

export const DEFAULT_AGENT_CLASS = 'cm-by-agent';

export class Provenance extends BasePlugin {
  static override readonly pluginName: string = 'provenance';

  /** Who last touched each cell, keyed `row:col`, rebuilt as cells are drawn. */
  #lastActor = new CellMap<{ kind: string; id: string }>();
  #panel: HTMLElement | null = null;

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    this.addHook(
      'afterRenderer',
      (_value: unknown, td: HTMLTableCellElement, row: number, col: number) => {
        if (!this.marksAgentEdits()) {
          return;
        }
        const actor = this.lastActorOf(row, col);
        if (actor?.kind === 'agent') {
          td.classList.add(this.agentClassName());
          td.dataset['actor'] = actor.id;
        }
      },
    );
    // Any edit can change who last touched a cell, so the cache is dropped
    // wholesale rather than picked at.
    this.addHook('afterChange', () => this.#lastActor.clear());
    this.addHook('afterUndo', () => this.#lastActor.clear());
    this.addHook('afterRedo', () => this.#lastActor.clear());
    this.grid.render();
  }

  protected override onDisable(): void {
    this.hide();
    this.#lastActor.clear();
    this.grid.render();
  }

  /** Whether cells an agent touched are marked. */
  marksAgentEdits(): boolean {
    return this.options<ProvenanceSettings>().markAgentEdits !== false;
  }

  /** The class such a cell carries. */
  agentClassName(): string {
    return this.options<ProvenanceSettings>().agentClassName ?? DEFAULT_AGENT_CLASS;
  }

  /** Every change that touched a cell, oldest first. */
  getHistory(row: number, col: number): HistoryEntry[] {
    return this.grid.getCellHistory(row, col) as unknown as HistoryEntry[];
  }

  /** Who last changed a cell, or `null` if nobody has. */
  lastActorOf(row: number, col: number): { kind: string; id: string } | null {
    const cached = this.#lastActor.get(row, col);
    if (cached) {
      return cached;
    }
    const history = this.getHistory(row, col);
    const last = history[history.length - 1];
    if (!last?.actor) {
      return null;
    }
    this.#lastActor.set(row, col, last.actor);
    return last.actor;
  }

  /** Shows a cell's history beside it. */
  show(row: number, col: number): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    this.hide();
    const doc = view.root.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'cm-provenance';
    panel.setAttribute('role', 'log');

    const title = doc.createElement('div');
    title.className = 'cm-provenance-title';
    title.textContent = `${this.grid.getColHeader(col)}${row + 1}`;
    panel.appendChild(title);

    const history = this.getHistory(row, col);
    if (history.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'cm-provenance-empty';
      // Not the same as "nobody changed it": a value that was in the file when
      // it was opened has no edit behind it.
      empty.textContent = 'No recorded change — this value came with the file.';
      panel.appendChild(empty);
    }
    for (const entry of [...history].reverse()) {
      panel.appendChild(this.#entry(doc, entry));
    }

    const cell = view.elementAt(row, col);
    if (cell) {
      panel.style.position = 'absolute';
      panel.style.left = `${cell.offsetLeft + cell.offsetWidth}px`;
      panel.style.top = `${cell.offsetTop}px`;
    }
    view.root.appendChild(panel);
    this.#panel = panel;
  }

  /** Shows the history of whatever is selected. */
  showForSelection(): void {
    const highlight = this.grid.selection.highlight;
    if (highlight) {
      this.show(highlight.row, highlight.col);
    }
  }

  /** Takes it down. */
  hide(): void {
    this.#panel?.remove();
    this.#panel = null;
  }

  /** The panel, for a caller that wants to inspect it. */
  get panel(): HTMLElement | null {
    return this.#panel;
  }

  #entry(doc: Document, entry: HistoryEntry): HTMLElement {
    const element = doc.createElement('div');
    element.className = `cm-provenance-entry cm-provenance-entry--${entry.actor.kind}`;
    element.dataset['revision'] = String(entry.revision);

    const who = doc.createElement('span');
    who.className = 'cm-provenance-who';
    who.textContent = `${entry.actor.kind}:${entry.actor.id}`;
    element.appendChild(who);

    const what = doc.createElement('span');
    what.className = 'cm-provenance-what';
    what.textContent = entry.input ?? entry.value ?? '';
    element.appendChild(what);

    if (entry.label) {
      const why = doc.createElement('span');
      why.className = 'cm-provenance-why';
      why.textContent = entry.label;
      element.appendChild(why);
    }
    if (entry.at) {
      const when = doc.createElement('time');
      when.className = 'cm-provenance-when';
      // The engine records epoch milliseconds; a journal that stored a
      // formatted date would replay differently in another locale.
      when.dateTime = new Date(entry.at).toISOString();
      when.textContent = new Date(entry.at).toISOString().slice(0, 19).replace('T', ' ');
      element.appendChild(when);
    }
    return element;
  }
}

registerPlugin(Provenance as never);
