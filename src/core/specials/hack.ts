/**
 * Hack (Hacker): pick an enemy within 4 the Hacker can see. No roll. At the start of
 * that model's owner's next turn its die is reduced by 2 (minimum 1), for everything
 * it does that turn. Doesn't stack: an already-hacked model isn't a valid target.
 * With the Gambler, the penalty applies when the delayed die is rolled.
 */
import { hexDistance } from '../hex';
import { canSeeUnit, unitDef } from '../queries';
import type { SpecialDef } from './types';

export const hack: SpecialDef = {
  name: 'Hack',
  describe: (r) =>
    `Hack an enemy within ${r.hackRange} you can see (no roll). On its owner's next turn its die gets -${r.hackPenalty} ` +
    '(minimum 1), for attacks and specials. Doesn\'t stack.',
  targeting: 'enemy',
  tags: ['No roll', `Doesn't stack`],
  checkChoice: (state, unit, { target }) => {
    if (target!.hacked) return 'Already hacked';
    if (unitDef(state, target!).noDie) return 'Has no die to hack';
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.hackRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  preview: (_state, _unit, { target }) => ({ area: [{ hex: target!.pos!, kind: 'impact' }], effects: [] }),
  apply: (_state, _unit, { target }) => {
    target!.hacked = true;
    return { targetId: target!.id };
  },
};

/** The die after a hack: reduced, but never below 1. */
export const hackedDie = (die: number, penalty: number): number => Math.max(1, die - penalty);
