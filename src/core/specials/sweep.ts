/**
 * Sweep: the Monster compares this turn's die against the defense of EVERY adjacent
 * enemy separately; each one it beats takes damage. Enemies only. Brace counts;
 * Spot and the Monster's +1 to hit (basic attack only) don't apply.
 */
import { dealDamage } from '../combat';
import { neighbors } from '../hex';
import { actionDie, effectiveDefense, onBoard, unitAt } from '../queries';
import type { GameState, Unit } from '../types';
import type { Effect, SpecialDef, SpecialPreview } from './types';

const adjacentEnemies = (state: GameState, unit: Unit): Unit[] =>
  neighbors(unit.pos!)
    .map((h) => unitAt(state, h))
    .filter((u): u is Unit => !!u && u.owner !== unit.owner);

function swing(state: GameState, unit: Unit): SpecialPreview {
  const roll = actionDie(state, unit);
  const damage = state.config.specials.sweepDamage;
  const effects: Effect[] = adjacentEnemies(state, unit).map((target) => {
    const defense = effectiveDefense(state, target);
    const hit = roll >= defense;
    return { unitId: target.id, roll, defense, hit, damage: hit ? damage : 0, killed: hit && target.hp <= damage };
  });
  const area = neighbors(unit.pos!)
    .filter((h) => onBoard(state, h))
    .map((hex) => ({ hex, kind: 'splash' as const }));
  return { area, effects };
}

export const sweep: SpecialDef = {
  name: 'Sweep',
  describe: (r) =>
    `Compare this turn's die against EACH adjacent enemy's defense; every one it beats takes ${r.sweepDamage} damage.`,
  targeting: 'none',
  tags: ['Enemies only', 'One die, many targets'],
  usable: (state, unit) => (adjacentEnemies(state, unit).length ? null : 'no adjacent enemies'),
  preview: (state, unit) => swing(state, unit),
  apply: (state, unit) => {
    const { effects } = swing(state, unit);
    for (const e of effects) {
      if (!e.hit) continue;
      const target = state.units.find((u) => u.id === e.unitId)!;
      e.killed = dealDamage(state, target, e.damage);
    }
    return { effects };
  },
};
