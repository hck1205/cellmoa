import { describe, expect, it } from 'vitest';
import { IndexMapper } from '../src/indexMapper.js';

describe('the index map', () => {
  it('starts as the identity', () => {
    const map = new IndexMapper(5);
    expect(map.length).toBe(5);
    expect(map.visibleLength).toBe(5);
    expect(map.toPhysical(2)).toBe(2);
    expect(map.toVisual(2)).toBe(2);
    expect(map.toPhysical(9)).toBeNull();
  });

  it('reorders without touching the data', () => {
    const map = new IndexMapper(4);
    // What a descending sort does.
    map.setSequence([3, 2, 1, 0]);
    expect(map.toPhysical(0)).toBe(3);
    expect(map.toVisual(3)).toBe(0);
    expect(map.getSequence()).toEqual([3, 2, 1, 0]);
  });

  it('takes trimmed indexes out of the visual space entirely', () => {
    const map = new IndexMapper(5);
    map.trim([1, 3]);
    // What a filter does: the rows are not there to be counted.
    expect(map.visibleLength).toBe(3);
    expect(map.toPhysical(1)).toBe(2);
    expect(map.toVisual(1)).toBeNull();
    expect(map.isTrimmed(1)).toBe(true);
  });

  it('keeps hidden indexes countable but undrawn', () => {
    const map = new IndexMapper(5);
    map.hide([1, 3]);
    // Unlike trimming, hiding leaves the visual space alone.
    expect(map.visibleLength).toBe(5);
    expect(map.renderableLength).toBe(3);
    expect(map.toVisual(1)).toBe(1);
    expect(map.toRenderable(1)).toBeNull();
    expect(map.toRenderable(2)).toBe(1);
  });

  it('combines trimming and hiding', () => {
    const map = new IndexMapper(6);
    map.trim([0]);
    map.hide([2]);
    expect(map.visibleLength).toBe(5);
    expect(map.renderableLength).toBe(4);
    // Physical 2 is visual 1 (0 is trimmed away) and is not drawn.
    expect(map.toVisual(2)).toBe(1);
    expect(map.toRenderable(1)).toBeNull();
  });

  it('finds the next visible index in either direction', () => {
    const map = new IndexMapper(6);
    map.hide([1, 2, 3]);
    expect(map.firstVisible(1, 1)).toBe(4);
    expect(map.firstVisible(3, -1)).toBe(0);
    expect(map.firstVisible(0, -1)).toBe(0);
  });

  it('moves indexes to where they were dropped', () => {
    const map = new IndexMapper(5);
    // Drag row 0 down to sit at position 3.
    map.moveIndexes([0], 3);
    expect(map.getSequence()).toEqual([1, 2, 3, 0, 4]);
  });

  it('moves a block so its first element lands on the target', () => {
    const map = new IndexMapper(6);
    map.moveIndexes([0, 1], 3);
    // Rows 0 and 1 come out, the rest close up, and the block goes back in so
    // that row 0 sits at visual index 3.
    expect(map.getSequence()).toEqual([2, 3, 4, 0, 1, 5]);
    expect(map.toPhysical(3)).toBe(0);
  });

  it('a move that would not fit goes to the end', () => {
    const map = new IndexMapper(5);
    map.moveIndexes([0, 1], 4);
    expect(map.getSequence()).toEqual([2, 3, 4, 0, 1]);
  });

  it('moves upward as well as downward', () => {
    const map = new IndexMapper(5);
    map.moveIndexes([4], 1);
    expect(map.getSequence()).toEqual([0, 4, 1, 2, 3]);
  });

  it('moves to the end when the target is past it', () => {
    const map = new IndexMapper(3);
    map.moveIndexes([0], 99);
    expect(map.getSequence()).toEqual([1, 2, 0]);
  });

  it('shifts hidden indexes when a row is inserted above them', () => {
    const map = new IndexMapper(4);
    map.hide([2]);
    map.insertIndexes(0, 1);
    expect(map.length).toBe(5);
    // The hidden row moved down with everything else, and is still hidden.
    expect(map.isHidden(3)).toBe(true);
    expect(map.isHidden(2)).toBe(false);
    expect(map.renderableLength).toBe(4);
  });

  it('closes the gap when indexes are removed', () => {
    const map = new IndexMapper(5);
    map.hide([4]);
    map.removeIndexes([1, 2]);
    expect(map.length).toBe(3);
    expect(map.getSequence()).toEqual([0, 1, 2]);
    // The hidden row kept its identity across the renumbering.
    expect(map.isHidden(2)).toBe(true);
  });

  it('drops trimming and hiding for a removed index', () => {
    const map = new IndexMapper(4);
    map.trim([1]);
    map.hide([1]);
    map.removeIndexes([1]);
    expect(map.getTrimmed()).toEqual([]);
    expect(map.getHidden()).toEqual([]);
    expect(map.visibleLength).toBe(3);
  });

  it('untrims and unhides', () => {
    const map = new IndexMapper(3);
    map.trim([0, 1]);
    map.untrim([0]);
    expect(map.visibleLength).toBe(2);
    map.untrim();
    expect(map.visibleLength).toBe(3);

    map.hide([0, 1]);
    map.unhide([0]);
    expect(map.renderableLength).toBe(2);
    map.unhide();
    expect(map.renderableLength).toBe(3);
  });

  it('survives a large map without going quadratic', () => {
    const map = new IndexMapper(100_000);
    map.hide(Array.from({ length: 1000 }, (_, i) => i * 50));
    expect(map.renderableLength).toBe(99_000);
    expect(map.toPhysical(99_999)).toBe(99_999);
  });
});
