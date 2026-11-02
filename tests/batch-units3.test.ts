import { describe, expect, it } from 'vitest';
import { validateArmy } from '../src/core/army';
import { type Action, type GameEvent, applyAction, canUndoMove } from '../src/core/game';
import { hex, hexKey } from '../src/core/hex';
import { actionDie, getUnit, moveReach, terrainHeight } from '../src/core/queries';
import { nextRandom } from '../src/core/rng';
import { previewSpecial, specialBlockedReason, specialChoices } from '../src/core/specials';
import type { GameState } from '../src/core/types';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';
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

const END: Action = { type: 'endTurn' };

/** An rng state whose next d12 satisfies `want`. */
function rngFor(want: (d12: number) => boolean): number {
  for (let s = 1; s < 100000; s++) {
    const [v] = nextRandom(s);
    if (want(1 + Math.floor(v * 12))) return s;
  }
  throw new Error('no seed');
}

describe('new unit stats', () => {
  it('match the brief', () => {
    expect(UNITS.hacker).toMatchObject({ cost: 3, size: 1, speed: 3, defense: 5, health: 6, range: 4, damage: 2, special: 'hack' });
    expect(UNITS.dualgunner).toMatchObject({ cost: 4, size: 2, speed: 3, defense: 6, health: 7, range: 4, damage: 2, special: 'secondShot' });
    expect(UNITS.dragon).toMatchObject({ cost: 6, size: 3, speed: 4, defense: 6, health: 12, range: 3, damage: 3, special: 'breath', flying: true });
    expect(UNITS.behemoth).toMatchObject({ cost: 12, size: 3, speed: 2, defense: 10, health: 15, range: 1, damage: 6, special: 'smash', hero: {}, crackingArmor: { minDefense: 4 } });
  });

  it('the Behemoth is a hero: it fits in 16 points but not with another hero', () => {
    expect(validateArmy(DEFAULT_CONFIG, ['behemoth', 'infantry'])).toBeNull();
    expect(validateArmy(DEFAULT_CONFIG, ['behemoth', 'scout', 'scout'])).toBeNull();
    const roomy = { ...DEFAULT_CONFIG, armyPointLimit: 40 };
    expect(validateArmy(roomy, ['behemoth', 'gambler'])).toMatch(/hero/i);
    expect(validateArmy(roomy, ['behemoth', 'twins'])).toMatch(/hero/i);
  });
});

describe('Hacker: Hack', () => {
  function setup() {
    const s = makeState();
    const hacker = addUnit(s, 'hacker', 0, hex(0, 3));
    const target = addUnit(s, 'heavy', 1, hex(0, 0));
    return { s, hacker, target };
  }

  it('reduces the target’s next die by 2, then wears off', () => {
    const { s, hacker, target } = setup();
    let state = run(s, { type: 'special', unitId: hacker.id, targetId: target.id }).state;
    expect(getUnit(state, target.id)!.hacked).toBe(true);
    expect(getUnit(state, hacker.id)!.acted).toBe(true);
    state.rngState = rngFor((d) => d === 9);
    const r = run(state, END); // P2's turn starts
    expect(getUnit(r.state, target.id)).toMatchObject({ die: 7, hackPenalty: 2, hacked: false });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'turnStart', dice: { [target.id]: 7 } }));

    // The turn after, the die is normal again.
    state = run(r.state, END, END).state; // P2 ends; round 2 starts with P1 (flip every 2 rounds)
    state.rngState = rngFor((d) => d === 9);
    state = run(state, END).state;
    expect(getUnit(state, target.id)).toMatchObject({ die: 9, hackPenalty: 0 });
  });

  it('never drops the die below 1', () => {
    const { s, hacker, target } = setup();
    const state = run(s, { type: 'special', unitId: hacker.id, targetId: target.id }).state;
    state.rngState = rngFor((d) => d === 2);
    expect(getUnit(run(state, END).state, target.id)!.die).toBe(1);
  });

  it("doesn't stack: an already-hacked model isn't a valid target", () => {
    const { s, hacker, target } = setup();
    const second = addUnit(s, 'hacker', 0, hex(1, 3));
    const state = run(s, { type: 'special', unitId: hacker.id, targetId: target.id }).state;
    expect(specialBlockedReason(state, getUnit(state, second.id)!, { targetId: target.id })).toBe('Already hacked');
    expect(() => run(state, { type: 'special', unitId: second.id, targetId: target.id })).toThrow('Already hacked');
  });

  it('needs range 4 and line of sight', () => {
    const s = makeState({ terrain: [[hex(0, 2), 2]] });
    const hacker = addUnit(s, 'hacker', 0, hex(0, 3));
    const hidden = addUnit(s, 'scout', 1, hex(0, 0)); // small, behind a tall wall
    const far = addUnit(s, 'heavy', 1, hex(5, -2));
    expect(specialBlockedReason(s, hacker, { targetId: hidden.id })).toBe('No line of sight');
    expect(specialBlockedReason(s, hacker, { targetId: far.id })).toBe('Out of range');
  });

  it('with the Gambler: the delayed roll is capped at 14, then reduced by 2', () => {
    const s = makeState();
    const hacker = addUnit(s, 'hacker', 0, hex(0, 3));
    addUnit(s, 'gambler', 1, hex(-5, 0));
    const inf = addUnit(s, 'infantry', 1, hex(0, 0));
    let state = run(s, { type: 'special', unitId: hacker.id, targetId: inf.id }).state;
    state = run(state, END).state;
    const hacked = getUnit(state, inf.id)!;
    expect(hacked).toMatchObject({ die: null, gambling: true, hackPenalty: 2 });
    expect(actionDie(state, hacked)).toBe(12); // best case: 14 - 2

    state.rngState = rngFor((d) => d === 12); // 12 + 2 = 14, capped at 14, then -2
    const r = run(state, { type: 'attack', unitId: inf.id, targetId: hacker.id });
    expect(r.events[0]).toEqual({ type: 'gambleRoll', unitId: inf.id, roll: 12 });
  });
});

describe('Dual Gunner: Second Shot', () => {
  function setup() {
    const s = makeState();
    const dg = addUnit(s, 'dualgunner', 0, hex(0, 3), { die: 8 });
    const a = addUnit(s, 'infantry', 1, hex(0, 0)); // def 5
    const b = addUnit(s, 'infantry', 1, hex(2, 0));
    return { s, dg, a, b };
  }

  it('is only available after the basic attack', () => {
    const { s, dg, a } = setup();
    expect(specialBlockedReason(s, dg)).toBe('attack first');
    expect(() => run(s, { type: 'special', unitId: dg.id, targetId: a.id })).toThrow('attack first');
  });

  it('fires again with the same die, at a different target', () => {
    const { s, dg, a, b } = setup();
    let state = run(s, { type: 'attack', unitId: dg.id, targetId: a.id }).state;
    expect(getUnit(state, dg.id)).toMatchObject({ acted: false, attacked: true, movesLeft: 0, die: 8 });
    expect(getUnit(state, a.id)!.hp).toBe(UNITS.infantry.health - 2);
    // A second basic attack isn't allowed: only Second Shot.
    expect(() => run(state, { type: 'attack', unitId: dg.id, targetId: b.id })).toThrow('Already attacked');
    expect(canUndoMove(state, getUnit(state, dg.id)!)).toBe(false);
    const r = run(state, { type: 'special', unitId: dg.id, targetId: b.id });
    state = r.state;
    expect(r.events[0]).toMatchObject({ type: 'special', special: 'secondShot', effects: [{ unitId: b.id, roll: 8, hit: true, damage: 2 }] });
    expect(getUnit(state, b.id)!.hp).toBe(UNITS.infantry.health - 2);
    expect(getUnit(state, dg.id)).toMatchObject({ acted: true, specialUsed: true });
    expect(() => run(state, { type: 'special', unitId: dg.id, targetId: a.id })).toThrow();
  });

  it('can hit the same target twice', () => {
    const { s, dg, a } = setup();
    const state = run(s, { type: 'attack', unitId: dg.id, targetId: a.id }, { type: 'special', unitId: dg.id, targetId: a.id }).state;
    expect(getUnit(state, a.id)!.hp).toBe(UNITS.infantry.health - 4);
  });

  it('a missed first shot still allows Second Shot, which uses the same (low) die', () => {
    const { s, dg, a } = setup();
    s.units.find((u) => u.id === dg.id)!.die = 3;
    const r = run(s, { type: 'attack', unitId: dg.id, targetId: a.id }, { type: 'special', unitId: dg.id, targetId: a.id });
    expect(r.events[1]).toMatchObject({ effects: [{ roll: 3, hit: false }] });
  });

  it('the turn ends after the first shot if nothing is left to shoot at', () => {
    const s = makeState();
    const dg = addUnit(s, 'dualgunner', 0, hex(0, 3), { die: 12 });
    const a = addUnit(s, 'infantry', 1, hex(0, 0), { hp: 1 });
    addUnit(s, 'infantry', 1, hex(0, -6)); // out of range
    const state = run(s, { type: 'attack', unitId: dg.id, targetId: a.id }).state;
    expect(getUnit(state, dg.id)!.acted).toBe(true);
    expect(specialChoices(state, getUnit(state, dg.id)!)).toEqual([]);
  });

  it('other models still can’t act after attacking', () => {
    const { s, a } = setup();
    const inf = addUnit(s, 'infantry', 0, hex(1, 2));
    const state = run(s, { type: 'attack', unitId: inf.id, targetId: a.id }).state;
    expect(getUnit(state, inf.id)!.acted).toBe(true);
  });
});

describe('Dragon', () => {
  it('flies over terrain and models, but must end on an empty, open hex', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2], [hex(1, 0), 1], [hex(-1, 1), 2], [hex(1, 1), 2], [hex(-1, 2), 2]] });
    const dragon = addUnit(s, 'dragon', 0, hex(0, 2));
    addUnit(s, 'heavy', 1, hex(0, 0));
    addUnit(s, 'heavy', 0, hex(0, 3));
    const reach = moveReach(s, dragon);
    // Walled in on most sides, yet it reaches past the wall and the enemy.
    expect(reach.costs.has(hexKey(hex(0, -1)))).toBe(true);
    expect(reach.costs.has(hexKey(hex(0, 4)))).toBe(true); // over its own Heavy
    expect(reach.costs.has(hexKey(hex(0, 1)))).toBe(false); // terrain
    expect(reach.costs.has(hexKey(hex(0, 0)))).toBe(false); // enemy
    expect(reach.costs.has(hexKey(hex(0, 3)))).toBe(false); // ally
    const state = run(s, { type: 'move', unitId: dragon.id, to: hex(0, -1) }).state;
    expect(getUnit(state, dragon.id)).toMatchObject({ pos: hex(0, -1), movesLeft: 1 });
    expect(() => run(s, { type: 'move', unitId: dragon.id, to: hex(0, 1) })).toThrow('Cannot reach');
  });

  it('a non-flyer is still blocked by the same walls', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2]] });
    const heavy = addUnit(s, 'heavy', 0, hex(0, 2));
    expect(moveReach(s, heavy).costs.has(hexKey(hex(0, 0)))).toBe(false); // 3 steps around the wall
    expect(moveReach(s, heavy).costs.has(hexKey(hex(1, 0)))).toBe(true);
    s.map.heights[hexKey(hex(1, 1))] = 2;
    s.map.heights[hexKey(hex(-1, 2))] = 2;
    s.map.heights[hexKey(hex(-1, 3))] = 2;
    s.map.heights[hexKey(hex(1, 2))] = 2;
    s.map.heights[hexKey(hex(0, 3))] = 2;
    expect(moveReach(s, heavy).costs.size).toBe(0); // fully walled in
  });

  it('Breath burns everything it hits, without a Pyromancer, friend or foe', () => {
    const s = makeState();
    const dragon = addUnit(s, 'dragon', 0, hex(0, 2), { die: 9 });
    const ally = addUnit(s, 'infantry', 0, hex(0, 1)); // SE direction is 5; N-ish is 2 (NW: 0,-1)
    const enemy = addUnit(s, 'heavy', 1, hex(0, 0)); // def 6
    const preview = previewSpecial(s, dragon, { dir: 2 })!;
    expect(preview.effects.map((e) => [e.unitId, e.hit, e.burned])).toEqual([
      [ally.id, true, true],
      [enemy.id, true, true],
    ]);
    const { state, events } = run(s, { type: 'special', unitId: dragon.id, dir: 2 });
    expect(getUnit(state, ally.id)).toMatchObject({ hp: UNITS.infantry.health - 3, burning: true });
    expect(getUnit(state, enemy.id)).toMatchObject({ hp: UNITS.heavy.health - 3, burning: true });
    expect(events[0]).toMatchObject({ type: 'special', special: 'breath' });
  });

  it('Breath ignores Brace, misses don’t burn, kills don’t burn, terrain stops it', () => {
    const s = makeState({ terrain: [[hex(1, 2), 1]] });
    const dragon = addUnit(s, 'dragon', 0, hex(0, 2), { die: 7 });
    const braced = addUnit(s, 'heavy', 1, hex(0, 1), { braced: true }); // def 6 (+2 ignored)
    const tough = addUnit(s, 'monster', 1, hex(0, 0));
    const weak = addUnit(s, 'scout', 1, hex(-1, 2), { hp: 1 });
    addUnit(s, 'scout', 1, hex(2, 2)); // behind terrain to the E
    let state = run(s, { type: 'special', unitId: dragon.id, dir: 2 }).state;
    expect(getUnit(state, braced.id)!.burning).toBe(true);
    const monster = getUnit(state, tough.id)!;
    expect(monster.burning).toBe(UNITS.monster.defense <= 7);
    expect(specialBlockedReason(s, dragon, { dir: 0 })).toBe('Breath blocked');
    state = run(s, { type: 'special', unitId: dragon.id, dir: 3 }).state;
    expect(getUnit(state, weak.id)).toBeUndefined(); // killed, not left burning
  });
});

describe('Behemoth: Smash', () => {
  it('removes an adjacent terrain hex of either height, for good, with no roll', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2], [hex(1, 1), 1], [hex(0, -2), 2]] });
    s.map.terrain = [
      { id: 0, kind: 'wall', height: 2, hexes: [hex(0, 1), hex(0, -2)] },
      { id: 1, kind: 'wall', height: 1, hexes: [hex(1, 1)] },
    ];
    const b = addUnit(s, 'behemoth', 0, hex(0, 2), { die: 1 });
    addUnit(s, 'infantry', 1, hex(0, -5));
    expect(specialBlockedReason(s, b, { hex: hex(0, -2) })).toBe('Pick adjacent terrain');
    expect(specialBlockedReason(s, b, { hex: hex(-1, 2) })).toBe('Pick adjacent terrain'); // open ground

    let state = run(s, { type: 'special', unitId: b.id, hex: hex(0, 1) }).state;
    expect(terrainHeight(state, hex(0, 1))).toBe(0);
    expect(state.map.terrain[0].hexes).toEqual([hex(0, -2)]);
    expect(getUnit(state, b.id)).toMatchObject({ acted: true, specialUsed: true });

    // Still gone later; the height-1 hex can be smashed too.
    state = run(state, END, END).state;
    expect(terrainHeight(state, hex(0, 1))).toBe(0);
    state = run(state, { type: 'special', unitId: b.id, hex: hex(1, 1) }).state;
    expect(terrainHeight(state, hex(1, 1))).toBe(0);
    expect(state.map.terrain.map((t) => t.id)).toEqual([0]);
  });

  it("can't be used with no terrain next to it", () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 0, hex(0, 2));
    expect(specialBlockedReason(s, b)).toBe('no terrain adjacent');
  });
});

describe('Behemoth: Cracking Armor', () => {
  const def = (state: GameState, id: string) => {
    const u = getUnit(state, id)!;
    return UNITS[u.type].defense - u.armorCracks;
  };

  it('each damaging hit permanently lowers its defense by 1, with a log event', () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 1, hex(0, 0));
    const a = addUnit(s, 'heavy', 0, hex(0, 3), { die: 12 });
    const c = addUnit(s, 'heavy', 0, hex(1, 2), { die: 10 });
    let r = run(s, { type: 'attack', unitId: a.id, targetId: b.id });
    expect(r.events).toContainEqual({ type: 'cracked', unitId: b.id, defense: 9, cracks: 1 });
    expect(def(r.state, b.id)).toBe(9);
    r = run(r.state, { type: 'attack', unitId: c.id, targetId: b.id }); // 10 vs 9
    expect(def(r.state, b.id)).toBe(8);
    expect(r.state.struck).toEqual([]);
  });

  it('misses and Burn do not crack it', () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 1, hex(0, 0), { burning: true });
    const a = addUnit(s, 'infantry', 0, hex(0, 3), { die: 9 }); // 9 vs 10: miss
    const r = run(s, { type: 'attack', unitId: a.id, targetId: b.id }, END); // P2's turn: burn ticks
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'burn', unitId: b.id, damage: 1 }));
    expect(r.events.some((e) => e.type === 'cracked')).toBe(false);
    expect(getUnit(r.state, b.id)).toMatchObject({ hp: 14, armorCracks: 0 });
  });

  it('always-hit damage cracks it: Grenade splash and Hook', () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 1, hex(0, 0));
    const g = addUnit(s, 'grenadier', 0, hex(0, 4), { die: 10 });
    const h = addUnit(s, 'grappler', 0, hex(2, 0), { die: 7 });
    let r = run(s, { type: 'special', unitId: g.id, hex: hex(0, 1) }); // splash on the Behemoth
    expect(getUnit(r.state, b.id)!.hp).toBe(14);
    expect(def(r.state, b.id)).toBe(9);
    r = run(r.state, { type: 'special', unitId: h.id, targetId: b.id });
    expect(def(r.state, b.id)).toBe(8);
  });

  it('one action cracks it once, even with several hits (two overwatch shots)', () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 0, hex(0, 0));
    addUnit(s, 'sentinel', 1, hex(0, -2), { overwatch: { die: 12, hexes: [hex(0, 0)] } });
    addUnit(s, 'sentinel', 1, hex(2, -2), { overwatch: { die: 12, hexes: [hex(0, 0)] } });
    const r = run(s, END);
    expect(r.events.filter((e) => e.type === 'overwatch' && e.hit)).toHaveLength(2);
    expect(r.events.filter((e) => e.type === 'cracked')).toHaveLength(1);
    expect(getUnit(r.state, b.id)).toMatchObject({ hp: 11, armorCracks: 1 });
  });

  it('stops at defense 4', () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 1, hex(0, 0), { armorCracks: 5 }); // defense 5
    const a = addUnit(s, 'heavy', 0, hex(0, 3), { die: 12 });
    const c = addUnit(s, 'heavy', 0, hex(1, 2), { die: 12 });
    let r = run(s, { type: 'attack', unitId: a.id, targetId: b.id });
    expect(def(r.state, b.id)).toBe(4);
    r = run(r.state, { type: 'attack', unitId: c.id, targetId: b.id });
    expect(def(r.state, b.id)).toBe(4);
    expect(r.events.some((e) => e.type === 'cracked')).toBe(false);
  });

  it('cracked defense is what attacks roll against (Torch too); Brace still adds on top', () => {
    const s = makeState();
    const b = addUnit(s, 'behemoth', 1, hex(0, 1), { armorCracks: 3 }); // defense 7
    const f = addUnit(s, 'flamer', 0, hex(0, 2), { die: 7 });
    expect(previewSpecial(s, f, { dir: 2 })!.effects[0]).toMatchObject({ defense: 7, hit: true });
    b.braced = true;
    const inf = addUnit(s, 'infantry', 0, hex(1, 2), { die: 8 });
    expect(applyAction(s, { type: 'attack', unitId: inf.id, targetId: b.id }).events[0]).toMatchObject({ defense: 9, hit: false });
  });
});
