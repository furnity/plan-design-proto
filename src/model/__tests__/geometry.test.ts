import { describe, expect, it } from 'vitest';
import { isSimplePolygon, polygonsOverlap, v } from '../geometry';

describe('geometry', () => {
  const sq = (x: number, y: number, s = 100) => [v(x, y), v(x + s, y), v(x + s, y + s), v(x, y + s)];

  it('detects overlap but allows touching', () => {
    expect(polygonsOverlap(sq(0, 0), sq(50, 50))).toBe(true);
    expect(polygonsOverlap(sq(0, 0), sq(100, 0))).toBe(false);
    expect(polygonsOverlap(sq(0, 0), sq(100, 100))).toBe(false);
    expect(polygonsOverlap(sq(0, 0), sq(0, 0))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 300), sq(100, 100))).toBe(true); // containment
  });

  it('rejects self-intersecting outlines', () => {
    expect(isSimplePolygon(sq(0, 0))).toBe(true);
    expect(isSimplePolygon([v(0, 0), v(100, 100), v(100, 0), v(0, 100)])).toBe(false);
  });
});
