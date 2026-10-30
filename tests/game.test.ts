import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/data/config';
import { type Action, type GameEvent, applyAction, newGame } from '../src/core/game';
import { hex } from '../src/core/hex';
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

const deployBoth = (s: GameState) =>
  run(s, { type: 'autoDeploy' }, { type: 'finishDeploy' }, { type: 'autoDeploy' }, { type: 'finishDeploy' });

describe('deployment', () => {
  it('starts in deployment with every model off the board', () => {
    const s = newGame(DEFAULT_CONFIG, 1);
    expect(s.phase).toBe('deploy');
    expect(s.units).toHaveLength(DEFAULT_CONFIG.army.length * 2);
    expect(s.units.every((u) => u.pos === null)).toBe(true);
  });

  it('only allows placing in your own zone, on free hexes', () => {
    const s = newGame(DEFAULT_CONFIG, 1);
    const [a, b] = s.units.filter((u) => u.owner === 0);
    const zone = s.map.deployZones[0];
    expect(() => applyAction(s, { type: 'place', unitId: a.id, hex: hex(0, 0) })).toThrow('Outside');
    expect(() => applyAction(s, { type: 'place', unitId: a.id, hex: s.map.deployZones[1][0] })).toThrow('Outside');
    const placed = applyAction(s, { type: 'place', unitId: a.id, hex: zone[0] }).state;
    expect(() => applyAction(placed, { type: 'place', unitId: b.id, hex: zone[0] })).toThrow('occupied');
    const enemy = s.units.find((u) => u.owner === 1)!;
    expect(() => applyAction(s, { type: 'place', unitId: enemy.id, hex: zone[0] })).toThrow('Not your model');
  });

  it('requires all models placed, then hands over to player 2, then starts round 1', () => {
    const s = newGame(DEFAULT_CONFIG, 1);
    expect(() => applyAction(s, { type: 'finishDeploy' })).toThrow();
    const p2 = run(s, { type: 'autoDeploy' }, { type: 'finishDeploy' }).state;
    expect(p2.current).toBe(1);
    const { state, events } = run(p2, { type: 'autoDeploy' }, { type: 'finishDeploy' });
    expect(state.phase).toBe('play');
    expect(state.current).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'turnStart', player: 0, round: 1 });
  });
});

describe('turn flow', () => {
  it('rolls a d12 for each of the current player’s models at turn start', () => {
    const { state } = deployBoth(newGame(DEFAULT_CONFIG, 3));
    for (const u of livingUnits(state, 0)) {
      expect(u.die).toBeGreaterThanOrEqual(1);
      expect(u.die).toBeLessThanOrEqual(12);
    }
    for (const u of livingUnits(state, 1)) expect(u.die).toBeNull();
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

  it('alternates the first player each round', () => {
    let state = deployBoth(newGame(DEFAULT_CONFIG, 1)).state;
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(state.current);
      state = applyAction(state, { type: 'endTurn' }).state;
    }
    // Round 1: P1, P2. Round 2: P2, P1. Round 3: P1, P2.
    expect(order).toEqual([0, 1, 1, 0, 0, 1]);
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
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    const sniper = addUnit(s, 'sniper', 0, hex(2, 3));
    const enemy = addUnit(s, 'infantry', 1, hex(0, -3));
    let state = run(s, { type: 'special', unitId: inf.id }, { type: 'special', unitId: sniper.id, targetId: enemy.id }).state;
    state = run(state, { type: 'endTurn' }).state; // player 2's turn
    expect(getUnit(state, inf.id)!.braced).toBe(true);
    expect(getUnit(state, enemy.id)!.spottedBy).toBe(0);
    state = run(state, { type: 'endTurn' }).state; // round 2: player 2 goes again
    state = run(state, { type: 'endTurn' }).state; // player 1's turn
    expect(getUnit(state, inf.id)!.braced).toBe(false);
    expect(getUnit(state, enemy.id)!.spottedBy).toBeNull();
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
    expect(events).toContainEqual({ type: 'roundScored', round: 1, counts: [2, 1], scorer: 0 });
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
    const u = livingUnits(s, 0)[0];
    applyAction(s, { type: 'special', unitId: u.id });
    applyAction(s, { type: 'endTurn' });
    expect(s).toEqual(before);
  });
});
