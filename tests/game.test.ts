import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/data/config';
import { type Action, type GameEvent, applyAction, firstPlayerOfRound, newGame, unplacedUnits } from '../src/core/game';
import { hex, hexEquals } from '../src/core/hex';
import { getUnit, livingUnits } from '../src/core/queries';
import type { GameState } from '../src/core/types';
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

const ARMY = ['infantry', 'infantry', 'medic', 'sniper', 'scout']; // 14 points

/** Builds both armies, then deploys by always placing the first unplaced model on the first free hex. */
function deployAll(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  while (state.phase === 'deploy') {
    const unit = unplacedUnits(state, state.current)[0];
    const hex = state.map.deployZones[state.current].find((h) => !state.units.some((u) => u.pos && hexEquals(u.pos, h)))!;
    const r = applyAction(state, { type: 'place', unitId: unit.id, hex });
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const buildBoth = (s: GameState, a = ARMY, b = ARMY) =>
  run(s, { type: 'chooseArmy', units: a }, { type: 'chooseArmy', units: b }).state;

const deployBoth = (s: GameState) => deployAll(buildBoth(s));

describe('army building', () => {
  it('starts in the build phase with no models', () => {
    const s = newGame(DEFAULT_CONFIG, 1);
    expect(s).toMatchObject({ phase: 'build', current: 0, units: [] });
  });

  it('player 1 builds, then player 2, then deployment starts with player 1', () => {
    const s = newGame(DEFAULT_CONFIG, 1);
    const p2 = run(s, { type: 'chooseArmy', units: ['heavy', 'heavy'] }).state;
    expect(p2).toMatchObject({ phase: 'build', current: 1 });
    expect(p2.units.map((u) => [u.owner, u.type])).toEqual([[0, 'heavy'], [0, 'heavy']]);
    const { state, events } = run(p2, { type: 'chooseArmy', units: ['scout'] });
    expect(state).toMatchObject({ phase: 'deploy', current: 0 });
    expect(state.units.filter((u) => u.owner === 1)).toHaveLength(1);
    expect(events).toEqual([{ type: 'armyChosen', player: 1, next: null }]);
  });

  it('rejects an army over the point limit', () => {
    const s = newGame(DEFAULT_CONFIG, 1);
    expect(() => applyAction(s, { type: 'chooseArmy', units: ['heavy', 'heavy', 'heavy', 'heavy', 'scout'] })).toThrow('limit');
  });
});

describe('deployment', () => {
  it('only allows placing unplaced models in your own zone, on free hexes', () => {
    const s = buildBoth(newGame(DEFAULT_CONFIG, 1));
    const [a] = s.units.filter((u) => u.owner === 0);
    const zone0 = s.map.deployZones[0];
    expect(() => applyAction(s, { type: 'place', unitId: a.id, hex: hex(0, 0) })).toThrow('Outside');
    expect(() => applyAction(s, { type: 'place', unitId: a.id, hex: s.map.deployZones[1][0] })).toThrow('Outside');
    const enemy = s.units.find((u) => u.owner === 1)!;
    expect(() => applyAction(s, { type: 'place', unitId: enemy.id, hex: zone0[0] })).toThrow('Not your model');
    const placed = applyAction(s, { type: 'place', unitId: a.id, hex: zone0[0] }).state;
    // Player 2's turn to place now; then back to player 1, who can't stack or re-place.
    const p2unit = placed.units.find((u) => u.owner === 1)!;
    const back = applyAction(placed, { type: 'place', unitId: p2unit.id, hex: placed.map.deployZones[1][0] }).state;
    const b = back.units.filter((u) => u.owner === 0)[1];
    expect(() => applyAction(back, { type: 'place', unitId: b.id, hex: zone0[0] })).toThrow('occupied');
    expect(() => applyAction(back, { type: 'place', unitId: a.id, hex: zone0[1] })).toThrow('Already placed');
  });

  it('alternates one model at a time; the bigger army finishes alone; then round 1 starts', () => {
    const s = buildBoth(newGame(DEFAULT_CONFIG, 1), ['scout', 'scout', 'scout'], ['heavy']);
    const { state, events } = deployAll(s);
    const order = events.filter((e) => e.type === 'placed').map((e) => (e.type === 'placed' ? e.unitId.slice(0, 2) : ''));
    expect(order).toEqual(['p0', 'p1', 'p0', 'p0']);
    const nexts = events.filter((e) => e.type === 'placed').map((e) => (e.type === 'placed' ? e.next : -1));
    expect(nexts).toEqual([1, 0, 0, null]);
    expect(state).toMatchObject({ phase: 'play', current: state.firstPlayer, round: 1 });
    expect(events.at(-2)).toEqual({ type: 'coinFlip', winner: state.firstPlayer });
    expect(events.at(-1)).toMatchObject({ type: 'turnStart', player: state.firstPlayer, round: 1 });
  });
});

describe('turn flow', () => {
  it('rolls a d12 for each of the current player’s models at turn start', () => {
    const { state } = deployBoth(newGame(DEFAULT_CONFIG, 3));
    for (const u of livingUnits(state, state.current)) {
      expect(u.die).toBeGreaterThanOrEqual(1);
      expect(u.die).toBeLessThanOrEqual(12);
    }
    for (const u of livingUnits(state, state.current === 0 ? 1 : 0)) expect(u.die).toBeNull();
  });

  it('dice are roughly uniform over 1..12', () => {
    let state = deployBoth(newGame(DEFAULT_CONFIG, 9)).state;
    const counts = new Array(13).fill(0);
    for (let i = 0; i < 400; i++) {
      for (const u of livingUnits(state, state.current)) counts[u.die!]++;
      state = applyAction(state, { type: 'endTurn' }).state;
      if (state.phase === 'over') break;
    }
    expect(counts[0]).toBe(0);
    for (let v = 1; v <= 12; v++) expect(counts[v]).toBeGreaterThan(100);
  });

  it('flips the first player every two rounds', () => {
    let state = deployBoth(newGame(DEFAULT_CONFIG, 1)).state;
    const order: number[] = [];
    const rounds: number[] = [];
    for (let i = 0; i < 12; i++) {
      order.push(state.current);
      rounds.push(state.round);
      state = applyAction(state, { type: 'endTurn' }).state;
    }
    expect(rounds).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    // Relative to the coin-flip winner (W) and the other player (L):
    // rounds 1–2: W, L. Rounds 3–4: L, W. Rounds 5–6: W, L.
    const relative = order.map((p) => (p === state.firstPlayer ? 0 : 1));
    expect(relative).toEqual([0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1]);
  });

  it('firstPlayerOfRound follows the configured swap interval', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => firstPlayerOfRound(r, 2))).toEqual([0, 0, 1, 1, 0, 0, 1]);
    expect([1, 2, 3, 4].map((r) => firstPlayerOfRound(r, 1))).toEqual([0, 1, 0, 1]);
    expect([1, 2, 3, 4].map((r) => firstPlayerOfRound(r, 3))).toEqual([0, 0, 0, 1]);
  });

  it('back-to-back turns happen only where the order flips, and each round still scores once', () => {
    const s = makeState();
    addUnit(s, 'infantry', 0, hex(0, 0)); // P1 holds the control point
    addUnit(s, 'infantry', 1, hex(0, -6));
    let state = s;
    const starts: { player: number; round: number }[] = [];
    let scored = 0;
    for (let i = 0; i < 8; i++) {
      const r = run(state, { type: 'endTurn' });
      state = r.state;
      for (const e of r.events) {
        if (e.type === 'turnStart') starts.push({ player: e.player, round: e.round });
        if (e.type === 'roundScored') scored++;
      }
    }
    const repeats = starts.filter((t, i) => i > 0 && t.player === starts[i - 1].player);
    expect(repeats.map((t) => t.round)).toEqual([3, 5]); // P2 twice going into round 3, P1 going into round 5
    expect(scored).toBe(4);
    expect(state.scores).toEqual([4, 0]);
  });

  it('moves spend movement and can be split across several moves', () => {
    const s = makeState();
    const u = addUnit(s, 'infantry', 0, hex(0, 3));
    let state = run(s, { type: 'move', unitId: u.id, to: hex(1, 3) }).state;
    expect(getUnit(state, u.id)!.movesLeft).toBe(2);
    state = run(state, { type: 'move', unitId: u.id, to: hex(3, 3) }).state;
    expect(getUnit(state, u.id)!.movesLeft).toBe(0);
    expect(() => applyAction(state, { type: 'move', unitId: u.id, to: hex(4, 3) })).toThrow();
  });

  it('a move can be undone until the model acts', () => {
    const s = makeState();
    const u = addUnit(s, 'infantry', 0, hex(0, 3));
    const moved = run(s, { type: 'move', unitId: u.id, to: hex(2, 3) }).state;
    const undone = run(moved, { type: 'undoMove', unitId: u.id }).state;
    expect(getUnit(undone, u.id)).toMatchObject({ pos: hex(0, 3), movesLeft: 3 });

    const acted = run(moved, { type: 'special', unitId: u.id }).state;
    expect(() => applyAction(acted, { type: 'undoMove', unitId: u.id })).toThrow();
    expect(() => applyAction(acted, { type: 'move', unitId: u.id, to: hex(3, 3) })).toThrow();
  });

  it('moving is always allowed regardless of the die', () => {
    const s = makeState();
    const u = addUnit(s, 'infantry', 0, hex(0, 3), { die: 1 });
    expect(getUnit(run(s, { type: 'move', unitId: u.id, to: hex(3, 3) }).state, u.id)!.pos).toEqual(hex(3, 3));
  });

  it('cannot move or act with the other player’s models', () => {
    const s = makeState();
    const enemy = addUnit(s, 'infantry', 1, hex(0, -3));
    expect(() => applyAction(s, { type: 'move', unitId: enemy.id, to: hex(0, -2) })).toThrow('Not your model');
  });

  it('Brace and Spot expire at the start of the owner’s next turn', () => {
    const s = makeState();
    const inf = addUnit(s, 'heavy', 0, hex(0, 3));
    const sniper = addUnit(s, 'sniper', 0, hex(2, 3));
    const enemy = addUnit(s, 'infantry', 1, hex(0, -3));
    let state = run(s, { type: 'special', unitId: inf.id }, { type: 'special', unitId: sniper.id, targetId: enemy.id }).state;
    state = run(state, { type: 'endTurn' }).state; // player 2's turn
    expect(getUnit(state, inf.id)!.braced).toBe(true);
    expect(getUnit(state, enemy.id)!.spottedBy).toBe(0);
    state = run(state, { type: 'endTurn' }).state; // round 2: player 1 first again
    expect(getUnit(state, inf.id)!.braced).toBe(false);
    expect(getUnit(state, enemy.id)!.spottedBy).toBeNull();
  });

  it('Prep adds +2 to the model’s die on its next turn only', () => {
    const setup = () => {
      const s = makeState();
      const inf = addUnit(s, 'infantry', 0, hex(0, 3));
      addUnit(s, 'infantry', 1, hex(0, -3));
      return { s, inf };
    };
    // Same seed with and without Prep, so the underlying rolls are identical.
    const a = setup();
    const b = setup();
    const toP1Turn: Action[] = [{ type: 'endTurn' }, { type: 'endTurn' }]; // P2's turn, then round 2 (P1 first)
    let prepped = run(a.s, { type: 'special', unitId: a.inf.id }, ...toP1Turn).state;
    const plain = run(b.s, ...toP1Turn).state;
    expect(prepped.current).toBe(0);
    expect(getUnit(prepped, a.inf.id)).toMatchObject({ prepped: false, dieBonus: 2 });
    expect(getUnit(prepped, a.inf.id)!.die).toBe(getUnit(plain, b.inf.id)!.die! + 2);

    // The bonus doesn't carry over to the turn after.
    // Round 2: P2; round 3: P2 then P1.
    prepped = run(prepped, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' }).state;
    expect(prepped).toMatchObject({ current: 0, round: 3 });
    expect(getUnit(prepped, a.inf.id)!.dieBonus).toBe(0);
  });
});

describe('scoring and winning', () => {
  it('scores 1 point to the player with more models on the control point at round end', () => {
    const s = makeState();
    addUnit(s, 'infantry', 0, hex(0, 0));
    addUnit(s, 'infantry', 0, hex(1, 0));
    addUnit(s, 'infantry', 1, hex(-1, 0));
    const { state, events } = run(s, { type: 'endTurn' }, { type: 'endTurn' });
    expect(state.scores).toEqual([1, 0]);
    expect(events).toContainEqual({ type: 'roundScored', round: 1, counts: [2, 1], scorer: 0, points: 1 });
  });

  it('only scores at the end of a full round', () => {
    const s = makeState();
    addUnit(s, 'infantry', 0, hex(0, 0));
    addUnit(s, 'infantry', 1, hex(0, -6));
    expect(run(s, { type: 'endTurn' }).state.scores).toEqual([0, 0]);
  });

  it('a tie scores nothing', () => {
    const s = makeState();
    addUnit(s, 'infantry', 0, hex(0, 0));
    addUnit(s, 'infantry', 1, hex(-1, 0));
    expect(run(s, { type: 'endTurn' }, { type: 'endTurn' }).state.scores).toEqual([0, 0]);
  });

  it('first to the points target wins', () => {
    const s = makeState();
    s.scores = [4, 0];
    addUnit(s, 'infantry', 0, hex(0, 0));
    addUnit(s, 'infantry', 1, hex(0, -6));
    const { state, events } = run(s, { type: 'endTurn' }, { type: 'endTurn' });
    expect(state).toMatchObject({ phase: 'over', winner: 0, winReason: 'points' });
    expect(events.at(-1)).toEqual({ type: 'gameOver', winner: 0, reason: 'points' });
    expect(() => applyAction(state, { type: 'endTurn' })).toThrow();
  });

  it('eliminating every enemy model wins immediately', () => {
    const s = makeState();
    const a = addUnit(s, 'heavy', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'scout', 1, hex(2, 0));
    const { state } = run(s, { type: 'attack', unitId: a.id, targetId: t.id });
    expect(state).toMatchObject({ phase: 'over', winner: 0, winReason: 'elimination' });
  });
});

describe('purity', () => {
  it('applyAction never mutates its input', () => {
    const s = deployBoth(newGame(DEFAULT_CONFIG, 4)).state;
    const before = structuredClone(s);
    const u = livingUnits(s, s.current)[0];
    applyAction(s, { type: 'special', unitId: u.id });
    applyAction(s, { type: 'endTurn' });
    expect(s).toEqual(before);
  });
});
