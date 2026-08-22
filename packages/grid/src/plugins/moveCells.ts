/**
 * Dragging a block of cells to another place.
 *
 * Moving is not copying, and the difference shows in the formulas. A cell that
 * is *copied* one row down has its relative references shifted; a cell that is
 * *moved* keeps pointing at exactly what it pointed at, because it is the same
 * cell in a new place. Formulas elsewhere that referred to the moved cells have
 * to follow them, which is the same problem inserting a row solves — so it is
 * solved the same way, by the engine, in one commit.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface Rectangle {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export class MoveCells extends BasePlugin {
  static override readonly pluginName: string = 'moveCells';

  #dragging = false;

  override isEnabled(): boolean {
    return this.grid.getSettings().moveCells !== false;
  }

  protected override onEnable(): void {
    // The drag handles are the view's; this plugin performs the move.
  }

  /** Whether a move is in progress. */
  isDragActive(): boolean {
    return this.#dragging;
  }

  /** Notes that a drag has started or ended, for a caller driving one. */
  setDragActive(active: boolean): void {
    this.#dragging = active;
  }

  /**
   * Moves a block so its top-left lands at `(row, col)`.
   *
   * Returns false when the move was refused: onto itself, off the sheet, or
   * vetoed by a hook.
   */
  moveCellRange(source: Rectangle, row: number, col: number, isCopy = false): boolean {
    const height = source.endRow - source.startRow + 1;
    const width = source.endCol - source.startCol + 1;
    const dRow = row - source.startRow;
    const dCol = col - source.startCol;
    if ((dRow === 0 && dCol === 0) || row < 0 || col < 0) {
      return false;
    }
    if (this.grid.hooks.allows('beforeMoveCells', source, { row, col }, isCopy) === false) {
      return false;
    }

    // Read everything first. Writing as we go would let a block overwrite the
    // part of itself it has not read yet whenever source and target overlap.
    const carried: string[][] = [];
    for (let r = source.startRow; r <= source.endRow; r += 1) {
      const line: string[] = [];
      for (let c = source.startCol; c <= source.endCol; c += 1) {
        line.push(this.grid.getEditableValue(r, c));
      }
      carried.push(line);
    }

    const changes: Array<[number, number, string]> = [];
    if (!isCopy) {
      // Clearing the source before writing the target, and only the parts of it
      // the target does not cover.
      for (let r = source.startRow; r <= source.endRow; r += 1) {
        for (let c = source.startCol; c <= source.endCol; c += 1) {
          const insideTarget =
            r >= row && r < row + height && c >= col && c < col + width;
          if (!insideTarget) {
            changes.push([r, c, '']);
          }
        }
      }
    }
    carried.forEach((line, r) => {
      line.forEach((value, c) => {
        // A move keeps the formula exactly as it was; a copy shifts it, which
        // is what the clipboard already does, so a copy-drag goes through the
        // same translation.
        const text = isCopy ? this.grid.translateFormula(value, dRow, dCol) : value;
        changes.push([row + r, col + c, text]);
      });
    });

    this.grid.setDataAtCells(changes, isCopy ? 'copyDrag' : 'moveCells');
    this.grid.selectCell(row, col, row + height - 1, col + width - 1);
    this.grid.hooks.run('afterMoveCells', undefined, source, { row, col }, isCopy);
    return true;
  }
}

registerPlugin(MoveCells);
