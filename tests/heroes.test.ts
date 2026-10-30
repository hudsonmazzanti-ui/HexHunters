import { describe, expect, it } from 'vitest';
import { validateArmy } from '../src/core/army';
import { previewAttack } from '../src/core/combat';
import { type Action, type GameEvent, applyAction, canUndoMove, newGame } from '../src/core/game';
import { hex } from '../src/core/hex';
import { aurasOn } from '../src/core/auras';
import { attackDamage, baseDefense, canSeeUnit, getUnit, maxHealth, moveReach, needsLoading, unitSpeed } from '../src/core/queries';
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
/** P1 ends, P2 ends: back to P1 at the start of round 2. */
const NEXT_P1_TURN = [END, END];

/** Kills a unit outright (heroes' auras must survive this). */
function kill(state: GameState, id: string): GameState {
  const s = structuredClone(state);
  s.units = s.units.filter((u) => u.id !== id);
  return s;
}

describe('hero data and army limit', () => {
  it('has the three heroes with the agreed stats and no special', () => {
    expect(UNITS.marshal).toMatchObject({ cost: 7, size: 2, speed: 3, defense: 6, health: 9, range: 4, damage: 3 });
    expect(UNITS.siegemaster).toMatchObject({ cost: 8, size: 2, speed: 2, defense: 5, health: 8, range: 4, damage: 2, indirectFire: true });
    expect(UNITS.warlord).toMatchObject({ cost: 6, size: 3, speed: 3, defense: 6, health: 12, range: 1, damage: 4 });
    for (const id of ['marshal', 'siegemaster', 'warlord']) {
      expect(UNITS[id].hero).toBeDefined();
      expect(UNITS[id].special).toBeUndefined();
    }
  });

  it('allows at most one hero per army; heroes are optional', () => {
    expect(validateArmy(DEFAULT_CONFIG, ['infantry', 'infantry'])).toBeNull();
    expect(validateArmy(DEFAULT_CONFIG, ['warlord', 'infantry', 'infantry'])).toBeNull();
    expect(validateArmy(DEFAULT_CONFIG, ['warlord', 'marshal'])).toBe('Only one hero per army (you have 2)');
    expect(validateArmy(DEFAULT_CONFIG, ['warlord', 'warlord'])).toMatch(/one hero/);
    expect(() => applyAction(newGame(DEFAULT_CONFIG, 1), { type: 'chooseArmy', units: ['warlord', 'marshal'] })).toThrow(
      'Only one hero',
    );
  });

  it('choosing an army records its hero aura for that player only', () => {
    const s = run(newGame(DEFAULT_CONFIG, 1), { type: 'chooseArmy', units: ['marshal', 'infantry'] }, { type: 'chooseArmy', units: ['heavy'] }).state;
    expect(s.auras).toEqual([['marshal'], []]);
  });

  it('heroes have no special: their die is only for attacking', () => {
    const s = makeState();
    const w = addUnit(s, 'warlord', 0, hex(0, 0), { die: 12 });
    const enemy = addUnit(s, 'infantry', 1, hex(1, 0));
    expect(specialBlockedReason(s, w)).toBe('No special action');
    expect(() => applyAction(s, { type: 'special', unitId: w.id })).toThrow('No special action');
    expect(previewAttack(s, w, enemy)).toMatchObject({ blockedReason: null, hit: true, damage: 4 });
  });
});

describe('Field Marshal', () => {
  it('gives your Infantry +2 on their roll every turn, without an action', () => {
    const s = makeState();
    addUnit(s, 'marshal', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    const medic = addUnit(s, 'medic', 0, hex(1, 3));
    const enemyInf = addUnit(s, 'infantry', 1, hex(0, -3));
    expect(aurasOn(s, inf)).toEqual(['marshal']);
    expect(aurasOn(s, medic)).toEqual([]);
    expect(aurasOn(s, enemyInf)).toEqual([]);

    const p2 = run(s, END).state; // P2's turn: the enemy Infantry gets no bonus
    expect(getUnit(p2, enemyInf.id)!.dieBonus).toBe(0);
    const p1 = run(p2, END).state;
    expect(getUnit(p1, inf.id)!.dieBonus).toBe(2);
    expect(getUnit(p1, medic.id)!.dieBonus).toBe(0);
  });

  it('stacks with manual Prep for +4', () => {
    const s = makeState();
    addUnit(s, 'marshal', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    addUnit(s, 'infantry', 1, hex(0, -3));
    const state = run(s, { type: 'special', unitId: inf.id }, ...NEXT_P1_TURN).state;
    const u = getUnit(state, inf.id)!;
    expect(u.dieBonus).toBe(4);
    expect(u.prepped).toBe(false);
  });

  it('keeps working after the Field Marshal dies', () => {
    const s = makeState();
    const fm = addUnit(s, 'marshal', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    addUnit(s, 'infantry', 1, hex(0, -3));
    const state = run(kill(s, fm.id), ...NEXT_P1_TURN).state;
    expect(getUnit(state, inf.id)!.dieBonus).toBe(2);
  });
});

describe('Siege Master', () => {
  it('lets your Artillery fire without loading, and firing keeps it ready', () => {
    const s = makeState();
    addUnit(s, 'siegemaster', 0, hex(-5, 5));
    const art = addUnit(s, 'artillery', 0, hex(0, 3), { die: 12 });
    const target = addUnit(s, 'infantry', 1, hex(0, -3));
    expect(needsLoading(s, art)).toBe(false);
    expect(specialBlockedReason(s, art)).toBe('not needed');
    expect(previewAttack(s, art, target).blockedReason).toBeNull();
    const { state, events } = run(s, { type: 'attack', unitId: art.id, targetId: target.id });
    expect(events[0]).toMatchObject({ type: 'attack', hit: true, damage: 4 });
    // Next turn it can fire again without loading.
    const later = run(state, ...NEXT_P1_TURN).state;
    const art2 = getUnit(later, art.id)!;
    art2.die = 12;
    expect(previewAttack(later, art2, getUnit(later, target.id)!).blockedReason).toBeNull();
  });

  it("doesn't affect the enemy's Artillery", () => {
    const s = makeState();
    addUnit(s, 'siegemaster', 1, hex(-5, -1));
    const art = addUnit(s, 'artillery', 0, hex(0, 3), { die: 12 });
    const target = addUnit(s, 'infantry', 1, hex(0, -3));
    expect(previewAttack(s, art, target).blockedReason).toBe('Not loaded');
  });

  it('keeps working after the Siege Master dies', () => {
    const s = makeState();
    const sm = addUnit(s, 'siegemaster', 0, hex(-5, 5));
    const art = addUnit(s, 'artillery', 0, hex(0, 3), { die: 12 });
    const target = addUnit(s, 'infantry', 1, hex(0, -3));
    const after = kill(s, sm.id);
    expect(previewAttack(after, getUnit(after, art.id)!, getUnit(after, target.id)!).blockedReason).toBeNull();
  });

  it('its own attack is indirect fire', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2]] });
    const sm = addUnit(s, 'siegemaster', 0, hex(0, 2), { die: 12 });
    addUnit(s, 'heavy', 1, hex(0, 0));
    const hidden = addUnit(s, 'scout', 1, hex(0, -1));
    expect(canSeeUnit(s, sm, hidden)).toBe(false);
    expect(previewAttack(s, sm, hidden).blockedReason).toBeNull();
  });
});

describe('Warlord', () => {
  it('gives all your large models, including itself, +1 movement', () => {
    const s = makeState();
    const w = addUnit(s, 'warlord', 0, hex(-5, 5));
    const heavy = addUnit(s, 'heavy', 0, hex(-3, 5));
    const monster = addUnit(s, 'monster', 0, hex(-1, 5));
    const grappler = addUnit(s, 'grappler', 0, hex(1, 5));
    const inf = addUnit(s, 'infantry', 0, hex(3, 4));
    const enemyHeavy = addUnit(s, 'heavy', 1, hex(0, -5));
    expect(unitSpeed(s, w)).toBe(4);
    expect(unitSpeed(s, heavy)).toBe(3);
    expect(unitSpeed(s, monster)).toBe(4);
    expect(unitSpeed(s, grappler)).toBe(3);
    expect(unitSpeed(s, inf)).toBe(3);
    expect(unitSpeed(s, enemyHeavy)).toBe(2);

    const state = run(s, ...NEXT_P1_TURN).state;
    expect(getUnit(state, heavy.id)!.movesLeft).toBe(3);
    expect(getUnit(state, w.id)!.movesLeft).toBe(4);
    // A heavy can really move 3 hexes now.
    expect(moveReach(state, getUnit(state, heavy.id)!).costs.get('0,5')).toBe(3);
  });

  it('undo move restores the boosted movement', () => {
    const s = makeState();
    addUnit(s, 'warlord', 0, hex(-5, 5));
    const heavy = addUnit(s, 'heavy', 0, hex(0, 3), { movesLeft: 3 });
    addUnit(s, 'infantry', 1, hex(0, -3));
    const moved = run(s, { type: 'move', unitId: heavy.id, to: hex(2, 3) }).state;
    const undone = run(moved, { type: 'undoMove', unitId: heavy.id }).state;
    expect(getUnit(undone, heavy.id)!.movesLeft).toBe(3);
  });

  it('keeps working after the Warlord dies', () => {
    const s = makeState();
    const w = addUnit(s, 'warlord', 0, hex(-5, 5));
    const heavy = addUnit(s, 'heavy', 0, hex(0, 3));
    addUnit(s, 'infantry', 1, hex(0, -3));
    const state = run(kill(s, w.id), ...NEXT_P1_TURN).state;
    expect(getUnit(state, heavy.id)!.movesLeft).toBe(3);
  });
});

describe('Warden', () => {
  it('has the agreed stats and is a hero', () => {
    expect(UNITS.warden).toMatchObject({ cost: 6, size: 2, speed: 3, defense: 6, health: 10, range: 4, damage: 3 });
    expect(UNITS.warden.hero).toEqual({ aura: 'warden' });
  });

  it('gives Medics +1 defense and +1 damage, Sentinels +1 defense and +2 max health', () => {
    const s = makeState();
    addUnit(s, 'warden', 0, hex(-5, 5));
    const medic = addUnit(s, 'medic', 0, hex(0, 3), { die: 12 });
    const sentinel = addUnit(s, 'sentinel', 0, hex(1, 3));
    const enemyMedic = addUnit(s, 'medic', 1, hex(0, 1));
    const enemySentinel = addUnit(s, 'sentinel', 1, hex(1, -3));
    expect(baseDefense(s, medic)).toBe(6);
    expect(baseDefense(s, sentinel)).toBe(7);
    expect(maxHealth(s, sentinel)).toBe(10);
    expect(sentinel.hp).toBe(10);
    expect(attackDamage(s, medic)).toBe(2);
    expect(previewAttack(s, medic, enemyMedic)).toMatchObject({ damage: 2, defense: 5 });
    // The enemy's Medics and Sentinels are unaffected.
    expect(baseDefense(s, enemySentinel)).toBe(6);
    expect(maxHealth(s, enemySentinel)).toBe(8);
    expect(previewAttack(s, getUnit(s, enemyMedic.id)!, medic).defense).toBe(6);
  });

  it('Sentinels start the game with the extra health when the army is chosen', () => {
    const s = run(newGame(DEFAULT_CONFIG, 1), { type: 'chooseArmy', units: ['warden', 'sentinel', 'medic'] }, { type: 'chooseArmy', units: ['sentinel'] }).state;
    const [mine, theirs] = [0, 1].map((p) => s.units.find((u) => u.owner === p && u.type === 'sentinel')!);
    expect(mine.hp).toBe(10);
    expect(theirs.hp).toBe(8);
    expect(s.units.find((u) => u.type === 'medic')!.hp).toBe(4);
  });

  it('Heal can restore a Sentinel up to its boosted max health', () => {
    const s = makeState();
    addUnit(s, 'warden', 0, hex(-5, 5));
    const medic = addUnit(s, 'medic', 0, hex(0, 3), { die: 12 });
    const sentinel = addUnit(s, 'sentinel', 0, hex(1, 3), { hp: 7 });
    addUnit(s, 'infantry', 1, hex(0, -3));
    const { state } = run(s, { type: 'special', unitId: medic.id, targetId: sentinel.id });
    expect(getUnit(state, sentinel.id)!.hp).toBe(10);
  });

  it('Torch ignores the Warden bonus; Sweep and normal attacks count it', () => {
    const s = makeState();
    addUnit(s, 'warden', 1, hex(-5, -1));
    const flamer = addUnit(s, 'flamer', 0, hex(0, 0), { die: 6 });
    const sentinel = addUnit(s, 'sentinel', 1, hex(1, 0)); // base 6, 7 with Warden
    const torch = previewSpecial(s, flamer, { dir: 0 })!;
    expect(torch.effects[0]).toMatchObject({ defense: 6, hit: true });
    const monster = addUnit(s, 'monster', 0, hex(2, -1), { die: 6 });
    const sweep = previewSpecial(s, monster, {})!;
    expect(sweep.effects.find((e) => e.unitId === sentinel.id)).toMatchObject({ defense: 7, hit: false });
  });

  it('keeps working after the Warden dies', () => {
    const s = makeState();
    const w = addUnit(s, 'warden', 0, hex(-5, 5));
    const medic = addUnit(s, 'medic', 0, hex(0, 3));
    const after = kill(s, w.id);
    expect(baseDefense(after, getUnit(after, medic.id)!)).toBe(6);
    expect(aurasOn(after, getUnit(after, medic.id)!)).toEqual(['warden']);
  });
});

describe('Master Ninja', () => {
  /** P1 Master Ninja (far away) plus the given unit; one enemy to attack. */
  function ninjaSetup(type: 'assassin' | 'scout', extra: Partial<import('../src/core/types').Unit> = {}) {
    const s = makeState({ terrain: [[hex(1, 0), 1]] });
    addUnit(s, 'masterninja', 0, hex(-5, 5));
    const unit = addUnit(s, type, 0, hex(0, 0), { die: 9, ...extra });
    const enemy = addUnit(s, 'heavy', 1, hex(3, 0), { hp: 12 });
    return { s, unit, enemy };
  }

  it('has the agreed stats and is a hero', () => {
    expect(UNITS.masterninja).toMatchObject({ cost: 7, size: 1, speed: 4, defense: 5, health: 7, range: 1, damage: 4 });
    expect(UNITS.masterninja.hero).toEqual({ aura: 'ninja' });
  });

  it('Assassin: vault, move, then attack with the same die', () => {
    const { s, unit, enemy } = ninjaSetup('assassin');
    let state = run(s, { type: 'special', unitId: unit.id, hex: hex(2, 0) }).state; // vault over (1,0)
    let a = getUnit(state, unit.id)!;
    expect(a).toMatchObject({ specialUsed: true, acted: false, die: 9 });
    expect(specialBlockedReason(state, a)).toBe('already used');
    const { state: after, events } = run(state, { type: 'attack', unitId: unit.id, targetId: enemy.id });
    expect(events[0]).toMatchObject({ type: 'attack', roll: 9, hit: true, damage: 4 });
    a = getUnit(after, unit.id)!;
    expect(a).toMatchObject({ acted: true, movesLeft: 0 });
    state = after;
    expect(getUnit(state, enemy.id)!.hp).toBe(8);
  });

  it('Scout: dash, then attack; attacking ends the turn, so no special afterwards', () => {
    const { s, unit, enemy } = ninjaSetup('scout', { pos: hex(0, 1), movesLeft: 4 });
    // Dash with a 9: +3 hexes on top of the 4 normal ones.
    let state = run(s, { type: 'special', unitId: unit.id }).state;
    expect(getUnit(state, unit.id)).toMatchObject({ movesLeft: 7, specialUsed: true, acted: false });
    state = run(state, { type: 'move', unitId: unit.id, to: hex(2, 1) }).state;
    const { state: after } = run(state, { type: 'attack', unitId: unit.id, targetId: enemy.id });
    expect(getUnit(after, unit.id)).toMatchObject({ acted: true, movesLeft: 0 });

    // The other order: attack first ends the turn; the special is no longer available.
    const fresh = ninjaSetup('scout', { pos: hex(1, 1) });
    const attacked = run(fresh.s, { type: 'attack', unitId: fresh.unit.id, targetId: fresh.enemy.id }).state;
    expect(specialBlockedReason(attacked, getUnit(attacked, fresh.unit.id)!)).toBe('This model cannot act');
    expect(() => applyAction(attacked, { type: 'special', unitId: fresh.unit.id })).toThrow();
    expect(() => applyAction(attacked, { type: 'move', unitId: fresh.unit.id, to: hex(1, 2) })).toThrow();
  });

  it('undo move is locked once the special has been used', () => {
    const { s, unit } = ninjaSetup('scout', { pos: hex(0, 1), movesLeft: 4 });
    const moved = run(s, { type: 'move', unitId: unit.id, to: hex(-1, 2) }).state;
    expect(canUndoMove(moved, getUnit(moved, unit.id)!)).toBe(true);
    const dashed = run(moved, { type: 'special', unitId: unit.id }).state;
    expect(canUndoMove(dashed, getUnit(dashed, unit.id)!)).toBe(false);
  });

  it('only Assassins and Scouts of its own army get the second action', () => {
    const s = makeState();
    addUnit(s, 'masterninja', 0, hex(-5, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    const enemyScout = addUnit(s, 'scout', 1, hex(0, -3));
    addUnit(s, 'infantry', 1, hex(3, -3));
    const state = run(s, { type: 'special', unitId: inf.id }).state;
    expect(getUnit(state, inf.id)!.acted).toBe(true);
    expect(aurasOn(s, enemyScout)).toEqual([]);

    // Without the hero, a Scout's special ends its actions as before.
    const plain = makeState();
    const scout = addUnit(plain, 'scout', 0, hex(0, 3), { die: 9 });
    addUnit(plain, 'infantry', 1, hex(0, -3));
    expect(getUnit(run(plain, { type: 'special', unitId: scout.id }).state, scout.id)!.acted).toBe(true);
  });

  it('keeps working after the Master Ninja dies', () => {
    const { s, unit } = ninjaSetup('scout');
    const ninja = s.units.find((u) => u.type === 'masterninja')!;
    const after = kill(s, ninja.id);
    const state = run(after, { type: 'special', unitId: unit.id }).state;
    expect(getUnit(state, unit.id)!.acted).toBe(false);
  });

  it('the one-hero limit still applies to the new heroes', () => {
    expect(validateArmy(DEFAULT_CONFIG, ['masterninja', 'warden'])).toBe('Only one hero per army (you have 2)');
    expect(validateArmy(DEFAULT_CONFIG, ['masterninja', 'assassin', 'scout', 'scout'])).toBeNull();
    expect(validateArmy(DEFAULT_CONFIG, ['warden', 'medic', 'sentinel', 'sentinel'])).toBeNull();
  });
});
