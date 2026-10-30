import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/game';
import { type Hex, hex, hexKey } from '../src/core/hex';
import { getUnit } from '../src/core/queries';
import { previewSpecial, specialBlockedReason, specialChoices } from '../src/core/specials';
import type { GameState, TerrainHeight } from '../src/core/types';
import { addUnit, makeState } from './helpers';

/** An enemy far away so the game doesn't end when a test leaves one side empty. */
const bystander = (s: GameState) => addUnit(s, 'heavy', 1, hex(-6, 6));

describe('Vault', () => {
  it('leaps over an adjacent wall of either height to the hex beyond', () => {
    for (const height of [1, 2] as const) {
      const s = makeState({ terrain: [[hex(1, 0), height]] });
      const a = addUnit(s, 'assassin', 0, hex(0, 0));
      bystander(s);
      const next = applyAction(s, { type: 'special', unitId: a.id, hex: hex(2, 0) }).state;
      expect(getUnit(next, a.id)!.pos).toEqual(hex(2, 0));
    }
  });

  it('keeps remaining movement, so the assassin can move on after landing', () => {
    const s = makeState({ terrain: [[hex(1, 0), 2]] });
    const a = addUnit(s, 'assassin', 0, hex(0, 0), { movesLeft: 3 });
    bystander(s);
    let next = applyAction(s, { type: 'special', unitId: a.id, hex: hex(2, 0) }).state;
    expect(getUnit(next, a.id)).toMatchObject({ acted: true, movesLeft: 3 });
    next = applyAction(next, { type: 'move', unitId: a.id, to: hex(5, 0) }).state;
    expect(getUnit(next, a.id)!.pos).toEqual(hex(5, 0));
  });

  it('offers exactly the landing hexes beyond adjacent walls', () => {
    const s = makeState({ terrain: [[hex(1, 0), 1], [hex(0, -1), 2]] });
    const a = addUnit(s, 'assassin', 0, hex(0, 0));
    expect(specialChoices(s, a).map((c) => hexKey(c.hex!)).sort()).toEqual(['0,-2', '2,0']);
  });

  it('is refused when the landing hex is occupied, terrain, or off the board', () => {
    const s = makeState({ terrain: [[hex(1, 0), 1], [hex(0, -1), 1], [hex(0, -2), 2]] });
    const a = addUnit(s, 'assassin', 0, hex(0, 0));
    addUnit(s, 'scout', 1, hex(2, 0));
    expect(specialBlockedReason(s, a, { hex: hex(2, 0) })).toBe('Landing hex blocked'); // model
    expect(specialBlockedReason(s, a, { hex: hex(0, -2) })).toBe('Landing hex blocked'); // wall 2 thick

    const edge = makeState({ terrain: [[hex(7, 0), 1]] });
    const b = addUnit(edge, 'assassin', 0, hex(6, 0));
    expect(specialBlockedReason(edge, b, { hex: hex(8, 0) })).toBe('Landing hex blocked');
  });

  it('needs a wall in between and a straight two-hex leap', () => {
    const s = makeState({ terrain: [[hex(1, 0), 1]] });
    const a = addUnit(s, 'assassin', 0, hex(0, 0));
    expect(specialBlockedReason(s, a, { hex: hex(-2, 0) })).toMatch(/adjacent wall/); // no wall
    expect(specialBlockedReason(s, a, { hex: hex(1, 1) })).toMatch(/adjacent wall/); // not a straight leap
    expect(specialBlockedReason(s, a, { hex: hex(3, 0) })).toMatch(/adjacent wall/); // too far
  });
});

describe('Grenade', () => {
  it('needs a die of 10 or more', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 9 });
    expect(specialBlockedReason(s, g)).toBe('needs 10+');
    g.die = 10;
    expect(specialBlockedReason(s, g)).toBeNull();
  });

  it('needs range and a non-terrain hex', () => {
    const s = makeState({ terrain: [[hex(0, 2), 1]] });
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 }); // range 4
    expect(specialBlockedReason(s, g, { hex: hex(4, 0) })).toBeNull();
    expect(specialBlockedReason(s, g, { hex: hex(5, 0) })).toBe('Out of range');
    expect(specialBlockedReason(s, g, { hex: hex(0, 0) })).toBe('Out of range');
    expect(specialBlockedReason(s, g, { hex: hex(0, 2) })).toBe('Cannot target terrain');
  });

  it.each([
    ['height-1 terrain', 'terrain1', true],
    ['height-2 terrain', 'terrain2', false],
    ['a small model', 'scout', true],
    ['a medium enemy', 'infantry', false],
    ['a large model', 'heavy', false],
  ])('arcs over / is blocked by %s', (_label, blocker, clear) => {
    const terrain: [Hex, TerrainHeight][] =
      blocker === 'terrain1' ? [[hex(1, 0), 1]] : blocker === 'terrain2' ? [[hex(1, 0), 2]] : [];
    const s = makeState({ terrain });
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    if (!blocker.startsWith('terrain')) addUnit(s, blocker, 1, hex(1, 0));
    expect(specialBlockedReason(s, g, { hex: hex(3, 0) })).toBe(clear ? null : 'Arc blocked');
  });

  it('is blocked by friendly medium models too, and ignores normal line of sight', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    addUnit(s, 'infantry', 0, hex(1, 0));
    expect(specialBlockedReason(s, g, { hex: hex(3, 0) })).toBe('Arc blocked');
    // A small model directly in the way blocks the Grenadier's sight of small targets, but not the grenade.
    const s2 = makeState({ terrain: [[hex(1, 0), 1]] });
    const g2 = addUnit(s2, 'grenadier', 0, hex(0, 0), { die: 12 });
    addUnit(s2, 'scout', 1, hex(2, 0));
    expect(specialBlockedReason(s2, g2, { hex: hex(2, 0) })).toBeNull();
  });

  it('uses the edge rule: blocked only if both sides of an edge line are blocked', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    addUnit(s, 'infantry', 1, hex(1, 0));
    expect(specialBlockedReason(s, g, { hex: hex(1, 1) })).toBeNull();
    addUnit(s, 'infantry', 1, hex(0, 1));
    expect(specialBlockedReason(s, g, { hex: hex(1, 1) })).toBe('Arc blocked');
  });

  it('deals 2 on impact and 1 to every adjacent model, friend or foe', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 10 });
    const center = addUnit(s, 'infantry', 1, hex(3, 0)); // hp 6
    const enemyNext = addUnit(s, 'heavy', 1, hex(4, 0)); // hp 12
    const friendNext = addUnit(s, 'medic', 0, hex(2, 1)); // hp 4
    const outside = addUnit(s, 'scout', 1, hex(5, 0)); // distance 2: untouched
    const preview = previewSpecial(s, g, { hex: hex(3, 0) })!;
    expect(preview.area.filter((a) => a.kind === 'impact')).toHaveLength(1);
    expect(preview.area.filter((a) => a.kind === 'splash')).toHaveLength(6);
    expect(preview.effects.map((e) => [e.unitId, e.damage])).toEqual([
      [center.id, 2],
      [enemyNext.id, 1],
      [friendNext.id, 1],
    ]);

    const { state, events } = applyAction(s, { type: 'special', unitId: g.id, hex: hex(3, 0) });
    expect(getUnit(state, center.id)!.hp).toBe(4);
    expect(getUnit(state, enemyNext.id)!.hp).toBe(11);
    expect(getUnit(state, friendNext.id)!.hp).toBe(3);
    expect(getUnit(state, outside.id)!.hp).toBe(3);
    expect(getUnit(state, g.id)).toMatchObject({ acted: true, hp: 5 });
    expect(events[0]).toMatchObject({ type: 'special', special: 'grenade', hex: hex(3, 0) });
  });

  it('can hit the thrower and kill models', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    const victim = addUnit(s, 'scout', 1, hex(1, 0), { hp: 2 });
    bystander(s);
    const { state, events } = applyAction(s, { type: 'special', unitId: g.id, hex: hex(1, 0) });
    expect(getUnit(state, victim.id)).toBeUndefined();
    expect(getUnit(state, g.id)!.hp).toBe(4);
    expect(events[0]).toMatchObject({ effects: [{ unitId: victim.id, killed: true }, { unitId: g.id, killed: false }] });
  });

  it('a draw when it wipes out the last models on both sides', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12, hp: 1 });
    addUnit(s, 'scout', 1, hex(1, 0), { hp: 1 });
    const { state, events } = applyAction(s, { type: 'special', unitId: g.id, hex: hex(1, 0) });
    expect(state).toMatchObject({ phase: 'over', winner: null, winReason: 'draw' });
    expect(events.at(-1)).toEqual({ type: 'gameOver', winner: null, reason: 'draw' });
  });

  it('killing your own last model hands the win to the opponent', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12, hp: 1 });
    addUnit(s, 'heavy', 1, hex(1, 0));
    const { state } = applyAction(s, { type: 'special', unitId: g.id, hex: hex(1, 0) });
    expect(state).toMatchObject({ phase: 'over', winner: 1, winReason: 'elimination' });
  });
});

describe('Torch', () => {
  it('hits every model in the next 2 hexes, rolling the die against each defense', () => {
    const s = makeState();
    const f = addUnit(s, 'flamer', 0, hex(0, 0), { die: 6 }); // damage 3
    const inf = addUnit(s, 'infantry', 1, hex(1, 0)); // def 6: hit
    const scout = addUnit(s, 'scout', 1, hex(2, 0)); // def 7: miss
    const beyond = addUnit(s, 'medic', 1, hex(3, 0)); // out of reach
    const { state, events } = applyAction(s, { type: 'special', unitId: f.id, dir: 0 });
    expect(getUnit(state, inf.id)!.hp).toBe(3);
    expect(getUnit(state, scout.id)!.hp).toBe(3);
    expect(getUnit(state, beyond.id)!.hp).toBe(4);
    expect(events[0]).toMatchObject({
      effects: [
        { unitId: inf.id, roll: 6, defense: 6, hit: true, damage: 3 },
        { unitId: scout.id, roll: 6, defense: 7, hit: false, damage: 0 },
      ],
    });
  });

  it('ignores Brace (armor bonuses)', () => {
    const s = makeState();
    const f = addUnit(s, 'flamer', 0, hex(0, 0), { die: 6 });
    const heavy = addUnit(s, 'heavy', 1, hex(0, 1), { braced: true }); // def 6, 8 when braced
    const p = previewSpecial(s, f, { dir: 5 })!;
    expect(p.effects[0]).toMatchObject({ unitId: heavy.id, defense: 6, hit: true });
  });

  it('burns friendly models too', () => {
    const s = makeState();
    const f = addUnit(s, 'flamer', 0, hex(0, 0), { die: 12 });
    const friend = addUnit(s, 'medic', 0, hex(-1, 0));
    bystander(s);
    const { state } = applyAction(s, { type: 'special', unitId: f.id, dir: 3 });
    expect(getUnit(state, friend.id)!.hp).toBe(1);
  });

  it('is stopped by terrain', () => {
    const near = makeState({ terrain: [[hex(1, 0), 1]] });
    const f = addUnit(near, 'flamer', 0, hex(0, 0), { die: 12 });
    addUnit(near, 'infantry', 1, hex(2, 0));
    expect(specialBlockedReason(near, f, { dir: 0 })).toBe('Flame blocked');

    const far = makeState({ terrain: [[hex(2, 0), 2]] });
    const f2 = addUnit(far, 'flamer', 0, hex(0, 0), { die: 12 });
    const first = addUnit(far, 'infantry', 1, hex(1, 0));
    const p = previewSpecial(far, f2, { dir: 0 })!;
    expect(p.area.map((a) => hexKey(a.hex))).toEqual(['1,0']);
    expect(p.effects.map((e) => e.unitId)).toEqual([first.id]);
  });

  it('is not allowed at a line with no models, and offers only useful directions', () => {
    const s = makeState();
    const f = addUnit(s, 'flamer', 0, hex(0, 0), { die: 12 });
    addUnit(s, 'infantry', 1, hex(0, 2)); // two hexes SE
    expect(specialBlockedReason(s, f, { dir: 0 })).toBe('No models in the flame');
    expect(specialChoices(s, f)).toEqual([{ dir: 5 }]);
  });
});
