import { hexDistance } from '../hex';
import { canSeeUnit } from '../queries';
import type { SpecialDef } from './types';

export const spot: SpecialDef = {
  name: 'Spot',
  describe: (r) => `Mark a visible enemy within ${r.spotRange}: your next attack on it gets +${r.spotAttackBonus}.`,
  targeting: 'enemy',
  checkChoice: (state, unit, { target }) => {
    if (target!.spottedBy === unit.owner) return 'Already spotted';
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.spotRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  apply: (_s, unit, { target }) => {
    target!.spottedBy = unit.owner;
    return { targetId: target!.id };
  },
};
