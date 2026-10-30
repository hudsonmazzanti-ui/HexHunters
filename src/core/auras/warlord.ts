import type { AuraDef } from './types';

export const warlord: AuraDef = {
  describe: (r) => `All your large models, including the Warlord, get +${r.warlordSpeedBonus} movement.`,
  short: (r) => `+${r.warlordSpeedBonus} move`,
  affects: (state, unit) => state.config.units[unit.type].size === 3,
  effects: (r) => ({ speedBonus: r.warlordSpeedBonus }),
};
