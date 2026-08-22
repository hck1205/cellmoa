/**
 * Merged cells.
 *
 * A merge is a rectangle whose top-left cell is the one that shows; the rest
 * are covered. Only the corner holds a value — merging cells that all held
 * something and keeping only one is the behaviour every spreadsheet has, and
 * hiding the rest instead would leave data that cannot be seen or edited.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** One merged area. */
export interface MergedArea {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** What the `mergeCells` setting may hold, when it is given as an object. */
export interface MergeCellsSettings {
  cells?: MergedArea[];
  /**
   * Accepted and without effect here.
   *
   * In Handsontable this turns off the way the rendered range is widened to
   * take in a merge that crosses the viewport edge. This grid draws a merge as
   * a spanning cell in the pane that owns its corner and never widens the range
   * for one, so there is nothing to turn off — but a configuration written
   * against the guide should not be rejected for saying so.
   */
  virtualized?: boolean;
}

export class MergeCells extends BasePlugin {
  static override readonly pluginName: string = 'mergeCells';

  #areas: MergedArea[] = [];

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    const settings = this.grid.getSettings().mergeCells;
    const declared = Array.isArray(settings)
      ? (settings as MergedArea[])
      : (this.options<MergeCellsSettings>().cells ?? []);
    // Through `merge` rather than straight into the list, because a merge
    // declared in the settings clears the cells it covers exactly as one made
    // by hand does — a value under a merge is a value nobody can see or reach,
    // however the merge got there.
    for (const area of declared) {
      this.merge(area.row, area.col, area.row + area.rowspan - 1, area.col + area.colspan - 1);
    }
    this.addHook('afterRenderer', (_value: unknown, td: HTMLTableCellElement, row: number, col: number) => {
      const covering = this.getCoveringArea(row, col);
      if (!covering) {
        return;
      }
      if (covering.row === row && covering.col === col) {
        td.rowSpan = covering.rowspan;
        td.colSpan = covering.colspan;
        td.classList.add('cm-merged');
      } else {
        // A covered cell is not drawn at all; the corner's span covers it.
        td.style.display = 'none';
        td.classList.add('cm-merged-hidden');
      }
    });
  }

  protected override onDisable(): void {
    this.#areas = [];
    this.grid.render();
  }

  /** Every merged area. */
  getMergedAreas(): MergedArea[] {
    return this.#areas.map((area) => ({ ...area }));
  }

  /** The area covering a cell, or `null`. */
  getCoveringArea(row: number, col: number): MergedArea | null {
    return (
      this.#areas.find(
        (area) =>
          row >= area.row &&
          row < area.row + area.rowspan &&
          col >= area.col &&
          col < area.col + area.colspan,
      ) ?? null
    );
  }

  /** Whether a cell is covered by a merge but is not its corner. */
  isCovered(row: number, col: number): boolean {
    const area = this.getCoveringArea(row, col);
    return area !== null && !(area.row === row && area.col === col);
  }

  /**
   * Merges a rectangle.
   *
   * Everything but the corner is cleared, because a value under a merge is a
   * value nobody can see or reach.
   */
  merge(row: number, col: number, endRow: number, endCol: number): void {
    const area: MergedArea = {
      row: Math.min(row, endRow),
      col: Math.min(col, endCol),
      rowspan: Math.abs(endRow - row) + 1,
      colspan: Math.abs(endCol - col) + 1,
    };
    if (area.rowspan === 1 && area.colspan === 1) {
      return;
    }
    if (this.grid.hooks.allows('beforeMergeCells', area) === false) {
      return;
    }
    // A new merge replaces any it overlaps, rather than nesting.
    this.#areas = this.#areas.filter((existing) => !this.#overlaps(existing, area));

    const cleared: Array<[number, number, string]> = [];
    for (let r = area.row; r < area.row + area.rowspan; r += 1) {
      for (let c = area.col; c < area.col + area.colspan; c += 1) {
        if (r !== area.row || c !== area.col) {
          cleared.push([r, c, '']);
        }
      }
    }
    this.#areas.push(area);
    if (cleared.length > 0) {
      this.grid.setDataAtCells(cleared, 'merge');
    }
    this.grid.hooks.run('afterMergeCells', undefined, area);
    this.grid.render();
  }

  /** Merges whatever is selected. */
  mergeSelection(): void {
    const range = this.grid.getSelectedRangeLast();
    if (range) {
      this.merge(range.topRow, range.startCol, range.bottomRow, range.endCol);
    }
  }

  /** Removes the merge covering a cell. */
  unmerge(row: number, col: number): void {
    const area = this.getCoveringArea(row, col);
    if (!area) {
      return;
    }
    if (this.grid.hooks.allows('beforeUnmergeCells', area) === false) {
      return;
    }
    this.#areas = this.#areas.filter((existing) => existing !== area);
    this.grid.hooks.run('afterUnmergeCells', undefined, area);
    this.grid.render();
  }

  /** Toggles the selection between merged and not. */
  toggleMerge(): void {
    const range = this.grid.getSelectedRangeLast();
    if (!range) {
      return;
    }
    if (this.getCoveringArea(range.topRow, range.startCol)) {
      this.unmerge(range.topRow, range.startCol);
    } else {
      this.mergeSelection();
    }
  }

  #overlaps(a: MergedArea, b: MergedArea): boolean {
    return (
      a.row < b.row + b.rowspan &&
      b.row < a.row + a.rowspan &&
      a.col < b.col + b.colspan &&
      b.col < a.col + a.colspan
    );
  }
}

registerPlugin(MergeCells);
