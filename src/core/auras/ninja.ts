import type { AuraDef } from './types';

export const ninja: AuraDef = {
  describe: () =>
    'Your Assassins and Scouts can use their special AND attack in the same turn, with the same die. ' +
    'Special first: attacking ends their turn.',
  short: () => 'special + attack',
  affects: (_s, unit) => unit.type === 'assassin' || unit.type === 'scout',
  effects: () => ({ doubleAction: true }),
};
