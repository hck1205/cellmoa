/**
 * The handles at the corners of a selection.
 *
 * On a desktop they are the fill handle and the resize corners; on a touch
 * device they are what you drag to change a selection, since there is no way to
 * shift-click with a finger. Both draw the same elements, so both plugins share
 * the drawing and differ only in which handles appear and what a drag does.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** Where a handle sits on the selection. */
export type HandlePosition = 'top-left' | 'bottom-right';

abstract class Handles extends BasePlugin {
  #elements: HTMLElement[] = [];

  /** Which corners this plugin puts a handle on. */
  protected abstract positions(): HandlePosition[];

  /** The class the handles carry. */
  protected abstract handleClass(): string;

  protected override onEnable(): void {
    this.addHook('afterRender', () => this.reposition());
    this.addHook('afterSelection', () => this.reposition());
    this.reposition();
  }

  protected override onDisable(): void {
    this.#remove();
  }

  /** The handle elements currently on screen. */
  getHandles(): HTMLElement[] {
    return [...this.#elements];
  }

  /** Puts the handles where the selection is, or takes them away. */
  reposition(): void {
    this.#remove();
    const view = this.grid.view;
    const range = this.grid.getSelectedRangeLast();
    if (!view || !range) {
      return;
    }
    for (const position of this.positions()) {
      const row = position === 'top-left' ? range.topRow : range.bottomRow;
      const col = position === 'top-left' ? range.startCol : range.endCol;
      const cell = view.elementAt(row, col);
      if (!cell) {
        continue;
      }
      const handle = view.root.ownerDocument.createElement('div');
      handle.className = `${this.handleClass()} ${this.handleClass()}--${position}`;
      handle.dataset['position'] = position;
      handle.style.position = 'absolute';
      handle.style.left = `${position === 'top-left' ? cell.offsetLeft : cell.offsetLeft + cell.offsetWidth}px`;
      handle.style.top = `${position === 'top-left' ? cell.offsetTop : cell.offsetTop + cell.offsetHeight}px`;
      this.#bind(handle, position);
      view.root.appendChild(handle);
      this.#elements.push(handle);
    }
  }

  /** Hooks a handle up to whatever dragging it should do. */
  protected abstract bindHandle(handle: HTMLElement, position: HandlePosition): void;

  #bind(handle: HTMLElement, position: HandlePosition): void {
    this.bindHandle(handle, position);
  }

  #remove(): void {
    for (const element of this.#elements) {
      element.remove();
    }
    this.#elements = [];
  }
}

/**
 * The desktop handle: one square at the bottom-right, which fills.
 *
 * Dragging it hands off to the autofill plugin rather than doing the fill
 * itself — what a fill *means* is a question with one answer, and two
 * implementations of it would eventually disagree.
 */
export class SelectionHandles extends Handles {
  static override readonly pluginName: string = 'selectionHandles';

  override isEnabled(): boolean {
    return this.grid.getSettings().selectionHandles !== false;
  }

  protected override positions(): HandlePosition[] {
    return ['bottom-right'];
  }

  protected override handleClass(): string {
    return 'cm-fill-handle';
  }

  protected override bindHandle(handle: HTMLElement): void {
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.#startFill();
    });
  }

  #startFill(): void {
    const view = this.grid.view;
    const range = this.grid.getSelectedRangeLast();
    if (!view || !range) {
      return;
    }
    const doc = view.root.ownerDocument;
    let target = { row: range.bottomRow, col: range.endCol };

    const onMove = (event: MouseEvent): void => {
      const cell = (doc.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest(
        'td',
      );
      if (cell instanceof HTMLTableCellElement) {
        target = { row: Number(cell.dataset['row']), col: Number(cell.dataset['col']) };
      }
    };
    const onUp = (): void => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      const autofill = this.grid.getPlugin('autofill') as unknown as {
        fill(area: { startRow: number; endRow: number; startCol: number; endCol: number }): void;
      } | null;
      autofill?.fill({
        startRow: Math.min(range.topRow, target.row),
        endRow: Math.max(range.bottomRow, target.row),
        startCol: Math.min(range.startCol, target.col),
        endCol: Math.max(range.endCol, target.col),
      });
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }
}

registerPlugin(SelectionHandles);

/**
 * The touch handles: one at each end of the selection, which resize it.
 *
 * Two of them, because a finger cannot shift-click: without a handle at each
 * end there is no way to extend a selection upward.
 */
export class MultipleSelectionHandles extends Handles {
  static override readonly pluginName: string = 'multipleSelectionHandles';

  #dragged: HandlePosition | null = null;

  override isEnabled(): boolean {
    return this.grid.getSettings().multipleSelectionHandles !== false;
  }

  protected override positions(): HandlePosition[] {
    return ['top-left', 'bottom-right'];
  }

  protected override handleClass(): string {
    return 'cm-selection-handle';
  }

  /** Whether one of the handles is being dragged. */
  isDragged(): boolean {
    return this.#dragged !== null;
  }

  protected override bindHandle(handle: HTMLElement, position: HandlePosition): void {
    handle.addEventListener('touchstart', (event) => {
      event.preventDefault();
      this.#dragged = position;
    });
    handle.addEventListener('touchmove', (event) => this.#onMove(event));
    handle.addEventListener('touchend', () => {
      this.#dragged = null;
    });
  }

  #onMove(event: TouchEvent): void {
    const touch = event.touches[0];
    const range = this.grid.getSelectedRangeLast();
    const doc = this.grid.view?.root.ownerDocument;
    if (!touch || !range || !doc || this.#dragged === null) {
      return;
    }
    const cell = (doc.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null)?.closest(
      'td',
    );
    if (!(cell instanceof HTMLTableCellElement)) {
      return;
    }
    const row = Number(cell.dataset['row']);
    const col = Number(cell.dataset['col']);
    // The handle being dragged moves; the other end stays where it is.
    if (this.#dragged === 'top-left') {
      this.grid.selectCell(row, col, range.bottomRow, range.endCol);
    } else {
      this.grid.selectCell(range.topRow, range.startCol, row, col);
    }
    event.preventDefault();
  }
}

registerPlugin(MultipleSelectionHandles);
