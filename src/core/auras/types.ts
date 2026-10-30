import type { GameState, SpecialRules, Unit } from '../types';

/** The effects an aura can grant. Add a field here (and read it where it applies) for new kinds of aura. */
export interface AuraEffects {
  /** Added to the die at turn start. */
  rollBonus?: number;
  /** Extra hexes of movement per turn. */
  speedBonus?: number;
  /** Units that normally must Load before firing can fire without loading. */
  noLoading?: boolean;
}

/**
 * A hero's army-wide passive rule. It applies to the hero's own side for the whole
 * game once the hero is in the army, even after the hero dies.
 */
export interface AuraDef {
  /** Shown in the builder and info panel, e.g. "Your large models get +1 movement." */
  describe(rules: SpecialRules): string;
  /** Short label for affected units, e.g. "+1 move". */
  short(rules: SpecialRules): string;
  /** Does it affect this friendly unit? (Ownership is checked by the registry.) */
  affects(state: GameState, unit: Unit): boolean;
  effects(rules: SpecialRules): AuraEffects;
}
