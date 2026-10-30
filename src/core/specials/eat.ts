/**
 * Eat (Zombie): needs a die of 8+. Bite an adjacent enemy with a normal hit roll
 * (die + Spot / Standard Bearer bonuses vs defense, Brace counts). On a hit it deals
 * damage and the Zombie heals, up to its max health.
 */
import { dealDamage } from '../combat';
import { hexDistance } from '../hex';
import { actionDie, effectiveDefense, maxHealth } from '../queries';
import type { GameState, Unit } from '../types';
import type { SpecialDef, SpecialPreview } from './types';

function bite(state: GameState, unit: Unit, target: Unit): SpecialPreview & { heal: number; spot: number } {
  const r = state.config.specials;
  const spot = target.spottedBy === unit.owner ? r.spotAttackBonus : 0;
  const roll = actionDie(state, unit) + spot;
  const defense = effectiveDefense(state, target);
  const hit = roll >= defense;
  const damage = hit ? r.eatDamage : 0;
  const heal = hit ? Math.min(r.eatHeal, maxHealth(state, unit) - unit.hp) : 0;
  return {
    area: [],
    effects: [{ unitId: target.id, roll, defense, hit, damage, killed: hit && target.hp <= damage }],
    heal,
    spot,
  };
}

/** Health the Zombie would regain from eating this target (0 on a miss). */
export const eatHeal = (state: GameState, unit: Unit, target: Unit): number => bite(state, unit, target).heal;

export const eat: SpecialDef = {
  name: 'Eat',
  describe: (r) =>
    `Needs a die of ${r.eatMinDie}+. Bite an adjacent enemy with a normal hit roll: on a hit it takes ` +
    `${r.eatDamage} damage and the Zombie heals ${r.eatHeal}.`,
  targeting: 'enemy',
  tags: ['Needs die 8+', 'Heals on a hit'],
  usable: (state, unit) => {
    const min = state.config.specials.eatMinDie;
    return actionDie(state, unit) < min ? `needs ${min}+` : null;
  },
  checkChoice: (_s, unit, { target }) => (hexDistance(unit.pos!, target!.pos!) === 1 ? null : 'Must be adjacent'),
  preview: (state, unit, { target }) => bite(state, unit, target!),
  apply: (state, unit, { target }) => {
    const { effects, heal, spot } = bite(state, unit, target!);
    if (spot) target!.spottedBy = null; // Spot is used up, hit or miss
    const e = effects[0];
    if (e.hit) {
      e.killed = dealDamage(state, target!, e.damage);
      unit.hp += heal;
    }
    return { targetId: target!.id, amount: heal, effects };
  },
};
