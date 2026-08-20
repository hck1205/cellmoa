/**
 * Checking the workbook against a specification and marking what failed.
 *
 * A verify is the same thing a test is: a written statement of what should be
 * true, checked mechanically. The value of running it inside the grid is that
 * a failure points at a cell, so the answer to "what broke?" is a mark on the
 * screen rather than a line of output naming a coordinate.
 *
 * Handsontable has no counterpart.
 */

import { parseA1 } from '../../dataSource.js';
import { BasePlugin, registerPlugin } from '../base.js';

/** One thing the specification says should be true. */
export interface Expectation {
  /** The cell or range being checked, in A1 notation. */
  target?: string;
  cell?: string;
  label?: string;
  [key: string]: unknown;
}

/** The specification, as the engine's `verify` takes it. */
export interface Spec {
  sheet?: string;
  expect: Expectation[];
}

/** What one check concluded. */
export interface CheckResult {
  target: string;
  label?: string | null;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface VerifyReport {
  passed: boolean;
  results: CheckResult[];
}

export class VerifyOverlay extends BasePlugin {
  static override readonly pluginName: string = 'verifyOverlay';

  #results: CheckResult[] = [];
  /** The cells a failed check points at, keyed `row:col`. */
  #failed = new Map<string, CheckResult>();

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    this.addHook(
      'afterRenderer',
      (_value: unknown, td: HTMLTableCellElement, row: number, col: number) => {
        const failure = this.#failed.get(`${row}:${col}`);
        if (failure) {
          td.classList.add('cm-verify-failed');
          td.title = `expected ${failure.expected}, found ${failure.actual}`;
        }
      },
    );
    const configured = this.options<{ spec: Spec }>().spec;
    if (configured) {
      this.run(configured);
    }
  }

  protected override onDisable(): void {
    this.clear();
  }

  /** Runs a specification and marks what failed. */
  run(spec: Spec): VerifyReport {
    const response = this.grid.engine.call({ op: 'verify', spec });
    const report = (response['report'] ?? {}) as { results?: CheckResult[] };
    this.#results = report.results ?? [];
    this.#failed.clear();

    for (const result of this.#results) {
      if (result.passed) {
        continue;
      }
      // A check on a range marks its top-left cell: that is where a reader
      // looks first, and marking every cell of a large range would bury the
      // one thing that went wrong.
      const target = parseA1(result.target);
      if (target) {
        this.#failed.set(`${target.row}:${target.col}`, result);
      }
    }
    this.grid.render();
    const passed = this.#results.every((result) => result.passed);
    this.grid.hooks.run('afterVerify', undefined, { passed, results: this.#results });
    return { passed, results: this.getResults() };
  }

  /** What the last run concluded. */
  getResults(): CheckResult[] {
    return this.#results.map((result) => ({ ...result }));
  }

  /** Only the checks that failed. */
  getFailures(): CheckResult[] {
    return this.getResults().filter((result) => !result.passed);
  }

  /** Whether everything passed. Vacuously true before anything has run. */
  passed(): boolean {
    return this.#results.every((result) => result.passed);
  }

  /** The failure on a cell, or `null`. */
  failureAt(row: number, col: number): CheckResult | null {
    return this.#failed.get(`${row}:${col}`) ?? null;
  }

  /** Takes the marks off. */
  clear(): void {
    this.#results = [];
    this.#failed.clear();
    this.grid.render();
  }
}

registerPlugin(VerifyOverlay as never);
