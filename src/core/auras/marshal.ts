import type { AuraDef } from './types';

export const marshal: AuraDef = {
  describe: (r) => `Your Infantry start every turn Prepped: +${r.marshalRollBonus} on their roll. Stacks with Prep.`,
  short: (r) => `+${r.marshalRollBonus} roll`,
  affects: (_s, unit) => unit.type === 'infantry',
  effects: (r) => ({ rollBonus: r.marshalRollBonus }),
};
