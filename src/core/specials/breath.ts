/**
 * Breath (Dragon): like the Flamer's Torch, a line of fire 2 hexes long in one of the
 * 6 directions. The die is rolled against each model's base defense (bonuses ignored),
 * friendly fire applies and terrain stops it. Every model it hits and doesn't kill
 * starts burning, with or without a Pyromancer.
 */
import { burnLine, flames, torchLine } from './torch';
import type { SpecialDef } from './types';

export const breath: SpecialDef = {
  name: 'Breath',
  describe: (r) =>
    `Breathe fire on the next ${r.breathLength} hexes in one direction. Rolls this model's die against EACH model's ` +
    'defense there, IGNORING defense bonuses, for the Dragon\'s damage. Everything hit starts burning ' +
    `(${r.burnDamage} damage at the start of its owner's next turn). Friendly fire! Terrain stops it.`,
  targeting: 'direction',
  tags: ['Always burns', 'Ignores defense bonuses', 'Friendly fire', 'Stopped by walls'],
  checkChoice: (state, unit, { dir }) => {
    const length = state.config.specials.breathLength;
    if (torchLine(state, unit.pos!, dir!, length).length === 0) return 'Breath blocked';
    return flames(state, unit, dir!, length).effects.length ? null : 'No models in the fire';
  },
  preview: (state, unit, { dir }) => {
    const p = flames(state, unit, dir!, state.config.specials.breathLength);
    for (const e of p.effects) if (e.hit && !e.killed) e.burned = true;
    return p;
  },
  apply: (state, unit, { dir }) => {
    const { effects } = flames(state, unit, dir!, state.config.specials.breathLength);
    burnLine(state, effects, true);
    return { dir, effects };
  },
};
