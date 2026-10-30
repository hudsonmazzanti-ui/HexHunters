/** Attack resolution. An attack hits if die + modifiers >= the target's defense. */
import { hexDistance } from './hex';
import { actionBonus, attackDamage, canAct, canSeeUnit, effectiveDefense, needsLoading, unitDef } from './queries';
import type { GameState, Unit } from './types';

export interface AttackPreview {
  /** Why the attack isn't allowed, or null if it is. */
  blockedReason: string | null;
  roll: number;
  /** Total modifiers: hitBonus + Spot bonus + action bonus (Standard Bearer). */
  bonus: number;
  hitBonus: number;
  spotBonus: number;
  /** Standard Bearer: +2 while the attacker stands on the control point. */
  pointBonus: number;
  defense: number;
  hit: boolean;
  damage: number;
}

export function previewAttack(state: GameState, attacker: Unit, target: Unit): AttackPreview {
  const def = unitDef(state, attacker);
  const roll = attacker.die ?? 0;
  const hitBonus = def.hitBonus ?? 0;
  const spotBonus = target.spottedBy === attacker.owner ? state.config.specials.spotAttackBonus : 0;
  const pointBonus = actionBonus(state, attacker);
  const bonus = hitBonus + spotBonus + pointBonus;
  const defense = effectiveDefense(state, target);

  let blockedReason: string | null = null;
  if (!canAct(state, attacker)) blockedReason = 'This model cannot act';
  else if (needsLoading(state, attacker) && !attacker.loaded) blockedReason = 'Not loaded';
  else if (!target.pos || target.owner === attacker.owner) blockedReason = 'Not an enemy';
  else if (hexDistance(attacker.pos!, target.pos) > def.range) blockedReason = 'Out of range';
  else if (!def.indirectFire && !canSeeUnit(state, attacker, target)) blockedReason = 'No line of sight';

  const hit = roll + bonus >= defense;
  return { blockedReason, roll, bonus, hitBonus, spotBonus, pointBonus, defense, hit, damage: attackDamage(state, attacker) };
}

export interface AttackResult {
  roll: number;
  bonus: number;
  defense: number;
  hit: boolean;
  damage: number;
  killed: boolean;
}

/** Resolves an attack, mutating `state`. Throws if the attack isn't legal. */
export function resolveAttack(state: GameState, attacker: Unit, target: Unit): AttackResult {
  const p = previewAttack(state, attacker, target);
  if (p.blockedReason) throw new Error(p.blockedReason);

  // Attacking ends the unit's turn: no more moving or specials (even with Master Ninja).
  attacker.acted = true;
  attacker.movesLeft = 0;
  // Firing uses the shell (with the Siege Master's aura, no shell is needed or used).
  if (needsLoading(state, attacker)) attacker.loaded = false;
  // Spot is used up by the attack, hit or miss.
  if (p.spotBonus > 0) target.spottedBy = null;

  const killed = p.hit && dealDamage(state, target, p.damage);
  return { roll: p.roll, bonus: p.bonus, defense: p.defense, hit: p.hit, damage: p.hit ? p.damage : 0, killed };
}

/** Applies damage, removing the model at 0 health. Returns true if it was killed. */
export function dealDamage(state: GameState, target: Unit, amount: number): boolean {
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) return false;
  state.units = state.units.filter((u) => u.id !== target.id);
  return true;
}
