/** Overwatch special: see src/core/overwatch.ts for when and how it fires. */
import { watchArea } from '../overwatch';
import type { SpecialDef } from './types';

export const overwatch: SpecialDef = {
  name: 'Overwatch',
  describe: () =>
    "Lock in this turn's die and watch every hex in range you can see. At the end of the opponent's next turn, " +
    'fire once at an enemy still in that area (lowest defense first).',
  targeting: 'none',
  tags: ['Visible to opponent', 'Fires on their turn end'],
  usable: (state, unit) => (watchArea(state, unit).length ? null : 'nothing to watch'),
  preview: (state, unit) => ({
    area: watchArea(state, unit).map((hex) => ({ hex, kind: 'watch' as const })),
    effects: [],
  }),
  apply: (state, unit) => {
    unit.overwatch = { die: unit.die!, hexes: watchArea(state, unit) };
    return {};
  },
};
