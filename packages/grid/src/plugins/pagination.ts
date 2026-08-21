/**
 * Showing the table one page at a time.
 *
 * A page is a window over the rows, and the rows outside it are *trimmed* —
 * taken out of the visual space rather than hidden. That is the right primitive:
 * a trimmed row is not row 40 that you cannot see, it is simply not there, so
 * "row 1 of page 2" is row 1 on screen. The values stay in the workbook and a
 * formula reading them still reads them, because paging is a way of looking at
 * a sheet, not a change to it.
 */

import { BasePlugin, registerPlugin } from './base.js';
import { OwnedIndexes } from './ownedIndexes.js';

export interface PaginationSettings {
  pageSize?: number | 'auto';
  initialPage?: number;
  pageSizeList?: Array<number | 'auto'>;
  uiContainer?: HTMLElement;
  showCounter?: boolean;
  showNavigation?: boolean;
  showPageSize?: boolean;
}

/** What a pager needs to draw itself. */
export interface PaginationData {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeList: Array<number | 'auto'>;
  autoPageSize: boolean;
  numberOfRenderedRows: number;
  firstVisibleRowIndex: number;
  lastVisibleRowIndex: number;
}

export const DEFAULT_PAGE_SIZE = 10;

export class Pagination extends BasePlugin {
  static override readonly pluginName: string = 'pagination';

  #page = 1;
  #pager: HTMLElement | null = null;
  #pageSize: number | 'auto' = DEFAULT_PAGE_SIZE;
  /** The rows this plugin is holding out of view. */
  readonly #outside = new OwnedIndexes(() => this.grid.rowIndex, 'trim');

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    const options = this.options<PaginationSettings>();
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.#page = Math.max(options.initialPage ?? 1, 1);
    this.#apply();
    this.#drawPager();
  }

  protected override onDisable(): void {
    this.#outside.clear();
    this.grid.view?.layout.unregister('pagination', 'bottom');
    this.#pager = null;
    this.grid.render();
  }

  /**
   * How many rows there are to page through.
   *
   * The *visual* count, not the physical one: a filter may already have taken
   * rows out, and paging through rows a filter excluded would give empty pages.
   * This plugin's own trims are added back rather than released, because asking
   * how many rows there are must not change which ones are showing.
   */
  countAllRows(): number {
    return this.grid.rowIndex.visibleLength + this.#outside.size;
  }

  /** The page size in force, resolving `auto` against the viewport. */
  getCurrentPageSize(): number {
    if (this.#pageSize !== 'auto') {
      return Math.max(this.#pageSize, 1);
    }
    const height = this.grid.view?.root.clientHeight ?? 0;
    const rowHeight = this.grid.getRowHeight(0) || 23;
    return Math.max(Math.floor(height / rowHeight) - 1, 1);
  }

  getCurrentPage(): number {
    return this.#page;
  }

  /** How many pages the rows make at the current size. */
  countPages(): number {
    return Math.max(Math.ceil(this.countAllRows() / this.getCurrentPageSize()), 1);
  }

  /** Everything a pager needs to draw itself. */
  getPaginationData(): PaginationData {
    const options = this.options<PaginationSettings>();
    const pageSize = this.getCurrentPageSize();
    const start = (this.#page - 1) * pageSize;
    const rendered = this.grid.countRows();
    return {
      currentPage: this.#page,
      totalPages: this.countPages(),
      pageSize,
      pageSizeList: options.pageSizeList ?? [10, 20, 50, 100],
      autoPageSize: this.#pageSize === 'auto',
      numberOfRenderedRows: rendered,
      firstVisibleRowIndex: rendered > 0 ? start : -1,
      lastVisibleRowIndex: rendered > 0 ? start + rendered - 1 : -1,
    };
  }

  /** Goes to a page, clamped to the ones that exist. */
  setPage(page: number): void {
    const target = Math.min(Math.max(page, 1), this.countPages());
    if (target === this.#page) {
      return;
    }
    if (this.grid.hooks.allows('beforePageChange', target, this.#page) === false) {
      return;
    }
    const previous = this.#page;
    this.#page = target;
    this.#apply();
    this.grid.hooks.run('afterPageChange', undefined, target, previous);
  }

  nextPage(): void {
    this.setPage(this.#page + 1);
  }

  prevPage(): void {
    this.setPage(this.#page - 1);
  }

  /** Back to the first page. */
  resetPage(): void {
    this.setPage(1);
  }

  /** Changes how many rows a page holds, keeping the first visible row in view. */
  setPageSize(pageSize: number | 'auto'): void {
    if (this.grid.hooks.allows('beforePageSizeChange', pageSize, this.#pageSize) === false) {
      return;
    }
    // The row at the top of the current page stays on screen, so changing the
    // size does not lose the reader's place.
    const firstRow = (this.#page - 1) * this.getCurrentPageSize();
    const previous = this.#pageSize;
    this.#pageSize = pageSize;
    this.#page = Math.floor(firstRow / this.getCurrentPageSize()) + 1;
    this.#apply();
    this.grid.hooks.run('afterPageSizeChange', undefined, pageSize, previous);
  }

  resetPageSize(): void {
    this.setPageSize(this.options<PaginationSettings>().pageSize ?? DEFAULT_PAGE_SIZE);
  }

  /** Back to page one at the original size. */
  resetPagination(): void {
    this.#page = 1;
    this.resetPageSize();
  }

  /** The pager element, or `null` when it is not drawn. */
  get pager(): HTMLElement | null {
    return this.#pager;
  }

  /**
   * Draws the pager into the slot below the grid.
   *
   * Rebuilt rather than updated: it has four buttons and a label, and the cost
   * of getting one of them out of step with the page is higher than the cost of
   * making five elements.
   */
  #drawPager(): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    const options = this.options<PaginationSettings>();
    const doc = view.root.ownerDocument;
    const pager = doc.createElement('div');
    pager.className = 'cm-pagination';
    pager.setAttribute('role', 'navigation');

    if (options.showCounter !== false) {
      const counter = doc.createElement('span');
      counter.className = 'cm-pagination-counter';
      counter.textContent = `${this.#page} / ${this.countPages()}`;
      pager.appendChild(counter);
    }
    if (options.showNavigation !== false) {
      for (const [label, target, disabled] of [
        ['«', 1, this.#page === 1],
        ['‹', this.#page - 1, this.#page === 1],
        ['›', this.#page + 1, this.#page === this.countPages()],
        ['»', this.countPages(), this.#page === this.countPages()],
      ] as const) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'cm-pagination-button';
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener('click', () => this.setPage(target));
        pager.appendChild(button);
      }
    }
    view.layout.register('pagination', pager, { side: 'bottom', weight: 100 });
    this.#pager = pager;
  }

  /** Holds everything outside the current page out of view. */
  #apply(): void {
    const pageSize = this.getCurrentPageSize();
    const start = (this.#page - 1) * pageSize;
    const end = start + pageSize;
    const outside: number[] = [];
    const total = this.countAllRows();
    // Counted over the whole visual space with this plugin's rows added back,
    // so paging does not walk off the end of what a filter left behind.
    this.#outside.clear();
    for (let visual = 0; visual < total; visual += 1) {
      if (visual < start || visual >= end) {
        const physical = this.grid.rowIndex.toPhysical(visual);
        if (physical !== null) {
          outside.push(physical);
        }
      }
    }
    this.#outside.set(outside);
    if (this.#pager) {
      this.#drawPager();
    }
    this.grid.render();
  }
}

registerPlugin(Pagination);
