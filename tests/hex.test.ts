import { describe, expect, it } from 'vitest';
import {
  ORIGIN,
  directionTo,
  hex,
  hexDistance,
  hexKey,
  hexLine,
  hexToPixel,
  hexagon,
  mirror,
  neighbors,
  parseHexKey,
  pixelToHex,
} from '../src/core/hex';

describe('hex math', () => {
  it('measures distance', () => {
    expect(hexDistance(ORIGIN, ORIGIN)).toBe(0);
    expect(hexDistance(ORIGIN, hex(1, 0))).toBe(1);
    expect(hexDistance(ORIGIN, hex(2, -1))).toBe(2);
    expect(hexDistance(hex(-3, 0), hex(3, 0))).toBe(6);
    expect(hexDistance(hex(1, 2), hex(-2, 1))).toBe(4);
  });

  it('has six neighbors, all at distance 1', () => {
    const ns = neighbors(hex(2, -1));
    expect(ns).toHaveLength(6);
    expect(new Set(ns.map(hexKey)).size).toBe(6);
    for (const n of ns) expect(hexDistance(n, hex(2, -1))).toBe(1);
  });

  it('builds a hexagon board of 3R(R+1)+1 hexes', () => {
    expect(hexagon(0)).toHaveLength(1);
    expect(hexagon(1)).toHaveLength(7);
    expect(hexagon(7)).toHaveLength(169);
    for (const h of hexagon(7)) expect(hexDistance(h, ORIGIN)).toBeLessThanOrEqual(7);
  });

  it('round-trips keys without -0 problems', () => {
    expect(hexKey(mirror(hex(0, 3)))).toBe('0,-3');
    expect(parseHexKey(hexKey(hex(-4, 2)))).toEqual(hex(-4, 2));
  });

  it('mirrors through the center', () => {
    expect(mirror(hex(2, -5))).toEqual(hex(-2, 5));
    for (const h of hexagon(4)) expect(hexDistance(mirror(h), ORIGIN)).toBe(hexDistance(h, ORIGIN));
  });

  it('finds the direction to an adjacent hex', () => {
    const c = hex(1, 1);
    neighbors(c).forEach((n, i) => expect(directionTo(c, n)).toBe(i));
    expect(directionTo(c, hex(5, 5))).toBe(-1);
  });

  it('draws lines of distance+1 contiguous hexes', () => {
    const line = hexLine(hex(-3, 0), hex(3, -2));
    expect(line).toHaveLength(7);
    expect(line[0]).toEqual(hex(-3, 0));
    expect(line[6]).toEqual(hex(3, -2));
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1], line[i])).toBe(1);
  });

  it('nudged lines pick opposite sides of an edge', () => {
    // From (0,0) to (1,1) the line passes exactly between (1,0) and (0,1).
    const a = hexLine(ORIGIN, hex(1, 1), 1e-6)[1];
    const b = hexLine(ORIGIN, hex(1, 1), -1e-6)[1];
    expect([hexKey(a), hexKey(b)].sort()).toEqual(['0,1', '1,0']);
  });

  it('converts between pixels and hexes', () => {
    for (const h of hexagon(5)) expect(pixelToHex(hexToPixel(h, 30), 30)).toEqual(h);
    // A point near (but inside) a hex's edge still maps to that hex.
    const p = hexToPixel(hex(2, 1), 30);
    expect(pixelToHex({ x: p.x + 20, y: p.y }, 30)).toEqual(hex(2, 1));
  });
});
