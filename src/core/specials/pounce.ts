/** Pounce (Werewolf beast): move up to 2 extra hexes, then it may still attack with the same die. */
import type { SpecialDef } from './types';

export const pounce: SpecialDef = {
  name: 'Pounce',
  describe: (r) => `Move up to ${r.pounceMoves} extra hexes, then make your melee attack with the same die.`,
  targeting: 'none',
  tags: ['Then attack'],
  keepsMovement: true,
  allowsAttackAfter: true,
  apply: (state, unit) => {
    unit.movesLeft += state.config.specials.pounceMoves;
    return { amount: state.config.specials.pounceMoves };
  },
};
