import type { AuraDef } from './types';

/** Gambler: dice aren't rolled at turn start; each model rolls d12+2 (max 14) when it confirms an action. */
export const gambler: AuraDef = {
  describe: (r) =>
    `Your dice aren't rolled at the start of your turn ("?"). A model rolls d12+${r.gamblerRollBonus} ` +
    `(max ${r.gamblerMaxDie}) when you confirm its attack or special. Miss a special's threshold and the action is wasted.`,
  short: (r) => `rolls on action, +${r.gamblerRollBonus}`,
  affects: () => true,
  effects: () => ({ rollsOnAction: true }),
};
