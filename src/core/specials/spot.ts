import { canSeeUnit } from '../queries';
import type { SpecialDef } from './types';

export const spot: SpecialDef = {
  name: 'Spot',
  describe: (r) => `Mark a visible enemy (any range): your next attack on it gets +${r.spotAttackBonus}.`,
  targeting: 'enemy',
  checkChoice: (state, unit, { target }) => {
    if (target!.spottedBy === unit.owner) return 'Already spotted';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  apply: (_s, unit, { target }) => {
    target!.spottedBy = unit.owner;
    return { targetId: target!.id };
  },
};
