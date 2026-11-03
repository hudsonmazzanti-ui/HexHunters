import { hexDistance } from '../hex';
import type { AuraDef } from './types';

/**
 * Field Marshal: Infantry start every turn Prepped. With marshalRange > 0 (0 in the real
 * data) only Infantry within that many hexes of a living Field Marshal get it, judged
 * when the turn starts (that's when the die is rolled).
 */
export const marshal: AuraDef = {
  describe: (r) =>
    `Your Infantry ${r.marshalRange ? `within ${r.marshalRange} hexes of the Field Marshal ` : ''}start every turn Prepped: +${r.marshalRollBonus} on their roll. Stacks with Prep.`,
  short: (r) => `+${r.marshalRollBonus} roll`,
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
