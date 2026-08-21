/**
 * Filtering rows by a column's values.
 *
 * A filter is a set of conditions per column plus a trim of the rows that fail
 * them. Building it on trimming rather than on hiding is deliberate: a filtered
 * row is not there at all, so the row numbers the user sees stay contiguous.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** A value as it comes out of a cell. */
export type FilterValue = string | number | boolean | null;

/** The conditions a filter can apply. */
export type ConditionName =
  | 'none'
  | 'empty'
  | 'not_empty'
  | 'eq'
  | 'neq'
  | 'begins_with'
  | 'ends_with'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'not_between'
  | 'by_value';

export interface Condition {
  name: ConditionName;
  /** What the condition compares against. */
  args: unknown[];
}

/** One column's conditions, and how they combine. */
export interface ColumnFilter {
  column: number;
  conditions: Condition[];
  operation: 'conjunction' | 'disjunction';
}

/** Compares as text, case-insensitively, the way a filter box does. */
function asText(value: FilterValue): string {
  return value === null ? '' : String(value).toLowerCase();
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(String(value));
}

/** Whether one value satisfies one condition. */
export function testCondition(value: FilterValue, condition: Condition): boolean {
  const [first, second] = condition.args;
  switch (condition.name) {
    case 'none':
      return true;
    case 'empty':
      return value === null || value === '';
    case 'not_empty':
      return !(value === null || value === '');
    case 'eq':
      return asText(value) === asText(first as FilterValue);
    case 'neq':
      return asText(value) !== asText(first as FilterValue);
    case 'begins_with':
      return asText(value).startsWith(asText(first as FilterValue));
    case 'ends_with':
      return asText(value).endsWith(asText(first as FilterValue));
    case 'contains':
      return asText(value).includes(asText(first as FilterValue));
    case 'not_contains':
      return !asText(value).includes(asText(first as FilterValue));
    case 'gt':
      return asNumber(value) > asNumber(first);
    case 'gte':
      return asNumber(value) >= asNumber(first);
    case 'lt':
      return asNumber(value) < asNumber(first);
    case 'lte':
      return asNumber(value) <= asNumber(first);
    case 'between': {
      const n = asNumber(value);
      // Written either way round, the range means the same thing.
      const low = Math.min(asNumber(first), asNumber(second));
      const high = Math.max(asNumber(first), asNumber(second));
      return n >= low && n <= high;
    }
    case 'not_between': {
      const n = asNumber(value);
      const low = Math.min(asNumber(first), asNumber(second));
      const high = Math.max(asNumber(first), asNumber(second));
      return n < low || n > high;
    }
    case 'by_value': {
      // The checkbox list: the argument is the set of values to keep.
      const allowed = (first as FilterValue[] | undefined) ?? [];
      return allowed.some((candidate) => asText(candidate) === asText(value));
    }
    default:
      return true;
  }
}

export class Filters extends BasePlugin {
  static override readonly pluginName: string = 'filters';

  #filters = new Map<number, ColumnFilter>();

  override isEnabled(): boolean {
    return this.grid.getSettings().filters === true;
  }

  protected override onEnable(): void {
    // Nothing to set up; the plugin is driven by its methods and by the
    // dropdown menu.
  }

  protected override onDisable(): void {
    this.clearConditions();
  }

  /** Adds a condition to a column. */
  addCondition(
    column: number,
    name: ConditionName,
    args: unknown[] = [],
    operation: 'conjunction' | 'disjunction' = 'conjunction',
  ): void {
    const existing = this.#filters.get(column);
    if (existing) {
      existing.conditions.push({ name, args });
      existing.operation = operation;
    } else {
      this.#filters.set(column, { column, conditions: [{ name, args }], operation });
    }
  }

  /** Removes every condition on a column, or on all of them. */
  clearConditions(column?: number): void {
    if (column === undefined) {
      this.#filters.clear();
    } else {
      this.#filters.delete(column);
    }
  }

  /** Whether a column has any conditions. */
  isFiltered(column?: number): boolean {
    return column === undefined ? this.#filters.size > 0 : this.#filters.has(column);
  }

  /** The conditions on a column. */
  getConditions(column: number): Condition[] {
    return this.#filters.get(column)?.conditions.map((c) => ({ ...c })) ?? [];
  }

  /** The distinct values in a column, for a checkbox list. */
  getValues(column: number): FilterValue[] {
    const seen = new Map<string, FilterValue>();
    for (let row = 0; row < this.grid.countSourceRows(); row += 1) {
      const visual = this.grid.rowIndex.toVisual(row);
      const value = visual === null ? null : (this.grid.getCell(visual, column)?.value ?? null);
      const key = asText(value);
      if (!seen.has(key)) {
        seen.set(key, value);
      }
    }
    return [...seen.values()];
  }

  /** Applies the conditions, trimming the rows that fail. */
  filter(): void {
    if (this.grid.hooks.allows('beforeFilter', [...this.#filters.values()]) === false) {
      return;
    }
    const map = this.grid.rowIndex;
    map.untrim();

    if (this.#filters.size > 0) {
      const failing: number[] = [];
      // The whole sheet is considered, not only what is visible: re-filtering
      // must be able to bring a row back.
      for (let physical = 0; physical < map.length; physical += 1) {
        const visual = map.toVisual(physical);
        if (visual === null) {
          continue;
        }
        if (!this.#passes(visual)) {
          failing.push(physical);
        }
      }
      map.trim(failing);
    }
    this.grid.hooks.run('afterFilter', undefined, [...this.#filters.values()]);
    this.grid.render();
  }

  #passes(visualRow: number): boolean {
    for (const filter of this.#filters.values()) {
      const value = this.grid.getCell(visualRow, filter.column)?.value ?? null;
      const results = filter.conditions.map((condition) => testCondition(value, condition));
      const passes =
        filter.operation === 'disjunction'
          ? results.some(Boolean)
          : results.every(Boolean);
      // Columns always combine with AND; only the conditions within one column
      // follow the chosen operation.
      if (!passes) {
        return false;
      }
    }
    return true;
  }
}

registerPlugin(Filters);
