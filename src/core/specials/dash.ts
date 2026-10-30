import { actionDie } from '../queries';
import type { GameState } from '../types';
import type { SpecialDef } from './types';

export const dashAmount = (state: GameState, die: number) => Math.floor(die / state.config.specials.dashDivisor);

export const dash: SpecialDef = {
  name: 'Dash',
  describe: (r) => `Move extra hexes equal to die / ${r.dashDivisor} (rounded down).`,
  targeting: 'none',
  keepsMovement: true,
  usable: (state, unit) => (dashAmount(state, actionDie(state, unit)) < 1 ? 'die too low' : null),
  apply: (state, unit) => {
    const amount = dashAmount(state, actionDie(state, unit));
    unit.movesLeft += amount;
    return { amount };
  },
};
