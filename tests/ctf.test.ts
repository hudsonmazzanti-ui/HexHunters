import { describe, expect, it } from 'vitest';
import { type Action, type GameEvent, applyAction, isInDeployZone, newGame } from '../src/core/game';
import { flagCarrier } from '../src/core/flag';
import { ORIGIN, hex, hexKey } from '../src/core/hex';
import { MISSIONS, pickMission } from '../src/core/missions';
import { actionBonus, getUnit, moveReach, unitSpeed } from '../src/core/queries';
import type { GameState, PlayerId, TerrainHeight } from '../src/core/types';
import { DEFAULT_CONFIG } from '../src/data/config';
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

/** A Capture the Flag test board: the flag on the center hex (or wherever `flagAt` says). */
function ctf(opts: { terrain?: [ReturnType<typeof hex>, TerrainHeight][]; flagAt?: ReturnType<typeof hex> } = {}): GameState {
  const s = makeState(opts);
  s.mission = 'ctf';
  s.flag = { pos: opts.flagAt ?? ORIGIN, carrierId: null };
  return s;
}

/** Gives the flag to a model directly. */
const carry = (s: GameState, id: string) => (s.flag = { pos: null, carrierId: id });

const END: Action = { type: 'endTurn' };
const drops = (events: GameEvent[]) => events.filter((e) => e.type === 'flagDropped');

describe('Capture the Flag: picking up', () => {
  it('a model on the flag spends its action to pick it up: no attack afterwards, movement ends', () => {
    const s = ctf();
    const inf = addUnit(s, 'infantry', 0, ORIGIN);
    const enemy = addUnit(s, 'infantry', 1, hex(0, -3));
    const { state, events } = run(s, { type: 'pickUp', unitId: inf.id });
    expect(state.flag).toEqual({ pos: null, carrierId: inf.id });
    expect(events).toContainEqual({ type: 'flagPickedUp', unitId: inf.id, hex: ORIGIN });
    const after = getUnit(state, inf.id)!;
    expect(after).toMatchObject({ acted: true, movesLeft: 0 });
    expect(() => applyAction(state, { type: 'attack', unitId: inf.id, targetId: enemy.id })).toThrow();
  });

  it('can move onto the flag first, then pick it up', () => {
    const s = ctf();
    const inf = addUnit(s, 'infantry', 0, hex(0, 2));
    const { state } = run(s, { type: 'move', unitId: inf.id, to: ORIGIN }, { type: 'pickUp', unitId: inf.id });
    expect(flagCarrier(state)?.id).toBe(inf.id);
  });

  it('needs to stand on the flag, have its action left, and the mission to be Capture the Flag', () => {
    const s = ctf();
    const off = addUnit(s, 'infantry', 0, hex(1, 0));
    expect(() => applyAction(s, { type: 'pickUp', unitId: off.id })).toThrow(/Not on the flag/);
    const done = addUnit(s, 'infantry', 0, ORIGIN, { acted: true });
    expect(() => applyAction(s, { type: 'pickUp', unitId: done.id })).toThrow(/cannot act/);

    const koth = makeState();
    const inf = addUnit(koth, 'infantry', 0, ORIGIN);
    expect(() => applyAction(koth, { type: 'pickUp', unitId: inf.id })).toThrow(/Not on the flag/);
  });

  it('a model without a die (Behemoth) can pick it up too', () => {
    const s = ctf();
    const b = addUnit(s, 'behemoth', 0, ORIGIN);
    expect(flagCarrier(run(s, { type: 'pickUp', unitId: b.id }).state)?.id).toBe(b.id);
  });
});

describe('Capture the Flag: the carrier', () => {
  it('moves 1 slower, minimum 1, and back to normal once it drops the flag', () => {
    const s = ctf();
    const inf = addUnit(s, 'infantry', 0, hex(0, 2)); // speed 3
    const heavy = addUnit(s, 'heavy', 0, hex(2, 2)); // speed 2
    const zombie = addUnit(s, 'zombie', 0, hex(-2, 2), { crawling: true }); // crawl 1
    carry(s, inf.id);
    expect(unitSpeed(s, inf)).toBe(2);
    carry(s, heavy.id);
    expect(unitSpeed(s, heavy)).toBe(1);
    carry(s, zombie.id);
    expect(unitSpeed(s, zombie)).toBe(1); // minimum 1
    s.flag = { pos: ORIGIN, carrierId: null };
    expect(unitSpeed(s, inf)).toBe(3);
  });

  it('ignores the Warlord\'s +1: a Monster carrying with the Warlord moves 1, and 3 again once it drops it', () => {
    const s = ctf();
    const warlord = addUnit(s, 'warlord', 0, hex(3, 3));
    const monster = addUnit(s, 'monster', 0, hex(0, 3));
    expect(unitSpeed(s, monster)).toBe(3); // 2 + 1 (Warlord)
    carry(s, monster.id);
    expect(unitSpeed(s, monster)).toBe(1); // own speed 2 - 1 (flag); the +1 doesn't apply
    carry(s, warlord.id);
    expect(unitSpeed(s, warlord)).toBe(1); // the Warlord itself too
    expect(unitSpeed(s, monster)).toBe(3); // not carrying: bonus back
  });

  it('the move range on the board follows the carrier\'s speed (Warlord bonus ignored)', () => {
    const s = ctf({ flagAt: hex(5, -5) });
    addUnit(s, 'warlord', 0, hex(-5, 5));
    const monster = addUnit(s, 'monster', 0, ORIGIN, { movesLeft: 3 });
    const far = (n: number) => [...moveReach(s, monster).costs.values()].some((c) => c === n);
    expect(far(3)).toBe(true);
    carry(s, monster.id);
    monster.movesLeft = unitSpeed(s, monster); // as at the start of its turn
    expect(far(1)).toBe(true);
    expect(far(2)).toBe(false);
  });

  it('a Warlord-boosted carrier gets the reduced movement at the start of its turn', () => {
    const s = ctf({ flagAt: hex(5, -5) });
    addUnit(s, 'warlord', 0, hex(-5, 5));
    const monster = addUnit(s, 'monster', 0, hex(0, 3));
    addUnit(s, 'infantry', 1, hex(0, -5));
    carry(s, monster.id);
    const { state } = run(s, END, END);
    expect(state.current).toBe(0);
    expect(getUnit(state, monster.id)!.movesLeft).toBe(1);
  });

  it('gets the reduced movement at the start of its turn', () => {
    const s = ctf();
    const inf = addUnit(s, 'infantry', 0, hex(0, 2));
    addUnit(s, 'infantry', 1, hex(0, -5));
    carry(s, inf.id);
    const { state } = run(s, END, END); // round 2: player 1 goes first again
    expect(state.current).toBe(0);
    expect(getUnit(state, inf.id)!.movesLeft).toBe(2);
  });

  it('a Dragon carrying the flag walks instead of flying', () => {
    const ring = [hex(1, 0), hex(1, -1), hex(0, -1), hex(-1, 0), hex(-1, 1), hex(0, 1)].map((h) => [h, 1] as [typeof h, TerrainHeight]);
    const s = ctf({ terrain: ring, flagAt: hex(5, 0) });
    const dragon = addUnit(s, 'dragon', 0, ORIGIN);
    expect(moveReach(s, dragon).costs.size).toBeGreaterThan(0); // flies over the ring
    carry(s, dragon.id);
    expect(moveReach(s, dragon).costs.size).toBe(0); // walled in on foot
  });

  it('can still attack normally while carrying', () => {
    const s = ctf();
    const inf = addUnit(s, 'infantry', 0, ORIGIN, { die: 12 });
    const enemy = addUnit(s, 'infantry', 1, hex(0, -3));
    carry(s, inf.id);
    const { events, state } = run(s, { type: 'attack', unitId: inf.id, targetId: enemy.id });
    expect(events.some((e) => e.type === 'attack' && e.hit)).toBe(true);
    expect(flagCarrier(state)?.id).toBe(inf.id);
  });
});

describe('Capture the Flag: drops', () => {
  it('Dash drops the flag where the carrier stands when it dashes', () => {
    const s = ctf();
    const scout = addUnit(s, 'scout', 0, hex(0, 2), { die: 12 });
    carry(s, scout.id);
    const moved = run(s, { type: 'move', unitId: scout.id, to: hex(0, 3) }).state;
    const { state, events } = run(moved, { type: 'special', unitId: scout.id });
    expect(state.flag).toEqual({ pos: hex(0, 3), carrierId: null });
    expect(drops(events)).toEqual([{ type: 'flagDropped', unitId: scout.id, hex: hex(0, 3), reason: 'moved', by: scout.id }]);
  });

  it('Pounce drops it too', () => {
    const s = ctf();
    const beast = addUnit(s, 'werewolfbeast', 0, hex(0, 2), { die: 8 });
    carry(s, beast.id);
    const { state } = run(s, { type: 'special', unitId: beast.id });
    expect(state.flag).toEqual({ pos: hex(0, 2), carrierId: null });
  });

  it('Vault drops it on the hex the carrier leapt from', () => {
    const s = ctf({ terrain: [[hex(0, 3), 1]] });
    const assassin = addUnit(s, 'assassin', 0, hex(0, 2), { die: 8 });
    carry(s, assassin.id);
    const { state } = run(s, { type: 'special', unitId: assassin.id, hex: hex(0, 4) });
    expect(getUnit(state, assassin.id)!.pos).toEqual(hex(0, 4));
    expect(state.flag).toEqual({ pos: hex(0, 2), carrierId: null });
  });

  it('Swap drops it whichever twin uses it, on the carrier twin\'s old hex', () => {
    for (const activator of ['tank', 'shooter'] as const) {
      const s = ctf();
      const tank = addUnit(s, 'twintank', 0, hex(0, 4), { die: 8 });
      const shooter = addUnit(s, 'twinshooter', 0, hex(3, -3), { die: 8 });
      tank.partnerId = shooter.id;
      shooter.partnerId = tank.id;
      carry(s, tank.id);
      const user = activator === 'tank' ? tank : shooter;
      const { state, events } = run(s, { type: 'special', unitId: user.id });
      expect(state.flag).toEqual({ pos: hex(0, 4), carrierId: null });
      expect(drops(events)[0]).toMatchObject({ unitId: tank.id, reason: 'moved', by: user.id });
    }
  });

  it('a Hook pull drops it where the carrier was hooked from; a hook that doesn\'t move it doesn\'t', () => {
    const s = ctf();
    const grappler = addUnit(s, 'grappler', 0, hex(0, 0), { die: 10 });
    const carrier = addUnit(s, 'infantry', 1, hex(0, -3));
    carry(s, carrier.id);
    const { state, events } = run(s, { type: 'special', unitId: grappler.id, targetId: carrier.id });
    expect(getUnit(state, carrier.id)!.pos).toEqual(hex(0, -1));
    expect(state.flag).toEqual({ pos: hex(0, -3), carrierId: null });
    expect(drops(events)[0]).toMatchObject({ reason: 'moved', by: grappler.id });

    const t = ctf();
    const g2 = addUnit(t, 'grappler', 0, hex(0, 0), { die: 10 });
    const adjacent = addUnit(t, 'infantry', 1, hex(0, -1));
    carry(t, adjacent.id);
    expect(flagCarrier(run(t, { type: 'special', unitId: g2.id, targetId: adjacent.id }).state)?.id).toBe(adjacent.id);
  });

  it('hooking your own carrier drops it as well', () => {
    const s = ctf();
    const grappler = addUnit(s, 'grappler', 0, hex(0, 0), { die: 10 });
    const ally = addUnit(s, 'infantry', 0, hex(0, -3));
    carry(s, ally.id);
    expect(run(s, { type: 'special', unitId: grappler.id, targetId: ally.id }).state.flag).toEqual({ pos: hex(0, -3), carrierId: null });
  });

  it('a normal move keeps the flag', () => {
    const s = ctf();
    const inf = addUnit(s, 'infantry', 0, hex(0, 2), { movesLeft: 2 });
    carry(s, inf.id);
    const { state, events } = run(s, { type: 'move', unitId: inf.id, to: hex(0, 4) });
    expect(flagCarrier(state)?.id).toBe(inf.id);
    expect(drops(events)).toEqual([]);
  });

  it('Hack makes the carrier drop it on its hex, even if it is already hacked or has no die', () => {
    const s = ctf();
    const hacker = addUnit(s, 'hacker', 0, hex(0, 2));
    const carrier = addUnit(s, 'infantry', 1, hex(0, -1));
    carry(s, carrier.id);
    const { state, events } = run(s, { type: 'special', unitId: hacker.id, targetId: carrier.id });
    expect(state.flag).toEqual({ pos: hex(0, -1), carrierId: null });
    expect(getUnit(state, carrier.id)!.hacked).toBe(true);
    expect(drops(events)[0]).toMatchObject({ reason: 'hacked', by: hacker.id });

    const t = ctf();
    const h2 = addUnit(t, 'hacker', 0, hex(0, 2));
    const behemoth = addUnit(t, 'behemoth', 1, hex(0, -1));
    carry(t, behemoth.id);
    const after = run(t, { type: 'special', unitId: h2.id, targetId: behemoth.id }).state;
    expect(after.flag).toEqual({ pos: hex(0, -1), carrierId: null });
    expect(getUnit(after, behemoth.id)!.hacked).toBe(false); // no die to hack

    // Not carrying: the usual rules (no Behemoth, no double hack).
    const u = ctf();
    const h3 = addUnit(u, 'hacker', 0, hex(0, 2));
    const b2 = addUnit(u, 'behemoth', 1, hex(0, -1));
    expect(() => applyAction(u, { type: 'special', unitId: h3.id, targetId: b2.id })).toThrow(/no die/);
  });

  it('killing the carrier drops the flag on its hex', () => {
    const s = ctf();
    const shooter = addUnit(s, 'infantry', 0, hex(0, 2), { die: 12 });
    const carrier = addUnit(s, 'scout', 1, hex(0, -2), { hp: 1 });
    carry(s, carrier.id);
    const { state, events } = run(s, { type: 'attack', unitId: shooter.id, targetId: carrier.id });
    expect(getUnit(state, carrier.id)).toBeUndefined();
    expect(state.flag).toEqual({ pos: hex(0, -2), carrierId: null });
    expect(drops(events)[0]).toMatchObject({ unitId: carrier.id, reason: 'killed' });
  });

  it('a dropped flag stays until someone picks it up (same action cost)', () => {
    const s = ctf({ flagAt: hex(0, -2) });
    const inf = addUnit(s, 'infantry', 0, hex(0, -1));
    const { state } = run(s, { type: 'move', unitId: inf.id, to: hex(0, -2) });
    expect(state.flag).toEqual({ pos: hex(0, -2), carrierId: null }); // walking onto it isn't enough
    expect(flagCarrier(run(state, { type: 'pickUp', unitId: inf.id }).state)?.id).toBe(inf.id);
  });

  it('a Hurl boulder landing on a killed carrier\'s hex rolls the flag to the nearest open hex', () => {
    const s = ctf({ terrain: [[hex(0, 3), 1]] });
    const giant = addUnit(s, 'hillgiant', 0, hex(0, 2), { die: 12 });
    const carrier = addUnit(s, 'scout', 1, hex(0, -1), { hp: 1 });
    carry(s, carrier.id);
    const { state, events } = run(s, { type: 'special', unitId: giant.id, hex: hex(0, 3), targetId: carrier.id });
    expect(state.map.heights[hexKey(hex(0, -1))]).toBe(1); // the boulder
    expect(state.flag!.pos).not.toEqual(hex(0, -1));
    expect(state.map.heights[hexKey(state.flag!.pos!)]).toBeUndefined();
    expect(events.some((e) => e.type === 'flagShifted')).toBe(true);
  });
});

describe('Capture the Flag: winning', () => {
  const zoneHex = (s: GameState, p: PlayerId) => s.map.deployZones[p][0];

  it('a carrier ending its turn in its own zone wins the game at once (no points)', () => {
    const s = ctf();
    const home = zoneHex(s, 0);
    expect(isInDeployZone(s, 0, home)).toBe(true);
    const inf = addUnit(s, 'infantry', 0, home);
    addUnit(s, 'infantry', 1, hex(0, -5));
    carry(s, inf.id);
    const { state, events } = run(s, END);
    expect(state).toMatchObject({ phase: 'over', winner: 0, winReason: 'capture', scores: [0, 0] });
    expect(events.slice(-2)).toEqual([
      { type: 'flagCaptured', player: 0, unitId: inf.id },
      { type: 'gameOver', winner: 0, reason: 'capture' },
    ]);
    expect(state.flag).toEqual({ pos: null, carrierId: inf.id }); // no reset: the game is over
  });

  it('player 2 wins the same way in its own zone', () => {
    const s = ctf();
    s.current = 1;
    s.turnInRound = 1;
    const inf = addUnit(s, 'infantry', 1, zoneHex(s, 1));
    addUnit(s, 'infantry', 0, hex(0, 5));
    carry(s, inf.id);
    expect(run(s, END).state).toMatchObject({ phase: 'over', winner: 1, winReason: 'capture' });
  });

  it('no win outside your own zone (including the enemy\'s zone)', () => {
    for (const where of [hex(0, 2), zoneHex(makeState(), 1)]) {
      const s = ctf();
      const inf = addUnit(s, 'infantry', 0, where);
      addUnit(s, 'infantry', 1, hex(3, -2));
      carry(s, inf.id);
      const { state } = run(s, END);
      expect(state.phase).toBe('play');
      expect(flagCarrier(state)?.id).toBe(inf.id);
    }
  });

  it('only at the end of the carrier\'s own turn', () => {
    const s = ctf();
    s.current = 1;
    addUnit(s, 'infantry', 1, hex(0, -5));
    const inf = addUnit(s, 'infantry', 0, zoneHex(s, 0));
    carry(s, inf.id);
    expect(run(s, END).state.phase).toBe('play'); // player 2's turn ended
  });

  it('enemy overwatch fires first: killing the carrier stops the capture', () => {
    const s = ctf();
    const home = zoneHex(s, 0);
    const inf = addUnit(s, 'infantry', 0, home, { hp: 1 });
    addUnit(s, 'infantry', 0, hex(2, 2));
    addUnit(s, 'sentinel', 1, hex(home.q, home.r - 3), { overwatch: { die: 12, hexes: [home] } });
    carry(s, inf.id);
    const { state, events } = run(s, END);
    expect(state.phase).toBe('play');
    expect(state.flag).toEqual({ pos: home, carrierId: null });
    expect(events.some((e) => e.type === 'flagCaptured')).toBe(false);
  });

  it('eliminating the enemy still wins', () => {
    const s = ctf();
    const shooter = addUnit(s, 'infantry', 0, hex(0, 2), { die: 12 });
    const last = addUnit(s, 'scout', 1, hex(0, -2), { hp: 1 });
    expect(run(s, { type: 'attack', unitId: shooter.id, targetId: last.id }).state).toMatchObject({ phase: 'over', winner: 0, winReason: 'elimination' });
  });

  it('there is no scoring at all: no control point, no points', () => {
    const s = ctf();
    addUnit(s, 'infantry', 0, hex(1, 0));
    addUnit(s, 'infantry', 1, hex(-4, -1));
    const { state, events } = run(s, END, END);
    expect(state.scores).toEqual([0, 0]);
    expect(events.some((e) => e.type === 'roundScored')).toBe(false);
    expect(MISSIONS.ctf.usesPoints).toBe(false);
    expect(MISSIONS.koth.usesPoints).toBe(true);
  });
});

describe('Capture the Flag: Standard Bearer', () => {
  it('the carrier gets +2 on its rolls; models on the old control point get nothing', () => {
    const s = ctf({ flagAt: hex(4, 0) });
    addUnit(s, 'standardbearer', 0, hex(-3, 5));
    const carrier = addUnit(s, 'infantry', 0, hex(0, 3));
    const onPoint = addUnit(s, 'infantry', 0, hex(1, 0));
    expect(actionBonus(s, carrier)).toBe(0);
    carry(s, carrier.id);
    expect(actionBonus(s, carrier)).toBe(s.config.specials.standardRollBonus);
    expect(actionBonus(s, onPoint)).toBe(0);
  });

  it('the carrier isn\'t slowed; without the Standard Bearer it is', () => {
    const s = ctf();
    addUnit(s, 'standardbearer', 0, hex(-3, 5));
    const inf = addUnit(s, 'infantry', 0, hex(0, 3)); // speed 3
    const enemy = addUnit(s, 'infantry', 1, hex(0, -3));
    carry(s, inf.id);
    expect(unitSpeed(s, inf)).toBe(3);
    carry(s, enemy.id);
    expect(unitSpeed(s, enemy)).toBe(2);
  });

  it('the Standard Bearer\'s carrier moves at its own speed: not slowed, but no speed bonuses either', () => {
    const s = ctf();
    addUnit(s, 'standardbearer', 0, hex(-3, 5));
    const monster = addUnit(s, 'monster', 0, hex(0, 3)); // speed 2
    s.auras[0].push('warlord'); // test only: both auras on one army
    expect(unitSpeed(s, monster)).toBe(3);
    carry(s, monster.id);
    expect(unitSpeed(s, monster)).toBe(2);
  });

  it('a capture with the Standard Bearer wins the same way (no bonus points)', () => {
    const s = ctf();
    addUnit(s, 'standardbearer', 0, hex(-3, 5));
    const inf = addUnit(s, 'infantry', 0, s.map.deployZones[0][0]);
    addUnit(s, 'infantry', 1, hex(0, -5));
    carry(s, inf.id);
    expect(run(s, END).state).toMatchObject({ phase: 'over', winner: 0, winReason: 'capture', scores: [0, 0] });
  });

  it('still works as before in King of the Hill', () => {
    const s = makeState();
    addUnit(s, 'standardbearer', 0, hex(-3, 5));
    const onPoint = addUnit(s, 'infantry', 0, hex(1, 0));
    expect(actionBonus(s, onPoint)).toBe(s.config.specials.standardRollBonus);
  });
});

describe('Random missions', () => {
  it('each game picks one from the pool, seeded: the same seed always gives the same mission', () => {
    const seeds = Array.from({ length: 400 }, (_, i) => i + 1);
    const picks = seeds.map((seed) => newGame(DEFAULT_CONFIG, seed).mission);
    for (const m of ['koth', 'ctf', 'dom']) {
      const share = picks.filter((x) => x === m).length / picks.length;
      expect(share).toBeGreaterThan(0.27); // a third each
      expect(share).toBeLessThan(0.4);
    }
    expect(seeds.map((seed) => pickMission(DEFAULT_CONFIG, seed))).toEqual(picks);
  });

  it('a one-mission pool always picks it', () => {
    for (const m of ['koth', 'ctf'] as const) {
      const config = { ...DEFAULT_CONFIG, missions: [m] };
      for (let seed = 1; seed < 30; seed++) expect(newGame(config, seed).mission).toBe(m);
    }
  });

  it('the mission doesn\'t change the map or dice for a seed (same Condition)', () => {
    for (let seed = 1; seed < 30; seed++) {
      const a = newGame({ ...DEFAULT_CONFIG, missions: ['koth'], conditions: { clear: 1 } }, seed);
      const b = newGame({ ...DEFAULT_CONFIG, missions: ['ctf'], conditions: { clear: 1 } }, seed);
      expect(b.map).toEqual(a.map);
      expect(b.rngState).toBe(a.rngState);
    }
  });

  it('Capture the Flag starts with the flag on the center hex; King of the Hill has no flag', () => {
    expect(newGame({ ...DEFAULT_CONFIG, missions: ['ctf'] }, 5).flag).toEqual({ pos: ORIGIN, carrierId: null });
    expect(newGame({ ...DEFAULT_CONFIG, missions: ['koth'] }, 5).flag).toBeNull();
  });

  it('every mission has a name, a one-line summary and rules', () => {
    for (const m of Object.values(MISSIONS)) {
      expect(m.name).toBeTruthy();
      expect(m.summary(DEFAULT_CONFIG)).not.toMatch(/\n/);
      expect(m.rules(DEFAULT_CONFIG).length).toBeGreaterThan(2);
    }
    for (const id of DEFAULT_CONFIG.missions) expect(MISSIONS[id]).toBeDefined();
  });
});
