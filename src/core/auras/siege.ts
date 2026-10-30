import type { AuraDef } from './types';

export const siege: AuraDef = {
  describe: () => "Your Artillery never needs to Load: Fire is always available.",
  short: () => 'no Load',
  affects: (state, unit) => !!state.config.units[unit.type].needsLoading,
  effects: () => ({ noLoading: true }),
};
