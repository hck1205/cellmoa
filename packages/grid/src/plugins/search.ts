/**
 * Searching the table.
 *
 * A search reads what the cells *show*, not what they hold: someone looking for
 * `1,234` is looking at the screen, and a search that only matched the stored
 * `1234` would find nothing. Matches are marked with a class rather than
 * changing anything, so a search never counts as an edit.
 */

import { BasePlugin, registerPlugin } from './base.js';

/** One cell the query matched. */
export interface SearchResult {
  row: number;
  col: number;
  data: string;
}

/** Decides whether one cell matches. */
export type SearchQueryMethod = (query: string, value: string) => boolean;

export interface SearchSettings {
  searchResultClass?: string;
  queryMethod?: SearchQueryMethod;
  callback?: (grid: unknown, row: number, col: number, value: string, matched: boolean) => void;
}

export const DEFAULT_SEARCH_RESULT_CLASS = 'htSearchResult';

/**
 * The default match: case-insensitive, anywhere in the text.
 *
 * An empty query matches nothing rather than everything — clearing the search
 * box should clear the highlights, not light up the whole sheet.
 */
export const DEFAULT_QUERY_METHOD: SearchQueryMethod = (query, value) => {
  if (query === '') {
    return false;
  }
  return value.toLowerCase().includes(query.toLowerCase());
};

export class Search extends BasePlugin {
  static override readonly pluginName: string = 'search';

  #query = '';
  #results: SearchResult[] = [];
  #cursor = -1;

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    this.addHook(
      'afterRenderer', (td: HTMLTableCellElement, row: number, col: number) => {
        if (this.#results.some((result) => result.row === row && result.col === col)) {
          td.classList.add(this.resultClass());
        }
      },
    );
  }

  protected override onDisable(): void {
    this.#results = [];
    this.#query = '';
    this.#cursor = -1;
  }

  /** The class put on a matching cell. */
  resultClass(): string {
    return this.options<SearchSettings>().searchResultClass ?? DEFAULT_SEARCH_RESULT_CLASS;
  }

  /** The matcher in use. */
  queryMethod(): SearchQueryMethod {
    return this.options<SearchSettings>().queryMethod ?? DEFAULT_QUERY_METHOD;
  }

  /** Runs a query over every cell and returns what matched. */
  query(text: string, callback?: SearchSettings['callback'], method?: SearchQueryMethod): SearchResult[] {
    const matches = method ?? this.queryMethod();
    const report = callback ?? this.options<SearchSettings>().callback;
    this.#query = text;
    this.#results = [];
    this.#cursor = -1;

    for (let row = 0; row < this.grid.countRows(); row += 1) {
      for (let col = 0; col < this.grid.countCols(); col += 1) {
        const value = this.grid.getDataAtCell(row, col);
        const matched = matches(text, value);
        if (matched) {
          this.#results.push({ row, col, data: value });
        }
        report?.(this.grid, row, col, value, matched);
      }
    }
    this.grid.render();
    return this.getResults();
  }

  /** What the last query found. */
  getResults(): SearchResult[] {
    return this.#results.map((result) => ({ ...result }));
  }

  /** The query that produced them. */
  getQuery(): string {
    return this.#query;
  }

  /**
   * Selects the next match, wrapping round at the end.
   *
   * Returns the match, or `null` when there were none — a caller showing
   * "3 of 12" needs to tell "nothing found" from "back to the first".
   */
  next(): SearchResult | null {
    return this.#step(1);
  }

  /** The previous one, wrapping the other way. */
  previous(): SearchResult | null {
    return this.#step(-1);
  }

  /** Forgets the query and takes the highlights off. */
  clear(): void {
    this.#query = '';
    this.#results = [];
    this.#cursor = -1;
    this.grid.render();
  }

  #step(direction: 1 | -1): SearchResult | null {
    if (this.#results.length === 0) {
      return null;
    }
    const count = this.#results.length;
    this.#cursor = (this.#cursor + direction + count) % count;
    const result = this.#results[this.#cursor]!;
    this.grid.selectCell(result.row, result.col);
    return { ...result };
  }
}

registerPlugin(Search);
