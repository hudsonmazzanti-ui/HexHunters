/**
 * Game state machine. `applyAction(state, action)` is pure: it returns a new state
 * plus a list of events (for animations / logs) and never touches the input.
 * Everything a player can do is an Action, so AI or network play can later drive
 * the game by producing the same actions as the UI.
 */
import { type Hex, hexEquals, neighbors } from './hex';
import { entryModels, validateArmy } from './army';
import { type AttackResult, dealDamage, previewAttack, resolveAttack } from './combat';
import { raiseDead } from './necro';
import { auraEffects, holdPoints } from './auras';
import { generateMap } from './mapgen';
import { type OverwatchShot, resolveOverwatch } from './overwatch';
import {
  getUnit,
  hasDoubleAction,
  livingUnits,
  maxHealth,
  movePath,
  other,
  unitAt,
  unitDef,
  unitSpeed,
  unitsOnControlPoint,
} from './queries';
import { nextRandom } from './rng';
import { type SpecialChoice, type SpecialResult, applySpecial, specialBlockedReason, specialOf } from './specials';
import type { GameConfig, GameState, PlayerId, Unit, WinReason } from './types';

export type Action =
  | { type: 'chooseArmy'; units: string[] }
  /** Place one model. A twin also needs `partnerHex`: its partner goes there, next to it, in the same step. */
  | { type: 'place'; unitId: string; hex: Hex; partnerHex?: Hex }
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
  /** The coin flip deciding who goes first in round 1. */
  | { type: 'coinFlip'; winner: PlayerId }
  /** A Werewolf turned into its beast form at the start of its owner's turn. */
  | { type: 'transformed'; unitId: string; into: string; healed: number }
  /** A Skeleton rose from an enemy's death (Necromancer). */
  | { type: 'raised'; unitId: string; at: Hex }
  /** Gambler: the die rolled when the action was confirmed. */
  | { type: 'gambleRoll'; unitId: string; roll: number }
  /** Gambler: the roll missed the special's threshold, so the action was wasted. */
  | { type: 'gambleFailed'; unitId: string; roll: number; reason: string }
  /** Burn damage at the start of the burning model's owner's turn. */
  | { type: 'burn'; unitId: string; damage: number; killed: boolean }
  /** A Sentinel's overwatch shot at the end of the opponent's turn. */
  | ({ type: 'overwatch' } & OverwatchShot)
  /** `points` is what the scorer got (Standard Bearer: 2), 0 on a tie. */
  | { type: 'roundScored'; round: number; counts: [number, number]; scorer: PlayerId | null; points: number }
  /** winner null = draw. */
  | { type: 'gameOver'; winner: PlayerId | null; reason: WinReason };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Who goes first in a round. `first` won the coin flip and goes first in round 1; the
 * order flips every `swapEvery` rounds. With 2 and player 1 winning the flip: rounds
 * 1–2 player 1 first, rounds 3–4 player 2 first, and so on. Where it flips, the same
 * player takes two turns in a row.
 */
export const firstPlayerOfRound = (round: number, swapEvery: number, first: PlayerId = 0): PlayerId =>
  Math.floor((round - 1) / swapEvery) % 2 === 0 ? first : other(first);

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
    firstPlayer: 0,
    turnsTaken: [0, 0],
    deaths: [],
    spawned: 0,
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
      // Squads (the Twins) expand into all their models.
      const models = action.units.map((t) => entryModels(state.config, t));
      // Hero auras belong to the army for the whole game, even if the hero later dies.
      state.auras[player] = models.flat().flatMap((t) => state.config.units[t].hero?.aura ?? []);
      let index = 0;
      for (const group of models) {
        const units = group.map((type) => newUnit(state.config, player, type, index++));
        // Link squad members as partners (the Twins: each other).
        if (units.length === 2) [units[0].partnerId, units[1].partnerId] = [units[1].id, units[0].id];
        for (const unit of units) {
          state.units.push(unit);
          unit.hp = maxHealth(state, unit); // aura health bonuses (Warden) apply from the start
        }
      }
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
      const partner = unit.partnerId ? getUnit(state, unit.partnerId) : undefined;
      if (partner && !partner.pos) {
        // Twins are placed together: the partner on a free zone hex next to this one.
        if (!freePartnerHexes(state, action.hex).length) fail('No free hex next to it for the other twin');
        const ph = action.partnerHex ?? fail('Place the other twin next to it');
        if (!freePartnerHexes(state, action.hex).some((h) => hexEquals(h, ph))) {
          fail('The other twin must go on a free hex next to the first, inside your zone');
        }
        partner.pos = ph;
      }
      unit.pos = action.hex;
      const next = nextDeployer(state);
      events.push({ type: 'placed', unitId: unit.id, hex: action.hex, next });
      if (next === null) {
        state.phase = 'play';
        state.round = 1;
        state.turnInRound = 0;
        // Coin flip: who goes first in round 1 (seeded, so a replayed seed flips the same way).
        const [flip, rng] = nextRandom(state.rngState);
        state.rngState = rng;
        state.firstPlayer = flip < 0.5 ? 0 : 1;
        events.push({ type: 'coinFlip', winner: state.firstPlayer });
        state.current = state.firstPlayer;
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
      if (unit.gambling) {
        // Gambler: check the attack is legal, then roll its die now.
        const reason = previewAttack(state, unit, target).blockedReason;
        if (reason) fail(reason);
        gambleRoll(state, unit, events);
      }
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
      const choice = { targetId, hex, dir };
      if (unit.gambling) {
        // Gambler: the special must be possible with the best roll; then roll for real.
        const reason = specialBlockedReason(state, unit, choice);
        if (reason) fail(reason);
        const roll = gambleRoll(state, unit, events);
        const missed = specialBlockedReason(state, unit, choice);
        if (missed) {
          // The gamble failed (e.g. Grenade needs 10+): the die is spent, nothing happens.
          unit.specialUsed = true;
          unit.acted = !hasDoubleAction(state, unit);
          if (!specialOf(state, unit)?.keepsMovement) unit.movesLeft = 0;
          events.push({ type: 'gambleFailed', unitId: unit.id, roll, reason: missed });
          break;
        }
      }
      const result = guard(() => applySpecial(state, unit, choice));
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
  // Raise Dead (Necromancer) for every model that died during this action.
  for (const u of raiseDead(state)) events.push({ type: 'raised', unitId: u.id, at: u.pos! });
  return { state, events };
}

/** Gambler: rolls the model's die now: d12 + bonus (+ Prep/Marshal), capped. */
function gambleRoll(state: GameState, unit: Unit, events: GameEvent[]): number {
  const r = state.config.specials;
  unit.die = Math.min(r.gamblerMaxDie, rollDie(state) + r.gamblerRollBonus + unit.dieBonus);
  unit.gambling = false;
  events.push({ type: 'gambleRoll', unitId: unit.id, roll: unit.die });
  return unit.die;
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
    crawling: false,
    resting: false,
    burning: false,
    partnerId: null,
    gambling: false,
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

/** Free hexes in the current player's zone next to `h`, where a twin's partner can be placed. */
export function freePartnerHexes(state: GameState, h: Hex): Hex[] {
  return neighbors(h).filter((n) => isInDeployZone(state, state.current, n) && !unitAt(state, n) && !hexEquals(n, h));
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

/**
 * Starts the current player's turn. `backToBack` is true when they also took the
 * previous turn (the turn order just flipped): Skeletons rest on that turn.
 */
function startTurn(state: GameState, events: GameEvent[], backToBack = false): void {
  // Burn ticks first, so a Zombie that starts crawling from it moves at crawl speed.
  for (const unit of livingUnits(state, state.current)) {
    if (!unit.burning) continue;
    unit.burning = false;
    const damage = state.config.specials.burnDamage;
    const killed = dealDamage(state, unit, damage);
    events.push({ type: 'burn', unitId: unit.id, damage, killed });
  }
  if (checkElimination(state, events)) return;

  // Werewolves transform for good at the start of their owner's Nth turn.
  state.turnsTaken[state.current] += 1;
  for (const unit of livingUnits(state, state.current)) {
    const t = unitDef(state, unit).transformsInto;
    if (!t || state.turnsTaken[state.current] < t.onOwnerTurn) continue;
    unit.type = t.type;
    const before = unit.hp;
    unit.hp = Math.min(maxHealth(state, unit), unit.hp + t.heal);
    events.push({ type: 'transformed', unitId: unit.id, into: t.type, healed: unit.hp - before });
  }

  const dice: Record<string, number> = {};
  for (const unit of livingUnits(state, state.current)) {
    unit.resting = backToBack && !!unitDef(state, unit).restsOnDoubleTurn && !auraEffects(state, unit).noRest;
    if (unit.resting) {
      // Sits this turn out: no die, no movement.
      unit.die = null;
      unit.dieBonus = 0;
      unit.movesLeft = 0;
      unit.acted = true;
      unit.specialUsed = false;
      unit.turnStartPos = unit.pos;
      unit.braced = false;
      continue;
    }
    // Prep and the Field Marshal's aura both add to the roll, and stack.
    const prep = unit.prepped ? state.config.specials.prepRollBonus : 0;
    unit.dieBonus = prep + (auraEffects(state, unit).rollBonus ?? 0);
    unit.prepped = false;
    // Gambler: no roll yet ("?"); the die rolls when an action is confirmed.
    unit.gambling = !!auraEffects(state, unit).rollsOnAction;
    unit.die = unit.gambling ? null : rollDie(state) + unit.dieBonus;
    unit.movesLeft = unitSpeed(state, unit);
    unit.acted = false;
    unit.specialUsed = false;
    unit.turnStartPos = unit.pos;
    unit.braced = false; // Brace lasts "until your next turn"
    if (unit.die !== null) dice[unit.id] = unit.die;
  }
  // Spot marks placed by this player expire at the start of their next turn.
  for (const unit of state.units) if (unit.spottedBy === state.current) unit.spottedBy = null;
  events.push({ type: 'turnStart', player: state.current, round: state.round, dice });
}

function endTurn(state: GameState, events: GameEvent[]): void {
  for (const unit of livingUnits(state, state.current)) {
    unit.die = null;
    unit.gambling = false;
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
  const previous = state.current;
  state.round += 1;
  state.turnInRound = 0;
  state.current = firstPlayerOfRound(state.round, state.config.firstPlayerSwapEvery, state.firstPlayer);
  startTurn(state, events, state.current === previous);
}

function scoreRound(state: GameState, events: GameEvent[]): void {
  const counts: [number, number] = [unitsOnControlPoint(state, 0).length, unitsOnControlPoint(state, 1).length];
  const scorer: PlayerId | null = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : null;
  const points = scorer === null ? 0 : holdPoints(state, scorer);
  if (scorer !== null) state.scores[scorer] += points;
  events.push({ type: 'roundScored', round: state.round, counts, scorer, points });
  if (scorer !== null && state.scores[scorer] >= state.config.pointsToWin) endGame(state, events, scorer, 'points');
}

function endGame(state: GameState, events: GameEvent[], winner: PlayerId | null, reason: WinReason): void {
  state.phase = 'over';
  state.winner = winner;
  state.winReason = reason;
  for (const unit of state.units) unit.die = null;
  events.push({ type: 'gameOver', winner, reason });
}
