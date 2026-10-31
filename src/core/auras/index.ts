/**
 * Hero auras. Each lives in its own module; to add one, write the module, add its id
 * to AuraId (types.ts), list it here, and give a unit `hero: { aura: '<id>' }`.
 */
import type { AuraId, GameState, PlayerId, Unit } from '../types';
import { gambler } from './gambler';
import { marshal } from './marshal';
import { necro } from './necro';
import { ninja } from './ninja';
import { pyro } from './pyro';
import { siege } from './siege';
import { standard } from './standard';
import type { AuraDef, AuraEffects } from './types';
import { warden } from './warden';
import { warlord } from './warlord';

export * from './types';

export const AURAS: Record<AuraId, AuraDef> = { marshal, siege, warlord, warden, ninja, standard, pyro, gambler, necro };

/** Points a player scores for winning the control point at the end of a round (Standard Bearer: 2). */
export const holdPoints = (state: GameState, player: PlayerId): number =>
  Math.max(1, ...state.auras[player].map((id) => AURAS[id].holdPoints?.(state.config.specials) ?? 1));

/** Auras of the unit's own army that affect it. */
export const aurasOn = (state: GameState, unit: Unit): AuraId[] =>
  state.auras[unit.owner].filter((id) => AURAS[id].affects(state, unit));

/** All aura effects on a unit, combined (bonuses add up). */
export function auraEffects(state: GameState, unit: Unit): AuraEffects {
  const total: AuraEffects = {};
  for (const id of aurasOn(state, unit)) {
    const e = AURAS[id].effects(state.config.specials, state.config.units[unit.type]);
    for (const key of ['rollBonus', 'speedBonus', 'defenseBonus', 'damageBonus', 'healthBonus', 'actionRollBonus'] as const) {
      if (e[key]) total[key] = (total[key] ?? 0) + e[key];
    }
    if (e.noLoading) total.noLoading = true;
    if (e.doubleAction) total.doubleAction = true;
    if (e.burnsOn) total.burnsOn = [...(total.burnsOn ?? []), ...e.burnsOn];
    for (const flag of ['rollsOnAction', 'noRest', 'crawlAtHalf', 'raisesDead'] as const) if (e[flag]) total[flag] = true;
  }
  return total;
}
