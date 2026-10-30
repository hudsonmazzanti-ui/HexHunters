import type { Hex } from './hex';

export type PlayerId = 0 | 1;

/** small = 1, medium = 2, large = 3. Also the model's height for line of sight. */
export type Size = 1 | 2 | 3;

export type TerrainHeight = 1 | 2;

export type SpecialId =
  | 'brace'
  | 'prep'
  | 'heal'
  | 'spot'
  | 'dash'
  | 'shove'
  | 'vault'
  | 'grenade'
  | 'torch'
  | 'sweep'
  | 'load'
  | 'overwatch';

export interface UnitDef {
  name: string;
  /** Army-building cost in points. Any positive integer. */
  cost: number;
  /** 1–2 letter label drawn on the model. */
  label: string;
  size: Size;
  /** Hexes per turn: crawl = 1, slow = 2, normal = 3, fast = 4 (see SPEED in config.ts). */
  speed: number;
  defense: number;
  health: number;
  range: number;
  damage: number;
  special: SpecialId;
  /** Name of the basic attack in the UI (default "Attack"). */
  attackName?: string;
  /** Added to the die on basic attacks. */
  hitBonus?: number;
  /** The basic attack can only be used while loaded (see the Load special); firing unloads. */
  needsLoading?: boolean;
  /** The basic attack ignores line of sight entirely. */
  indirectFire?: boolean;
}

export interface GameConfig {
  /** Board is a hexagon of this radius (radius 7 = 15 hexes across). */
  boardRadius: number;
  /** Mirrored terrain pairs; each pair is two pieces (so 3 pairs = 6 walls). */
  terrainPairs: number;
  terrainMinLength: number;
  terrainMaxLength: number;
  /** Rows at each player's edge where they may deploy. */
  deployRows: number;
  dieSides: number;
  pointsToWin: number;
  /** Maximum total cost of each player's army. */
  armyPointLimit: number;
  /** The first player flips every this many rounds (2: P1 first in rounds 1–2, P2 in 3–4, ...). */
  firstPlayerSwapEvery: number;
  units: Record<string, UnitDef>;
  specials: SpecialRules;
}

export interface SpecialRules {
  braceDefenseBonus: number;
  /** Added to the model's die on its next turn after using Prep. */
  prepRollBonus: number;
  spotAttackBonus: number;
  /** Heal amount = floor(die / healDivisor). */
  healDivisor: number;
  /** Dash extra hexes = floor(die / dashDivisor). */
  dashDivisor: number;
  /** Grenade needs a die of at least this. */
  grenadeMinDie: number;
  grenadeImpactDamage: number;
  grenadeSplashDamage: number;
  /** How many hexes Torch reaches. */
  torchLength: number;
  sweepDamage: number;
}

export interface Terrain {
  id: number;
  kind: 'wall' | 'curve';
  height: TerrainHeight;
  hexes: Hex[];
}

export interface GameMap {
  radius: number;
  terrain: Terrain[];
  /** hexKey -> terrain height, for fast lookup. */
  heights: Record<string, TerrainHeight>;
  controlPoint: Hex[];
  /** deployZones[player] = hexes that player may deploy on. */
  deployZones: [Hex[], Hex[]];
}

export interface Unit {
  id: string;
  type: string;
  owner: PlayerId;
  /** null while still waiting to be deployed. */
  pos: Hex | null;
  hp: number;
  /** This turn's d12 result (including any Prep bonus); null when not this unit's turn. */
  die: number | null;
  /** How much of `die` came from Prep, for display. */
  dieBonus: number;
  movesLeft: number;
  /** True once the unit has used its die (attack or special). */
  acted: boolean;
  /** Where the unit started this turn; used to undo a move. */
  turnStartPos: Hex | null;
  /** Brace bonus active until the owner's next turn starts. */
  braced: boolean;
  /** Prep used: the next roll gets a bonus. */
  prepped: boolean;
  /** Set by an enemy Sniper's Spot; the spotter's side gets a bonus on its next attack. */
  spottedBy: PlayerId | null;
  /** A shell is loaded (units with needsLoading). Persists across moves and turns until fired. */
  loaded: boolean;
  /** Sentinel overwatch: the locked die and the hexes watched (fixed when activated). */
  overwatch: Overwatch | null;
}

export interface Overwatch {
  die: number;
  hexes: Hex[];
}

export type WinReason = 'points' | 'elimination' | 'draw';

export type Phase = 'build' | 'deploy' | 'play' | 'over';

export interface GameState {
  config: GameConfig;
  seed: number;
  map: GameMap;
  units: Unit[];
  phase: Phase;
  current: PlayerId;
  round: number;
  /** 0 for the first turn of a round, 1 for the second. */
  turnInRound: 0 | 1;
  scores: [number, number];
  /** null with phase 'over' means a draw. */
  winner: PlayerId | null;
  winReason: WinReason | null;
  rngState: number;
}
