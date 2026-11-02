/**
 * Which games to play: every preset against every other preset (`perMatchup` games
 * each, seats alternating game by game), plus `randomGames` random-vs-random games.
 * Deterministic for a base seed.
 */
import { Rng } from '../src/core/rng';
import type { GameConfig, PlayerId } from '../src/core/types';
import { type ArmySpec, PRESETS, randomArmy } from './armies';
import { type GameJob, jobSeed } from './runGame';

export interface ScheduleOptions {
  seed: number;
  perMatchup: number;
  randomGames: number;
  presets?: ArmySpec[];
}

export function buildJobs(config: GameConfig, o: ScheduleOptions): GameJob[] {
  const presets = o.presets ?? PRESETS;
  const jobs: GameJob[] = [];
  const push = (kind: GameJob['kind'], a: ArmySpec, b: ArmySpec, k: number) => {
    const index = jobs.length;
    jobs.push({ index, seed: jobSeed(o.seed, index), kind, a, b, seatOfA: (k % 2) as PlayerId });
  };
  for (let i = 0; i < presets.length; i++) {
    for (let j = i + 1; j < presets.length; j++) {
      for (let k = 0; k < o.perMatchup; k++) push('preset', presets[i], presets[j], k);
    }
  }
  for (let k = 0; k < o.randomGames; k++) {
    // The armies come from their own stream, so they're the same whatever else runs.
    const rng = new Rng(jobSeed(o.seed ^ 0x7a11, k));
    push('random', randomArmy(config, rng), randomArmy(config, rng), k);
  }
  return jobs;
}

/** Splits `games` between the round robin (about half) and random games. */
export function splitGames(games: number, presetCount: number): { perMatchup: number; randomGames: number } {
  const pairs = (presetCount * (presetCount - 1)) / 2;
  const perMatchup = Math.max(1, Math.round(games / 2 / pairs));
  return { perMatchup, randomGames: Math.max(0, games - perMatchup * pairs) };
}
