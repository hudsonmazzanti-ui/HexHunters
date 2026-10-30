import type { SpecialDef } from './types';

export const brace: SpecialDef = {
  name: 'Brace',
  describe: (r) => `+${r.braceDefenseBonus} defense until your next turn.`,
  targeting: 'none',
  usable: (_s, unit) => (unit.braced ? 'already braced' : null),
  apply: (_s, unit) => {
    unit.braced = true;
    return {};
  },
};
