/** Read-only helpers for asking questions about a GameState. */
import { auraEffects } from './auras';
import { type Hex, ORIGIN, hexDistance, hexEquals, hexKey } from './hex';
import { isCarrier } from './flag';
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

/** The model's own defense: its stat minus permanent losses (the Behemoth's Cracking Armor). No bonuses. */
export const naturalDefense = (state: GameState, unit: Unit): number => unitDef(state, unit).defense - unit.armorCracks;

/** Defense without temporary armor (Brace): natural defense plus permanent aura bonuses (Warden). */
export const baseDefense = (state: GameState, unit: Unit): number =>
  naturalDefense(state, unit) + (auraEffects(state, unit).defenseBonus ?? 0);

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
  const viewerSize = unitSize(state, viewer);
  return hasLineOfSight(viewer.pos, target, (h) => {
    const model = unitAt(state, h);
    return blocksSight(
      {
        terrainHeight: terrainHeight(state, h),
        model: model && { size: unitSize(state, model), friendlyToViewer: model.owner === viewer.owner },
      },
      viewerSize,
      targetSize,
    );
  });
}

export function canSeeUnit(state: GameState, viewer: Unit, target: Unit): boolean {
  return !!target.pos && canSeeHex(state, viewer, target.pos, unitSize(state, target));
}

/**
 * Where can this unit move with its remaining movement? Terrain and enemy models
 * block; friendly models can be passed through but not stopped on. Flyers (Dragon)
 * pass over terrain and any models, but still must stop on an empty, open hex. A flyer
 * carrying the flag (Capture the Flag) walks instead.
 */
export function moveReach(state: GameState, unit: Unit): Reach {
  if (!unit.pos) return { costs: new Map(), prev: new Map() };
  const flying = !!unitDef(state, unit).flying && !isCarrier(state, unit);
  return reachable(
    unit.pos,
    unit.movesLeft,
    (h) => {
      if (!onBoard(state, h)) return false;
      if (flying) return true;
      if (terrainHeight(state, h) > 0) return false;
      const occupant = unitAt(state, h);
      return !occupant || occupant.owner === unit.owner;
    },
    (h) => !unitAt(state, h) && terrainHeight(state, h) === 0,
  );
}

export function movePath(state: GameState, unit: Unit, to: Hex): Hex[] | null {
  return pathTo(moveReach(state, unit), to);
}

/** Models of `player` on the control point. */
export const unitsOnControlPoint = (state: GameState, player: PlayerId): Unit[] =>
  livingUnits(state, player).filter((u) => state.map.controlPoint.some((h) => hexEquals(h, u.pos!)));

/** Is it this unit's owner's turn and may it still use its die? (A Gambler's "?" die counts.) */
export const canAct = (state: GameState, unit: Unit): boolean =>
  state.phase === 'play' &&
  unit.owner === state.current &&
  !!unit.pos &&
  !unit.acted &&
  (unit.die !== null || unit.gambling || !!unitDef(state, unit).noDie);

/** Current size (height for line of sight): a crawling Zombie is small. */
export function unitSize(state: GameState, unit: Unit): UnitDef['size'] {
  const def = unitDef(state, unit);
  return unit.crawling && def.woundedForm ? def.woundedForm.size : def.size;
}

/**
 * Hexes of movement per turn: base (crawl once a Zombie is crawling) plus hero auras
 * (Warlord). The flag carrier (Capture the Flag) is slower, minimum 1, unless an aura
 * says otherwise (Standard Bearer).
 */
export function unitSpeed(state: GameState, unit: Unit): number {
  const def = unitDef(state, unit);
  const base = unit.crawling && def.woundedForm ? def.woundedForm.speed : def.speed;
  const aura = auraEffects(state, unit);
  const speed = base + (aura.speedBonus ?? 0);
  const slowed = isCarrier(state, unit) && !aura.carriesUnslowed;
  return slowed ? Math.max(1, speed - state.config.specials.flagCarrierSlow) : speed;
}

/** Why this model can't pick up the flag right now, or null if it can (Capture the Flag). */
export function pickUpBlockedReason(state: GameState, unit: Unit): string | null {
  if (!state.flag?.pos || !unit.pos || !hexEquals(state.flag.pos, unit.pos)) return 'Not on the flag';
  if (!canAct(state, unit)) return 'This model cannot act';
  if (unit.specialUsed || unit.attacked) return 'Already acted';
  return null;
}

/** Does this unit's attack / special set Burn on what it hits? (Pyromancer's aura) */
export const burnsOn = (state: GameState, unit: Unit, action: 'attack' | 'special'): boolean =>
  (auraEffects(state, unit).burnsOn ?? []).includes(action);

/** Must this unit be loaded to fire? (Artillery, unless the Siege Master's aura applies.) */
export const needsLoading = (state: GameState, unit: Unit): boolean =>
  !!unitDef(state, unit).needsLoading && !auraEffects(state, unit).noLoading;

export const isHero = (state: GameState, unit: Unit): boolean => !!unitDef(state, unit).hero;

/** Die bonus a unit gets when it acts right now (Standard Bearer: +2 while on the control point). None without a die. */
export const actionBonus = (state: GameState, unit: Unit): number =>
  unitDef(state, unit).noDie ? 0 : (auraEffects(state, unit).actionRollBonus ?? 0);

/**
 * The die value used when the unit acts now: its rolled die (incl. Prep/Marshal) plus any
 * action bonus. For a Gambler's unrolled "?" die this is the best possible roll, which is
 * what an action must be possible with before it is rolled for real.
 */
export function actionDie(state: GameState, unit: Unit): number {
  // A hacked Gambler's best roll is the cap minus the hack.
  const die = unit.gambling ? Math.max(1, state.config.specials.gamblerMaxDie - unit.hackPenalty) : (unit.die ?? 0);
  return die + actionBonus(state, unit);
}

/** Cracking Armor badge text ("DEF 8"), shown where other models show their die; null for other units. */
export function armorLabel(state: GameState, unit: Unit): string | null {
  return unitDef(state, unit).crackingArmor ? `DEF ${naturalDefense(state, unit)}` : null;
}

/** Werewolf: how many more of its owner's turns until it transforms (null if it never will / already has). */
export function turnsUntilTransform(state: GameState, unit: Unit): number | null {
  const t = unitDef(state, unit).transformsInto;
  return t ? Math.max(0, t.onOwnerTurn - state.turnsTaken[unit.owner]) : null;
}
