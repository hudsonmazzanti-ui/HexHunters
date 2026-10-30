import { describe, expect, it } from 'vitest';
import { validateArmy } from '../src/core/army';
import { previewAttack } from '../src/core/combat';
import { type Action, type GameEvent, applyAction, newGame } from '../src/core/game';
import { hex } from '../src/core/hex';
import { aurasOn } from '../src/core/auras';
import { canSeeUnit, getUnit, moveReach, needsLoading, unitSpeed } from '../src/core/queries';
import { specialBlockedReason } from '../src/core/specials';
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
