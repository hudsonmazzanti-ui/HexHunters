import { DEFAULT_CONFIG } from '../src/data/config';
import { type Hex, hexKey } from '../src/core/hex';
import { controlPointHexes, deployZones } from '../src/core/mapgen';
import { maxHealth } from '../src/core/queries';
import type { GameState, PlayerId, TerrainHeight, Unit } from '../src/core/types';

/** A hand-built state in the play phase: an empty board plus whatever terrain/units a test needs. */
export function makeState(opts: { terrain?: [Hex, TerrainHeight][] } = {}): GameState {
  const config = DEFAULT_CONFIG;
  const heights: Record<string, TerrainHeight> = {};
  for (const [h, height] of opts.terrain ?? []) heights[hexKey(h)] = height;
  return {
    config,
    seed: 1,
    map: {
      radius: config.boardRadius,
      terrain: [],
      heights,
      controlPoint: controlPointHexes(),
      deployZones: deployZones(config.boardRadius, config.deployRows),
    },
    units: [],
    phase: 'play',
    current: 0,
    round: 1,
    turnInRound: 0,
    scores: [0, 0],
    auras: [[], []],
    winner: null,
    winReason: null,
    rngState: 42,
  };
}

let nextId = 0;

/** Adds a ready-to-act unit to the state and returns it. */
export function addUnit(
  state: GameState,
  type: string,
  owner: PlayerId,
  pos: Hex,
  extra: Partial<Unit> = {},
): Unit {
  const def = state.config.units[type];
  const unit: Unit = {
    id: `${type}-${nextId++}`,
    type,
    owner,
    pos,
    hp: def.health,
    die: owner === state.current ? 6 : null,
    dieBonus: 0,
    movesLeft: owner === state.current ? def.speed : 0,
    acted: false,
    specialUsed: false,
    turnStartPos: pos,
    braced: false,
    prepped: false,
    spottedBy: null,
    loaded: false,
    overwatch: null,
    ...extra,
  };
  state.units.push(unit);
  // A hero brings its aura with it, as when an army is chosen (add heroes before the units they buff).
  if (def.hero) state.auras[owner].push(def.hero.aura);
  if (extra.hp === undefined) unit.hp = maxHealth(state, unit);
  return unit;
}
