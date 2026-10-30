import { describe, expect, it } from 'vitest';
import { previewAttack } from '../src/core/combat';
import { type Action, type GameEvent, applyAction } from '../src/core/game';
import { hex, hexKey } from '../src/core/hex';
import { chooseOverwatchTarget, watchArea } from '../src/core/overwatch';
import { canSeeUnit, getUnit, moveReach } from '../src/core/queries';
import { previewSpecial, specialBlockedReason } from '../src/core/specials';
import type { GameState } from '../src/core/types';
import { SPEED, UNITS, speedName } from '../src/data/config';
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

describe('crawl speed', () => {
  it('is 1 hex per turn and named', () => {
    expect(SPEED.crawl).toBe(1);
    expect(speedName(1)).toBe('crawl');
    expect(UNITS.artillery.speed).toBe(SPEED.crawl);
    const s = makeState();
    const art = addUnit(s, 'artillery', 0, hex(0, 3));
    expect(moveReach(s, art).costs.size).toBe(6);
  });
});

describe('Monster', () => {
  it('gets +1 to hit on its basic attack', () => {
    const s = makeState();
    const m = addUnit(s, 'monster', 0, hex(0, 0), { die: 5 });
    const inf = addUnit(s, 'infantry', 1, hex(1, 0)); // defense 6
    expect(previewAttack(s, m, inf)).toMatchObject({ roll: 5, bonus: 1, hitBonus: 1, hit: true, damage: 5 });
  });

  it('Sweep compares one die against every adjacent enemy separately', () => {
    const s = makeState();
    const m = addUnit(s, 'monster', 0, hex(0, 0), { die: 6 });
    const inf = addUnit(s, 'infantry', 1, hex(1, 0)); // def 6: hit
    const medic = addUnit(s, 'medic', 1, hex(0, 1)); // def 5: hit
    const scout = addUnit(s, 'scout', 1, hex(-1, 0)); // def 7: miss
    const braced = addUnit(s, 'heavy', 1, hex(0, -1), { braced: true }); // def 6 + 2 Brace: miss
    const friend = addUnit(s, 'medic', 0, hex(1, -1)); // allies are never hit
    const far = addUnit(s, 'medic', 1, hex(2, 0)); // not adjacent

    const { state, events } = run(s, { type: 'special', unitId: m.id });
    expect(getUnit(state, inf.id)!.hp).toBe(3);
    expect(getUnit(state, medic.id)!.hp).toBe(1);
    expect(getUnit(state, scout.id)!.hp).toBe(3);
    expect(getUnit(state, braced.id)!.hp).toBe(12);
    expect(getUnit(state, friend.id)!.hp).toBe(4);
    expect(getUnit(state, far.id)!.hp).toBe(4);
    const effects = (events[0] as { effects: { unitId: string; hit: boolean; roll: number }[] }).effects;
    expect(effects).toHaveLength(4);
    expect(new Set(effects.map((e) => e.roll))).toEqual(new Set([6]));
    expect(getUnit(state, m.id)).toMatchObject({ acted: true });
  });

  it('Sweep does not get the +1 to hit, and kills what it beats', () => {
    const s = makeState();
    const m = addUnit(s, 'monster', 0, hex(0, 0), { die: 5 });
    addUnit(s, 'infantry', 1, hex(1, 0)); // def 6: 5 misses without the +1
    const weak = addUnit(s, 'scout', 1, hex(-1, 0), { hp: 2 }); // def 7: miss too
    const medic = addUnit(s, 'medic', 1, hex(0, 1), { hp: 3 }); // def 5: hit, dies
    const p = previewSpecial(s, m, {})!;
    expect(p.effects.map((e) => e.hit)).toEqual([false, false, true]);
    expect(p.area).toHaveLength(6);
    const { state } = run(s, { type: 'special', unitId: m.id });
    expect(getUnit(state, medic.id)).toBeUndefined();
    expect(getUnit(state, weak.id)!.hp).toBe(2);
  });

  it('Sweep needs an adjacent enemy', () => {
    const s = makeState();
    const m = addUnit(s, 'monster', 0, hex(0, 0), { die: 12 });
    addUnit(s, 'medic', 0, hex(1, 0));
    addUnit(s, 'medic', 1, hex(2, 0));
    expect(specialBlockedReason(s, m)).toBe('no adjacent enemies');
  });
});

describe('Artillery', () => {
  it('cannot fire until loaded', () => {
    const s = makeState();
    const art = addUnit(s, 'artillery', 0, hex(0, 3), { die: 12 });
    const target = addUnit(s, 'infantry', 1, hex(0, -3));
    expect(previewAttack(s, art, target).blockedReason).toBe('Not loaded');
    expect(() => applyAction(s, { type: 'attack', unitId: art.id, targetId: target.id })).toThrow('Not loaded');
  });

  it('stays loaded through movement and turns, and firing unloads it', () => {
    const s = makeState();
    const art = addUnit(s, 'artillery', 0, hex(0, 3), { die: 12 });
    const target = addUnit(s, 'infantry', 1, hex(0, -4));
    let state = run(s, { type: 'special', unitId: art.id }).state;
    expect(getUnit(state, art.id)!.loaded).toBe(true);
    expect(specialBlockedReason(state, getUnit(state, art.id)!)).toBe('This model cannot act');

    state = run(state, END, END).state; // P2's turn, then round 2 (P1 first)
    expect(state.current).toBe(0);
    expect(getUnit(state, art.id)!.loaded).toBe(true);
    state = run(state, { type: 'move', unitId: art.id, to: hex(1, 3) }).state;
    expect(getUnit(state, art.id)).toMatchObject({ loaded: true, pos: hex(1, 3) });
    expect(specialBlockedReason(state, getUnit(state, art.id)!)).toBe('already loaded');

    const unit = getUnit(state, art.id)!;
    unit.die = 12; // force a hit
    const { state: after, events } = run(state, { type: 'attack', unitId: art.id, targetId: target.id });
    expect(events[0]).toMatchObject({ type: 'attack', hit: true, damage: 4 });
    expect(getUnit(after, target.id)!.hp).toBe(2);
    expect(getUnit(after, art.id)!.loaded).toBe(false);
  });

  it('indirect fire ignores line of sight: over height-2 walls and large models', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2]] });
    const art = addUnit(s, 'artillery', 0, hex(0, 3), { die: 12, loaded: true });
    addUnit(s, 'heavy', 1, hex(0, -1));
    const hidden = addUnit(s, 'scout', 1, hex(0, -3));
    expect(canSeeUnit(s, art, hidden)).toBe(false);
    expect(previewAttack(s, art, hidden).blockedReason).toBeNull();
  });

  it('has range 10', () => {
    const s = makeState();
    const art = addUnit(s, 'artillery', 0, hex(-3, 7), { die: 12, loaded: true });
    const inRange = addUnit(s, 'infantry', 1, hex(-3, -3)); // distance 10
    const outOfRange = addUnit(s, 'infantry', 1, hex(4, -4)); // distance 11
    expect(previewAttack(s, art, inRange).blockedReason).toBeNull();
    expect(previewAttack(s, art, outOfRange).blockedReason).toBe('Out of range');
  });
});

describe('Sentinel overwatch', () => {
  /** P1 Sentinel at (0,3) on overwatch with a locked die, then P2's turn begins. */
  function overwatchSetup(die: number) {
    const s = makeState();
    const sentinel = addUnit(s, 'sentinel', 0, hex(0, 3), { die });
    return { s, sentinel };
  }

  it('locks the die and the watched area (range 3, line of sight)', () => {
    const s = makeState({ terrain: [[hex(0, 2), 1]] });
    const sentinel = addUnit(s, 'sentinel', 0, hex(0, 3), { die: 9 });
    addUnit(s, 'medic', 1, hex(0, -6));
    const area = watchArea(s, sentinel);
    const keys = new Set(area.map(hexKey));
    expect(keys.has('0,2')).toBe(false); // terrain
    expect(keys.has('0,1')).toBe(false); // hidden behind the wall (for a small model)
    expect(keys.has('1,2')).toBe(true);
    expect(area.every((h) => Math.max(Math.abs(h.q), Math.abs(h.r - 3), Math.abs(h.q + h.r - 3)) <= 3)).toBe(true);
    expect(previewSpecial(s, sentinel, {})!.area.length).toBe(area.length);

    const { state } = run(s, { type: 'special', unitId: sentinel.id });
    expect(getUnit(state, sentinel.id)!.overwatch).toMatchObject({ die: 9 });
    expect(getUnit(state, sentinel.id)!.overwatch!.hexes).toHaveLength(area.length);
  });

  it('fires only at enemies still inside the area at the end of the opponent’s turn', () => {
    const { s, sentinel } = overwatchSetup(9);
    const leaver = addUnit(s, 'medic', 1, hex(1, 2)); // inside, will leave (def 5)
    const stayer = addUnit(s, 'infantry', 1, hex(-1, -2)); // outside, will enter (def 6)
    let state = run(s, { type: 'special', unitId: sentinel.id }, END).state; // now P2's turn
    state = run(state, { type: 'move', unitId: leaver.id, to: hex(1, -1) }).state; // out of range 3
    state = run(state, { type: 'move', unitId: stayer.id, to: hex(-1, 1) }).state; // into the area
    const { state: after, events } = run(state, END);
    const shot = events.find((e) => e.type === 'overwatch');
    expect(shot).toMatchObject({ unitId: sentinel.id, targetId: stayer.id, roll: 9, defense: 6, hit: true, damage: 2 });
    expect(getUnit(after, stayer.id)!.hp).toBe(4);
    expect(getUnit(after, leaver.id)!.hp).toBe(4);
    expect(getUnit(after, sentinel.id)!.overwatch).toBeNull(); // fired once, then ends
  });

  it('a miss still ends overwatch, and the shot uses the locked die', () => {
    const { s, sentinel } = overwatchSetup(3);
    const target = addUnit(s, 'medic', 1, hex(1, 2));
    const { state, events } = run(s, { type: 'special', unitId: sentinel.id }, END, END);
    expect(events.find((e) => e.type === 'overwatch')).toMatchObject({ roll: 3, hit: false, damage: 0 });
    expect(getUnit(state, target.id)!.hp).toBe(4);
    expect(getUnit(state, sentinel.id)!.overwatch).toBeNull();
  });

  it('targets the lowest defense, then lowest health (Brace counts)', () => {
    const s = makeState();
    const a = addUnit(s, 'medic', 1, hex(0, 0), { hp: 4 }); // def 5
    const b = addUnit(s, 'medic', 1, hex(1, 0), { hp: 2 }); // def 5, lower health
    const c = addUnit(s, 'scout', 1, hex(2, 0)); // def 7
    const braced = addUnit(s, 'medic', 1, hex(3, 0), { hp: 1, braced: true }); // def 7 when braced
    expect(chooseOverwatchTarget(s, [a, b, c, braced])!.id).toBe(b.id);
    expect(chooseOverwatchTarget(s, [a, c, braced])!.id).toBe(a.id);
    expect(chooseOverwatchTarget(s, [])).toBeUndefined();
  });

  it('does not fire if nobody is in the area, and ends anyway', () => {
    const { s, sentinel } = overwatchSetup(12);
    addUnit(s, 'medic', 1, hex(0, -6));
    const { state, events } = run(s, { type: 'special', unitId: sentinel.id }, END, END);
    expect(events.some((e) => e.type === 'overwatch')).toBe(false);
    expect(getUnit(state, sentinel.id)!.overwatch).toBeNull();
  });

  it('ends immediately if the Sentinel dies', () => {
    const { s, sentinel } = overwatchSetup(12);
    sentinel.hp = 1;
    addUnit(s, 'medic', 0, hex(-6, 6)); // so P1 still has a model after the Sentinel dies
    const killer = addUnit(s, 'sniper', 1, hex(0, -4));
    addUnit(s, 'medic', 1, hex(1, 2)); // inside the area
    let state = run(s, { type: 'special', unitId: sentinel.id }, END).state;
    getUnit(state, killer.id)!.die = 12;
    state = run(state, { type: 'attack', unitId: killer.id, targetId: sentinel.id }).state;
    expect(getUnit(state, sentinel.id)).toBeUndefined();
    const { events } = run(state, END);
    expect(events.some((e) => e.type === 'overwatch')).toBe(false);
  });

  it('Spot applies to the shot and a kill can end the game', () => {
    const { s, sentinel } = overwatchSetup(4);
    const target = addUnit(s, 'medic', 1, hex(1, 2), { hp: 2, spottedBy: 0 }); // def 5: 4 + 2 spot hits
    const { state, events } = run(s, { type: 'special', unitId: sentinel.id }, END, END);
    expect(events.find((e) => e.type === 'overwatch')).toMatchObject({ bonus: 2, hit: true, killed: true });
    expect(getUnit(state, target.id)).toBeUndefined();
    expect(state).toMatchObject({ phase: 'over', winner: 0, winReason: 'elimination' });
  });

  it('fires before round scoring', () => {
    // P1 sets overwatch; P2 then moves last in round 1 with a medic sitting on the control point.
    const { s, sentinel } = overwatchSetup(12);
    const onPoint = addUnit(s, 'medic', 1, hex(0, 1), { hp: 2 }); // control point, inside the watched area
    addUnit(s, 'medic', 1, hex(0, -6));
    const { state, events } = run(s, { type: 'special', unitId: sentinel.id }, END, END);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf('overwatch')).toBeLessThan(kinds.indexOf('roundScored'));
    expect(getUnit(state, onPoint.id)).toBeUndefined();
    expect(state.scores).toEqual([0, 0]); // without overwatch first, P2 would have scored
  });

  it('survives back-to-back turns at an order flip and fires after the opponent’s next turn', () => {
    const s = makeState();
    s.round = 2;
    s.turnInRound = 1;
    s.current = 1; // P2 moves last in round 2, then first in round 3
    const sentinel = addUnit(s, 'sentinel', 1, hex(0, -3), { die: 10 });
    const target = addUnit(s, 'medic', 0, hex(0, -1));
    addUnit(s, 'medic', 0, hex(-6, 6));
    let state = run(s, { type: 'special', unitId: sentinel.id }, END).state;
    expect(state).toMatchObject({ round: 3, current: 1 }); // P2 again
    expect(getUnit(state, sentinel.id)!.overwatch).toMatchObject({ die: 10 });
    state = run(state, END).state; // P2 ends its second turn without touching the Sentinel
    expect(state.current).toBe(0);
    expect(getUnit(state, sentinel.id)!.overwatch).not.toBeNull();
    const { events } = run(state, END); // P1's turn ends: overwatch fires
    expect(events.find((e) => e.type === 'overwatch')).toMatchObject({ targetId: target.id, roll: 10, hit: true });
  });

  it('moving or using the die cancels overwatch', () => {
    const s = makeState();
    s.round = 2;
    s.turnInRound = 1;
    s.current = 1;
    const sentinel = addUnit(s, 'sentinel', 1, hex(0, -3), { die: 10 });
    addUnit(s, 'medic', 0, hex(-6, 6));
    const state = run(s, { type: 'special', unitId: sentinel.id }, END).state; // P2 goes again
    const moved = run(state, { type: 'move', unitId: sentinel.id, to: hex(0, -2) }).state;
    expect(getUnit(moved, sentinel.id)!.overwatch).toBeNull();
  });
});
