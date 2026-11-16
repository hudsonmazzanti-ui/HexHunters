/**
 * Guard (Guardian): until the Guardian's next turn, every friendly model next to it gets
 * extra defense (not the Guardian itself). Checked live, so allies that step next to it
 * are covered and ones that leave are not. Doesn't stack with a second Guardian.
 */
import { neighbors } from '../hex';
import { unitAt } from '../queries';
import type { SpecialDef } from './types';

export const guard: SpecialDef = {
  name: 'Guard',
  describe: (r) => `Until your next turn, your models next to the Guardian get +${r.guardDefenseBonus} defense (not the Guardian itself).`,
  targeting: 'none',
  tags: ['Protects neighbors', `Doesn't stack`],
  usable: (_s, unit) => (unit.guarding ? 'already guarding' : null),
  preview: (state, unit) => ({
    area: neighbors(unit.pos!)
      .filter((h) => unitAt(state, h)?.owner === unit.owner)
      .map((hex) => ({ hex, kind: 'landing' as const })),
    effects: [],
  }),
  apply: (_s, unit) => {
    unit.guarding = true;
    return {};
  },
};
