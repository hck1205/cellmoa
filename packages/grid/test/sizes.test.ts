import { describe, expect, it } from 'vitest';
import { SizeMap } from '../src/sizes.js';

describe('the size map', () => {
  it('is arithmetic while nothing has been resized', () => {
    const sizes = new SizeMap(1000, 23);
    expect(sizes.isUniform).toBe(true);
    expect(sizes.total).toBe(23_000);
    expect(sizes.offsetOf(10)).toBe(230);
    expect(sizes.indexAt(235)).toBe(10);
  });

  it('accounts for a resized index', () => {
    const sizes = new SizeMap(5, 20);
    sizes.setSize(1, 50);
    expect(sizes.isUniform).toBe(false);
    expect(sizes.sizeOf(1)).toBe(50);
    expect(sizes.total).toBe(20 + 50 + 20 * 3);
    expect(sizes.offsetOf(2)).toBe(70);
    expect(sizes.indexAt(70)).toBe(2);
    expect(sizes.indexAt(69)).toBe(1);
  });

  it('restores the default when a resize is undone', () => {
    const sizes = new SizeMap(3, 10);
    sizes.setSize(0, 40);
    expect(sizes.total).toBe(60);
    sizes.setSize(0, null);
    expect(sizes.isUniform).toBe(true);
    expect(sizes.total).toBe(30);
  });

  it('reports the range covering a viewport', () => {
    const sizes = new SizeMap(100, 10);
    const { first, last } = sizes.rangeAt(95, 30);
    expect(first).toBe(9);
    expect(last).toBe(12);
  });

  it('reports the range with mixed sizes', () => {
    const sizes = new SizeMap(10, 10);
    sizes.setSizes([[2, 100], [5, 50]]);
    // Offsets: 0,10,20,120,130,140,190,200,210,220
    expect(sizes.offsetOf(3)).toBe(120);
    expect(sizes.offsetOf(6)).toBe(190);
    const range = sizes.rangeAt(20, 110);
    expect(range.first).toBe(2);
    expect(range.last).toBe(3);
  });

  it('clamps an offset past the end to the last index', () => {
    const sizes = new SizeMap(5, 10);
    expect(sizes.indexAt(99_999)).toBe(4);
    expect(sizes.indexAt(-5)).toBe(0);
  });

  it('handles an empty axis', () => {
    const sizes = new SizeMap(0, 20);
    expect(sizes.total).toBe(0);
    expect(sizes.indexAt(100)).toBe(0);
    expect(sizes.rangeAt(0, 100)).toEqual({ first: 0, last: -1 });
  });

  it('keeps the overrides when the count changes', () => {
    const sizes = new SizeMap(3, 10);
    sizes.setSize(1, 30);
    sizes.count = 5;
    expect(sizes.total).toBe(10 + 30 + 10 * 3);
    expect(sizes.overrides()).toEqual([[1, 30]]);
  });

  it('answers quickly for a very tall grid', () => {
    const sizes = new SizeMap(1_000_000, 23);
    sizes.setSize(500_000, 100);
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) {
      sizes.indexAt(i * 100_000);
    }
    // The prefix sum is built once; the lookups after it are binary searches.
    expect(performance.now() - started).toBeLessThan(500);
    expect(sizes.total).toBe(1_000_000 * 23 + 77);
  });

  it('forgets every resize on reset', () => {
    const sizes = new SizeMap(4, 10);
    sizes.setSizes([[0, 20], [1, 30]]);
    sizes.reset();
    expect(sizes.isUniform).toBe(true);
    expect(sizes.overrides()).toEqual([]);
  });
});
