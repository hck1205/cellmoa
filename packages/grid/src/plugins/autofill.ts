/**
 * Filling by dragging the handle at the corner of a selection.
 *
 * The interesting part is what a drag means. Dragging one number down repeats
 * it; dragging two continues the series they imply; dragging a formula copies
 * it with its relative references shifted — which the engine does, so the fill
 * only has to hand it the right source text.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface AutofillSettings {
  autoInsertRow?: boolean;
  direction?: 'vertical' | 'horizontal';
}

/**
 * Continues a series.
 *
 * Two or more numbers spaced evenly continue by that spacing; anything else
 * repeats. A single number repeats rather than counting up, which is what
 * every spreadsheet does and what people expect when they drag one cell.
 *
 * The result says where each filled value came from as well as what it is, so
 * a caller filling formulas can shift their references by the distance the
 * formula actually travelled — repeating a block of three every fourth cell
 * comes from the first of the three, not from three cells back.
 */
export interface Filled {
  value: string;
  /** How far this value is from the cell it was taken from. */
  distance: number;
}

export function extendSeries(source: string[], length: number): string[] {
  return fillFrom(source, length).map((filled) => filled.value);
}

/** The same fill, with each value's distance from its source. */
export function fillFrom(source: string[], length: number): Filled[] {
  const numbers = source.map((value) => Number(value));
  const allNumeric = source.length > 0 && numbers.every((n) => Number.isFinite(n) && source.length > 0);

  if (allNumeric && source.length >= 2) {
    const step = numbers[1]! - numbers[0]!;
    const even = numbers.every((n, i) => i === 0 || n - numbers[i - 1]! === step);
    if (even && step !== 0) {
      const last = numbers[numbers.length - 1]!;
      // A computed number has no source cell to shift a formula from.
      return Array.from({ length }, (_, i) => ({
        value: String(last + step * (i + 1)),
        distance: 0,
      }));
    }
  }
  // Anything else repeats the block, each value coming from the cell one whole
  // block back.
  return Array.from({ length }, (_, i) => ({
    value: source[i % source.length] ?? '',
    distance: source.length * (Math.floor(i / source.length) + 1),
  }));
}

export class Autofill extends BasePlugin {
  static override readonly pluginName: string = 'autofill';

  override isEnabled(): boolean {
    const settings = this.grid.getSettings();
    return settings.fillHandle !== false && settings.fillHandle !== undefined;
  }

  protected override onEnable(): void {
    // The handle itself is drawn by the view; this plugin provides the fill.
  }

  /**
   * Fills from the current selection into a larger rectangle.
   *
   * `direction` follows the drag: down and right continue forward, up and left
   * continue backward.
   */
  fill(target: { startRow: number; endRow: number; startCol: number; endCol: number }): void {
    const source = this.grid.getSelectedRangeLast();
    if (!source) {
      return;
    }
    if (this.grid.hooks.allows('beforeAutofill', source.toArray(), target) === false) {
      return;
    }
    const changes: Array<[number, number, string]> = [];

    const fillsDown = target.endRow > source.bottomRow;
    const fillsUp = target.startRow < source.topRow;
    const fillsRight = target.endCol > source.endCol;
    const fillsLeft = target.startCol < source.startCol;

    if (fillsDown || fillsUp) {
      for (let col = source.startCol; col <= source.endCol; col += 1) {
        const values: string[] = [];
        for (let row = source.topRow; row <= source.bottomRow; row += 1) {
          // The formula rather than the result, so it can be shifted the way a
          // copy would shift it.
          values.push(this.grid.getSourceDataAtCell(row, col));
        }
        if (fillsDown) {
          fillFrom(values, target.endRow - source.bottomRow).forEach((filled, index) => {
            changes.push([
              source.bottomRow + index + 1,
              col,
              this.grid.translateFormula(filled.value, filled.distance, 0),
            ]);
          });
        }
        if (fillsUp) {
          // Upward, the series runs backward, so the source is reversed and the
          // results are laid back down in reverse too.
          fillFrom([...values].reverse(), source.topRow - target.startRow).forEach(
            (filled, index) => {
              changes.push([
                source.topRow - index - 1,
                col,
                this.grid.translateFormula(filled.value, -filled.distance, 0),
              ]);
            },
          );
        }
      }
    }
    if (fillsRight || fillsLeft) {
      for (let row = source.topRow; row <= source.bottomRow; row += 1) {
        const values: string[] = [];
        for (let col = source.startCol; col <= source.endCol; col += 1) {
          values.push(this.grid.getSourceDataAtCell(row, col));
        }
        if (fillsRight) {
          fillFrom(values, target.endCol - source.endCol).forEach((filled, index) => {
            changes.push([
              row,
              source.endCol + index + 1,
              this.grid.translateFormula(filled.value, 0, filled.distance),
            ]);
          });
        }
        if (fillsLeft) {
          fillFrom([...values].reverse(), source.startCol - target.startCol).forEach(
            (filled, index) => {
              changes.push([
                row,
                source.startCol - index - 1,
                this.grid.translateFormula(filled.value, 0, -filled.distance),
              ]);
            },
          );
        }
      }
    }

    if (changes.length > 0) {
      this.grid.setDataAtCells(changes, 'autofill');
    }
    this.grid.hooks.run('afterAutofill', undefined, source.toArray(), target);
  }
}

registerPlugin(Autofill as never);
