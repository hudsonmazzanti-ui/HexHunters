import type { ConditionId, MissionId } from '../types';

/**
 * A battlefield Condition. One is picked at random each game (weights in
 * config.conditions). A Condition only says what changes; the engine reads these fields
 * where they apply (speed, dice, reach, map, deployment, armies).
 */
export interface ConditionDef {
  id: ConditionId;
  name: string;
  /** One line for the briefing screen. */
  summary: string;
  /** Icon key for the briefing and the in-game corner button (see src/ui/icons.ts). */
  icon: string;
  /** Missions it can't be paired with (it's rerolled if one comes up). */
  incompatibleMissions?: MissionId[];
  /** Added to every model's final speed, after all other modifiers (minimum 1). */
  speedDelta?: number;
  /** Added to every die result (minimum 1). Models without a die are unaffected. */
  dieDelta?: number;
  /** Nothing can target or affect a model farther away than this (attacks and specials). */
  maxReach?: number;
  /** Free models each army gets, placed after the rest of the army. */
  freeUnits?: string[];
  /** Board radius change (Small / Big Map). */
  radiusDelta?: number;
  /** Replaces the random deployment shape with this one (Hot Drop). */
  deployShape?: string;
  /** Deployment shapes that can't be used with this Condition (too cramped). */
  excludeShapes?: string[];
}

