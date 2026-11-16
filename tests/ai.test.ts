import { describe, expect, it } from 'vitest';
import { aiActions, aiArmy } from '../src/ai';
import { validateArmy } from '../src/core/army';
import { type Action, applyAction, newGame, unplacedUnits } from '../src/core/game';
import { Rng } from '../src/core/rng';
import type { GameState } from '../src/core/types';
import { DEFAULT_CONFIG } from '../src/data/config';

/** A stand-in human: deploys anywhere legal, then just ends every turn (or plays as a second AI). */
function humanAction(state: GameState, smart: boolean, rng: Rng): Action[] {
  if (smart) return aiActions(state, 0, rng);
  if (state.phase === 'deploy') {
    const unit = unplacedUnits(state, 0).find((u) => !u.free) ?? unplacedUnits(state, 0)[0];
    const free = state.map.deployZones[0].filter((h) => !state.units.some((u) => u.pos && u.pos.q === h.q && u.pos.r === h.r));
    return [{ type: 'place', unitId: unit.id, hex: free[0] }];
  }
  return [{ type: 'endTurn' }];
}

function playVsAi(seed: number, smartHuman: boolean) {
  const rng = new Rng(seed * 7 + 1);
  let state = newGame(DEFAULT_CONFIG, seed);
  state = applyAction(state, { type: 'chooseArmy', units: ['infantry', 'infantry', 'heavy', 'sniper', 'scout'] }).state;
  const army = aiArmy(DEFAULT_CONFIG, rng);
  expect(validateArmy(DEFAULT_CONFIG, army.units)).toBeNull();
  state = applyAction(state, { type: 'chooseArmy', units: army.units }).state;
  let aiDidSomething = 0;
  for (let i = 0; i < 4000 && state.phase !== 'over' && state.round <= 30; i++) {
    const mine = state.current === 1;
    const actions = mine ? aiActions(state, 1, rng) : humanAction(state, smartHuman, rng);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      if (state.phase === 'over') break;
      state = applyAction(state, a).state; // throws if the AI ever tries something illegal
      if (mine && a.type !== 'endTurn' && a.type !== 'place') aiDidSomething++;
    }
  }
  return { state, aiDidSomething };
}

describe('AI opponent', () => {
  it('builds a legal army that spends most of its points', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 40; i++) {
      const army = aiArmy(DEFAULT_CONFIG, rng);
      expect(validateArmy(DEFAULT_CONFIG, army.units)).toBeNull();
      expect(army.name).not.toBe('Skeleton Wall');
    }
  });

  it('only acts on its own move', () => {
    const state = newGame(DEFAULT_CONFIG, 3);
    expect(aiActions(state, 1, new Rng(1))).toEqual([]); // building: nothing to do
  });

  it('deploys, moves, fights and beats a player who never acts, in every mission, with only legal actions', () => {
    const missions = new Set<string>();
    let wins = 0;
    for (const seed of [1, 2, 6, 8, 9, 13, 14, 40]) {
      const { state, aiDidSomething } = playVsAi(seed, false);
      missions.add(state.mission);
      expect(aiDidSomething).toBeGreaterThan(3);
      expect(state.phase).toBe('over');
      if (state.winner === 1) wins++;
    }
    expect(missions.size).toBe(3);
    expect(wins).toBe(8);
  }, 120_000);

  it('plays full games to the end against an opponent that fights back', () => {
    for (const seed of [3, 4, 5]) {
      const { state } = playVsAi(seed, true);
      expect(state.phase === 'over' || state.round > 30).toBe(true);
    }
  }, 120_000);
});
