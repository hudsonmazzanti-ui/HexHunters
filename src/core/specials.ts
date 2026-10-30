/**
 * Special actions. Each one uses the model's die for the turn (like an attack).
 * Brace, Spot and Shove always succeed; Heal and Dash scale with the die.
 * A special that would do nothing (e.g. Heal on a full-health ally, Dash for 0
 * hexes, Shove into a wall) is not allowed, so a die is never wasted by accident.
 */
import { type Hex, hexAdd, hexDistance, hexSub } from './hex';
import { canAct, canSeeUnit, onBoard, terrainHeight, unitAt, unitDef } from './queries';
import type { GameState, SpecialId, Unit } from './types';

export type SpecialTarget = 'none' | 'ally' | 'enemy';

export const SPECIAL_TARGET: Record<SpecialId, SpecialTarget> = {
  brace: 'none',
  dash: 'none',
  heal: 'ally',
  spot: 'enemy',
  shove: 'enemy',
};

export const specialOf = (state: GameState, unit: Unit): SpecialId => unitDef(state, unit).special;

export const healAmount = (state: GameState, die: number) => Math.floor(die / state.config.specials.healDivisor);

export const dashAmount = (state: GameState, die: number) => Math.floor(die / state.config.specials.dashDivisor);

/** Where a shoved target would land: one hex directly away from the shover. */
export const shoveDestination = (shover: Hex, target: Hex): Hex => hexAdd(target, hexSub(target, shover));

/** Why this special can't be used (on this target), or null if it can. */
export function specialBlockedReason(state: GameState, unit: Unit, target?: Unit): string | null {
  if (!canAct(state, unit)) return 'This model cannot act';
  const special = specialOf(state, unit);
  const die = unit.die!;
  const kind = SPECIAL_TARGET[special];

  if (kind !== 'none') {
    if (!target?.pos) return 'Choose a target';
    if (kind === 'ally' && (target.owner !== unit.owner || target.id === unit.id)) return 'Choose an ally';
    if (kind === 'enemy' && target.owner === unit.owner) return 'Choose an enemy';
  }

  switch (special) {
    case 'brace':
      return unit.braced ? 'Already braced' : null;
    case 'dash':
      return dashAmount(state, die) < 1 ? 'Die too low to dash' : null;
    case 'heal':
      if (hexDistance(unit.pos!, target!.pos!) !== 1) return 'Must be adjacent';
      if (target!.hp >= unitDef(state, target!).health) return 'Already at full health';
      return healAmount(state, die) < 1 ? 'Die too low to heal' : null;
    case 'spot':
      if (target!.spottedBy === unit.owner) return 'Already spotted';
      return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
    case 'shove': {
      if (hexDistance(unit.pos!, target!.pos!) !== 1) return 'Must be adjacent';
      const dest = shoveDestination(unit.pos!, target!.pos!);
      if (!onBoard(state, dest) || terrainHeight(state, dest) > 0 || unitAt(state, dest)) return 'Nowhere to push';
      return null;
    }
  }
}

/** All units this special could legally target right now. */
export function specialTargets(state: GameState, unit: Unit): Unit[] {
  if (SPECIAL_TARGET[specialOf(state, unit)] === 'none') return [];
  return state.units.filter((t) => t.pos && specialBlockedReason(state, unit, t) === null);
}

export interface SpecialResult {
  special: SpecialId;
  targetId?: string;
  /** Hexes healed / dashed. */
  amount?: number;
  /** For Shove: where the target moved from and to. */
  from?: Hex;
  to?: Hex;
}

/** Applies a special, mutating `state`. Throws if it isn't legal. */
export function applySpecial(state: GameState, unit: Unit, target?: Unit): SpecialResult {
  const reason = specialBlockedReason(state, unit, target);
  if (reason) throw new Error(reason);
  const special = specialOf(state, unit);
  const die = unit.die!;
  unit.acted = true;
  // Using the die ends normal movement; only Dash grants more.
  const keptMoves = unit.movesLeft;
  unit.movesLeft = 0;

  switch (special) {
    case 'brace':
      unit.braced = true;
      return { special };
    case 'dash': {
      const amount = dashAmount(state, die);
      unit.movesLeft = keptMoves + amount;
      return { special, amount };
    }
    case 'heal': {
      const max = unitDef(state, target!).health;
      const amount = Math.min(healAmount(state, die), max - target!.hp);
      target!.hp += amount;
      return { special, targetId: target!.id, amount };
    }
    case 'spot':
      target!.spottedBy = unit.owner;
      return { special, targetId: target!.id };
    case 'shove': {
      const from = target!.pos!;
      const to = shoveDestination(unit.pos!, from);
      target!.pos = to;
      return { special, targetId: target!.id, from, to };
    }
  }
}
