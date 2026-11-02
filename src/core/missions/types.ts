import type { GameEvent } from '../game';
import type { GameConfig, GameState, PlayerId, Unit, WinReason } from '../types';

/** A mission's hook says the game is won (e.g. a flag capture). */
export interface MissionWin {
  winner: PlayerId;
  reason: WinReason;
}

/**
 * One mission (the game's objective). Picked at random each game from config.missions.
 * The engine calls the scoring hooks. A mission adds points and events, and the engine
 * ends the game when a side reaches config.pointsToWin, or when a hook returns a win.
 */
export interface MissionDef {
  name: string;
  /** One line, shown with the mission's name before deployment. */
  summary(config: GameConfig): string;
  /** The full rules, one line each (the mission info panel). */
  rules(config: GameConfig): string[];
  /** Does the control point exist in this mission (drawn on the board, scored)? */
  usesControlPoint: boolean;
  /** Is the game won on points (shown in the top bar)? */
  usesPoints: boolean;
  /** Extra state at the start of the game (e.g. the flag on the center hex). */
  setup?(state: GameState): void;
  /** Models the Standard Bearer's aura boosts (+2 when acting): on the point, or the flag carrier. */
  empowered(state: GameState, unit: Unit): boolean;
  /** Checked at the end of each turn of `player` (after the opponent's overwatch). Returns a win, if any. */
  endOfTurn?(state: GameState, player: PlayerId, events: GameEvent[]): MissionWin | null;
  /** Scoring at the end of each round (after both turns). */
  endOfRound?(state: GameState, events: GameEvent[]): void;
}
