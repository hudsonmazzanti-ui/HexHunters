import type { SpecialDef } from './types';

export const prep: SpecialDef = {
  name: 'Prep',
  describe: (r) => `+${r.prepRollBonus} on this model's die roll next turn.`,
  targeting: 'none',
  usable: (_s, unit) => (unit.prepped ? 'already prepped' : null),
  apply: (_s, unit) => {
    unit.prepped = true;
    return {};
  },
};
