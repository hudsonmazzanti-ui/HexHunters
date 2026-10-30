import { hexEquals } from '../hex';
import type { AuraDef } from './types';

/**
 * Standard Bearer. Only models standing on the control point are affected, checked
 * live: the +2 applies when a model acts while on the point (moving on, then acting,
 * counts). Winning the point at the end of a round scores extra points.
 */
export const standard: AuraDef = {
  describe: (r) =>
    `Your models on the control point get +${r.standardRollBonus} on their die when they attack or use a special. ` +
    `Winning the control point at the end of a round scores ${r.standardHoldPoints} points instead of 1.`,
  short: (r) => `+${r.standardRollBonus} on point`,
  affects: (state, unit) => !!unit.pos && state.map.controlPoint.some((h) => hexEquals(h, unit.pos!)),
  effects: (r) => ({ actionRollBonus: r.standardRollBonus }),
  holdPoints: (r) => r.standardHoldPoints,
};
