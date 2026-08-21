/**
 * Rows that contain other rows.
 *
 * The nesting is described separately from the data — a list of parent rows and
 * the rows underneath each — because the sheet itself is flat. Collapsing a
 * parent trims its children out of the visual space; it does not touch what is
 * in them, so a formula reading a collapsed row still reads it.
 */

import { BasePlugin, registerPlugin } from './base.js';
import { OwnedIndexes } from './ownedIndexes.js';

/** One row's place in the tree. */
export interface NestedRow {
  /** The physical row this node is. */
  row: number;
  /** The rows directly under it. */
  children?: NestedRow[];
}

export class NestedRows extends BasePlugin {
  static override readonly pluginName: string = 'nestedRows';

  #tree: NestedRow[] = [];
  #collapsed = new Set<number>();
  /** The rows this plugin is folding away. */
  readonly #folded = new OwnedIndexes(() => this.grid.rowIndex, 'trim');

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().nestedRows;
    return settings === true || Array.isArray(settings);
  }

  protected override onEnable(): void {
    const settings = this.grid.getSettings().nestedRows;
    this.#tree = Array.isArray(settings) ? (settings as NestedRow[]) : [];
    this.addHook(
      'afterGetRowHeader',
      (_value: unknown, row: number, th: HTMLTableCellElement) => this.#decorate(row, th),
    );
    this.grid.render();
  }

  protected override onDisable(): void {
    this.#folded.clear();
    this.#collapsed.clear();
    this.grid.render();
  }

  /** The tree as it stands. */
  getTree(): NestedRow[] {
    return this.#tree;
  }

  /** How deep a physical row sits, 0 at the top level. */
  getRowLevel(row: number): number {
    const walk = (nodes: NestedRow[], depth: number): number | null => {
      for (const node of nodes) {
        if (node.row === row) {
          return depth;
        }
        const found = node.children ? walk(node.children, depth + 1) : null;
        if (found !== null) {
          return found;
        }
      }
      return null;
    };
    return walk(this.#tree, 0) ?? 0;
  }

  /** The node for a physical row, or `null`. */
  getNode(row: number): NestedRow | null {
    const walk = (nodes: NestedRow[]): NestedRow | null => {
      for (const node of nodes) {
        if (node.row === row) {
          return node;
        }
        const found = node.children ? walk(node.children) : null;
        if (found) {
          return found;
        }
      }
      return null;
    };
    return walk(this.#tree);
  }

  /** Whether a row has anything under it. */
  hasChildren(row: number): boolean {
    return (this.getNode(row)?.children?.length ?? 0) > 0;
  }

  /** Every row underneath a row, at any depth. */
  getDescendants(row: number): number[] {
    const collect = (node: NestedRow, into: number[]): void => {
      for (const child of node.children ?? []) {
        into.push(child.row);
        collect(child, into);
      }
    };
    const node = this.getNode(row);
    const found: number[] = [];
    if (node) {
      collect(node, found);
    }
    return found;
  }

  isCollapsed(row: number): boolean {
    return this.#collapsed.has(row);
  }

  /** Folds a row's children away. */
  collapse(row: number): void {
    if (!this.hasChildren(row)) {
      return;
    }
    this.#collapsed.add(row);
    this.#apply();
    this.grid.hooks.run('afterCollapseRow', undefined, row);
  }

  /** Opens it again. */
  expand(row: number): void {
    if (this.#collapsed.delete(row)) {
      this.#apply();
      this.grid.hooks.run('afterExpandRow', undefined, row);
    }
  }

  toggle(row: number): void {
    if (this.isCollapsed(row)) {
      this.expand(row);
    } else {
      this.collapse(row);
    }
  }

  collapseAll(): void {
    const walk = (nodes: NestedRow[]): void => {
      for (const node of nodes) {
        if (node.children?.length) {
          this.#collapsed.add(node.row);
          walk(node.children);
        }
      }
    };
    walk(this.#tree);
    this.#apply();
  }

  expandAll(): void {
    this.#collapsed.clear();
    this.#apply();
  }

  /**
   * Works out which rows are hidden, from scratch each time.
   *
   * A row can sit under two collapsed parents at once, and opening the outer
   * one must not reveal what the inner one is folding away.
   */
  #apply(): void {
    const hidden = new Set<number>();
    for (const parent of this.#collapsed) {
      for (const child of this.getDescendants(parent)) {
        hidden.add(child);
      }
    }
    this.#folded.set(hidden);
    this.grid.render();
  }

  #decorate(row: number, th: HTMLTableCellElement): void {
    const physical = this.grid.rowIndex.toPhysical(row);
    if (physical === null) {
      return;
    }
    th.style.paddingLeft = `${this.getRowLevel(physical) * 12}px`;
    if (!this.hasChildren(physical)) {
      return;
    }
    const button = th.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'cm-nested-toggle';
    button.textContent = this.isCollapsed(physical) ? '+' : '−';
    button.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.toggle(physical);
    });
    th.insertBefore(button, th.firstChild);
  }
}

registerPlugin(NestedRows);
