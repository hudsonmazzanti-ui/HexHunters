/**
 * Game state machine. `applyAction(state, action)` is pure: it returns a new state
 * plus a list of events (for animations / logs) and never touches the input.
 * Everything a player can do is an Action, so AI or network play can later drive
 * the game by producing the same actions as the UI.
 */
import { type Hex, hexEquals, hexKey } from './hex';
import { type AttackResult, resolveAttack } from './combat';
import { generateMap } from './mapgen';
import { movePath, getUnit, livingUnits, other, unitAt, unitDef, unitsOnControlPoint } from './queries';
import { Rng, nextRandom } from './rng';
import { type SpecialResult, applySpecial } from './specials';
import type { GameConfig, GameState, PlayerId, Unit } from './types';

export type Action =
  | { type: 'place'; unitId: string; hex: Hex }
  | { type: 'unplace'; unitId: string }
  | { type: 'autoDeploy' }
  | { type: 'finishDeploy' }
  | { type: 'move'; unitId: string; to: Hex }
  | { type: 'undoMove'; unitId: string }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'special'; unitId: string; targetId?: string }
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'turnStart'; player: PlayerId; round: number; dice: Record<string, number> }
  | { type: 'move'; unitId: string; path: Hex[] }
  | ({ type: 'attack'; unitId: string; targetId: string } & AttackResult)
  | ({ type: 'special'; unitId: string } & SpecialResult)
  | { type: 'roundScored'; round: number; counts: [number, number]; scorer: PlayerId | null }
  | { type: 'gameOver'; winner: PlayerId; reason: 'points' | 'elimination' };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/** Player 1 (id 0) goes first in odd rounds, player 2 (id 1) in even rounds. */
export const firstPlayerOfRound = (round: number): PlayerId => (round % 2 === 1 ? 0 : 1);

export function newGame(config: GameConfig, seed: number): GameState {
  const units: Unit[] = [];
  for (const owner of [0, 1] as const) {
    config.army.forEach((type, i) => {
      if (!config.units[type]) throw new Error(`Unknown unit type "${type}" in army`);
      units.push({
        id: `p${owner}-${type}-${i}`,
        type,
        owner,
        pos: null,
        hp: config.units[type].health,
        die: null,
        movesLeft: 0,
        acted: false,
        turnStartPos: null,
        braced: false,
        spottedBy: null,
      });
    });
  }
  return {
    config,
    seed,
    map: generateMap(config, seed),
    units,
    phase: 'deploy',
    current: 0,
    round: 1,
    turnInRound: 0,
    scores: [0, 0],
    winner: null,
    winReason: null,
    // A separate random stream from the map so dice don't depend on map attempts.
    rngState: (seed ^ 0x5bd1e995) | 0,
  };
}

export class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message);
}

export function applyAction(prev: GameState, action: Action): ActionResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];

  const ownUnit = (id: string): Unit => {
    const unit = getUnit(state, id) ?? fail('No such model');
    if (unit.owner !== state.current) fail('Not your model');
    return unit;
  };

  switch (action.type) {
    case 'place': {
      if (state.phase !== 'deploy') fail('Not deploying');
      const unit = ownUnit(action.unitId);
      if (!isInDeployZone(state, state.current, action.hex)) fail('Outside your deployment zone');
      const occupant = unitAt(state, action.hex);
      if (occupant && occupant.id !== unit.id) fail('Hex occupied');
      unit.pos = action.hex;
      break;
    }
    case 'unplace': {
      if (state.phase !== 'deploy') fail('Not deploying');
      ownUnit(action.unitId).pos = null;
      break;
    }
    case 'autoDeploy': {
      if (state.phase !== 'deploy') fail('Not deploying');
      const rng = new Rng(state.rngState);
      for (const unit of state.units.filter((u) => u.owner === state.current && !u.pos)) {
        const free = state.map.deployZones[state.current].filter((h) => !unitAt(state, h));
        unit.pos = rng.pick(free);
      }
      state.rngState = rng.state;
      break;
    }
    case 'finishDeploy': {
      if (state.phase !== 'deploy') fail('Not deploying');
      if (state.units.some((u) => u.owner === state.current && !u.pos)) fail('Place all models first');
      if (state.current === 0) {
        state.current = 1;
      } else {
        state.phase = 'play';
        state.round = 1;
        state.turnInRound = 0;
        state.current = firstPlayerOfRound(1);
        startTurn(state, events);
      }
      break;
    }
    case 'move': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      const path = movePath(state, unit, action.to) ?? fail('Cannot reach that hex');
      unit.pos = action.to;
      unit.movesLeft -= path.length;
      events.push({ type: 'move', unitId: unit.id, path });
      break;
    }
    case 'undoMove': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      if (!canUndoMove(state, unit)) fail('Cannot undo this move');
      events.push({ type: 'move', unitId: unit.id, path: [unit.turnStartPos!] });
      unit.pos = unit.turnStartPos;
      unit.movesLeft = unitDef(state, unit).speed;
      break;
    }
    case 'attack': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      const target = getUnit(state, action.targetId) ?? fail('No such target');
      const result = guard(() => resolveAttack(state, unit, target));
      events.push({ type: 'attack', unitId: unit.id, targetId: target.id, ...result });
      if (livingUnits(state, target.owner).length === 0) endGame(state, events, unit.owner, 'elimination');
      break;
    }
    case 'special': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      const target = action.targetId ? (getUnit(state, action.targetId) ?? fail('No such target')) : undefined;
      const result = guard(() => applySpecial(state, unit, target));
      events.push({ type: 'special', unitId: unit.id, ...result });
      break;
    }
    case 'endTurn': {
      if (state.phase !== 'play') fail('Not in play');
      endTurn(state, events);
      break;
    }
  }
  return { state, events };
}

/** Re-throw rule violations from helpers as RuleErrors. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw e instanceof RuleError ? e : new RuleError((e as Error).message);
  }
}

export function isInDeployZone(state: GameState, player: PlayerId, h: Hex): boolean {
  return state.map.deployZones[player].some((z) => hexEquals(z, h));
}

/** A move can be undone until the model uses its die, if its start hex is still free. */
export function canUndoMove(state: GameState, unit: Unit): boolean {
  if (state.phase !== 'play' || unit.owner !== state.current || unit.acted) return false;
  if (!unit.pos || !unit.turnStartPos || hexEquals(unit.pos, unit.turnStartPos)) return false;
  return !unitAt(state, unit.turnStartPos);
}

function rollDie(state: GameState): number {
  const [value, next] = nextRandom(state.rngState);
  state.rngState = next;
  return 1 + Math.floor(value * state.config.dieSides);
}

function startTurn(state: GameState, events: GameEvent[]): void {
  const dice: Record<string, number> = {};
  for (const unit of livingUnits(state, state.current)) {
    unit.die = rollDie(state);
    unit.movesLeft = unitDef(state, unit).speed;
    unit.acted = false;
    unit.turnStartPos = unit.pos;
    unit.braced = false; // Brace lasts "until your next turn"
    dice[unit.id] = unit.die;
  }
  // Spot marks placed by this player expire at the start of their next turn.
  for (const unit of state.units) if (unit.spottedBy === state.current) unit.spottedBy = null;
  events.push({ type: 'turnStart', player: state.current, round: state.round, dice });
}

function endTurn(state: GameState, events: GameEvent[]): void {
  for (const unit of livingUnits(state, state.current)) {
    unit.die = null;
    unit.movesLeft = 0;
    unit.turnStartPos = null;
  }

  if (state.turnInRound === 0) {
    state.turnInRound = 1;
    state.current = other(state.current);
    startTurn(state, events);
    return;
  }

  scoreRound(state, events);
  if (state.phase === 'over') return;
  state.round += 1;
  state.turnInRound = 0;
  state.current = firstPlayerOfRound(state.round);
  startTurn(state, events);
}

function scoreRound(state: GameState, events: GameEvent[]): void {
  const counts: [number, number] = [unitsOnControlPoint(state, 0).length, unitsOnControlPoint(state, 1).length];
  const scorer: PlayerId | null = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : null;
  if (scorer !== null) state.scores[scorer] += 1;
  events.push({ type: 'roundScored', round: state.round, counts, scorer });
  if (scorer !== null && state.scores[scorer] >= state.config.pointsToWin) endGame(state, events, scorer, 'points');
}

function endGame(state: GameState, events: GameEvent[], winner: PlayerId, reason: 'points' | 'elimination'): void {
  state.phase = 'over';
  state.winner = winner;
  state.winReason = reason;
  for (const unit of state.units) unit.die = null;
  events.push({ type: 'gameOver', winner, reason });
}

/** Keys of the hexes in a player's deployment zone that are still free. */
export const freeDeployHexes = (state: GameState, player: PlayerId): Set<string> =>
  new Set(state.map.deployZones[player].filter((h) => !unitAt(state, h)).map(hexKey));
