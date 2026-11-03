/**
 * Plays one complete game between two bot-controlled armies with the real rules
 * (newGame + applyAction only): army building, deployment, turns, scoring. No UI.
 *
 * Fully determined by the job (seed + armies + seat): the map, deployment shape,
 * coin flip and dice come from the game seed, the bot's tie-breaking jitter from a
 * stream derived from it. So any game can be replayed from its CSV row.
 */
import { type Action, type GameEvent, applyAction, newGame } from '../src/core/game';
import { Rng } from '../src/core/rng';
import type { ConditionId, GameConfig, GameState, MissionId, PlayerId } from '../src/core/types';
import { DEFAULT_CONFIG } from '../src/data/config';
import { DEPLOY_SHAPES } from '../src/data/deployShapes';
import type { ArmySpec } from './armies';
import { planPlacement, planStep } from './bot';
import { WEIGHTS, type Weights } from './weights';

export interface GameJob {
  /** Index in the run; also used to derive the seed. */
  index: number;
  seed: number;
  kind: 'preset' | 'random';
  a: ArmySpec;
  b: ArmySpec;
  /** Which seat army A takes (0 = Player 1). Alternates to cancel seat bias. */
  seatOfA: PlayerId;
}

export interface UnitUsage {
  /** Model-turns the unit was on the board for its owner's turn (not resting). */
  turns: number;
  attacks: number;
  specials: number;
}

export type Outcome = 'A' | 'B' | 'draw';
export type EndReason = 'points' | 'capture' | 'elimination' | 'draw' | 'roundLimit';

export interface GameRecord {
  index: number;
  seed: number;
  kind: GameJob['kind'];
  a: ArmySpec;
  b: ArmySpec;
  seatOfA: PlayerId;
  /** Which army won the coin flip and went first in round 1. */
  firstMover: 'A' | 'B';
  shape: string;
  /** This game's mission id ('koth', 'ctf'). */
  mission: MissionId;
  /** This game's battlefield Condition id ('clear', 'fog', ...). */
  condition: ConditionId;
  /** Capture the Flag: flag captures by each army (a capture wins, so 0 or 1), pickups and drops (0 in other missions). */
  capturesA: number;
  capturesB: number;
  flagPickups: number;
  flagDrops: number;
  /** Capture the Flag: the unit type that made the winning capture (null if none). */
  captureUnit: string | null;
  /** Domination: site claims by both sides (0 in other missions). */
  siteClaims: number;
  /** Terrain on this game's map. */
  terrainPieces: number;
  terrainHexes: number;
  winner: Outcome;
  reason: EndReason;
  rounds: number;
  scoreA: number;
  scoreB: number;
  /** Per unit type, summed over both sides. */
  usage: Record<string, UnitUsage>;
  /** Bot actions the rules refused (should always be 0). */
  illegal: number;
  /** Every action, for replays (only when requested). */
  log?: Action[];
}

export interface RunOptions {
  maxRounds?: number;
  weights?: Weights;
  /** 'passive' just ends every turn (used to test the round limit). */
  bot?: 'heuristic' | 'passive';
  keepLog?: boolean;
  config?: GameConfig;
}

/** Seed for job `index` of a run started with `base`. Always a positive 31-bit integer. */
export const jobSeed = (base: number, index: number): number =>
  1 + ((Math.imul(base >>> 0, 2654435761) + Math.imul(index + 1, 40503)) >>> 0) % 2147483646;

export function runGame(job: GameJob, opts: RunOptions = {}): GameRecord {
  const config = opts.config ?? DEFAULT_CONFIG;
  const maxRounds = opts.maxRounds ?? 30;
  const w = opts.weights ?? WEIGHTS;
  const rng = new Rng((job.seed ^ 0x5eed1e55) | 0);
  const log: Action[] = [];
  const usage: Record<string, UnitUsage> = {};
  const use = (type: string) => (usage[type] ??= { turns: 0, attacks: 0, specials: 0 });
  let illegal = 0;
  const captures: [number, number] = [0, 0];
  let flagPickups = 0;
  let flagDrops = 0;
  let captureUnit: string | null = null;
  let siteClaims = 0;

  let state: GameState = newGame(config, job.seed);
  // Terrain as generated (Hurl and Smash can remove some during the game).
  const terrainPieces = state.map.terrain.length;
  const terrainHexes = Object.keys(state.map.heights).length;
  // (A function, so TypeScript doesn't narrow the phase across the apply() calls below.)
  const phase = () => state.phase;
  const apply = (action: Action): boolean => {
    let events: GameEvent[];
    const before = state;
    try {
      ({ state, events } = applyAction(state, action));
    } catch {
      illegal++;
      return false;
    }
    if (opts.keepLog) log.push(action);
    for (const ev of events) {
      if (ev.type === 'attack') use(typeOf(before, ev.unitId)).attacks++;
      else if (ev.type === 'special' || ev.type === 'gambleFailed') use(typeOf(before, ev.unitId)).specials++;
      else if (ev.type === 'flagCaptured') {
        captures[ev.player]++;
        captureUnit = typeOf(state, ev.unitId);
      }
      else if (ev.type === 'flagPickedUp') flagPickups++;
      else if (ev.type === 'siteClaimed') siteClaims++;
      else if (ev.type === 'flagDropped') flagDrops++;
      else if (ev.type === 'turnStart') {
        for (const u of state.units) if (u.owner === ev.player && u.pos && !u.resting) use(u.type).turns++;
      }
    }
    return true;
  };

  const armyOf = (seat: PlayerId) => (seat === job.seatOfA ? job.a : job.b);
  apply({ type: 'chooseArmy', units: armyOf(0).units });
  apply({ type: 'chooseArmy', units: armyOf(1).units });
  if (phase() !== 'deploy') throw new Error(`Army rejected: ${job.a.units} / ${job.b.units}`);

  for (let guard = 0; phase() === 'deploy' && guard < 200; guard++) {
    if (!apply(planPlacement(state, rng))) throw new Error('Bot made an illegal placement');
  }

  let reason: EndReason | null = null;
  while (phase() === 'play') {
    if (state.round > maxRounds) {
      reason = 'roundLimit';
      break;
    }
    if (opts.bot !== 'passive') {
      for (let steps = 0; steps < 60 && phase() === 'play'; steps++) {
        const plan = planStep(state, rng, w);
        if (!plan) break;
        let ok = true;
        for (const action of plan) if (phase() === 'play' && !apply(action)) ok = false;
        if (!ok) break; // the rules refused something: don't loop on it
      }
    }
    if (phase() === 'play') apply({ type: 'endTurn' });
  }

  const seatToArmy = (p: PlayerId | null): Outcome => (p === null ? 'draw' : p === job.seatOfA ? 'A' : 'B');
  const winner: Outcome = reason === 'roundLimit' ? 'draw' : seatToArmy(state.winner);
  return {
    index: job.index,
    seed: job.seed,
    kind: job.kind,
    a: job.a,
    b: job.b,
    seatOfA: job.seatOfA,
    firstMover: state.firstPlayer === job.seatOfA ? 'A' : 'B',
    shape: DEPLOY_SHAPES[state.map.deployShape]?.name ?? state.map.deployShape,
    mission: state.mission,
    condition: state.condition,
    capturesA: captures[job.seatOfA],
    capturesB: captures[job.seatOfA === 0 ? 1 : 0],
    flagPickups,
    flagDrops,
    captureUnit,
    siteClaims,
    terrainPieces,
    terrainHexes,
    winner,
    reason: reason ?? (state.winReason as EndReason),
    rounds: Math.min(state.round, maxRounds),
    scoreA: state.scores[job.seatOfA],
    scoreB: state.scores[job.seatOfA === 0 ? 1 : 0],
    usage,
    illegal,
    log: opts.keepLog ? log : undefined,
  };
}

const typeOf = (state: GameState, id: string): string => state.units.find((u) => u.id === id)?.type ?? 'unknown';

/** Runs several jobs in order (what each worker does). */
export const runJobs = (jobs: GameJob[], opts: RunOptions = {}): GameRecord[] => jobs.map((j) => runGame(j, opts));
