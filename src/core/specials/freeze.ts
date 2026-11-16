/**
 * Freeze (Cryomancer): pick an enemy within 3 it can see. No roll. That model can't move
 * on its owner's next turn (it can still attack and use its special). Doesn't stack.
 */
import { hexDistance } from '../hex';
import { canSeeUnit } from '../queries';
import type { SpecialDef } from './types';

export const freeze: SpecialDef = {
  name: 'Freeze',
  describe: (r) => `Freeze an enemy within ${r.freezeRange} you can see (no roll): it can't move on its next turn. It can still attack.`,
  targeting: 'enemy',
  tags: ['No roll', `Doesn't stack`],
  checkChoice: (state, unit, { target }) => {
    if (target!.frozen) return 'Already frozen';
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.freezeRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  preview: (_s, _u, { target }) => ({ area: [{ hex: target!.pos!, kind: 'impact' }], effects: [] }),
  apply: (_s, _u, { target }) => {
    target!.frozen = true;
    return { targetId: target!.id };
  },
};
