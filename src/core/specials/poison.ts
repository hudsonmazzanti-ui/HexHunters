/**
 * Poison (Poisoner): pick an enemy within 4 it can see. No roll. The target takes 1 damage
 * at the start of each of its owner's next 2 turns. Doesn't stack (a poisoned model can't
 * be poisoned again until it wears off). Poison isn't a hit: it doesn't crack armor.
 */
import { hexDistance } from '../hex';
import { canSeeUnit } from '../queries';
import type { SpecialDef } from './types';

export const poison: SpecialDef = {
  name: 'Poison',
  describe: (r) =>
    `Poison an enemy within ${r.poisonRange} you can see (no roll): it takes ${r.poisonDamage} damage at the start of each of its next ${r.poisonTurns} turns.`,
  targeting: 'enemy',
  tags: ['No roll', 'Damage over time', `Doesn't stack`],
  checkChoice: (state, unit, { target }) => {
    if (target!.poison > 0) return 'Already poisoned';
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.poisonRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  preview: (_s, _u, { target }) => ({ area: [{ hex: target!.pos!, kind: 'impact' }], effects: [] }),
  apply: (state, _u, { target }) => {
    target!.poison = state.config.specials.poisonTurns;
    return { targetId: target!.id };
  },
};
