import { hexDistance } from '../hex';
import { maxHealth } from '../queries';
import type { GameState } from '../types';
import type { SpecialDef } from './types';

export const healAmount = (state: GameState, die: number) => Math.floor(die / state.config.specials.healDivisor);

export const heal: SpecialDef = {
  name: 'Heal',
  describe: (r) => `Heal an adjacent ally for die / ${r.healDivisor} (rounded down).`,
  targeting: 'ally',
  usable: (state, unit) => (healAmount(state, unit.die!) < 1 ? 'die too low' : null),
  checkChoice: (state, unit, { target }) => {
    if (hexDistance(unit.pos!, target!.pos!) !== 1) return 'Must be adjacent';
    if (target!.hp >= maxHealth(state, target!)) return 'Already at full health';
    return null;
  },
  apply: (state, unit, { target }) => {
    const max = maxHealth(state, target!);
    const amount = Math.min(healAmount(state, unit.die!), max - target!.hp);
    target!.hp += amount;
    return { targetId: target!.id, amount };
  },
};
