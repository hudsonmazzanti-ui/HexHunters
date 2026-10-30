/**
 * All balance numbers live here. Tweak freely; no game logic needs to change.
 *
 * Attacks hit when (d12 + modifiers) >= target defense, so on a plain roll:
 *   defense 6 -> 58% hit, 7 -> 50%, 8 -> 42%, 9 -> 33%.
 */
import type { GameConfig, SpecialId, UnitDef } from '../core/types';

export const UNITS: Record<string, UnitDef> = {
  infantry: {
    name: 'Infantry',
    label: 'I',
    size: 2, // medium
    speed: 3, // normal
    defense: 7,
    health: 6,
    range: 5,
    damage: 2,
    special: 'brace',
  },
  medic: {
    name: 'Medic',
    label: 'M',
    size: 1, // small
    speed: 3, // normal
    defense: 6,
    health: 4,
    range: 3,
    damage: 1,
    special: 'heal',
  },
  sniper: {
    name: 'Sniper',
    label: 'Sn',
    size: 1, // small
    speed: 2, // slow
    defense: 6,
    health: 4,
    range: 10,
    damage: 4,
    special: 'spot',
  },
  scout: {
    name: 'Scout',
    label: 'Sc',
    size: 1, // small
    speed: 4, // fast
    defense: 8,
    health: 3,
    range: 3,
    damage: 2,
    special: 'dash',
  },
  heavy: {
    name: 'Heavy',
    label: 'H',
    size: 3, // large
    speed: 2, // slow
    defense: 6,
    health: 12,
    range: 3,
    damage: 4,
    special: 'shove',
  },
};

export const SPECIAL_INFO: Record<SpecialId, { name: string; text: string }> = {
  brace: { name: 'Brace', text: '+2 defense until your next turn.' },
  heal: { name: 'Heal', text: 'Heal an adjacent ally for half the die (rounded down).' },
  spot: { name: 'Spot', text: 'Mark a visible enemy: your next attack on it gets +2.' },
  dash: { name: 'Dash', text: 'Move extra hexes equal to die / 3 (rounded down).' },
  shove: { name: 'Shove', text: 'Push an adjacent enemy 1 hex directly away.' },
};

export const DEFAULT_CONFIG: GameConfig = {
  boardRadius: 7,
  terrainPairs: 3,
  terrainMinLength: 2,
  terrainMaxLength: 4,
  deployRows: 2,
  dieSides: 12,
  pointsToWin: 5,
  army: ['infantry', 'infantry', 'medic', 'sniper', 'scout', 'heavy'],
  units: UNITS,
  specials: {
    braceDefenseBonus: 2,
    spotAttackBonus: 2,
    healDivisor: 2,
    dashDivisor: 3,
  },
};
