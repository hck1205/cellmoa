/**
 * Row heights and column widths, and where each one starts.
 *
 * Virtual scrolling needs two answers fast: where does index `i` begin, and
 * which index is at offset `y`. With every row the same height both are
 * arithmetic; the moment one row is resized they are not, and doing them by
 * summing from the top makes scrolling to the end of a large grid quadratic.
 *
 * So the sizes are kept as a default plus a sparse set of overrides, and the
 * running total is a prefix-sum array rebuilt only when an override changes.
 * A grid where nothing has been resized never builds one at all.
 */

/** Sizes for one axis. */
export class SizeMap {
  #default: number;
  #count: number;
  #overrides = new Map<number, number>();
  /** Prefix sums, built lazily and only while overrides exist. */
  #offsets: number[] | null = null;

  constructor(count: number, defaultSize: number) {
    this.#count = Math.max(count, 0);
    this.#default = defaultSize;
  }

  get count(): number {
    return this.#count;
  }

  set count(value: number) {
    this.#count = Math.max(value, 0);
    this.#offsets = null;
  }

  get defaultSize(): number {
    return this.#default;
  }

  set defaultSize(value: number) {
    this.#default = value;
    this.#offsets = null;
  }

  /** Whether anything has been resized away from the default. */
  get isUniform(): boolean {
    return this.#overrides.size === 0;
  }

  /** The size of one index. */
  sizeOf(index: number): number {
    return this.#overrides.get(index) ?? this.#default;
  }

  /** Resizes one index. Passing `null` restores the default. */
  setSize(index: number, size: number | null): void {
    if (size === null) {
      this.#overrides.delete(index);
    } else {
      this.#overrides.set(index, Math.max(size, 0));
    }
    this.#offsets = null;
  }

  /** Resizes several indexes at once. */
  setSizes(sizes: Iterable<[number, number | null]>): void {
    for (const [index, size] of sizes) {
      if (size === null) {
        this.#overrides.delete(index);
      } else {
        this.#overrides.set(index, Math.max(size, 0));
      }
    }
    this.#offsets = null;
  }

  /** Forgets every resize. */
  reset(): void {
    this.#overrides.clear();
    this.#offsets = null;
  }

  /** The resized indexes and their sizes, for saving the layout. */
  overrides(): Array<[number, number]> {
    return [...this.#overrides.entries()].sort((a, b) => a[0] - b[0]);
  }

  /** The total size of every index. */
  get total(): number {
    if (this.isUniform) {
      return this.#count * this.#default;
    }
    return this.#prefix()[this.#count]!;
  }

  /** Where an index begins. */
  offsetOf(index: number): number {
    const clamped = Math.min(Math.max(index, 0), this.#count);
    if (this.isUniform) {
      return clamped * this.#default;
    }
    return this.#prefix()[clamped]!;
  }

  /**
   * The index at an offset.
   *
   * Offsets past the end give the last index rather than `null`: a scroll
   * position can legitimately overshoot while the grid is shrinking, and the
   * caller wants somewhere to draw rather than an error.
   */
  indexAt(offset: number): number {
    if (this.#count === 0) {
      return 0;
    }
    if (offset <= 0) {
      return 0;
    }
    if (this.isUniform) {
      return Math.min(Math.floor(offset / this.#default), this.#count - 1);
    }
    const prefix = this.#prefix();
    // Binary search for the last index whose offset is at or below the target.
    let low = 0;
    let high = this.#count - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (prefix[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  /**
   * The half-open range of indexes covering `[start, start + length)`.
   *
   * The end is exclusive, and is clamped to the count, so a caller can loop
   * over it without checking.
   */
  rangeAt(start: number, length: number): { first: number; last: number } {
    if (this.#count === 0) {
      return { first: 0, last: -1 };
    }
    const first = this.indexAt(start);
    const end = start + length;
    let last = first;
    // Walking forward is right even with overrides: a viewport holds a bounded
    // number of rows, so this is bounded by what is on screen, not by the grid.
    while (last + 1 < this.#count && this.offsetOf(last + 1) < end) {
      last += 1;
    }
    return { first, last };
  }

  #prefix(): number[] {
    if (this.#offsets && this.#offsets.length === this.#count + 1) {
      return this.#offsets;
    }
    const offsets = new Array<number>(this.#count + 1);
    offsets[0] = 0;
    for (let i = 0; i < this.#count; i += 1) {
      offsets[i + 1] = offsets[i]! + this.sizeOf(i);
    }
    this.#offsets = offsets;
    return offsets;
  }
}
