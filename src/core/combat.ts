/** Attack resolution. An attack hits if die + modifiers >= the target's defense. */
import { hexDistance } from './hex';
import {
  actionBonus,
  attackDamage,
  burnsOn,
  canAct,
  canSeeUnit,
  effectiveDefense,
  maxHealth,
  needsLoading,
  unitDef,
  unitSpeed,
} from './queries';
import { auraEffects } from './auras';
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

/**
 * `secondShot`: the Dual Gunner's Second Shot, a repeat of the basic attack after it was
 * already used this turn (otherwise a model that has attacked can't attack again).
 */
export function previewAttack(state: GameState, attacker: Unit, target: Unit, secondShot = false): AttackPreview {
  const def = unitDef(state, attacker);
  const roll = attacker.die ?? 0;
  const hitBonus = def.hitBonus ?? 0;
  // A model without a die (Behemoth) always hits, so Spot doesn't help it (and isn't used up).
  const spotBonus = target.spottedBy === attacker.owner && !def.noDie ? state.config.specials.spotAttackBonus : 0;
  const pointBonus = actionBonus(state, attacker);
  const bonus = hitBonus + spotBonus + pointBonus;
  const defense = effectiveDefense(state, target);

  let blockedReason: string | null = null;
  if (!canAct(state, attacker)) blockedReason = 'This model cannot act';
  else if (attacker.attacked && !secondShot) blockedReason = 'Already attacked';
  else if (needsLoading(state, attacker) && !attacker.loaded) blockedReason = 'Not loaded';
  else if (!target.pos || target.owner === attacker.owner) blockedReason = 'Not an enemy';
  else if (hexDistance(attacker.pos!, target.pos) > def.range) blockedReason = 'Out of range';
  else if (!def.indirectFire && !canSeeUnit(state, attacker, target)) blockedReason = 'No line of sight';

  const hit = !!def.noDie || roll + bonus >= defense;
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
  // The Dual Gunner's Second Shot is the exception: game.ts re-opens the turn for it.
  attacker.acted = true;
  attacker.attacked = true;
  attacker.movesLeft = 0;
  // Firing uses the shell (with the Siege Master's aura, no shell is needed or used).
  if (needsLoading(state, attacker)) attacker.loaded = false;
  return fireShot(state, attacker, target, p);
}

/** Resolves a validated shot: Spot is used up, damage, Burn (Pyromancer). Shared with Second Shot. */
export function fireShot(state: GameState, attacker: Unit, target: Unit, p: AttackPreview): AttackResult {
  // Spot is used up by the attack, hit or miss.
  if (p.spotBonus > 0) target.spottedBy = null;
  const killed = p.hit && dealDamage(state, target, p.damage);
  if (p.hit && !killed && burnsOn(state, attacker, 'attack')) target.burning = true;
  return { roll: p.roll, bonus: p.bonus, defense: p.defense, hit: p.hit, damage: p.hit ? p.damage : 0, killed };
}

/**
 * Applies damage, removing the model at 0 health. Returns true if it was killed.
 * Every source of damage goes through here, so on-damage rules live here too: the
 * first damage a Zombie survives turns it into a crawler for good.
 */
export function dealDamage(state: GameState, target: Unit, amount: number, opts: { burn?: boolean } = {}): boolean {
  // Remembered for Cracking Armor (applied once per action when it finishes). Burn isn't a hit.
  if (amount > 0 && !opts.burn && !state.struck.includes(target.id)) state.struck.push(target.id);
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp <= 0) {
    state.units = state.units.filter((u) => u.id !== target.id);
    // Remembered for Raise Dead (processed once the current action is over).
    if (target.pos) state.deaths.push({ owner: target.owner, pos: target.pos });
    return true;
  }
  const def = unitDef(state, target);
  if (amount > 0 && def.woundedForm && !target.crawling) {
    // With the Necromancer, Zombies only crawl at half health or less.
    const halfOnly = auraEffects(state, target).crawlAtHalf;
    if (!halfOnly || target.hp <= maxHealth(state, target) / 2) {
      target.crawling = true;
      target.movesLeft = Math.min(target.movesLeft, unitSpeed(state, target));
    }
  }
  return false;
}
