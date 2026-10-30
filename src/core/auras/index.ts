/**
 * Hero auras. Each lives in its own module; to add one, write the module, add its id
 * to AuraId (types.ts), list it here, and give a unit `hero: { aura: '<id>' }`.
 */
import type { AuraId, GameState, Unit } from '../types';
import { marshal } from './marshal';
import { siege } from './siege';
import type { AuraDef, AuraEffects } from './types';
import { warlord } from './warlord';

export * from './types';

export const AURAS: Record<AuraId, AuraDef> = { marshal, siege, warlord };

/** Auras of the unit's own army that affect it. */
export const aurasOn = (state: GameState, unit: Unit): AuraId[] =>
  state.auras[unit.owner].filter((id) => AURAS[id].affects(state, unit));

/** All aura effects on a unit, combined (bonuses add up). */
export function auraEffects(state: GameState, unit: Unit): AuraEffects {
  const total: AuraEffects = {};
  for (const id of aurasOn(state, unit)) {
    const e = AURAS[id].effects(state.config.specials);
    if (e.rollBonus) total.rollBonus = (total.rollBonus ?? 0) + e.rollBonus;
    if (e.speedBonus) total.speedBonus = (total.speedBonus ?? 0) + e.speedBonus;
    if (e.noLoading) total.noLoading = true;
  }
  return total;
}
