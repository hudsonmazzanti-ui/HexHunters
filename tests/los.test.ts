import { describe, expect, it } from 'vitest';
import { hex } from '../src/core/hex';
import { blocksSight, hasLineOfSight, linesBetween } from '../src/core/los';
import { canSeeUnit } from '../src/core/queries';
import { addUnit, makeState } from './helpers';

describe('blocksSight (height rule)', () => {
  const terrain = (h: number) => ({ terrainHeight: h });

  it.each([
    // [terrain height, target size, blocked]
    [1, 1, true],
    [2, 1, true],
    [1, 2, false],
    [2, 2, true],
    [1, 3, false],
    [2, 3, false],
  ])('terrain height %i vs target size %i -> blocked=%s', (height, size, blocked) => {
    expect(blocksSight(terrain(height), 1, size)).toBe(blocked);
  });

  it('only cares about the target size for terrain (rule a)', () => {
    // A large viewer still cannot see a small model behind a height-1 wall.
    expect(blocksSight(terrain(1), 3, 1)).toBe(true);
  });

  it('models block targets their size or smaller', () => {
    const enemy = (size: number) => ({ terrainHeight: 0, model: { size, friendlyToViewer: false } });
    expect(blocksSight(enemy(1), 1, 1)).toBe(true);
    expect(blocksSight(enemy(1), 1, 2)).toBe(false);
    expect(blocksSight(enemy(3), 1, 3)).toBe(true);
  });

  it('bigger viewers shoot over smaller friendly models', () => {
    const friend = (size: number) => ({ terrainHeight: 0, model: { size, friendlyToViewer: true } });
    expect(blocksSight(friend(1), 2, 1)).toBe(false);
    expect(blocksSight(friend(2), 3, 1)).toBe(false);
    // Same size or bigger friends still block.
    expect(blocksSight(friend(1), 1, 1)).toBe(true);
    expect(blocksSight(friend(3), 2, 3)).toBe(true);
    // Smaller *enemy* models still block.
    expect(blocksSight({ terrainHeight: 0, model: { size: 1, friendlyToViewer: false } }, 3, 1)).toBe(true);
  });
});

describe('hasLineOfSight', () => {
  const wallAt = (...keys: string[]) => (h: { q: number; r: number }) => keys.includes(`${h.q},${h.r}`);

  it('ignores the viewer and target hexes themselves', () => {
    expect(linesBetween(hex(0, 0), hex(1, 0))).toEqual([[], []]);
    expect(hasLineOfSight(hex(0, 0), hex(1, 0), () => true)).toBe(true);
  });

  it('is blocked by a hex directly in between', () => {
    expect(hasLineOfSight(hex(0, 0), hex(3, 0), wallAt('2,0'))).toBe(false);
    expect(hasLineOfSight(hex(0, 0), hex(3, 0), wallAt('2,-1'))).toBe(true);
  });

  it('edge rule: a line along an edge is only blocked if both sides are blocked', () => {
    // (0,0) -> (2,2) runs along the edges between (1,0)/(0,1) and (2,1)/(1,2).
    const a = hex(0, 0);
    const b = hex(2, 2);
    expect(hasLineOfSight(a, b, wallAt('1,0'))).toBe(true);
    expect(hasLineOfSight(a, b, wallAt('0,1'))).toBe(true);
    expect(hasLineOfSight(a, b, wallAt('1,0', '0,1'))).toBe(false);
    // The center hex (1,1) is on both traces.
    expect(hasLineOfSight(a, b, wallAt('1,1'))).toBe(false);
  });

  it('is symmetric for edge lines', () => {
    const blocks = wallAt('1,0');
    expect(hasLineOfSight(hex(0, 0), hex(1, 1), blocks)).toBe(hasLineOfSight(hex(1, 1), hex(0, 0), blocks));
  });
});

describe('canSeeUnit on a game state', () => {
  it('small models hide behind height-1 terrain, medium do not', () => {
    const s = makeState({ terrain: [[hex(1, 0), 1]] });
    const viewer = addUnit(s, 'sniper', 0, hex(0, 0));
    const small = addUnit(s, 'scout', 1, hex(2, 0));
    expect(canSeeUnit(s, viewer, small)).toBe(false);

    const s2 = makeState({ terrain: [[hex(1, 0), 1]] });
    const v2 = addUnit(s2, 'sniper', 0, hex(0, 0));
    const medium = addUnit(s2, 'infantry', 1, hex(2, 0));
    expect(canSeeUnit(s2, v2, medium)).toBe(true);
  });

  it('large models are never hidden by terrain', () => {
    const s = makeState({ terrain: [[hex(1, 0), 2]] });
    const viewer = addUnit(s, 'scout', 0, hex(0, 0));
    const heavy = addUnit(s, 'heavy', 1, hex(2, 0));
    expect(canSeeUnit(s, viewer, heavy)).toBe(true);
  });

  it('a heavy shoots over its own infantry but not over enemy infantry', () => {
    const s = makeState();
    const heavy = addUnit(s, 'heavy', 0, hex(0, 0));
    addUnit(s, 'infantry', 0, hex(1, 0));
    const target = addUnit(s, 'infantry', 1, hex(2, 0));
    expect(canSeeUnit(s, heavy, target)).toBe(true);

    const s2 = makeState();
    const heavy2 = addUnit(s2, 'heavy', 0, hex(0, 0));
    addUnit(s2, 'infantry', 1, hex(1, 0));
    const target2 = addUnit(s2, 'infantry', 1, hex(2, 0));
    expect(canSeeUnit(s2, heavy2, target2)).toBe(false);
  });

  it('a small viewer cannot shoot past its own small friend', () => {
    const s = makeState();
    const sniper = addUnit(s, 'sniper', 0, hex(0, 0));
    addUnit(s, 'medic', 0, hex(1, 0));
    const target = addUnit(s, 'scout', 1, hex(2, 0));
    expect(canSeeUnit(s, sniper, target)).toBe(false);
  });
});
