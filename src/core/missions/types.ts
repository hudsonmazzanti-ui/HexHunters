import type { GameEvent } from '../game';
import type { GameConfig, GameState, PlayerId, Unit } from '../types';

/**
 * One mission (the game's objective). Picked at random each game from config.missions.
 * The engine calls the scoring hooks; a mission only adds points and events, and the
 * engine then ends the game when a side reaches config.pointsToWin.
 */
export interface MissionDef {
  name: string;
  /** One line, shown with the mission's name before deployment. */
  summary(config: GameConfig): string;
  /** The full rules, one line each (the mission info panel). */
  rules(config: GameConfig): string[];
  /** Does the control point exist in this mission (drawn on the board, scored)? */
  usesControlPoint: boolean;
  /** Extra state at the start of the game (e.g. the flag on the center hex). */
  setup?(state: GameState): void;
  /** Models the Standard Bearer's aura boosts (+2 when acting): on the point, or the flag carrier. */
  empowered(state: GameState, unit: Unit): boolean;
  /** Scoring at the end of each turn of `player` (after the opponent's overwatch). */
  endOfTurn?(state: GameState, player: PlayerId, events: GameEvent[]): void;
  /** Scoring at the end of each round (after both turns). */
  endOfRound?(state: GameState, events: GameEvent[]): void;
}
