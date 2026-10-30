import { describe, expect, it } from 'vitest';
import { validateArmy } from '../src/core/army';
import { previewAttack } from '../src/core/combat';
import { type Action, type GameEvent, applyAction } from '../src/core/game';
import { hex } from '../src/core/hex';
import { canSeeUnit, getUnit, moveReach, unitSize, unitSpeed } from '../src/core/queries';
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

/** An enemy far away, so a kill never ends the game by accident. */
const bystander = (s: GameState, owner: 0 | 1 = 1) => addUnit(s, 'heavy', owner, owner === 1 ? hex(-6, 0) : hex(6, 0));

describe('unit data', () => {
  it('has the agreed stats', () => {
    expect(UNITS.zombie).toMatchObject({ cost: 2, size: 2, speed: 3, defense: 0, health: 9, range: 1, damage: 3, special: 'eat' });
    expect(UNITS.skeleton).toMatchObject({ cost: 1, size: 2, speed: 3, defense: 2, health: 1, range: 1, damage: 2 });
    expect(UNITS.skeleton.special).toBeUndefined();
    expect(UNITS.pyromancer).toMatchObject({ cost: 6, size: 2, speed: 3, defense: 7, health: 10, range: 3, damage: 2 });
    expect(UNITS.pyromancer.hero).toEqual({ aura: 'pyro' });
  });

  it('allows any number of Skeletons, and still only one hero', () => {
    expect(validateArmy(DEFAULT_CONFIG, Array(16).fill('skeleton'))).toBeNull();
    expect(validateArmy(DEFAULT_CONFIG, ['pyromancer', 'warlord'])).toBe('Only one hero per army (you have 2)');
  });
});

describe('Zombie', () => {
  it('becomes a crawler the first time it takes damage: small and crawl speed, for good', () => {
    const s = makeState();
    const z = addUnit(s, 'zombie', 1, hex(2, 0));
    const shooter = addUnit(s, 'infantry', 0, hex(0, 0), { die: 12 });
    expect([unitSize(s, z), unitSpeed(s, z)]).toEqual([2, 3]);
    const { state } = run(s, { type: 'attack', unitId: shooter.id, targetId: z.id });
    const hurt = getUnit(state, z.id)!;
    expect(hurt).toMatchObject({ hp: 7, crawling: true });
    expect([unitSize(state, hurt), unitSpeed(state, hurt)]).toEqual([1, 1]);

    // Healing never reverses it.
    const h = makeState();
    const zz = addUnit(h, 'zombie', 0, hex(0, 1), { hp: 5, crawling: true });
    const medic = addUnit(h, 'medic', 0, hex(0, 0), { die: 12 });
    bystander(h);
    const healed = getUnit(run(h, { type: 'special', unitId: medic.id, targetId: zz.id }).state, zz.id)!;
    expect(healed).toMatchObject({ hp: 9, crawling: true });
  });

  it('as a crawler it hides like a small model and moves 1 hex', () => {
    const s = makeState({ terrain: [[hex(1, 0), 1]] });
    const viewer = addUnit(s, 'infantry', 0, hex(0, 0));
    const z = addUnit(s, 'zombie', 1, hex(2, 0));
    expect(canSeeUnit(s, viewer, z)).toBe(true); // medium: visible over a height-1 wall
    z.crawling = true;
    expect(canSeeUnit(s, viewer, z)).toBe(false); // small now: hidden

    const m = makeState();
    const mover = addUnit(m, 'zombie', 0, hex(0, 3), { crawling: true });
    addUnit(m, 'infantry', 1, hex(0, -3));
    const next = run(m, END, END).state; // back to P1: movement reset to crawl speed
    expect(getUnit(next, mover.id)!.movesLeft).toBe(1);
    expect(moveReach(next, getUnit(next, mover.id)!).costs.size).toBe(6);
  });

  it('a mid-turn wound caps its remaining movement at 1', () => {
    const s = makeState();
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    const z = addUnit(s, 'zombie', 0, hex(3, 1), { movesLeft: 3 }); // next to the impact hex
    bystander(s);
    const state = run(s, { type: 'special', unitId: g.id, hex: hex(3, 0) }).state; // splash hits the Zombie
    expect(getUnit(state, z.id)).toMatchObject({ crawling: true, movesLeft: 1 });
  });

  it('Eat needs 8+, rolls to hit, deals 2 and heals 2 up to max health', () => {
    const s = makeState();
    const z = addUnit(s, 'zombie', 0, hex(0, 0), { die: 7, hp: 5 });
    const target = addUnit(s, 'infantry', 1, hex(1, 0)); // defense 6
    const far = addUnit(s, 'infantry', 1, hex(3, 0));
    expect(specialBlockedReason(s, z)).toBe('needs 8+');
    z.die = 8;
    expect(specialBlockedReason(s, z, { targetId: far.id })).toBe('Must be adjacent');
    expect(previewSpecial(s, z, { targetId: target.id })!.effects[0]).toMatchObject({ roll: 8, defense: 6, hit: true, damage: 2 });
    const { state, events } = run(s, { type: 'special', unitId: z.id, targetId: target.id });
    expect(getUnit(state, target.id)!.hp).toBe(4);
    expect(getUnit(state, z.id)!.hp).toBe(7);
    expect(events[0]).toMatchObject({ special: 'eat', amount: 2 });

    // Heal is capped at max health.
    const capped = makeState();
    const z2 = addUnit(capped, 'zombie', 0, hex(0, 0), { die: 12, hp: 8 });
    const t2 = addUnit(capped, 'infantry', 1, hex(1, 0));
    expect(getUnit(run(capped, { type: 'special', unitId: z2.id, targetId: t2.id }).state, z2.id)!.hp).toBe(9);
  });

  it('Eat can miss: no damage, no healing, die used (Brace counts)', () => {
    const s = makeState();
    const z = addUnit(s, 'zombie', 0, hex(0, 0), { die: 8, hp: 5 });
    const target = addUnit(s, 'grappler', 1, hex(1, 0), { braced: true }); // defense 7 + 2 = 9
    expect(previewSpecial(s, z, { targetId: target.id })!.effects[0]).toMatchObject({ roll: 8, defense: 9, hit: false });
    const { state } = run(s, { type: 'special', unitId: z.id, targetId: target.id });
    expect(getUnit(state, target.id)!.hp).toBe(12);
    expect(getUnit(state, z.id)).toMatchObject({ hp: 5, acted: true });
  });
});

describe('Skeleton', () => {
  /** P1 skeleton; the order flips after round 2 so P2 goes twice (end of round 2, start of round 3). */
  function flipSetup() {
    const s = makeState();
    s.round = 2;
    s.turnInRound = 0; // P1 then P2 in round 2; round 3: P2 then P1
    const mine = addUnit(s, 'skeleton', 0, hex(0, 4));
    const theirs = addUnit(s, 'skeleton', 1, hex(0, -4));
    return { s, mine, theirs };
  }

  it('cannot move or act on the second of back-to-back turns', () => {
    const { s, theirs } = flipSetup();
    let state = run(s, END).state; // P2's turn (round 2)
    expect(getUnit(state, theirs.id)).toMatchObject({ resting: false, die: expect.any(Number), movesLeft: 3 });
    state = run(state, END).state; // round 3: P2 again
    expect(state).toMatchObject({ round: 3, current: 1 });
    const resting = getUnit(state, theirs.id)!;
    expect(resting).toMatchObject({ resting: true, die: null, movesLeft: 0 });
    expect(() => applyAction(state, { type: 'move', unitId: theirs.id, to: hex(0, -3) })).toThrow();
    expect(previewAttack(state, resting, getUnit(state, theirs.id)!).blockedReason).toBe('This model cannot act');
  });

  it('acts normally on other turns, and other units are unaffected', () => {
    const { s, theirs } = flipSetup();
    const inf = addUnit(s, 'infantry', 1, hex(1, -4));
    let state = run(s, END, END).state; // P2's back-to-back turn
    expect(getUnit(state, inf.id)).toMatchObject({ resting: false, movesLeft: 3 });
    state = run(state, END).state; // P1
    state = run(state, END).state; // round 4: P2 first again, not back-to-back
    expect(state).toMatchObject({ round: 4, current: 1 });
    expect(getUnit(state, theirs.id)).toMatchObject({ resting: false, movesLeft: 3 });
    expect(getUnit(state, theirs.id)!.die).not.toBeNull();
  });
});

describe('Pyromancer: Burn', () => {
  it("the Pyromancer's attacks burn what they hit; burn deals 1 at the owner's next turn start, then ends", () => {
    const s = makeState();
    const pyro = addUnit(s, 'pyromancer', 0, hex(0, 0), { die: 12 });
    const target = addUnit(s, 'infantry', 1, hex(2, 0));
    let { state } = run(s, { type: 'attack', unitId: pyro.id, targetId: target.id });
    expect(getUnit(state, target.id)).toMatchObject({ hp: 4, burning: true });
    const r = run(state, END); // P2's turn starts: burn ticks
    state = r.state;
    expect(r.events).toContainEqual({ type: 'burn', unitId: target.id, damage: 1, killed: false });
    expect(getUnit(state, target.id)).toMatchObject({ hp: 3, burning: false });
    // It doesn't tick again.
    state = run(state, END, END).state;
    expect(getUnit(state, target.id)!.hp).toBe(3);
  });

  it('Torch burns every model it hits, allies included', () => {
    const s = makeState();
    addUnit(s, 'pyromancer', 0, hex(-6, 6));
    const flamer = addUnit(s, 'flamer', 0, hex(0, 0), { die: 12 });
    const ally = addUnit(s, 'heavy', 0, hex(1, 0));
    const enemy = addUnit(s, 'infantry', 1, hex(2, 0));
    const { state, events } = run(s, { type: 'special', unitId: flamer.id, dir: 0 });
    expect(getUnit(state, ally.id)!.burning).toBe(true);
    expect(getUnit(state, enemy.id)!.burning).toBe(true);
    expect(events[0]).toMatchObject({ effects: [{ burned: true }, { burned: true }] });
  });

  it('Grenade burns the impact hex and the splash', () => {
    const s = makeState();
    addUnit(s, 'pyromancer', 0, hex(-6, 6));
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    const center = addUnit(s, 'heavy', 1, hex(3, 0));
    const splash = addUnit(s, 'heavy', 1, hex(4, 0));
    const state = run(s, { type: 'special', unitId: g.id, hex: hex(3, 0) }).state;
    expect(getUnit(state, center.id)!.burning).toBe(true);
    expect(getUnit(state, splash.id)!.burning).toBe(true);
  });

  it("the Flamer's and Grenadier's basic attacks don't burn, and no Pyromancer means no Burn", () => {
    const s = makeState();
    addUnit(s, 'pyromancer', 0, hex(-6, 6));
    const flamer = addUnit(s, 'flamer', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'heavy', 1, hex(2, 0));
    expect(getUnit(run(s, { type: 'attack', unitId: flamer.id, targetId: t.id }).state, t.id)!.burning).toBe(false);

    const plain = makeState();
    const f2 = addUnit(plain, 'flamer', 0, hex(0, 0), { die: 12 });
    const t2 = addUnit(plain, 'heavy', 1, hex(1, 0));
    expect(getUnit(run(plain, { type: 'special', unitId: f2.id, dir: 0 }).state, t2.id)!.burning).toBe(false);
  });

  it("doesn't stack: hitting a burning model again keeps a single 1-damage burn", () => {
    const s = makeState();
    addUnit(s, 'pyromancer', 0, hex(-6, 6));
    const g = addUnit(s, 'grenadier', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'heavy', 1, hex(3, 0), { burning: true });
    let state = run(s, { type: 'special', unitId: g.id, hex: hex(3, 0) }).state;
    expect(getUnit(state, t.id)).toMatchObject({ hp: 10, burning: true });
    const r = run(state, END);
    state = r.state;
    expect(r.events.filter((e) => e.type === 'burn')).toHaveLength(1);
    expect(getUnit(state, t.id)!.hp).toBe(9);
  });

  it('burn damage can kill, end the game, and makes a Zombie crawl', () => {
    const s = makeState();
    addUnit(s, 'pyromancer', 0, hex(-6, 6));
    const last = addUnit(s, 'medic', 1, hex(0, -5), { hp: 1, burning: true });
    const { state, events } = run(s, END);
    expect(events).toContainEqual({ type: 'burn', unitId: last.id, damage: 1, killed: true });
    expect(state).toMatchObject({ phase: 'over', winner: 0, winReason: 'elimination' });

    const z = makeState();
    const zombie = addUnit(z, 'zombie', 1, hex(0, -5), { burning: true });
    addUnit(z, 'infantry', 0, hex(0, 5));
    const after = run(z, END).state; // P2's turn starts: burn ticks first
    expect(getUnit(after, zombie.id)).toMatchObject({ hp: 8, crawling: true, movesLeft: 1 });
  });

  it('keeps working after the Pyromancer dies', () => {
    const s = makeState();
    const pyro = addUnit(s, 'pyromancer', 0, hex(-6, 6));
    const flamer = addUnit(s, 'flamer', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'heavy', 1, hex(1, 0));
    s.units = s.units.filter((u) => u.id !== pyro.id);
    expect(getUnit(run(s, { type: 'special', unitId: flamer.id, dir: 0 }).state, t.id)!.burning).toBe(true);
  });
});
