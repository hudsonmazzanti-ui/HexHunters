import { describe, expect, it } from 'vitest';
import { armyCost, validateArmy } from '../src/core/army';
import { previewAttack } from '../src/core/combat';
import { type Action, type GameEvent, applyAction, canUndoMove, freePartnerHexes, newGame } from '../src/core/game';
import { hex, hexDistance } from '../src/core/hex';
import { getUnit } from '../src/core/queries';
import { previewSpecial, specialBlockedReason } from '../src/core/specials';
import type { GameState } from '../src/core/types';
import { DEFAULT_CONFIG, SQUADS, UNITS } from '../src/data/config';
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

/** Linked twins on a test board. */
function twins(s: GameState, tankAt = hex(0, 6), shooterAt = hex(0, -6), owner: 0 | 1 = 0) {
  const tank = addUnit(s, 'twintank', owner, tankAt);
  const shooter = addUnit(s, 'twinshooter', owner, shooterAt);
  tank.partnerId = shooter.id;
  shooter.partnerId = tank.id;
  return { tank, shooter };
}

describe('Twins data and army building', () => {
  it('has the agreed stats; the Shooter uses the Infantry attack', () => {
    expect(SQUADS.twins).toEqual({ name: 'The Twins', cost: 10, hero: true, members: ['twintank', 'twinshooter'] });
    expect(UNITS.twintank).toMatchObject({ size: 3, speed: 2, defense: 7, health: 12, range: 1, damage: 3, special: 'swap' });
    expect(UNITS.twinshooter).toMatchObject({ size: 1, speed: 3, defense: 5, health: 5, special: 'swap' });
    expect([UNITS.twinshooter.range, UNITS.twinshooter.damage]).toEqual([UNITS.infantry.range, UNITS.infantry.damage]);
  });

  it('buying the Twins adds both models for 10 points and counts as the one hero', () => {
    expect(armyCost(DEFAULT_CONFIG, ['twins', 'scout'])).toBe(12);
    expect(validateArmy(DEFAULT_CONFIG, ['twins', 'scout', 'scout'])).toBeNull();
    expect(validateArmy(DEFAULT_CONFIG, ['twins', 'warlord'])).toBe('Only one hero per army (you have 2)');
    expect(validateArmy(DEFAULT_CONFIG, ['twintank'])).toMatch(/only comes with The Twins/);

    const s = run(newGame(DEFAULT_CONFIG, 1), { type: 'chooseArmy', units: ['twins', 'scout'] }, { type: 'chooseArmy', units: ['scout'] }).state;
    const mine = s.units.filter((u) => u.owner === 0);
    expect(mine.map((u) => u.type)).toEqual(['twintank', 'twinshooter', 'scout']);
    const [tank, shooter, scout] = mine;
    expect(tank.partnerId).toBe(shooter.id);
    expect(shooter.partnerId).toBe(tank.id);
    expect(scout.partnerId).toBeNull();
    expect(tank.hp).toBe(12);
    expect(s.auras[0]).toEqual([]); // no passive rule
  });
});

describe('Twins deployment', () => {
  const built = () =>
    run(newGame(DEFAULT_CONFIG, 1), { type: 'chooseArmy', units: ['twins'] }, { type: 'chooseArmy', units: ['scout'] }).state;

  it('places both twins next to each other in one step, then hands over', () => {
    const s = built();
    const [tank, shooter] = s.units.filter((u) => u.owner === 0);
    const zone = s.map.deployZones[0];
    const first = zone[0];
    const partnerHex = freePartnerHexes(s, first)[0];
    expect(() => applyAction(s, { type: 'place', unitId: tank.id, hex: first })).toThrow('Place the other twin');
    expect(() => applyAction(s, { type: 'place', unitId: tank.id, hex: first, partnerHex: zone[zone.length - 1] })).toThrow(
      'must go on a free hex next to',
    );
    const { state, events } = run(s, { type: 'place', unitId: tank.id, hex: first, partnerHex });
    expect(getUnit(state, tank.id)!.pos).toEqual(first);
    expect(getUnit(state, shooter.id)!.pos).toEqual(partnerHex);
    expect(hexDistance(first, partnerHex)).toBe(1);
    expect(events[0]).toMatchObject({ type: 'placed', next: 1 }); // handoff only after both
    expect(state.current).toBe(1);
  });

  it('blocks a placement with no free adjacent hex in the zone', () => {
    const s = built();
    const [tank] = s.units.filter((u) => u.owner === 0);
    const first = s.map.deployZones[0][0];
    // Fill every free zone neighbour with enemy models (test-only setup).
    for (const n of freePartnerHexes(s, first)) addUnit(s, 'scout', 1, n);
    expect(freePartnerHexes(s, first)).toEqual([]);
    expect(() => applyAction(s, { type: 'place', unitId: tank.id, hex: first, partnerHex: hex(0, 0) })).toThrow(
      'No free hex next to it for the other twin',
    );
  });
});

describe('Swap', () => {
  it('trades positions across the whole map, with no line of sight needed', () => {
    const s = makeState({ terrain: [[hex(0, 0), 2]] });
    const { tank, shooter } = twins(s, hex(0, 7), hex(0, -7)); // opposite edges, wall in between
    addUnit(s, 'infantry', 1, hex(3, -3));
    tank.die = 1;
    expect(specialBlockedReason(s, tank)).toBeNull();
    expect(previewSpecial(s, tank, {})!.area.map((a) => a.hex)).toEqual([hex(0, 7), hex(0, -7)]);
    const { state, events } = run(s, { type: 'special', unitId: tank.id });
    expect(getUnit(state, tank.id)!.pos).toEqual(hex(0, -7));
    expect(getUnit(state, shooter.id)!.pos).toEqual(hex(0, 7));
    expect(getUnit(state, tank.id)).toMatchObject({ acted: true, movesLeft: 0 });
    expect(events[0]).toMatchObject({ special: 'swap', targetId: shooter.id, movedId: tank.id, from: hex(0, 7), to: hex(0, -7) });
  });

  it('the partner keeps its die and can still move and attack afterwards', () => {
    const s = makeState();
    const { tank, shooter } = twins(s, hex(0, 6), hex(3, 0));
    shooter.die = 11;
    const enemy = addUnit(s, 'scout', 1, hex(0, 3)); // 3 hexes from the tank's spot
    let state = run(s, { type: 'special', unitId: tank.id }).state;
    const moved = getUnit(state, shooter.id)!;
    expect(moved).toMatchObject({ pos: hex(0, 6), die: 11, acted: false, movesLeft: 3 });
    expect(canUndoMove(state, moved)).toBe(false); // the swap itself can't be undone
    state = run(state, { type: 'move', unitId: shooter.id, to: hex(0, 5) }).state;
    expect(previewAttack(state, getUnit(state, shooter.id)!, getUnit(state, enemy.id)!).blockedReason).toBeNull();
    const after = run(state, { type: 'attack', unitId: shooter.id, targetId: enemy.id }).state;
    expect(getUnit(after, enemy.id)!.hp).toBe(1);
  });

  it('is disabled for the rest of the game once either twin dies', () => {
    const s = makeState();
    const { tank, shooter } = twins(s);
    addUnit(s, 'infantry', 1, hex(3, -3));
    s.units = s.units.filter((u) => u.id !== shooter.id);
    expect(specialBlockedReason(s, tank)).toBe('partner fallen');
    expect(() => applyAction(s, { type: 'special', unitId: tank.id })).toThrow('partner fallen');

    // And the other way round.
    const t = makeState();
    const pair = twins(t);
    addUnit(t, 'infantry', 1, hex(3, -3));
    t.units = t.units.filter((u) => u.id !== pair.tank.id);
    expect(specialBlockedReason(t, pair.shooter)).toBe('partner fallen');
  });
});
