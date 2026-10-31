import type { GameState, SpecialRules, Unit, UnitDef } from '../types';

/** The effects an aura can grant. Add a field here (and read it where it applies) for new kinds of aura. */
export interface AuraEffects {
  /** Added to the die at turn start. */
  rollBonus?: number;
  /** Extra hexes of movement per turn. */
  speedBonus?: number;
  /** Units that normally must Load before firing can fire without loading. */
  noLoading?: boolean;
  /** Added to defense (not an armor bonus: Torch ignores it along with Brace). */
  defenseBonus?: number;
  /** Added to basic-attack damage. */
  damageBonus?: number;
  /** Added to max health; units start the game with it. */
  healthBonus?: number;
  /** May use its special AND then its attack in one turn (same die). The attack must come last. */
  doubleAction?: boolean;
  /** Added to the die when the unit acts (attack or special) while this aura affects it. */
  actionRollBonus?: number;
  /** Which of its actions set Burn on every model they hit (Pyromancer). */
  burnsOn?: ('attack' | 'special')[];
  /** Its die isn't rolled at turn start; it rolls when an action is confirmed (Gambler). */
  rollsOnAction?: boolean;
  /** Ignores the back-to-back resting rule (Necromancer's Skeletons). */
  noRest?: boolean;
  /** A wounded-form unit only changes once at half health or less (Necromancer's Zombies). */
  crawlAtHalf?: boolean;
  /** Raises a Skeleton when an enemy dies nearby (Necromancer's Zombies and the Necromancer). */
  raisesDead?: boolean;
}

/**
 * A hero's army-wide passive rule. It applies to the hero's own side for the whole
 * game once the hero is in the army, even after the hero dies.
 */
export interface AuraDef {
  /** Shown in the builder and info panel, e.g. "Your large models get +1 movement." */
  describe(rules: SpecialRules): string;
  /** Short label for an affected unit type, e.g. "+1 move". */
  short(rules: SpecialRules, unit: UnitDef): string;
  /** Does it affect this friendly unit? (Ownership is checked by the registry.) */
  affects(state: GameState, unit: Unit): boolean;
  /** What it grants a given affected unit type. */
  effects(rules: SpecialRules, unit: UnitDef): AuraEffects;
  /** Army-wide: points scored for winning the control point at the end of a round (default 1). */
  holdPoints?(rules: SpecialRules): number;
}
