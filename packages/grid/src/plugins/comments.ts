/**
 * Cell comments.
 *
 * A comment is metadata on a cell rather than a value in it, so it is kept in
 * the cell's settings and never reaches the workbook — a comment must not
 * change what a formula reading that cell sees.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface CommentSettings {
  displayDelay?: number;
  readOnly?: boolean;
  style?: { width?: number; height?: number };
}

export interface Comment {
  value: string;
  readOnly?: boolean;
  style?: { width?: number; height?: number };
}

export class Comments extends BasePlugin {
  static override readonly pluginName: string = 'comments';

  #editor: HTMLElement | null = null;

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    this.addHook('afterRenderer', (td: HTMLTableCellElement, row: number, col: number) => {
      const comment = this.getComment(row, col);
      if (comment) {
        td.classList.add(String(this.grid.getSettings().commentedCellClassName ?? 'htCommentCell'));
        td.title = comment.value;
      }
    });
  }

  protected override onDisable(): void {
    this.hide();
  }

  /** The comment on a cell, or `null`. */
  getComment(row: number, col: number): Comment | null {
    const meta = this.grid.getCellMeta(row, col);
    const comment = meta.comment as Comment | string | undefined;
    if (comment === undefined) {
      return null;
    }
    return typeof comment === 'string' ? { value: comment } : comment;
  }

  /** Attaches a comment to a cell. */
  setComment(row: number, col: number, value: string): void {
    if (this.grid.hooks.allows('beforeSetComment', row, col, value) === false) {
      return;
    }
    this.grid.setCellMeta(row, col, 'comment', { value });
    this.grid.hooks.notify('afterSetComment', row, col, value);
    this.grid.render();
  }

  /** Removes it. */
  removeComment(row: number, col: number): void {
    this.grid.removeCellMeta(row, col, 'comment');
    this.grid.hooks.notify('afterRemoveComment', row, col);
    this.grid.render();
  }

  /** Attaches a comment to whatever is selected. */
  setCommentAtSelection(value: string): void {
    const highlight = this.grid.selection.highlight;
    if (highlight) {
      this.setComment(highlight.row, highlight.col, value);
    }
  }

  /** Shows the comment for a cell, as an editable box. */
  show(row: number, col: number): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    this.hide();
    const comment = this.getComment(row, col);
    const element = view.root.ownerDocument.createElement('textarea');
    element.className = 'cm-comment';
    element.value = comment?.value ?? '';
    element.readOnly = comment?.readOnly === true;

    const cell = view.elementAt(row, col);
    if (cell) {
      element.style.position = 'absolute';
      element.style.left = `${cell.offsetLeft + cell.offsetWidth}px`;
      element.style.top = `${cell.offsetTop}px`;
    }
    element.addEventListener('blur', () => {
      const value = element.value.trim();
      if (value === '') {
        this.removeComment(row, col);
      } else {
        this.setComment(row, col, value);
      }
      this.hide();
    });
    view.root.appendChild(element);
    this.#editor = element;
    element.focus();
  }

  /** Takes the box down. */
  hide(): void {
    this.#editor?.remove();
    this.#editor = null;
  }
}

registerPlugin(Comments);
