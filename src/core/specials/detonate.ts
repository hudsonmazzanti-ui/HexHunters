/**
 * Detonate (Bomber): the Bomber blows itself up. Every model next to it, friend or foe,
 * takes damage; the Bomber is destroyed. No roll. Needs at least one adjacent model.
 */
import { dealDamage } from '../combat';
import { neighbors } from '../hex';
import { unitAt } from '../queries';
import type { GameState, Unit } from '../types';
import type { Effect, SpecialDef } from './types';

const blast = (state: GameState, unit: Unit): Effect[] =>
  neighbors(unit.pos!)
    .map((h) => unitAt(state, h))
    .filter((u): u is Unit => !!u)
    .map((u) => ({ unitId: u.id, damage: state.config.specials.detonateDamage, killed: u.hp <= state.config.specials.detonateDamage }));

export const detonate: SpecialDef = {
  name: 'Detonate',
  describe: (r) => `Blow up: every model next to the Bomber takes ${r.detonateDamage} damage (friendly fire!). The Bomber is destroyed. No roll.`,
  targeting: 'none',
  tags: ['No roll', 'Friendly fire', 'Destroys itself'],
  usable: (state, unit) => (blast(state, unit).length ? null : 'no model adjacent'),
  preview: (state, unit) => ({
    area: [{ hex: unit.pos!, kind: 'impact' }, ...neighbors(unit.pos!).map((hex) => ({ hex, kind: 'splash' as const }))],
    effects: [...blast(state, unit), { unitId: unit.id, damage: unit.hp, killed: true }],
  }),
  apply: (state, unit) => {
    const effects = blast(state, unit);
    for (const e of effects) {
      const u = state.units.find((x) => x.id === e.unitId);
      if (u) e.killed = dealDamage(state, u, e.damage);
    }
    dealDamage(state, unit, unit.hp); // the Bomber goes with it
    return { hex: unit.pos!, effects };
  },
};
