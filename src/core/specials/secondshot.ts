/**
 * Second Shot (Dual Gunner): only after the Dual Gunner has made its basic attack this
 * turn. Fires another basic attack with the same die (range 4, 2 damage, normal hit
 * roll: Spot, Standard Bearer, Brace and Pyromancer Burn all count), at the same or
 * a different enemy. The one exception to "attacking ends the turn".
 */
import { fireShot, previewAttack } from '../combat';
import type { SpecialDef } from './types';

export const secondShot: SpecialDef = {
  name: 'Second Shot',
  describe: () =>
    'Only after this turn\'s basic attack: fire another basic attack with the same die, at the same or another enemy.',
  targeting: 'enemy',
  afterAttack: true,
  tags: ['Only after attacking', 'Same die'],
  usable: (_state, unit) => (unit.attacked ? null : 'attack first'),
  checkChoice: (state, unit, { target }) => previewAttack(state, unit, target!, true).blockedReason,
  preview: (state, unit, { target }) => {
    const p = previewAttack(state, unit, target!, true);
    return {
      area: [{ hex: target!.pos!, kind: 'impact' }],
      effects: [{ unitId: target!.id, roll: p.roll + p.bonus, defense: p.defense, hit: p.hit, damage: p.hit ? p.damage : 0, killed: p.hit && target!.hp <= p.damage }],
    };
  },
  apply: (state, unit, { target }) => {
    const p = previewAttack(state, unit, target!, true);
    const r = fireShot(state, unit, target!, p);
    const burned = r.hit && !r.killed && target!.burning;
    return {
      targetId: target!.id,
      effects: [{ unitId: target!.id, roll: r.roll + r.bonus, defense: r.defense, hit: r.hit, damage: r.damage, killed: r.killed, burned }],
    };
  },
};
