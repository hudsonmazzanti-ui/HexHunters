/**
 * Hack (Hacker): pick an enemy within 4 the Hacker can see. No roll. At the start of
 * that model's owner's next turn its die is reduced by 2 (minimum 1), for everything
 * it does that turn. Doesn't stack: an already-hacked model isn't a valid target.
 * With the Gambler, the penalty applies when the delayed die is rolled.
 *
 * Capture the Flag: hacking the flag carrier makes it drop the flag on its hex. The
 * carrier can always be hacked for that, even if it's already hacked or has no die
 * (the Behemoth); the die penalty then only applies where it normally would.
 */
import { dropFlag, isCarrier } from '../flag';
import { hexDistance } from '../hex';
import { canSeeUnit, unitDef } from '../queries';
import type { SpecialDef } from './types';

export const hack: SpecialDef = {
  name: 'Hack',
  describe: (r) =>
    `Hack an enemy within ${r.hackRange} you can see (no roll). On its owner's next turn its die gets -${r.hackPenalty} ` +
    '(minimum 1), for attacks and specials. Doesn\'t stack. Capture the Flag: a hacked carrier drops the flag.',
  targeting: 'enemy',
  tags: ['No roll', `Doesn't stack`],
  checkChoice: (state, unit, { target }) => {
    if (!isCarrier(state, target!)) {
      if (target!.hacked) return 'Already hacked';
      if (unitDef(state, target!).noDie) return 'Has no die to hack';
    }
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.hackRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  preview: (_state, _unit, { target }) => ({ area: [{ hex: target!.pos!, kind: 'impact' }], effects: [] }),
  apply: (state, unit, { target }) => {
    if (!unitDef(state, target!).noDie) target!.hacked = true;
    dropFlag(state, target!, target!.pos!, 'hacked', unit.id);
    return { targetId: target!.id };
  },
};

/** The die after a hack: reduced, but never below 1. */
export const hackedDie = (die: number, penalty: number): number => Math.max(1, die - penalty);
