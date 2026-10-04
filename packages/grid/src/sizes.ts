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
  /**
   * Which indexes take no room.
   *
   * A hidden row is not a row of height zero as far as anything else is
   * concerned — it keeps its size, its data and its place — so this is a
   * question the owner answers rather than a size stored here. Without it the
   * map had no way to know, and hiding a row changed nothing on screen: the
   * renderer walks these sizes, and every hidden row was still a full one.
   */
  #hidden: ((index: number) => boolean) | null = null;
  /**
   * Whether anything is hidden at all.
   *
   * Asked separately from the per-index question because the fast paths below
   * need it, and answering them by walking every index would be the opposite
   * of a fast path. A grid with nothing hidden must keep taking the shortcut.
   */
  #anyHidden: (() => boolean) | null = null;

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

  /**
   * Whether every index is the same size.
   *
   * The three measurements below take a shortcut when it is, and the shortcut
   * is arithmetic on the default size — so a hidden index, which is zero and
   * not the default, has to disqualify it just as a resized one does.
   */
  get isUniform(): boolean {
    if (this.#overrides.size > 0) {
      return false;
    }
    // Nothing hidden means every index really is the default size, and the
    // shortcut is correct — which is the common case and worth keeping.
    return this.#anyHidden ? !this.#anyHidden() : this.#hidden === null;
  }

  /**
   * Tells the map which indexes are hidden.
   *
   * Passing `null` stops asking. The answer is read on every measurement
   * rather than cached, because what is hidden changes without the sizes
   * changing — the cached offsets are dropped here so the next read rebuilds.
   */
  hides(predicate: ((index: number) => boolean) | null, anyHidden?: () => boolean): void {
    this.#hidden = predicate;
    this.#anyHidden = predicate ? (anyHidden ?? null) : null;
    this.#offsets = null;
  }

  /** Drops the cached offsets, for an owner whose hidden set has changed. */
  remeasure(): void {
    this.#offsets = null;
  }

  /** The size of one index. */
  sizeOf(index: number): number {
    if (this.#hidden?.(index)) {
      return 0;
    }
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
