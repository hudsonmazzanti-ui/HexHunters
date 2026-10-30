import type { Hex } from '../hex';
import type { GameState, SpecialId, SpecialRules, Unit } from '../types';

/** What a special is aimed at. 'model' = any model except the user itself, friend or foe. */
export type Targeting = 'none' | 'ally' | 'enemy' | 'model' | 'hex' | 'direction';

export const targetsUnit = (t: Targeting): boolean => t === 'ally' || t === 'enemy' || t === 'model';

/** The player's choice of target, as sent in an Action. Which field is used depends on the Targeting. */
export interface SpecialChoice {
  targetId?: string;
  hex?: Hex;
  /** Direction index 0–5 (see hex.ts DIRECTIONS). */
  dir?: number;
}

/** A choice with its target unit looked up. */
export interface ResolvedChoice {
  target?: Unit;
  hex?: Hex;
  dir?: number;
}

/** What happens (or would happen) to one model. */
export interface Effect {
  unitId: string;
  damage: number;
  /** For specials that roll against defense (Torch). */
  roll?: number;
  defense?: number;
  hit?: boolean;
  killed: boolean;
  /** Set burning by this hit (Pyromancer's aura). */
  burned?: boolean;
}

export type AreaKind = 'impact' | 'splash' | 'flame' | 'path' | 'landing' | 'watch';

/** Shown on the board before confirming: the affected hexes and predicted effects. */
export interface SpecialPreview {
  area: { hex: Hex; kind: AreaKind }[];
  effects: Effect[];
}

export interface SpecialResult {
  special: SpecialId;
  targetId?: string;
  /** Hexes healed / dashed. */
  amount?: number;
  /** For specials that move a model (Shove, Vault): where it moved from and to. */
  movedId?: string;
  from?: Hex;
  to?: Hex;
  /** Hexes passed through, ending at `to` (Hook's pull). */
  path?: Hex[];
  /** Area specials (Grenade, Torch). */
  hex?: Hex;
  dir?: number;
  effects?: Effect[];
}

/**
 * One special action. The registry (index.ts) handles everything shared: checking the
 * model can act, validating the choice's basic shape, spending the die, movement.
 */
export interface SpecialDef {
  name: string;
  describe(rules: SpecialRules): string;
  targeting: Targeting;
  /** Short callouts shown in the army builder, e.g. "Friendly fire". */
  tags?: string[];
  /** Keep the model's unused movement after using this special (it may move on). */
  keepsMovement?: boolean;
  /** Why the special can't be used at all right now (before picking a target), or null. */
  usable?(state: GameState, unit: Unit): string | null;
  /** Why this particular target isn't valid, or null. */
  checkChoice?(state: GameState, unit: Unit, choice: ResolvedChoice): string | null;
  /** The area and predicted effects for a valid choice. */
  preview?(state: GameState, unit: Unit, choice: ResolvedChoice): SpecialPreview;
  /** Applies the effect, mutating state. The choice has already been validated. */
  apply(state: GameState, unit: Unit, choice: ResolvedChoice): Omit<SpecialResult, 'special'>;
}
