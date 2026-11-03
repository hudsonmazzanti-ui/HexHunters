/**
 * Missions (the game's objective). Each lives in its own module; to add one, write the
 * module, add its id to MissionId (types.ts), list it here, and add the id to
 * config.missions so it can be picked.
 */
import { Rng } from '../rng';
import type { GameConfig, MissionId } from '../types';
import { ctf } from './ctf';
import { dom } from './dom';
import { koth } from './koth';
import type { MissionDef } from './types';

export * from './types';

export const MISSIONS: Record<MissionId, MissionDef> = { koth, ctf, dom };

/** Points needed to win this game's mission. */
export const missionPointsToWin = (config: GameConfig, mission: MissionId): number =>
  MISSIONS[mission].pointsToWin?.(config) ?? config.pointsToWin;

/**
 * This game's mission: a seeded pick from config.missions. It uses its own random stream,
 * so the map, deployment shape and dice for a seed are the same whatever the mission pool.
 */
export function pickMission(config: GameConfig, seed: number): MissionId {
  const pool = config.missions.length ? config.missions : (['koth'] as MissionId[]);
  return pool.length === 1 ? pool[0] : new Rng((seed ^ 0x1b873593) | 0).pick(pool);
}
