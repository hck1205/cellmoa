/**
 * Collapsing a nested-header group down to its first column.
 *
 * Collapsing hides columns; it does not remove them. A hidden column keeps its
 * values and a formula pointing at it still reads them, which is the difference
 * between folding a group away and deleting it.
 */

import { BasePlugin, registerPlugin } from './base.js';
import { OwnedIndexes } from './ownedIndexes.js';
import type { NestedHeaders } from './nestedHeaders.js';

/**
 * Which header cells may be collapsed, when the setting is a list.
 *
 * `row` is counted upwards from the first table row, so the guide writes it
 * negative: `-1` is the header row nearest the data and `-4` is the fourth one
 * above it.
 */
export interface CollapsibleSpec {
  row: number;
  col: number;
  collapsible?: boolean;
}

/** A group, identified by the header cell that folds it. */
export interface CollapsibleGroup {
  level: number;
  col: number;
  colspan: number;
  collapsed: boolean;
}

export class CollapsibleColumns extends BasePlugin {
  static override readonly pluginName: string = 'collapsibleColumns';

  /** There is nothing to collapse without the nested header that defines the groups. */
  static override get settingKeys(): string[] {
    return ['collapsibleColumns', 'nestedHeaders'];
  }

  /** The header cells currently folded, keyed `level:col`. */
  #collapsed = new Set<string>();
  /** The columns this plugin is folding away. */
  readonly #folded = new OwnedIndexes(() => this.grid.colIndex, 'hide');

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().collapsibleColumns;
    return settings === true || Array.isArray(settings);
  }

  protected override onEnable(): void {
    this.addHook(
      'afterGetColHeader',
      (_value: unknown, col: number, th: HTMLTableCellElement, level: number) => {
        if (!this.isCollapsible(level, col)) {
          return;
        }
        const button = th.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'cm-collapse';
        const collapsed = this.isCollapsed(level, col);
        button.classList.add(collapsed ? 'cm-collapse--collapsed' : 'cm-collapse--expanded');
        button.textContent = collapsed ? '+' : '−';
        button.addEventListener('mousedown', (event) => {
          // The header also starts a column selection; folding a group is not
          // that, so the event stops here.
          event.stopPropagation();
          event.preventDefault();
          this.toggle(level, col);
        });
        th.appendChild(button);
      },
    );
  }

  protected override onDisable(): void {
    this.#collapsed.clear();
    this.#folded.clear();
    this.grid.render();
  }

  /** The nested-header plugin this one reads its groups from. */
  #headers(): NestedHeaders | null {
    const plugin = this.grid.getPlugin<NestedHeaders>('nestedHeaders');
    return plugin?.isPluginEnabled() ? plugin : null;
  }

  /**
   * Whether a header cell has a fold control.
   *
   * Only a cell that actually spans more than one column: folding a group of
   * one would hide nothing and leave a control that does nothing.
   */
  isCollapsible(level: number, col: number): boolean {
    const span = this.#headers()?.getSpanAt(level, col);
    if (!span || span.colspan < 2 || span.col !== col) {
      return false;
    }
    const settings = this.grid.getSettings().collapsibleColumns;
    if (Array.isArray(settings)) {
      const depth = this.#headers()?.countLevels() ?? 0;
      return (settings as CollapsibleSpec[]).some(
        (spec) =>
          this.#levelOf(spec, depth) === level && spec.col === col && spec.collapsible !== false,
      );
    }
    return settings === true;
  }

  /**
   * Which level of the header stack a list entry names.
   *
   * The guide counts these upwards from the first table row, which is why they
   * are negative — and why comparing one against a level index counted down
   * from the top of the stack could never match, so the documented
   * configuration collapsed nothing at all. A non-negative value is still read
   * as that index down from the top, because that is the only form this plugin
   * understood before and a grid configured against it should keep working.
   */
  #levelOf(spec: CollapsibleSpec, depth: number): number {
    return spec.row < 0 ? depth + spec.row : spec.row;
  }

  isCollapsed(level: number, col: number): boolean {
    return this.#collapsed.has(`${level}:${col}`);
  }

  /** Every group that can be folded, and whether it is. */
  getGroups(): CollapsibleGroup[] {
    const levels = this.#headers()?.getLevels() ?? [];
    const groups: CollapsibleGroup[] = [];
    levels.forEach((spans, level) => {
      for (const span of spans) {
        if (this.isCollapsible(level, span.col)) {
          groups.push({
            level,
            col: span.col,
            colspan: span.colspan,
            collapsed: this.isCollapsed(level, span.col),
          });
        }
      }
    });
    return groups;
  }

  /** Folds a group away, leaving its first column showing. */
  collapse(level: number, col: number): void {
    if (!this.isCollapsible(level, col) || this.isCollapsed(level, col)) {
      return;
    }
    if (this.grid.hooks.allows('beforeColumnCollapse', level, col) === false) {
      return;
    }
    this.#collapsed.add(`${level}:${col}`);
    this.#apply();
    this.grid.hooks.run('afterColumnCollapse', undefined, level, col);
  }

  /** Opens it again. */
  expand(level: number, col: number): void {
    if (!this.isCollapsed(level, col)) {
      return;
    }
    if (this.grid.hooks.allows('beforeColumnExpand', level, col) === false) {
      return;
    }
    this.#collapsed.delete(`${level}:${col}`);
    this.#apply();
    this.grid.hooks.run('afterColumnExpand', undefined, level, col);
  }

  toggle(level: number, col: number): void {
    if (this.isCollapsed(level, col)) {
      this.expand(level, col);
    } else {
      this.collapse(level, col);
    }
  }

  /**
   * Folds every group that can be folded.
   *
   * One group at a time rather than in one sweep, so a listener that refuses a
   * particular group is refused here too — a veto that held for a click on the
   * control but not for "collapse all" would be no veto at all.
   */
  collapseAll(): void {
    for (const group of this.getGroups()) {
      this.collapse(group.level, group.col);
    }
  }

  /** Opens all of them, one at a time and for the same reason. */
  expandAll(): void {
    for (const key of [...this.#collapsed]) {
      const [level, col] = key.split(':').map(Number) as [number, number];
      this.expand(level, col);
    }
  }

  /**
   * Recomputes which columns are folded away.
   *
   * The whole set each time, because a column can sit inside two folded groups
   * at once and unfolding the outer one must not reveal what the inner one is
   * hiding. Only the columns this plugin hid are released — someone may also
   * have hidden a column through `hiddenColumns`, and unfolding a group is no
   * reason to bring that one back.
   */
  #apply(): void {
    const headers = this.#headers();
    const wanted = new Set<number>();
    if (headers) {
      for (const key of this.#collapsed) {
        const [level, col] = key.split(':').map(Number) as [number, number];
        const span = headers.getSpanAt(level, col);
        if (!span) {
          continue;
        }
        // The first column stays, so the group is still visible and can be
        // unfolded again.
        for (let i = span.col + 1; i < span.col + span.colspan; i += 1) {
          const physical = this.grid.colIndex.toPhysical(i);
          if (physical !== null) {
            wanted.add(physical);
          }
        }
      }
    }
    this.#folded.set(wanted);
    this.grid.render();
  }
}

registerPlugin(CollapsibleColumns);
