import { unitSize } from '../queries';
import type { SpecialRules } from '../types';
import type { AuraDef } from './types';

/** "+1 movement", plus any defense / max-health change (0 by default). */
const parts = (r: SpecialRules, long: boolean): string[] => {
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return [
    `${signed(r.warlordSpeedBonus)} ${long ? 'movement' : 'move'}`,
    ...(r.warlordDefenseBonus ? [`${signed(r.warlordDefenseBonus)} ${long ? 'defense' : 'def'}`] : []),
    ...(r.warlordHealthBonus ? [`${signed(r.warlordHealthBonus)} ${long ? 'max health' : 'HP'}`] : []),
  ];
};

export const warlord: AuraDef = {
  describe: (r) => `All your large models, including the Warlord, get ${parts(r, true).join(', ')}.`,
  short: (r) => parts(r, false).join(', '),
  affects: (state, unit) => unitSize(state, unit) === 3,
  effects: (r) => ({
    speedBonus: r.warlordSpeedBonus,
    ...(r.warlordDefenseBonus ? { defenseBonus: r.warlordDefenseBonus } : {}),
    ...(r.warlordHealthBonus ? { healthBonus: r.warlordHealthBonus } : {}),
  }),
};
