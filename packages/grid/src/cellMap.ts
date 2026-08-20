/**
 * A map from a cell position to something.
 *
 * Several things are remembered per cell — who last touched it, whether a check
 * failed on it, how it differs from a snapshot — and each of them was keying a
 * `Map` on a string built by hand. That works until one of them writes
 * `${col}:${row}`, which compiles, runs, and is wrong in a way nothing points
 * at. Having the key built in one place makes that unrepresentable.
 */
export class CellMap<T> implements Iterable<[number, number, T]> {
  #entries = new Map<string, { row: number; col: number; value: T }>();

  get size(): number {
    return this.#entries.size;
  }

  get(row: number, col: number): T | undefined {
    return this.#entries.get(key(row, col))?.value;
  }

  has(row: number, col: number): boolean {
    return this.#entries.has(key(row, col));
  }

  set(row: number, col: number, value: T): this {
    this.#entries.set(key(row, col), { row, col, value });
    return this;
  }

  delete(row: number, col: number): boolean {
    return this.#entries.delete(key(row, col));
  }

  clear(): void {
    this.#entries.clear();
  }

  /** Every entry, as `[row, col, value]`. */
  *[Symbol.iterator](): Iterator<[number, number, T]> {
    for (const { row, col, value } of this.#entries.values()) {
      yield [row, col, value];
    }
  }

  /** The positions that have an entry. */
  *positions(): Generator<{ row: number; col: number }> {
    for (const { row, col } of this.#entries.values()) {
      yield { row, col };
    }
  }
}

/**
 * The same, when the position is all that needs remembering.
 *
 * A `CellMap<true>` would serve, but reading `has(row, col)` on a set says what
 * is meant where reading it on a map of `true` does not.
 */
export class CellSet implements Iterable<{ row: number; col: number }> {
  #cells = new CellMap<true>();

  get size(): number {
    return this.#cells.size;
  }

  has(row: number, col: number): boolean {
    return this.#cells.has(row, col);
  }

  add(row: number, col: number): this {
    this.#cells.set(row, col, true);
    return this;
  }

  delete(row: number, col: number): boolean {
    return this.#cells.delete(row, col);
  }

  clear(): void {
    this.#cells.clear();
  }

  [Symbol.iterator](): Iterator<{ row: number; col: number }> {
    return this.#cells.positions();
  }
}

function key(row: number, col: number): string {
  return `${row}:${col}`;
}
