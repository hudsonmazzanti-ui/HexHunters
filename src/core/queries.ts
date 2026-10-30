/** Read-only helpers for asking questions about a GameState. */
import { auraEffects } from './auras';
import { type Hex, ORIGIN, hexDistance, hexEquals, hexKey } from './hex';
import { blocksSight, hasLineOfSight } from './los';
import { type Reach, pathTo, reachable } from './pathfinding';
import type { GameState, PlayerId, Unit, UnitDef } from './types';

export const unitDef = (state: GameState, unit: Unit): UnitDef => state.config.units[unit.type];

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export const getUnit = (state: GameState, id: string): Unit | undefined => state.units.find((u) => u.id === id);

export const unitAt = (state: GameState, h: Hex): Unit | undefined =>
  state.units.find((u) => u.pos && hexEquals(u.pos, h));

export const onBoard = (state: GameState, h: Hex): boolean => hexDistance(h, ORIGIN) <= state.map.radius;

export const terrainHeight = (state: GameState, h: Hex): number => state.map.heights[hexKey(h)] ?? 0;

export const livingUnits = (state: GameState, owner: PlayerId): Unit[] =>
  state.units.filter((u) => u.owner === owner && u.pos);

/** Defense without temporary armor (Brace): base plus permanent aura bonuses (Warden). */
export const baseDefense = (state: GameState, unit: Unit): number =>
  unitDef(state, unit).defense + (auraEffects(state, unit).defenseBonus ?? 0);

/** Defense against attacks: base, aura bonuses and Brace. */
export function effectiveDefense(state: GameState, unit: Unit): number {
  const bonus = unit.braced ? state.config.specials.braceDefenseBonus : 0;
  return baseDefense(state, unit) + bonus;
}

/** Max health, including aura bonuses (Warden). */
export const maxHealth = (state: GameState, unit: Unit): number =>
  unitDef(state, unit).health + (auraEffects(state, unit).healthBonus ?? 0);

/** Basic-attack damage, including aura bonuses (Warden). */
export const attackDamage = (state: GameState, unit: Unit): number =>
  unitDef(state, unit).damage + (auraEffects(state, unit).damageBonus ?? 0);

/** May this unit attack after using its special this turn? (Master Ninja) */
export const hasDoubleAction = (state: GameState, unit: Unit): boolean => !!auraEffects(state, unit).doubleAction;

/**
 * Can `viewer` see a model of `targetSize` standing on `target`?
 * See los.ts for the full rule.
 */
export function canSeeHex(state: GameState, viewer: Unit, target: Hex, targetSize: number): boolean {
  if (!viewer.pos) return false;
  const viewerSize = unitDef(state, viewer).size;
  return hasLineOfSight(viewer.pos, target, (h) => {
    const model = unitAt(state, h);
    return blocksSight(
      {
        terrainHeight: terrainHeight(state, h),
        model: model && { size: unitDef(state, model).size, friendlyToViewer: model.owner === viewer.owner },
      },
      viewerSize,
      targetSize,
    );
  });
}

export function canSeeUnit(state: GameState, viewer: Unit, target: Unit): boolean {
  return !!target.pos && canSeeHex(state, viewer, target.pos, unitDef(state, target).size);
}

/**
 * Where can this unit move with its remaining movement? Terrain and enemy models
 * block; friendly models can be passed through but not stopped on.
 */
export function moveReach(state: GameState, unit: Unit): Reach {
  if (!unit.pos) return { costs: new Map(), prev: new Map() };
  return reachable(
    unit.pos,
    unit.movesLeft,
    (h) => {
      if (!onBoard(state, h) || terrainHeight(state, h) > 0) return false;
      const occupant = unitAt(state, h);
      return !occupant || occupant.owner === unit.owner;
    },
    (h) => !unitAt(state, h),
  );
}

export function movePath(state: GameState, unit: Unit, to: Hex): Hex[] | null {
  return pathTo(moveReach(state, unit), to);
}

/** Models of `player` on the control point. */
export const unitsOnControlPoint = (state: GameState, player: PlayerId): Unit[] =>
  livingUnits(state, player).filter((u) => state.map.controlPoint.some((h) => hexEquals(h, u.pos!)));

/** Is it this unit's owner's turn and may it still use its die? */
export const canAct = (state: GameState, unit: Unit): boolean =>
  state.phase === 'play' && unit.owner === state.current && !!unit.pos && !unit.acted && unit.die !== null;

/** Hexes of movement per turn, including hero auras (Warlord). */
export const unitSpeed = (state: GameState, unit: Unit): number =>
  unitDef(state, unit).speed + (auraEffects(state, unit).speedBonus ?? 0);

/** Must this unit be loaded to fire? (Artillery, unless the Siege Master's aura applies.) */
export const needsLoading = (state: GameState, unit: Unit): boolean =>
  !!unitDef(state, unit).needsLoading && !auraEffects(state, unit).noLoading;

export const isHero = (state: GameState, unit: Unit): boolean => !!unitDef(state, unit).hero;
