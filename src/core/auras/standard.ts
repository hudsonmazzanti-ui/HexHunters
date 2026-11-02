import { MISSIONS } from '../missions';
import type { AuraDef } from './types';

/**
 * Standard Bearer. Which models it boosts depends on the mission (checked live):
 *  - King of the Hill: models standing on the control point (moving on, then acting,
 *    counts). Winning the point at the end of a round scores extra points.
 *  - Capture the Flag: the model carrying the flag. It isn't slowed by the flag.
 */
export const standard: AuraDef = {
  describe: (r) =>
    `King of the Hill: your models on the control point get +${r.standardRollBonus} on their die when they attack or use a special, ` +
    `and winning the point at the end of a round scores ${r.standardHoldPoints} points instead of 1. ` +
    `Capture the Flag: your flag carrier gets +${r.standardRollBonus} and isn't slowed by the flag.`,
  short: (r) => `+${r.standardRollBonus} on point / carrying`,
  affects: (state, unit) => MISSIONS[state.mission].empowered(state, unit),
  effects: (r) => ({ actionRollBonus: r.standardRollBonus, carriesUnslowed: true }),
  holdPoints: (r) => r.standardHoldPoints,
};
