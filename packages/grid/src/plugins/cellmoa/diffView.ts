/**
 * Comparing the workbook against a moment you chose.
 *
 * "What changed while I was away?" is the question a person has after leaving a
 * workbook with an agent, and it is not answerable from the file on disk —
 * the interesting comparison is against a moment, not against a save. So the
 * moment is recorded on request and the diff runs against it.
 *
 * Handsontable has no counterpart.
 */

import { CellMap } from '../../cellMap.js';
import { parseA1 } from '../../dataSource.js';
import { BasePlugin, registerPlugin } from '../base.js';

/** What a cell held on one side of the comparison. */
export interface CellSnapshot {
  formula?: string;
  value: string;
  present: boolean;
}

/**
 * One difference.
 *
 * Only cell changes and inserted rows have a position on the grid; a removed
 * row and a renamed sheet describe something that is not there to point at.
 */
export interface Change {
  kind: string;
  sheet?: string;
  cell?: string;
  row?: number;
  before?: CellSnapshot;
  after?: CellSnapshot;
  [key: string]: unknown;
}

export interface DiffSummary {
  sheets: number;
  rows: number;
  cells: number;
  names: number;
}

export interface DiffResult {
  changes: Change[];
  summary: DiffSummary;
}

export class DiffView extends BasePlugin {
  static override readonly pluginName: string = 'diffView';

  #changes: Change[] = [];
  #byCell = new CellMap<Change>();
  #against: string | null = null;

  override isEnabled(): boolean {
    return this.grid.getSettings().diffView !== false;
  }

  protected override onEnable(): void {
    this.addHook(
      'afterRenderer',
      (_value: unknown, td: HTMLTableCellElement, row: number, col: number) => {
        const change = this.#byCell.get(row, col);
        if (!change) {
          return;
        }
        td.classList.add('cm-diff-changed');
        if (change.before?.present === false) {
          td.classList.add('cm-diff-added');
        } else if (change.after?.present === false) {
          td.classList.add('cm-diff-removed');
        }
        const before = change.before?.formula ?? change.before?.value ?? '(empty)';
        td.title = `was ${before}`;
      },
    );
  }

  protected override onDisable(): void {
    this.clear();
  }

  /** Records the workbook as it stands, to compare against later. */
  snapshot(name = 'baseline'): void {
    this.grid.engine.call({ op: 'snapshot', name });
  }

  /** The snapshots that have been recorded. */
  getSnapshots(): string[] {
    const response = this.grid.engine.call({ op: 'snapshots' });
    return (response['snapshots'] as string[] | undefined) ?? [];
  }

  /** Compares the workbook against a snapshot and marks what differs. */
  compare(against = 'baseline'): DiffResult {
    const response = this.grid.engine.call({ op: 'diff', against });
    this.#against = against;
    this.#changes = (response['changes'] as Change[] | undefined) ?? [];
    this.#byCell.clear();

    for (const change of this.#changes) {
      if (change.kind === 'row_inserted' && change.row !== undefined) {
        // A row that exists only in the new version is reported as one change
        // rather than one per cell — which is the point of diffing on rows —
        // but on screen every cell in it is new.
        for (let col = 0; col < this.grid.countCols(); col += 1) {
          this.#byCell.set(change.row, col, {
            ...change,
            before: { value: '', present: false },
          });
        }
        continue;
      }
      const position = change.cell ? parseA1(change.cell) : null;
      if (position) {
        this.#byCell.set(position.row, position.col, change);
      }
    }
    this.grid.render();
    const result: DiffResult = {
      changes: this.getChanges(),
      summary: (response['summary'] as DiffSummary | undefined) ?? {
        sheets: 0,
        rows: 0,
        cells: 0,
        names: 0,
      },
    };
    this.grid.hooks.run('afterDiff', undefined, result);
    return result;
  }

  /** What the last comparison found. */
  getChanges(): Change[] {
    return this.#changes.map((change) => ({ ...change }));
  }

  /** Which snapshot the marks are relative to, or `null`. */
  getBaseline(): string | null {
    return this.#against;
  }

  /** The change at a cell, or `null`. */
  changeAt(row: number, col: number): Change | null {
    return this.#byCell.get(row, col) ?? null;
  }

  /** Takes the marks off. */
  clear(): void {
    this.#changes = [];
    this.#byCell.clear();
    this.#against = null;
    this.grid.render();
  }
}

registerPlugin(DiffView as never);
