/**
 * Premium Shot (Mercenary): an enemy within 7 that the Mercenary can see. No roll:
 * it always hits for 4 damage. Limited uses per game: one per point the army left
 * unspent, up to 3 (UnitDef.specialUses; the registry spends and checks them).
 */
import { dealDamage } from '../combat';
import { hexDistance } from '../hex';
import { canSeeUnit } from '../queries';
import type { GameState, Unit } from '../types';
import type { SpecialDef, SpecialPreview } from './types';

function shot(state: GameState, target: Unit): SpecialPreview {
  const damage = state.config.specials.premiumDamage;
  return {
    area: [{ hex: target.pos!, kind: 'impact' }],
    effects: [{ unitId: target.id, damage, killed: target.hp <= damage }],
  };
}

export const premiumShot: SpecialDef = {
  name: 'Premium Shot',
  describe: (r) =>
    `Shoot an enemy within ${r.premiumRange} you can see. No roll: always hits for ${r.premiumDamage} damage. ` +
    'Uses per game: 1 per point your army left unspent (max 3).',
  targeting: 'enemy',
  tags: ['Always hits', 'Limited uses'],
  checkChoice: (state, unit, { target }) => {
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.premiumRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  preview: (state, _unit, { target }) => shot(state, target!),
  apply: (state, _unit, { target }) => {
    const { effects } = shot(state, target!);
    effects[0].killed = dealDamage(state, target!, effects[0].damage);
    return { targetId: target!.id, effects };
  },
};
