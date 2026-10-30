import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/data/config';
import { ORIGIN, hexDistance, hexKey, mirror } from '../src/core/hex';
import { generateMap, isConnected } from '../src/core/mapgen';

const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

describe('generateMap', () => {
  it.each(seeds)('seed %i: symmetric, sparse, clear of key areas, connected', (seed) => {
    const map = generateMap(DEFAULT_CONFIG, seed);
    const keys = Object.keys(map.heights);

    // Point symmetry, including heights.
    for (const t of map.terrain) {
      for (const h of t.hexes) expect(map.heights[hexKey(mirror(h))]).toBe(t.height);
    }

    // Pieces have the configured length and every hex is on the board.
    for (const t of map.terrain) {
      expect(t.hexes.length).toBeGreaterThanOrEqual(DEFAULT_CONFIG.terrainMinLength);
      expect(t.hexes.length).toBeLessThanOrEqual(DEFAULT_CONFIG.terrainMaxLength);
      for (const h of t.hexes) expect(hexDistance(h, ORIGIN)).toBeLessThanOrEqual(map.radius);
    }

    // Control point and deployment zones are clear.
    for (const h of [...map.controlPoint, ...map.deployZones[0], ...map.deployZones[1]]) {
      expect(map.heights[hexKey(h)]).toBeUndefined();
    }

    expect(keys.length).toBeLessThanOrEqual(DEFAULT_CONFIG.terrainPairs * 2 * DEFAULT_CONFIG.terrainMaxLength);
    expect(isConnected(map.radius, new Set(keys))).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(generateMap(DEFAULT_CONFIG, 123)).toEqual(generateMap(DEFAULT_CONFIG, 123));
  });

  it('places all requested terrain on most seeds', () => {
    const full = seeds.filter((s) => generateMap(DEFAULT_CONFIG, s).terrain.length === DEFAULT_CONFIG.terrainPairs * 2);
    expect(full.length).toBeGreaterThan(seeds.length * 0.9);
  });

  it('deployment zones are the two back rows and mirror each other', () => {
    const [z0, z1] = generateMap(DEFAULT_CONFIG, 5).deployZones;
    expect(z0).toHaveLength(8 + 9);
    expect(new Set(z1.map(hexKey))).toEqual(new Set(z0.map((h) => hexKey(mirror(h)))));
  });
});
