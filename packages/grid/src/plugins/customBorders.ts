/**
 * Borders drawn on individual cells.
 *
 * A border is metadata, like a comment: it changes how a cell looks and not
 * what it holds. It is kept in the cell's settings and applied by the renderer,
 * so a border can never change what a formula reading that cell sees.
 *
 * The awkward part is that a border between two cells belongs to both of them.
 * Setting the bottom of one and the top of the next would draw two lines a
 * pixel apart, so each cell owns its own four edges and the renderer collapses
 * them.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** One edge. `hide: true` removes an edge that a range-wide setting drew. */
export interface BorderEdge {
  width?: number;
  color?: string;
  hide?: boolean;
}

/** The four edges of one cell. */
export interface CellBorder {
  top?: BorderEdge;
  bottom?: BorderEdge;
  left?: BorderEdge;
  right?: BorderEdge;
}

/** A border as the settings describe it: a range plus the edges to draw. */
export interface BorderSpec extends CellBorder {
  row?: number;
  col?: number;
  range?: { from: { row: number; col: number }; to: { row: number; col: number } };
}

/** Where a border goes, as the context menu names them. */
export type BorderPlace = 'top' | 'bottom' | 'left' | 'right' | 'all' | 'none';

export const DEFAULT_BORDER: BorderEdge = { width: 1, color: '#000' };

export class CustomBorders extends BasePlugin {
  static override readonly pluginName: string = 'customBorders';

  /** The second setting changes how the first is drawn. */
  static override get settingKeys(): string[] {
    return ['customBorders', 'customBordersProgressive'];
  }

  override isEnabled(): boolean {
    const settings = this.grid.getSettings().customBorders;
    return settings === true || Array.isArray(settings);
  }

  protected override onEnable(): void {
    const settings = this.grid.getSettings().customBorders;
    if (Array.isArray(settings)) {
      this.#build(settings as BorderSpec[]);
    }
    this.addHook(
      'afterRenderer',
      (_value: unknown, td: HTMLTableCellElement, row: number, col: number) => {
        const border = this.getBorder(row, col);
        if (!border) {
          return;
        }
        for (const side of ['top', 'bottom', 'left', 'right'] as const) {
          const edge = border[side];
          if (!edge || edge.hide) {
            continue;
          }
          const property = `border${side[0]!.toUpperCase()}${side.slice(1)}` as
            | 'borderTop'
            | 'borderBottom'
            | 'borderLeft'
            | 'borderRight';
          td.style[property] = `${edge.width ?? 1}px solid ${edge.color ?? '#000'}`;
        }
        td.classList.add('cm-bordered');
      },
    );
    this.grid.render();
  }

  protected override onDisable(): void {
    this.clearBorders();
  }

  /** The border on one cell, or `null`. */
  getBorder(row: number, col: number): CellBorder | null {
    return (this.grid.getCellMeta(row, col)['border'] as CellBorder | undefined) ?? null;
  }

  /** Every cell that has a border, with it. */
  getBorders(): Array<{ row: number; col: number; border: CellBorder }> {
    const found: Array<{ row: number; col: number; border: CellBorder }> = [];
    for (let row = 0; row < this.grid.countRows(); row += 1) {
      for (let col = 0; col < this.grid.countCols(); col += 1) {
        const border = this.getBorder(row, col);
        if (border) {
          found.push({ row, col, border });
        }
      }
    }
    return found;
  }

  /**
   * Draws a border round the selection, or on one side of it.
   *
   * `all` outlines the whole rectangle rather than every cell in it: a table
   * with a box round it is what people mean, and bordering each cell would draw
   * a grid.
   */
  setBorders(place: BorderPlace, edge: BorderEdge = DEFAULT_BORDER): void {
    const range = this.grid.getSelectedRangeLast();
    if (!range) {
      return;
    }
    for (let row = range.topRow; row <= range.bottomRow; row += 1) {
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        if (place === 'none') {
          this.grid.removeCellMeta(row, col, 'border');
          continue;
        }
        const border: CellBorder = { ...(this.getBorder(row, col) ?? {}) };
        const onTop = row === range.topRow;
        const onBottom = row === range.bottomRow;
        const onLeft = col === range.startCol;
        const onRight = col === range.endCol;

        if ((place === 'top' || place === 'all') && onTop) {
          border.top = edge;
        }
        if ((place === 'bottom' || place === 'all') && onBottom) {
          border.bottom = edge;
        }
        if ((place === 'left' || place === 'all') && onLeft) {
          border.left = edge;
        }
        if ((place === 'right' || place === 'all') && onRight) {
          border.right = edge;
        }
        // A cell in the middle of a range gets no edge from a one-sided
        // request, and recording an empty border for it would make
        // `getBorders` report cells that have none.
        if (Object.keys(border).length > 0) {
          this.grid.setCellMeta(row, col, 'border', border);
        }
      }
    }
    this.grid.render();
  }

  /** Takes the borders off the selection, or off everything. */
  clearBorders(everywhere = false): void {
    if (everywhere) {
      for (const { row, col } of this.getBorders()) {
        this.grid.removeCellMeta(row, col, 'border');
      }
      this.grid.render();
      return;
    }
    this.setBorders('none');
  }

  /**
   * Applies the configured borders.
   *
   * A very large configuration blocks the first paint if it is all built up
   * front, so `customBordersProgressive` builds it in batches after the grid is
   * on screen. The trade is real and goes both ways — the borders appear a
   * moment late — so it is a setting rather than a rule.
   */
  #build(specs: BorderSpec[]): void {
    if (this.grid.getSettings().customBordersProgressive !== true) {
      for (const spec of specs) {
        this.#applySpec(spec);
      }
      return;
    }
    const batch = 200;
    let index = 0;
    const step = (): void => {
      if (!this.isPluginEnabled()) {
        return;
      }
      for (const spec of specs.slice(index, index + batch)) {
        this.#applySpec(spec);
      }
      index += batch;
      if (index < specs.length) {
        setTimeout(step, 0);
      } else {
        this.grid.render();
      }
    };
    setTimeout(step, 0);
  }

  #applySpec(spec: BorderSpec): void {
    const edges: CellBorder = {};
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      if (spec[side]) {
        edges[side] = spec[side];
      }
    }
    if (spec.range) {
      const { from, to } = spec.range;
      for (let row = from.row; row <= to.row; row += 1) {
        for (let col = from.col; col <= to.col; col += 1) {
          // Only the outside edges of the range, as `all` does.
          const border: CellBorder = {};
          if (edges.top && row === from.row) {
            border.top = edges.top;
          }
          if (edges.bottom && row === to.row) {
            border.bottom = edges.bottom;
          }
          if (edges.left && col === from.col) {
            border.left = edges.left;
          }
          if (edges.right && col === to.col) {
            border.right = edges.right;
          }
          if (Object.keys(border).length > 0) {
            this.grid.setCellMeta(row, col, 'border', border);
          }
        }
      }
      return;
    }
    if (spec.row !== undefined && spec.col !== undefined) {
      this.grid.setCellMeta(spec.row, spec.col, 'border', edges);
    }
  }
}

registerPlugin(CustomBorders as never);
