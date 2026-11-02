import { describe, expect, it } from 'vitest';
import { specialUsesFor, validateArmy, validateConfig } from '../src/core/army';
import { type Action, type GameEvent, applyAction, newGame } from '../src/core/game';
import { ORIGIN, hex, hexDistance, hexKey, mirror } from '../src/core/hex';
import { generateMap, pickDeployShape, shapeZones } from '../src/core/mapgen';
import { getUnit } from '../src/core/queries';
import { specialBlockedReason } from '../src/core/specials';
import type { GameState } from '../src/core/types';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';
import { DEPLOY_SHAPES } from '../src/data/deployShapes';
import { addUnit, makeState } from './helpers';

function run(state: GameState, ...actions: Action[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('range cap', () => {
  it('no unit or special reaches farther than 7; Sniper and Artillery were lowered to 7', () => {
    expect(DEFAULT_CONFIG.maxRange).toBe(7);
    for (const def of Object.values(UNITS)) expect(def.range).toBeLessThanOrEqual(7);
    expect(UNITS.sniper.range).toBe(7);
    expect(UNITS.artillery.range).toBe(7);
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
  });

  it('validateConfig rejects a unit or special range above the cap, and newGame refuses it', () => {
    const longUnit = { ...DEFAULT_CONFIG, units: { ...UNITS, railgun: { ...UNITS.sniper, range: 8 } } };
    expect(validateConfig(longUnit)).toEqual(['railgun: range 8 is above the cap of 7']);
    const longSpecial = { ...DEFAULT_CONFIG, specials: { ...DEFAULT_CONFIG.specials, hookRange: 9 } };
    expect(validateConfig(longSpecial)).toEqual(['specials.hookRange: 9 is above the cap of 7']);
    expect(() => newGame(longUnit, 1)).toThrow(/range 8/);
  });

  it('Spot now has range 7', () => {
    const s = makeState();
    const sniper = addUnit(s, 'sniper', 0, hex(0, 4));
    const at7 = addUnit(s, 'infantry', 1, hex(0, -3));
    const at8 = addUnit(s, 'infantry', 1, hex(1, -4));
    expect(specialBlockedReason(s, sniper, { targetId: at7.id })).toBeNull();
    expect(specialBlockedReason(s, sniper, { targetId: at8.id })).toBe('Out of range');
  });
});

describe('Mercenary: Premium Shot', () => {
  it('has the agreed stats and the Infantry basic attack', () => {
    expect(UNITS.mercenary).toMatchObject({ cost: 5, size: 2, speed: 3, defense: 6, health: 8, special: 'premiumShot', hero: {} });
    expect([UNITS.mercenary.range, UNITS.mercenary.damage]).toEqual([UNITS.infantry.range, UNITS.infantry.damage]);
    expect(validateArmy(DEFAULT_CONFIG, ['mercenary', 'gambler'])).toMatch(/hero/i);
  });

  it('uses = unspent points, capped at 3', () => {
    const uses = (army: string[]) => specialUsesFor(DEFAULT_CONFIG, army, 'mercenary');
    expect(uses(['mercenary', 'heavy', 'heavy', 'artillery'])).toBe(0); // 16 of 16
    expect(uses(['mercenary', 'heavy', 'heavy', 'scout'])).toBe(1);
    expect(uses(['mercenary', 'heavy', 'heavy'])).toBe(3); // 13: 3 unspent
    expect(uses(['mercenary', 'heavy'])).toBe(3); // 7 unspent, capped
    expect(uses(['mercenary'])).toBe(3);
    expect(specialUsesFor(DEFAULT_CONFIG, ['heavy'], 'heavy')).toBeNull(); // unlimited specials
  });

  it('chooseArmy sets the uses on the model', () => {
    let s = newGame(DEFAULT_CONFIG, 3);
    s = run(s, { type: 'chooseArmy', units: ['mercenary', 'heavy', 'heavy', 'scout'] }, { type: 'chooseArmy', units: ['scout'] }).state;
    expect(s.units.find((u) => u.type === 'mercenary')!.usesLeft).toBe(1);
    expect(s.units.find((u) => u.type === 'heavy')!.usesLeft).toBeNull();
  });

  it('always hits for 4 at range 7, uses run out, and it is greyed out at 0', () => {
    const s = makeState();
    const merc = addUnit(s, 'mercenary', 0, hex(0, 4), { usesLeft: 2, die: 1 });
    const behemoth = addUnit(s, 'behemoth', 1, hex(0, -3)); // def 10, 7 away
    let r = run(s, { type: 'special', unitId: merc.id, targetId: behemoth.id });
    expect(r.events[0]).toMatchObject({ type: 'special', special: 'premiumShot', effects: [{ damage: 4 }] });
    expect(getUnit(r.state, behemoth.id)!.hp).toBe(UNITS.behemoth.health - 4);
    expect(getUnit(r.state, merc.id)).toMatchObject({ usesLeft: 1, acted: true });

    // Next turn: one shot left, then none.
    r = run(r.state, { type: 'endTurn' }, { type: 'endTurn' });
    r = run(r.state, { type: 'special', unitId: merc.id, targetId: behemoth.id });
    expect(getUnit(r.state, merc.id)!.usesLeft).toBe(0);
    r = run(r.state, { type: 'endTurn' });
    while (r.state.current !== 0) r = run(r.state, { type: 'endTurn' }); // the turn order flips every 2 rounds
    expect(specialBlockedReason(r.state, getUnit(r.state, merc.id)!)).toBe('no shots left');
    expect(() => run(r.state, { type: 'special', unitId: merc.id, targetId: behemoth.id })).toThrow('no shots left');
  });

  it('with 0 unspent points it has no shots from the start', () => {
    const s = makeState();
    const merc = addUnit(s, 'mercenary', 0, hex(0, 4), { usesLeft: 0 });
    addUnit(s, 'infantry', 1, hex(0, 0));
    expect(specialBlockedReason(s, merc)).toBe('no shots left');
  });

  it('needs line of sight and range 7', () => {
    const s = makeState({ terrain: [[hex(0, 3), 2]] });
    const merc = addUnit(s, 'mercenary', 0, hex(0, 4), { usesLeft: 3 });
    const hidden = addUnit(s, 'scout', 1, hex(0, 1));
    const far = addUnit(s, 'infantry', 1, hex(2, -4)); // 8 away
    expect(specialBlockedReason(s, merc, { targetId: hidden.id })).toBe('No line of sight');
    expect(specialBlockedReason(s, merc, { targetId: far.id })).toBe('Out of range');
  });
});

describe('deployment shapes', () => {
  const ids = Object.keys(DEPLOY_SHAPES);

  it('every shape in the data is in the random pool', () => {
    expect(new Set(DEFAULT_CONFIG.deployShapes)).toEqual(new Set(ids));
    expect(ids).toEqual(expect.arrayContaining(['standard', 'corners', 'flanks', 'spearhead', 'split', 'close']));
  });

  it.each(ids)('%s: mirrored, no overlap, clear of the objective, room for the largest army', (id) => {
    const [z0, z1] = shapeZones(DEFAULT_CONFIG, id);
    const k0 = new Set(z0.map(hexKey));
    const k1 = new Set(z1.map(hexKey));
    expect(k1).toEqual(new Set(z0.map((h) => hexKey(mirror(h)))));
    expect([...k0].some((k) => k1.has(k))).toBe(false);
    // The control point (center + ring) and its surrounding ring stay clear.
    for (const h of [...z0, ...z1]) expect(hexDistance(h, ORIGIN)).toBeGreaterThanOrEqual(3);
    // 16 Skeletons is the largest legal army (16 points at 1 each).
    expect(z0.length).toBeGreaterThanOrEqual(16);
    expect(k0.size).toBe(z0.length);
  });

  it('Split has two separate pockets; Flanks are left and right', () => {
    const [split] = shapeZones(DEFAULT_CONFIG, 'split');
    const x = (h: { q: number; r: number }) => h.q + h.r / 2;
    expect(split.filter((h) => x(h) < 0).length).toBe(split.filter((h) => x(h) > 0).length);
    expect(split.some((h) => Math.abs(x(h)) < 1.5)).toBe(false); // the gap
    const [left, right] = shapeZones(DEFAULT_CONFIG, 'flanks');
    expect(left.every((h) => x(h) < 0)).toBe(true);
    expect(right.every((h) => x(h) > 0)).toBe(true);
  });

  it('the shape is picked at random per seed, and the same seed picks the same shape', () => {
    const picks = Array.from({ length: 120 }, (_, i) => pickDeployShape(DEFAULT_CONFIG, i * 31 + 7));
    expect(new Set(picks)).toEqual(new Set(DEFAULT_CONFIG.deployShapes));
    expect(pickDeployShape(DEFAULT_CONFIG, 99)).toBe(pickDeployShape(DEFAULT_CONFIG, 99));
  });

  it.each(ids)('%s maps: terrain stays out of the zones (and a 1-hex buffer)', (id) => {
    const cfg = { ...DEFAULT_CONFIG, deployShapes: [id] };
    for (let seed = 1; seed <= 15; seed++) {
      const map = generateMap(cfg, seed);
      expect(map.deployShape).toBe(id);
      for (const h of [...map.deployZones[0], ...map.deployZones[1]]) {
        expect(map.heights[hexKey(h)]).toBeUndefined();
        for (const t of map.terrain) for (const th of t.hexes) expect(hexDistance(th, h)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('deployment only accepts hexes in the chosen zone', () => {
    const cfg = { ...DEFAULT_CONFIG, deployShapes: ['flanks'] };
    let s = newGame(cfg, 4);
    s = run(s, { type: 'chooseArmy', units: ['scout'] }, { type: 'chooseArmy', units: ['scout'] }).state;
    const unit = s.units.find((u) => u.owner === 0)!;
    expect(() => applyAction(s, { type: 'place', unitId: unit.id, hex: hex(0, 7) })).toThrow('Outside');
    expect(() => applyAction(s, { type: 'place', unitId: unit.id, hex: s.map.deployZones[0][0] })).not.toThrow();
  });
});
