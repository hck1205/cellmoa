/**
 * The map between physical and visual indexes.
 *
 * Sorting, moving, hiding and trimming all say the same thing in different
 * ways: the order the user sees is not the order the data is in. Every one of
 * those features is a change to this map rather than to the data, which is why
 * sorting a grid does not touch the workbook and why undoing a sort is free.
 *
 * Three index spaces, and the difference between the last two is the part that
 * is easy to get wrong:
 *
 * * **physical** — where a row lives in the data. Never changes when the view
 *   does.
 * * **visual** — what the user counts. Excludes trimmed rows entirely, so a
 *   filtered-out row is not "row 5 that you cannot see"; it is not there.
 * * **renderable** — what is actually drawn. Excludes hidden rows, which *are*
 *   still counted visually — that is what makes hiding a column different from
 *   filtering it away, and why a formula referring to a hidden column still
 *   works while one referring to a trimmed row does not.
 */

/** Maps physical indexes to visual and renderable ones. */
export class IndexMapper {
  /** Visual order: `#sequence[visual] === physical`. */
  #sequence: number[] = [];
  /** Physical indexes removed from the visual set entirely. */
  #trimmed = new Set<number>();
  /** Physical indexes that are counted but not drawn. */
  #hidden = new Set<number>();

  /** Derived from the above; rebuilt whenever any of them changes. */
  #notTrimmed: number[] = [];
  #renderable: number[] = [];
  #visualByPhysical = new Map<number, number>();
  #renderableByVisual = new Map<number, number>();
  #dirty = true;
  /**
   * How many times the map has changed.
   *
   * Anything that derives from the order or the hidden set — the size map's
   * prefix sums, most of all — needs to know when to throw its own cache away.
   * Counting here rather than announcing it from each mutation means a new
   * mutation cannot forget: it already has to mark the map dirty to work at
   * all, and that is the same moment.
   */
  #version = 0;

  constructor(length = 0) {
    this.setLength(length);
  }

  /** Resets to `length` indexes in their natural order. */
  setLength(length: number): void {
    this.#sequence = Array.from({ length }, (_, i) => i);
    this.#trimmed.clear();
    this.#hidden.clear();
    this.#dirty = true;
    this.#version += 1;
  }

  /** How many indexes exist, trimmed ones included. */
  /** Bumped on every change, so a derived cache can tell it is stale. */
  get version(): number {
    return this.#version;
  }

  get length(): number {
    return this.#sequence.length;
  }

  /** How many the user can count — the length of the visual space. */
  get visibleLength(): number {
    this.#rebuild();
    return this.#notTrimmed.length;
  }

  /** How many are actually drawn. */
  get renderableLength(): number {
    this.#rebuild();
    return this.#renderable.length;
  }

  /** The physical order, as an array indexed by visual position. */
  getSequence(): number[] {
    return [...this.#sequence];
  }

  /**
   * Replaces the order. This is what a sort does — the data does not move.
   */
  setSequence(sequence: number[]): void {
    this.#sequence = [...sequence];
    this.#dirty = true;
    this.#version += 1;
  }

  /** The physical index at a visual position, or `null` past the end. */
  toPhysical(visual: number): number | null {
    this.#rebuild();
    return this.#notTrimmed[visual] ?? null;
  }

  /** The visual position of a physical index, or `null` if it is trimmed. */
  toVisual(physical: number): number | null {
    this.#rebuild();
    return this.#visualByPhysical.get(physical) ?? null;
  }

  /** The renderable position of a visual one, or `null` if it is hidden. */
  toRenderable(visual: number): number | null {
    this.#rebuild();
    return this.#renderableByVisual.get(visual) ?? null;
  }

  /** The visual position of a renderable one. */
  fromRenderable(renderable: number): number | null {
    this.#rebuild();
    const physical = this.#renderable[renderable];
    return physical === undefined ? null : (this.toVisual(physical) ?? null);
  }

  /**
   * The first visible visual index at or after `visual`, searching in the given
   * direction. Used to skip over hidden rows when moving the selection.
   */
  firstVisible(visual: number, direction: 1 | -1 = 1): number | null {
    this.#rebuild();
    for (let i = visual; i >= 0 && i < this.#notTrimmed.length; i += direction) {
      if (this.toRenderable(i) !== null) {
        return i;
      }
    }
    return null;
  }

  /** Marks physical indexes as trimmed, removing them from the visual space. */
  trim(physical: Iterable<number>): void {
    for (const index of physical) {
      this.#trimmed.add(index);
    }
    this.#dirty = true;
    this.#version += 1;
  }

  /** Removes indexes from the trimmed set. */
  untrim(physical?: Iterable<number>): void {
    if (physical === undefined) {
      this.#trimmed.clear();
    } else {
      for (const index of physical) {
        this.#trimmed.delete(index);
      }
    }
    this.#dirty = true;
    this.#version += 1;
  }

  /** Hides physical indexes: still counted, not drawn. */
  hide(physical: Iterable<number>): void {
    for (const index of physical) {
      this.#hidden.add(index);
    }
    this.#dirty = true;
    this.#version += 1;
  }

  /** Removes indexes from the hidden set. */
  unhide(physical?: Iterable<number>): void {
    if (physical === undefined) {
      this.#hidden.clear();
    } else {
      for (const index of physical) {
        this.#hidden.delete(index);
      }
    }
    this.#dirty = true;
    this.#version += 1;
  }

  isTrimmed(physical: number): boolean {
    return this.#trimmed.has(physical);
  }

  isHidden(physical: number): boolean {
    return this.#hidden.has(physical);
  }

  /** The trimmed physical indexes, in order. */
  getTrimmed(): number[] {
    return [...this.#trimmed].sort((a, b) => a - b);
  }

  /** The hidden physical indexes, in order. */
  /** Whether anything is hidden at all, without building the list. */
  get hasHidden(): boolean {
    return this.#hidden.size > 0;
  }

  getHidden(): number[] {
    return [...this.#hidden].sort((a, b) => a - b);
  }

  /**
   * Moves visual indexes so that the first of them lands at `finalIndex`,
   * keeping their relative order.
   *
   * The destination is worked out against the sequence with the moved items
   * already taken out, and only when the block actually fits below
   * `finalIndex`; otherwise it goes to the end. That is what makes dragging a
   * row downward land where the user aimed rather than one place short — the
   * rows above it have already closed up by the time it arrives.
   */
  moveIndexes(moved: number[], finalIndex: number): void {
    this.#rebuild();
    const physicalMoved = moved
      .map((visual) => this.toPhysical(visual))
      .filter((physical): physical is number => physical !== null);
    if (physicalMoved.length === 0) {
      return;
    }
    const movedSet = new Set(physicalMoved);
    const notMoved = this.#sequence.filter((physical) => !movedSet.has(physical));
    const notTrimmedNotMoved = notMoved.filter((physical) => !this.#trimmed.has(physical));

    // Past the end, the block goes after everything that is left.
    const last = notTrimmedNotMoved[notTrimmedNotMoved.length - 1];
    let destination = last === undefined ? notMoved.length : notMoved.indexOf(last) + 1;

    if (finalIndex + physicalMoved.length < this.#notTrimmed.length) {
      const anchor = notTrimmedNotMoved[finalIndex];
      if (anchor !== undefined) {
        destination = notMoved.indexOf(anchor);
      }
    }
    notMoved.splice(destination, 0, ...physicalMoved);
    this.#sequence = notMoved;
    this.#dirty = true;
    this.#version += 1;
  }

  /**
   * Inserts `count` new indexes at a physical position.
   *
   * Every index at or after the insertion point shifts up, in the sequence and
   * in the trimmed and hidden sets alike — a hidden row must stay hidden when
   * a row is inserted above it.
   */
  insertIndexes(at: number, count: number): void {
    const shift = (index: number) => (index >= at ? index + count : index);
    this.#sequence = this.#sequence.map(shift);
    this.#trimmed = new Set([...this.#trimmed].map(shift));
    this.#hidden = new Set([...this.#hidden].map(shift));

    const added = Array.from({ length: count }, (_, i) => at + i);
    // The new indexes go in at the position matching their physical place, so
    // an insert into an unsorted grid is a plain insert.
    const insertAt = this.#sequence.findIndex((physical) => physical >= at + count);
    this.#sequence.splice(insertAt === -1 ? this.#sequence.length : insertAt, 0, ...added);
    this.#dirty = true;
    this.#version += 1;
  }

  /** Removes physical indexes, closing the gap they leave. */
  removeIndexes(physical: number[]): void {
    const removed = new Set(physical);
    const survivors = this.#sequence.filter((index) => !removed.has(index));
    // Everything above a removed index moves down by however many were removed
    // below it.
    const shift = (index: number) => index - [...removed].filter((r) => r < index).length;

    this.#sequence = survivors.map(shift);
    this.#trimmed = new Set([...this.#trimmed].filter((i) => !removed.has(i)).map(shift));
    this.#hidden = new Set([...this.#hidden].filter((i) => !removed.has(i)).map(shift));
    this.#dirty = true;
    this.#version += 1;
  }

  /** Rebuilds the derived views, if anything changed since the last one. */
  #rebuild(): void {
    if (!this.#dirty) {
      return;
    }
    this.#notTrimmed = this.#sequence.filter((physical) => !this.#trimmed.has(physical));
    this.#visualByPhysical = new Map(this.#notTrimmed.map((physical, visual) => [physical, visual]));
    this.#renderable = this.#notTrimmed.filter((physical) => !this.#hidden.has(physical));
    this.#renderableByVisual = new Map();
    let renderable = 0;
    for (const [visual, physical] of this.#notTrimmed.entries()) {
      if (!this.#hidden.has(physical)) {
        this.#renderableByVisual.set(visual, renderable);
        renderable += 1;
      }
    }
    this.#dirty = false;
  }
}
