/**
 * All balance numbers live here. Tweak freely; no game logic needs to change.
 * To add a unit, add an entry to UNITS (stats, cost, special id). Special action
 * logic and descriptions live in src/core/specials/.
 *
 * Attacks hit when (d12 + modifiers) >= target defense, so on a plain roll:
 *   defense 5 -> 67% hit, 6 -> 58%, 7 -> 50%, 8 -> 42%.
 */
import type { GameConfig, UnitDef } from '../core/types';

export const UNITS: Record<string, UnitDef> = {
  infantry: {
    name: 'Infantry',
    label: 'I',
    cost: 3,
    size: 2, // medium
    speed: 3, // normal
    defense: 6,
    health: 6,
    range: 5,
    damage: 2,
    special: 'prep',
  },
  medic: {
    name: 'Medic',
    label: 'M',
    cost: 3,
    size: 1, // small
    speed: 3, // normal
    defense: 5,
    health: 4,
    range: 3,
    damage: 1,
    special: 'heal',
  },
  sniper: {
    name: 'Sniper',
    label: 'Sn',
    cost: 3,
    size: 1, // small
    speed: 2, // slow
    defense: 5,
    health: 4,
    range: 10,
    damage: 4,
    special: 'spot',
  },
  scout: {
    name: 'Scout',
    label: 'Sc',
    cost: 2,
    size: 1, // small
    speed: 4, // fast
    defense: 7,
    health: 3,
    range: 3,
    damage: 2,
    special: 'dash',
  },
  heavy: {
    name: 'Heavy',
    label: 'H',
    cost: 4,
    size: 3, // large
    speed: 2, // slow
    defense: 6,
    health: 12,
    range: 3,
    damage: 4,
    special: 'brace',
  },
  assassin: {
    name: 'Assassin',
    label: 'A',
    cost: 2,
    size: 1, // small
    speed: 4, // fast
    defense: 5,
    health: 3,
    range: 1, // melee only
    damage: 4,
    special: 'vault',
  },
  grenadier: {
    name: 'Grenadier',
    label: 'G',
    cost: 3,
    size: 2, // medium
    speed: 3, // normal
    defense: 6,
    health: 5,
    range: 4,
    damage: 2,
    special: 'grenade',
  },
  flamer: {
    name: 'Flamer',
    label: 'F',
    cost: 4,
    size: 2, // medium
    speed: 2, // slow
    defense: 6,
    health: 9,
    range: 3,
    damage: 3,
    special: 'torch',
  },
};

export const DEFAULT_CONFIG: GameConfig = {
  boardRadius: 7,
  terrainPairs: 3,
  terrainMinLength: 2,
  terrainMaxLength: 4,
  deployRows: 2,
  dieSides: 12,
  pointsToWin: 5,
  armyPointLimit: 16,
  units: UNITS,
  specials: {
    braceDefenseBonus: 2,
    prepRollBonus: 2,
    spotAttackBonus: 2,
    healDivisor: 2,
    dashDivisor: 3,
    grenadeMinDie: 10,
    grenadeImpactDamage: 2,
    grenadeSplashDamage: 1,
    torchLength: 2,
  },
};
