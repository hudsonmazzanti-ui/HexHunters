/**
 * All balance numbers live here. Tweak freely; no game logic needs to change.
 * To add a unit, add an entry to UNITS (stats, cost, special id). Special action
 * logic and descriptions live in src/core/specials/. A hero has `hero: { aura }`
 * instead of a special; aura rules live in src/core/auras/.
 *
 * Attacks hit when (d12 + modifiers) >= target defense, so on a plain roll:
 *   defense 5 -> 67% hit, 6 -> 58%, 7 -> 50%, 8 -> 42%.
 */
import type { AuraId, GameConfig, UnitDef } from '../core/types';

/** Named movement speeds, in hexes per turn. */
export const SPEED = { crawl: 1, slow: 2, normal: 3, fast: 4 } as const;

/** "crawl", "slow"... for a speed value, or '' if it isn't one of the named speeds. */
export const speedName = (speed: number): string =>
  (Object.keys(SPEED) as (keyof typeof SPEED)[]).find((k) => SPEED[k] === speed) ?? '';

export const UNITS: Record<string, UnitDef> = {
  infantry: {
    name: 'Infantry',
    label: 'I',
    cost: 3,
    size: 2, // medium
    speed: SPEED.normal,
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
    speed: SPEED.normal,
    defense: 5,
    health: 4,
    range: 3,
    damage: 1,
    special: 'heal',
  },
  sniper: {
    name: 'Sniper',
    label: 'Sn',
    cost: 4,
    size: 1, // small
    speed: SPEED.slow,
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
    speed: SPEED.fast,
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
    speed: SPEED.slow,
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
    speed: SPEED.fast,
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
    speed: SPEED.normal,
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
    speed: SPEED.slow,
    defense: 6,
    health: 9,
    range: 3,
    damage: 3,
    special: 'torch',
  },
  monster: {
    name: 'Monster',
    label: 'Mo',
    cost: 5,
    size: 3, // large
    speed: SPEED.normal,
    defense: 3,
    health: 18,
    range: 1, // melee only
    damage: 5,
    hitBonus: 1,
    special: 'sweep',
  },
  artillery: {
    name: 'Artillery',
    label: 'Ar',
    cost: 3,
    size: 2, // medium
    speed: SPEED.crawl,
    defense: 4,
    health: 8,
    range: 10,
    damage: 4,
    attackName: 'Fire',
    needsLoading: true,
    indirectFire: true,
    special: 'load',
  },
  sentinel: {
    name: 'Sentinel',
    label: 'Se',
    cost: 3,
    size: 2, // medium
    speed: SPEED.slow,
    defense: 6,
    health: 8,
    range: 3,
    damage: 2,
    special: 'overwatch',
  },
  grappler: {
    name: 'Grappler',
    label: 'Gr',
    cost: 5,
    size: 3, // large
    speed: SPEED.slow,
    defense: 7,
    health: 12,
    range: 1, // melee only
    damage: 3,
    special: 'hook',
  },

  // ---- Heroes: max one per army, no special; grant a permanent army-wide aura ----
  marshal: {
    name: 'Field Marshal',
    label: 'FM',
    cost: 7,
    size: 2, // medium
    speed: SPEED.normal,
    defense: 6,
    health: 9,
    range: 4,
    damage: 3,
    hero: { aura: 'marshal' },
  },
  siegemaster: {
    name: 'Siege Master',
    label: 'SM',
    cost: 8,
    size: 2, // medium
    speed: SPEED.slow,
    defense: 5,
    health: 8,
    range: 4,
    damage: 2,
    indirectFire: true,
    hero: { aura: 'siege' },
  },
  warlord: {
    name: 'Warlord',
    label: 'WL',
    cost: 6,
    size: 3, // large
    speed: SPEED.normal,
    defense: 6,
    health: 12,
    range: 1, // melee only
    damage: 4,
    hero: { aura: 'warlord' },
  },
  warden: {
    name: 'Warden',
    label: 'Wd',
    cost: 6,
    size: 2, // medium
    speed: SPEED.normal,
    defense: 6,
    health: 10,
    range: 4,
    damage: 3,
    hero: { aura: 'warden' },
  },
  masterninja: {
    name: 'Master Ninja',
    label: 'MN',
    cost: 7,
    size: 1, // small
    speed: SPEED.fast,
    defense: 5,
    health: 7,
    range: 1, // melee only
    damage: 4,
    hero: { aura: 'ninja' },
  },
  standardbearer: {
    name: 'Standard Bearer',
    label: 'SB',
    cost: 6,
    size: 2, // medium
    speed: SPEED.normal,
    defense: 6,
    health: 10,
    range: 3,
    damage: 3,
    hero: { aura: 'standard' },
  },
};

/** Display name of the hero that grants an aura (e.g. "Warlord"). */
export const heroName = (config: GameConfig, aura: AuraId): string =>
  Object.values(config.units).find((u) => u.hero?.aura === aura)?.name ?? aura;

export const DEFAULT_CONFIG: GameConfig = {
  boardRadius: 7,
  terrainPairs: 3,
  terrainMinLength: 2,
  terrainMaxLength: 4,
  deployRows: 2,
  dieSides: 12,
  pointsToWin: 5,
  armyPointLimit: 16,
  maxHeroesPerArmy: 1,
  firstPlayerSwapEvery: 2,
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
    sweepDamage: 3,
    hookMinDie: 7,
    hookRange: 3,
    hookDamage: 1,
    marshalRollBonus: 2,
    warlordSpeedBonus: 1,
    wardenDefenseBonus: 1,
    wardenMedicDamageBonus: 1,
    wardenSentinelHealthBonus: 2,
    standardRollBonus: 2,
    standardHoldPoints: 2,
  },
};
