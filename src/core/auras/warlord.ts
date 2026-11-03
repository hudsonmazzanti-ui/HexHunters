import { unitSize } from '../queries';
import type { SpecialRules } from '../types';
import type { AuraDef } from './types';

/** "+1 movement and -2 max health" (any defense change too, if set). */
const parts = (r: SpecialRules, long: boolean): string[] => {
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return [
    `${signed(r.warlordSpeedBonus)} ${long ? 'movement' : 'move'}`,
    ...(r.warlordDefenseBonus ? [`${signed(r.warlordDefenseBonus)} ${long ? 'defense' : 'def'}`] : []),
    ...(r.warlordHealthBonus ? [`${signed(r.warlordHealthBonus)} ${long ? 'max health' : 'HP'}`] : []),
  ];
};

/**
 * Warlord: large models (the Warlord included) get +1 movement and -2 max health. Like
 * every hero aura it lasts all game; the health change applies from the start (a Werewolf
 * gets it when it turns into its large beast form).
 */
export const warlord: AuraDef = {
  describe: (r) => {
    const list = parts(r, true);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
    return `All your large models, including the Warlord, get ${joined}${r.warlordHealthBonus ? ' (from the start of the game)' : ''}.`;
  },
  short: (r) => parts(r, false).join(', '),
  affects: (state, unit) => unitSize(state, unit) === 3,
  appliesToType: (unit) => unit.size === 3,
  effects: (r) => ({
    speedBonus: r.warlordSpeedBonus,
    ...(r.warlordDefenseBonus ? { defenseBonus: r.warlordDefenseBonus } : {}),
    ...(r.warlordHealthBonus ? { healthBonus: r.warlordHealthBonus } : {}),
  }),
};
