/**
 * Game state machine. `applyAction(state, action)` is pure: it returns a new state
 * plus a list of events (for animations / logs) and never touches the input.
 * Everything a player can do is an Action, so AI or network play can later drive
 * the game by producing the same actions as the UI.
 */
import { type Hex, hexEquals } from './hex';
import { validateArmy } from './army';
import { type AttackResult, resolveAttack } from './combat';
import { auraEffects } from './auras';
import { generateMap } from './mapgen';
import { type OverwatchShot, resolveOverwatch } from './overwatch';
import { getUnit, livingUnits, maxHealth, movePath, other, unitAt, unitSpeed, unitsOnControlPoint } from './queries';
import { nextRandom } from './rng';
import { type SpecialChoice, type SpecialResult, applySpecial } from './specials';
import type { GameConfig, GameState, PlayerId, Unit, WinReason } from './types';

export type Action =
  | { type: 'chooseArmy'; units: string[] }
  | { type: 'place'; unitId: string; hex: Hex }
  | { type: 'move'; unitId: string; to: Hex }
  | { type: 'undoMove'; unitId: string }
  | { type: 'attack'; unitId: string; targetId: string }
  | ({ type: 'special'; unitId: string } & SpecialChoice)
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'armyChosen'; player: PlayerId; next: PlayerId | null }
  /** `next` is who places next during deployment (null once everyone is placed). */
  | { type: 'placed'; unitId: string; hex: Hex; next: PlayerId | null }
  | { type: 'turnStart'; player: PlayerId; round: number; dice: Record<string, number> }
  | { type: 'move'; unitId: string; path: Hex[] }
  | ({ type: 'attack'; unitId: string; targetId: string } & AttackResult)
  | ({ type: 'special'; unitId: string } & SpecialResult)
  /** A Sentinel's overwatch shot at the end of the opponent's turn. */
  | ({ type: 'overwatch' } & OverwatchShot)
  | { type: 'roundScored'; round: number; counts: [number, number]; scorer: PlayerId | null }
  /** winner null = draw. */
  | { type: 'gameOver'; winner: PlayerId | null; reason: WinReason };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Who goes first in a round. The order flips every `swapEvery` rounds; with 2:
 * rounds 1–2 player 1 first, rounds 3–4 player 2 first, 5–6 player 1, and so on.
 * Where it flips, the same player takes two turns in a row.
 */
export const firstPlayerOfRound = (round: number, swapEvery: number): PlayerId =>
  Math.floor((round - 1) / swapEvery) % 2 === 0 ? 0 : 1;

/** Starts in the army-building phase: player 1 builds, then player 2. */
export function newGame(config: GameConfig, seed: number): GameState {
  return {
    config,
    seed,
    map: generateMap(config, seed),
    units: [],
    phase: 'build',
    current: 0,
    round: 1,
    turnInRound: 0,
    scores: [0, 0],
    auras: [[], []],
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
    case 'chooseArmy': {
      if (state.phase !== 'build') fail('Not building armies');
      const reason = validateArmy(state.config, action.units);
      if (reason) fail(reason);
      const player = state.current;
      // Hero auras belong to the army for the whole game, even if the hero later dies.
      state.auras[player] = action.units.flatMap((t) => state.config.units[t].hero?.aura ?? []);
      action.units.forEach((type, i) => {
        const unit = newUnit(state.config, player, type, i);
        state.units.push(unit);
        unit.hp = maxHealth(state, unit); // aura health bonuses (Warden) apply from the start
      });
      if (player === 0) {
        state.current = 1;
      } else {
        state.phase = 'deploy';
        state.current = 0;
      }
      events.push({ type: 'armyChosen', player, next: player === 0 ? 1 : null });
      break;
    }
    case 'place': {
      if (state.phase !== 'deploy') fail('Not deploying');
      const unit = ownUnit(action.unitId);
      if (unit.pos) fail('Already placed');
      if (!isInDeployZone(state, state.current, action.hex)) fail('Outside your deployment zone');
      if (unitAt(state, action.hex)) fail('Hex occupied');
      unit.pos = action.hex;
      const next = nextDeployer(state);
      events.push({ type: 'placed', unitId: unit.id, hex: action.hex, next });
      if (next === null) {
        state.phase = 'play';
        state.round = 1;
        state.turnInRound = 0;
        state.current = firstPlayerOfRound(1, state.config.firstPlayerSwapEvery);
        startTurn(state, events);
      } else {
        state.current = next;
      }
      break;
    }
    case 'move': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      const path = movePath(state, unit, action.to) ?? fail('Cannot reach that hex');
      unit.overwatch = null; // the watched area belongs to where it stood
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
      unit.movesLeft = unitSpeed(state, unit);
      break;
    }
    case 'attack': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      const target = getUnit(state, action.targetId) ?? fail('No such target');
      const result = guard(() => resolveAttack(state, unit, target));
      unit.overwatch = null;
      events.push({ type: 'attack', unitId: unit.id, targetId: target.id, ...result });
      checkElimination(state, events);
      break;
    }
    case 'special': {
      if (state.phase !== 'play') fail('Not in play');
      const unit = ownUnit(action.unitId);
      const { targetId, hex, dir } = action;
      // Using the die ends any earlier overwatch (Overwatch itself sets a new one).
      // If the special is illegal, applyAction throws and this cloned state is discarded.
      unit.overwatch = null;
      const result = guard(() => applySpecial(state, unit, { targetId, hex, dir }));
      events.push({ type: 'special', unitId: unit.id, ...result });
      checkElimination(state, events);
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

function newUnit(config: GameConfig, owner: PlayerId, type: string, index: number): Unit {
  return {
    id: `p${owner}-${type}-${index}`,
    type,
    owner,
    pos: null,
    hp: config.units[type].health,
    die: null,
    dieBonus: 0,
    movesLeft: 0,
    acted: false,
    specialUsed: false,
    turnStartPos: null,
    braced: false,
    prepped: false,
    spottedBy: null,
    loaded: false,
    overwatch: null,
  };
}

export const unplacedUnits = (state: GameState, player: PlayerId): Unit[] =>
  state.units.filter((u) => u.owner === player && !u.pos);

/**
 * Deployment alternates one model at a time, starting with player 1. When one
 * player runs out, the other places the rest. null once everything is placed.
 */
function nextDeployer(state: GameState): PlayerId | null {
  const otherPlayer = other(state.current);
  if (unplacedUnits(state, otherPlayer).length) return otherPlayer;
  if (unplacedUnits(state, state.current).length) return state.current;
  return null;
}

/** Ends the game if a side has no models left (a draw if both were wiped out at once). Returns true if it ended. */
function checkElimination(state: GameState, events: GameEvent[]): boolean {
  const alive = [livingUnits(state, 0).length, livingUnits(state, 1).length];
  if (alive[0] && alive[1]) return false;
  if (!alive[0] && !alive[1]) endGame(state, events, null, 'draw');
  else endGame(state, events, alive[0] ? 0 : 1, 'elimination');
  return true;
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
  if (state.phase !== 'play' || unit.owner !== state.current || unit.acted || unit.specialUsed) return false;
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
    // Prep and the Field Marshal's aura both add to the roll, and stack.
    const prep = unit.prepped ? state.config.specials.prepRollBonus : 0;
    unit.dieBonus = prep + (auraEffects(state, unit).rollBonus ?? 0);
    unit.prepped = false;
    unit.die = rollDie(state) + unit.dieBonus;
    unit.movesLeft = unitSpeed(state, unit);
    unit.acted = false;
    unit.specialUsed = false;
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
    unit.dieBonus = 0;
    unit.movesLeft = 0;
    unit.turnStartPos = null;
  }

  // The opponent's Sentinels on overwatch fire at enemies still in their area.
  for (const shot of resolveOverwatch(state, state.current)) events.push({ type: 'overwatch', ...shot });
  if (checkElimination(state, events)) return;

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
  state.current = firstPlayerOfRound(state.round, state.config.firstPlayerSwapEvery);
  startTurn(state, events);
}

function scoreRound(state: GameState, events: GameEvent[]): void {
  const counts: [number, number] = [unitsOnControlPoint(state, 0).length, unitsOnControlPoint(state, 1).length];
  const scorer: PlayerId | null = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : null;
  if (scorer !== null) state.scores[scorer] += 1;
  events.push({ type: 'roundScored', round: state.round, counts, scorer });
  if (scorer !== null && state.scores[scorer] >= state.config.pointsToWin) endGame(state, events, scorer, 'points');
}

function endGame(state: GameState, events: GameEvent[], winner: PlayerId | null, reason: WinReason): void {
  state.phase = 'over';
  state.winner = winner;
  state.winReason = reason;
  for (const unit of state.units) unit.die = null;
  events.push({ type: 'gameOver', winner, reason });
}
