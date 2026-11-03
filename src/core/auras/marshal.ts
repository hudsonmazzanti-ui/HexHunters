import { hexDistance } from '../hex';
import type { AuraDef } from './types';

/**
 * Field Marshal: your Infantry within 3 hexes of it (marshalRange) start every turn
 * Prepped, judged when the turn starts (that's when the die is rolled). Needs the Field
 * Marshal alive. marshalRange 0 would reach every Infantry in the army.
 */
export const marshal: AuraDef = {
  describe: (r) =>
    `Your Infantry ${r.marshalRange ? `within ${r.marshalRange} hexes of the Field Marshal ` : ''}start every turn Prepped: +${r.marshalRollBonus} on their roll. Stacks with Prep.`,
  short: (r) => `+${r.marshalRollBonus} roll`,
  outlivesHero: (r) => !r.marshalRange,
  reach: (r) => r.marshalRange,
  affects: (state, unit) => {
    if (unit.type !== 'infantry') return false;
    const range = state.config.specials.marshalRange;
    if (!range) return true;
    return state.units.some(
      (m) => m.owner === unit.owner && m.type === 'marshal' && m.pos && unit.pos && hexDistance(m.pos, unit.pos) <= range,
    );
  },
  effects: (r) => ({ rollBonus: r.marshalRollBonus }),
};
