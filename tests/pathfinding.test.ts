import { describe, expect, it } from 'vitest';
import { hex, hexKey } from '../src/core/hex';
import { pathTo, reachable } from '../src/core/pathfinding';
import { moveReach } from '../src/core/queries';
import { addUnit, makeState } from './helpers';

describe('reachable (generic BFS)', () => {
  const open = () => true;

  it('reaches every hex within the step budget', () => {
    expect(reachable(hex(0, 0), 1, open, open).costs.size).toBe(6);
    expect(reachable(hex(0, 0), 2, open, open).costs.size).toBe(18);
  });

  it('never includes the start hex', () => {
    expect(reachable(hex(0, 0), 2, open, open).costs.has('0,0')).toBe(false);
  });

  it('routes around blocked hexes', () => {
    // Wall east of origin: (2,0) now takes 3 steps instead of 2.
    const reach = reachable(hex(0, 0), 3, (h) => hexKey(h) !== '1,0', open);
    expect(reach.costs.get('2,0')).toBe(3);
    const path = pathTo(reach, hex(2, 0))!;
    expect(path).toHaveLength(3);
    expect(path.map(hexKey)).not.toContain('1,0');
  });

  it('can pass through hexes it cannot stop on', () => {
    const reach = reachable(hex(0, 0), 2, open, (h) => hexKey(h) !== '1,0');
    expect(reach.costs.has('1,0')).toBe(false);
    expect(reach.costs.get('2,0')).toBe(2);
    expect(pathTo(reach, hex(1, 0))).toBeNull();
  });
});

describe('moveReach (game rules)', () => {
  it('limits movement to the unit speed', () => {
    const s = makeState();
    const scout = addUnit(s, 'scout', 0, hex(0, 0)); // speed 4
    const reach = moveReach(s, scout);
    expect(reach.costs.has(hexKey(hex(4, 0)))).toBe(true);
    expect(reach.costs.has(hexKey(hex(5, 0)))).toBe(false);
  });

  it('is blocked by terrain', () => {
    // Ring of terrain around the unit except one gap.
    const ring = [hex(1, 0), hex(1, -1), hex(0, -1), hex(-1, 0), hex(-1, 1)];
    const s = makeState({ terrain: ring.map((h) => [h, 1] as const) });
    const u = addUnit(s, 'infantry', 0, hex(0, 0));
    const reach = moveReach(s, u);
    for (const h of ring) expect(reach.costs.has(hexKey(h))).toBe(false);
    expect(reach.costs.get('0,1')).toBe(1);
    expect(reach.costs.get('1,0')).toBeUndefined();
  });

  it('passes through friends but not enemies, and never stops on either', () => {
    const s = makeState();
    const u = addUnit(s, 'infantry', 0, hex(0, 0));
    addUnit(s, 'medic', 0, hex(1, 0));
    addUnit(s, 'medic', 1, hex(-1, 0));
    const reach = moveReach(s, u);
    expect(reach.costs.has('1,0')).toBe(false);
    expect(reach.costs.get('2,0')).toBe(2); // straight through the friend
    expect(reach.costs.has('-1,0')).toBe(false);
    expect(reach.costs.get('-2,0')).toBe(3); // around the enemy
  });

  it('stays on the board', () => {
    const s = makeState();
    const u = addUnit(s, 'scout', 0, hex(7, 0));
    for (const key of moveReach(s, u).costs.keys()) {
      const [q, r] = key.split(',').map(Number);
      expect(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r))).toBeLessThanOrEqual(7);
    }
  });
});
