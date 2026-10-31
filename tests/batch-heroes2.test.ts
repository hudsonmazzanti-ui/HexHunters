import { describe, expect, it } from 'vitest';
import { validateArmy } from '../src/core/army';
import { type Action, type GameEvent, applyAction, firstPlayerOfRound, newGame, unplacedUnits } from '../src/core/game';
import { hex, hexEquals, hexKey } from '../src/core/hex';
import { baseDefense, getUnit, turnsUntilTransform, unitSize, unitSpeed } from '../src/core/queries';
import { nextRandom } from '../src/core/rng';
import { previewSpecial, specialBlockedReason } from '../src/core/specials';
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

/** An rng state whose next d12 satisfies `want` (for steering Gambler rolls). */
function rngFor(want: (d12: number) => boolean): number {
  for (let s = 1; s < 100000; s++) {
    const [v] = nextRandom(s);
    if (want(1 + Math.floor(v * 12))) return s;
  }
  throw new Error('no seed');
}

/** Build both armies and deploy everything on the first free zone hexes. */
function startGame(seed: number): GameState {
  let s = run(newGame(DEFAULT_CONFIG, seed), { type: 'chooseArmy', units: ['scout'] }, { type: 'chooseArmy', units: ['scout'] }).state;
  while (s.phase === 'deploy') {
    const unit = unplacedUnits(s, s.current)[0];
    const at = s.map.deployZones[s.current].find((h) => !s.units.some((u) => u.pos && hexEquals(u.pos, h)))!;
    s = applyAction(s, { type: 'place', unitId: unit.id, hex: at }).state;
  }
  return s;
}

describe('random first player', () => {
  it('a seeded coin flip picks who goes first; both outcomes happen', () => {
    const winners = Array.from({ length: 30 }, (_, i) => startGame(i + 1).firstPlayer);
    expect(new Set(winners)).toEqual(new Set([0, 1]));
    expect(startGame(7).firstPlayer).toBe(startGame(7).firstPlayer);
    const s = startGame(7);
    expect(s.current).toBe(s.firstPlayer);
  });

  it('the order still flips every two rounds, counted from the winner', () => {
    expect([1, 2, 3, 4, 5].map((r) => firstPlayerOfRound(r, 2, 1))).toEqual([1, 1, 0, 0, 1]);
    const s = startGame(3);
    const w = s.firstPlayer;
    const l = w === 0 ? 1 : 0;
    let state = s;
    const order: number[] = [];
    for (let i = 0; i < 8; i++) {
      order.push(state.current);
      state = applyAction(state, END).state;
    }
    expect(order).toEqual([w, l, w, l, l, w, l, w]);
  });
});

describe('Gambler', () => {
  it('has the agreed stats', () => {
    expect(UNITS.gambler).toMatchObject({ cost: 6, size: 2, speed: 3, defense: 6, health: 9, range: 3, damage: 3 });
    expect(UNITS.gambler.hero).toEqual({ aura: 'gambler' });
  });

  it('dice are not rolled at turn start ("?"), but models can still move', () => {
    const s = makeState();
    addUnit(s, 'gambler', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    addUnit(s, 'infantry', 1, hex(0, -3));
    let state = run(s, END, END).state; // back to P1
    expect(getUnit(state, inf.id)).toMatchObject({ die: null, gambling: true, movesLeft: 3 });
    state = run(state, { type: 'move', unitId: inf.id, to: hex(0, 1) }).state;
    expect(getUnit(state, inf.id)!.pos).toEqual(hex(0, 1));
  });

  it('rolls d12+2 when an attack is confirmed, and uses that roll', () => {
    const s = makeState();
    addUnit(s, 'gambler', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3), { die: null, gambling: true });
    const enemy = addUnit(s, 'heavy', 1, hex(0, 0));
    s.rngState = rngFor((d) => d === 5);
    const { state, events } = run(s, { type: 'attack', unitId: inf.id, targetId: enemy.id });
    expect(events[0]).toEqual({ type: 'gambleRoll', unitId: inf.id, roll: 7 });
    expect(events[1]).toMatchObject({ type: 'attack', roll: 7, hit: true }); // 7 vs defense 6
    expect(getUnit(state, inf.id)).toMatchObject({ die: 7, gambling: false, acted: true });
  });

  it('the roll is capped at 14 (Prep included)', () => {
    const s = makeState();
    addUnit(s, 'gambler', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3), { die: null, gambling: true, dieBonus: 2 });
    const enemy = addUnit(s, 'heavy', 1, hex(0, 0));
    s.rngState = rngFor((d) => d === 12);
    expect(run(s, { type: 'attack', unitId: inf.id, targetId: enemy.id }).events[0]).toMatchObject({ roll: 14 });
  });

  it('a special that misses its threshold after the roll is wasted (Grenade 10+, Hook 7+)', () => {
    const s = makeState();
    addUnit(s, 'gambler', 0, hex(-5, 5));
    const g = addUnit(s, 'grenadier', 0, hex(0, 3), { die: null, gambling: true, movesLeft: 3 });
    const enemy = addUnit(s, 'heavy', 1, hex(0, 0));
    expect(specialBlockedReason(s, g)).toBeNull(); // possible with the best roll
    s.rngState = rngFor((d) => d + 2 < 10);
    const { state, events } = run(s, { type: 'special', unitId: g.id, hex: hex(0, 0) });
    expect(events[0]).toMatchObject({ type: 'gambleRoll' });
    expect(events[1]).toMatchObject({ type: 'gambleFailed', reason: 'needs 10+' });
    expect(getUnit(state, enemy.id)!.hp).toBe(12);
    expect(getUnit(state, g.id)).toMatchObject({ acted: true, movesLeft: 0 });

    // With a good roll the same Grenade goes off.
    s.rngState = rngFor((d) => d + 2 >= 10);
    expect(getUnit(run(s, { type: 'special', unitId: g.id, hex: hex(0, 0) }).state, enemy.id)!.hp).toBe(10);

    const h = makeState();
    addUnit(h, 'gambler', 0, hex(-5, 5));
    const grap = addUnit(h, 'grappler', 0, hex(0, 3), { die: null, gambling: true });
    const t = addUnit(h, 'infantry', 1, hex(0, 0));
    h.rngState = rngFor((d) => d + 2 < 7);
    const r = run(h, { type: 'special', unitId: grap.id, targetId: t.id });
    expect(r.events[1]).toMatchObject({ type: 'gambleFailed', reason: 'needs 7+' });
    expect(getUnit(r.state, t.id)!.pos).toEqual(hex(0, 0));
  });

  it('an illegal action is refused before rolling (no die spent)', () => {
    const s = makeState();
    addUnit(s, 'gambler', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 6), { die: null, gambling: true });
    const far = addUnit(s, 'heavy', 1, hex(0, -6));
    expect(() => applyAction(s, { type: 'attack', unitId: inf.id, targetId: far.id })).toThrow('Out of range');
  });

  it('Overwatch locks the die rolled when it is chosen', () => {
    const s = makeState();
    addUnit(s, 'gambler', 0, hex(-5, 5));
    const sen = addUnit(s, 'sentinel', 0, hex(0, 3), { die: null, gambling: true });
    addUnit(s, 'infantry', 1, hex(0, -6));
    s.rngState = rngFor((d) => d === 8);
    const state = run(s, { type: 'special', unitId: sen.id }).state;
    expect(getUnit(state, sen.id)!.overwatch!.die).toBe(10);
  });
});

describe('Necromancer', () => {
  it('has the agreed stats', () => {
    expect(UNITS.necromancer).toMatchObject({ cost: 7, size: 2, speed: 3, defense: 5, health: 8, range: 3, damage: 2 });
    expect(validateArmy(DEFAULT_CONFIG, ['necromancer', 'gambler'])).toBe('Only one hero per army (you have 2)');
  });

  it('Skeletons get +1 defense and ignore the back-to-back resting rule', () => {
    const s = makeState();
    s.round = 2;
    addUnit(s, 'infantry', 0, hex(0, 5));
    addUnit(s, 'necromancer', 1, hex(-5, -1));
    const sk = addUnit(s, 'skeleton', 1, hex(0, -4));
    expect(baseDefense(s, sk)).toBe(3);
    const state = run(s, END, END).state; // P2 takes back-to-back turns
    expect(state).toMatchObject({ round: 3, current: 1 });
    expect(getUnit(state, sk.id)).toMatchObject({ resting: false, movesLeft: 3 });
  });

  it('Zombies only crawl at half health or less', () => {
    const s = makeState();
    addUnit(s, 'necromancer', 1, hex(-5, -1));
    const z = addUnit(s, 'zombie', 1, hex(0, 0));
    const a = addUnit(s, 'infantry', 0, hex(0, 3), { die: 12 }); // 2 dmg
    const b = addUnit(s, 'heavy', 0, hex(1, 2), { die: 12 }); // 4 dmg
    let state = run(s, { type: 'attack', unitId: a.id, targetId: z.id }).state;
    expect(getUnit(state, z.id)).toMatchObject({ hp: 7, crawling: false });
    state = run(state, { type: 'attack', unitId: b.id, targetId: z.id }).state;
    expect(getUnit(state, z.id)).toMatchObject({ hp: 3, crawling: true });
  });

  it('Raise Dead: an enemy dying near your Zombie rises as your Skeleton, unable to act yet', () => {
    // P2's turn: P2's unit kills a P1 model next to P2's Zombie.
    const t = makeState();
    t.current = 1;
    addUnit(t, 'necromancer', 1, hex(-6, 0));
    addUnit(t, 'zombie', 1, hex(0, -2));
    const shooter = addUnit(t, 'infantry', 1, hex(2, -4), { die: 12 });
    const prey = addUnit(t, 'scout', 0, hex(0, 0), { hp: 2 });
    addUnit(t, 'heavy', 0, hex(6, 0));
    const { state, events } = run(t, { type: 'attack', unitId: shooter.id, targetId: prey.id });
    const raised = events.find((e) => e.type === 'raised');
    expect(raised).toMatchObject({ at: hex(0, 0) });
    const sk = getUnit(state, (raised as { unitId: string }).unitId)!;
    expect(sk).toMatchObject({ type: 'skeleton', owner: 1, acted: true, die: null, movesLeft: 0, hp: 1 });
  });

  it('the Necromancer raises too; friendly deaths and far deaths do not', () => {
    const s = makeState();
    addUnit(s, 'necromancer', 0, hex(0, 2));
    const shooter = addUnit(s, 'heavy', 0, hex(2, 1), { die: 12 });
    const near = addUnit(s, 'scout', 1, hex(0, 0), { hp: 1 });
    addUnit(s, 'heavy', 1, hex(-6, 0));
    let r = run(s, { type: 'attack', unitId: shooter.id, targetId: near.id });
    expect(r.events.some((e) => e.type === 'raised')).toBe(true);

    const far = makeState();
    addUnit(far, 'necromancer', 0, hex(0, 6));
    const sh = addUnit(far, 'sniper', 0, hex(0, 5), { die: 12 });
    const v = addUnit(far, 'scout', 1, hex(0, 0), { hp: 1 });
    addUnit(far, 'heavy', 1, hex(-6, 0));
    r = run(far, { type: 'attack', unitId: sh.id, targetId: v.id });
    expect(r.events.some((e) => e.type === 'raised')).toBe(false);

    // Friendly fire: a Grenade kills your own model next to your Zombie. No raise.
    const ff = makeState();
    addUnit(ff, 'necromancer', 0, hex(-6, 6));
    addUnit(ff, 'zombie', 0, hex(1, 1));
    const g = addUnit(ff, 'grenadier', 0, hex(0, 4), { die: 12 });
    addUnit(ff, 'scout', 0, hex(0, 0), { hp: 1 });
    addUnit(ff, 'heavy', 1, hex(-6, 0));
    r = run(ff, { type: 'special', unitId: g.id, hex: hex(0, 0) });
    expect(r.events.some((e) => e.type === 'raised')).toBe(false);
  });

  it('after the Necromancer dies, only Zombies raise', () => {
    const s = makeState();
    const nec = addUnit(s, 'necromancer', 0, hex(0, 2));
    const shooter = addUnit(s, 'heavy', 0, hex(2, 1), { die: 12 });
    const v = addUnit(s, 'scout', 1, hex(0, 0), { hp: 1 });
    addUnit(s, 'heavy', 1, hex(-6, 0));
    s.units = s.units.filter((u) => u.id !== nec.id);
    expect(run(s, { type: 'attack', unitId: shooter.id, targetId: v.id }).events.some((e) => e.type === 'raised')).toBe(false);
  });

  it('rises in the nearest empty hex when its own hex is taken (a Hill Giant boulder)', () => {
    const s = makeState({ terrain: [[hex(0, 3), 1]] });
    addUnit(s, 'necromancer', 0, hex(-6, 6));
    addUnit(s, 'zombie', 0, hex(1, 0));
    const giant = addUnit(s, 'hillgiant', 0, hex(0, 4), { die: 12 });
    const v = addUnit(s, 'scout', 1, hex(0, 0), { hp: 1 });
    addUnit(s, 'heavy', 1, hex(-6, 0));
    const { state, events } = run(s, { type: 'special', unitId: giant.id, hex: hex(0, 3), targetId: v.id });
    expect(state.map.heights[hexKey(hex(0, 0))]).toBe(1); // boulder
    const raised = events.find((e) => e.type === 'raised') as { at: { q: number; r: number } };
    expect(raised).toBeDefined();
    expect(Math.max(Math.abs(raised.at.q), Math.abs(raised.at.r), Math.abs(raised.at.q + raised.at.r))).toBe(1);
  });
});

describe('Hill Giant: Hurl', () => {
  it('has the agreed stats and needs adjacent terrain', () => {
    expect(UNITS.hillgiant).toMatchObject({ cost: 5, size: 3, speed: 2, defense: 6, health: 13, range: 1, damage: 4, special: 'hurl' });
    const s = makeState();
    const g = addUnit(s, 'hillgiant', 0, hex(0, 3));
    addUnit(s, 'infantry', 1, hex(0, 0));
    expect(specialBlockedReason(s, g)).toBe('no terrain adjacent');
  });

  it('removes the terrain and deals 2 + its height; a survivor gets no boulder', () => {
    for (const height of [1, 2] as const) {
      const s = makeState({ terrain: [[hex(1, 3), height]] });
      const g = addUnit(s, 'hillgiant', 0, hex(0, 3), { die: 12 });
      const t = addUnit(s, 'heavy', 1, hex(0, 0));
      expect(previewSpecial(s, g, { hex: hex(1, 3), targetId: t.id })!.effects[0]).toMatchObject({ hit: true, damage: 2 + height });
      const { state } = run(s, { type: 'special', unitId: g.id, hex: hex(1, 3), targetId: t.id });
      expect(getUnit(state, t.id)!.hp).toBe(12 - 2 - height);
      expect(state.map.heights[hexKey(hex(1, 3))]).toBeUndefined();
      expect(state.map.heights[hexKey(hex(0, 0))]).toBeUndefined();
      expect(state.map.terrain.flatMap((p) => p.hexes)).toEqual([]);
    }
  });

  it('a miss still removes the terrain', () => {
    const s = makeState({ terrain: [[hex(1, 3), 2]] });
    const g = addUnit(s, 'hillgiant', 0, hex(0, 3), { die: 2 });
    const t = addUnit(s, 'heavy', 1, hex(0, 0));
    const { state } = run(s, { type: 'special', unitId: g.id, hex: hex(1, 3), targetId: t.id });
    expect(getUnit(state, t.id)!.hp).toBe(12);
    expect(state.map.heights[hexKey(hex(1, 3))]).toBeUndefined();
  });

  it('a kill drops a height-1 boulder on the target hex', () => {
    const s = makeState({ terrain: [[hex(1, 3), 2]] });
    const g = addUnit(s, 'hillgiant', 0, hex(0, 3), { die: 12 });
    const t = addUnit(s, 'scout', 1, hex(0, 0));
    addUnit(s, 'heavy', 1, hex(-6, 0));
    const { state } = run(s, { type: 'special', unitId: g.id, hex: hex(1, 3), targetId: t.id });
    expect(getUnit(state, t.id)).toBeUndefined();
    expect(state.map.heights[hexKey(hex(0, 0))]).toBe(1);
    expect(state.map.terrain.some((p) => p.kind === 'boulder')).toBe(true);
  });

  it('can throw the wall that blocks its line of sight, and needs range 4', () => {
    const s = makeState({ terrain: [[hex(0, 2), 2]] });
    const g = addUnit(s, 'hillgiant', 0, hex(0, 3), { die: 12 });
    const behind = addUnit(s, 'scout', 1, hex(0, 0)); // hidden behind (0,2) until it's lifted
    const far = addUnit(s, 'heavy', 1, hex(4, -2));
    expect(specialBlockedReason(s, g, { hex: hex(0, 2), targetId: behind.id })).toBeNull();
    expect(specialBlockedReason(s, g, { hex: hex(0, 2), targetId: far.id })).toBe('Out of range');
  });
});

describe('Werewolf', () => {
  it('has the agreed stats in both forms; the beast form is not buyable', () => {
    expect(UNITS.werewolf).toMatchObject({ cost: 5, size: 2, speed: 3, defense: 5, health: 7, range: 3, damage: 2 });
    expect(UNITS.werewolf.special).toBeUndefined();
    expect(UNITS.werewolfbeast).toMatchObject({ size: 3, speed: 4, defense: 6, health: 12, range: 1, damage: 5, special: 'pounce' });
    expect(validateArmy(DEFAULT_CONFIG, ['werewolfbeast'])).toMatch(/can't be bought/);
  });

  it("transforms at the start of its owner's 3rd turn, healing 5 up to the new max", () => {
    const s = makeState();
    s.turnsTaken = [2, 1]; // P1 has already started 2 turns
    const w = addUnit(s, 'werewolf', 0, hex(0, 3), { hp: 3 });
    addUnit(s, 'infantry', 1, hex(0, -3));
    expect(turnsUntilTransform(s, w)).toBe(1);
    let r = run(s, END); // P2's turn: P1's werewolf unchanged
    expect(getUnit(r.state, w.id)!.type).toBe('werewolf');
    r = run(r.state, END); // round 2: P1 again, its 3rd turn
    const beast = getUnit(r.state, w.id)!;
    expect(r.events).toContainEqual({ type: 'transformed', unitId: w.id, into: 'werewolfbeast', healed: 5 });
    expect(beast).toMatchObject({ type: 'werewolfbeast', hp: 8, movesLeft: 4 });
    expect([unitSize(r.state, beast), unitSpeed(r.state, beast), baseDefense(r.state, beast)]).toEqual([3, 4, 6]);
    expect(turnsUntilTransform(r.state, beast)).toBeNull();

    // Healing is capped at the new max of 12.
    const full = makeState();
    full.turnsTaken = [2, 0];
    const w2 = addUnit(full, 'werewolf', 0, hex(0, 3)); // 7 hp
    addUnit(full, 'infantry', 1, hex(0, -3));
    expect(getUnit(run(full, END, END).state, w2.id)!.hp).toBe(12);
  });

  it('counts down from the start of the game', () => {
    const s = makeState();
    const w = addUnit(s, 'werewolf', 0, hex(0, 3));
    expect(turnsUntilTransform(s, w)).toBe(3);
  });

  it('Pounce: 2 extra hexes, then its melee attack with the same die', () => {
    const s = makeState();
    const b = addUnit(s, 'werewolfbeast', 0, hex(0, 6), { die: 9, movesLeft: 4 });
    const enemy = addUnit(s, 'infantry', 1, hex(0, 0));
    let state = run(s, { type: 'special', unitId: b.id }).state;
    expect(getUnit(state, b.id)).toMatchObject({ movesLeft: 6, specialUsed: true, acted: false });
    state = run(state, { type: 'move', unitId: b.id, to: hex(0, 1) }).state; // 5 hexes, more than speed 4
    const { state: after, events } = run(state, { type: 'attack', unitId: b.id, targetId: enemy.id });
    expect(events[0]).toMatchObject({ type: 'attack', roll: 9, hit: true, damage: 5 });
    expect(getUnit(after, enemy.id)!.hp).toBe(1);
    expect(getUnit(after, b.id)).toMatchObject({ acted: true, movesLeft: 0 });
  });
});
