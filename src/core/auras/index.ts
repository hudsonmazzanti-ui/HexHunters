/**
 * Hero auras. Each lives in its own module; to add one, write the module, add its id
 * to AuraId (types.ts), list it here, and give a unit `hero: { aura: '<id>' }`.
 */
import type { AuraId, GameState, Unit } from '../types';
import { marshal } from './marshal';
import { ninja } from './ninja';
import { siege } from './siege';
import type { AuraDef, AuraEffects } from './types';
import { warden } from './warden';
import { warlord } from './warlord';

export * from './types';

export const AURAS: Record<AuraId, AuraDef> = { marshal, siege, warlord, warden, ninja };

/** Auras of the unit's own army that affect it. */
export const aurasOn = (state: GameState, unit: Unit): AuraId[] =>
  state.auras[unit.owner].filter((id) => AURAS[id].affects(state, unit));

/** All aura effects on a unit, combined (bonuses add up). */
export function auraEffects(state: GameState, unit: Unit): AuraEffects {
  const total: AuraEffects = {};
  for (const id of aurasOn(state, unit)) {
    const e = AURAS[id].effects(state.config.specials, state.config.units[unit.type]);
    for (const key of ['rollBonus', 'speedBonus', 'defenseBonus', 'damageBonus', 'healthBonus'] as const) {
      if (e[key]) total[key] = (total[key] ?? 0) + e[key];
    }
    if (e.noLoading) total.noLoading = true;
    if (e.doubleAction) total.doubleAction = true;
  }
  return total;
}
