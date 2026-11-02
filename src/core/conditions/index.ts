/**
 * Battlefield Conditions. Each is plain data (see ConditionDef). To add one, add its id
 * to ConditionId (types.ts), an entry here, and a weight in config.conditions.
 * Weights, not this list, decide how often each comes up.
 */
import { Rng } from '../rng';
import type { ConditionId, GameConfig, GameState, MissionId } from '../types';
import type { ConditionDef } from './types';

export * from './types';

export const CONDITIONS: Record<ConditionId, ConditionDef> = {
  clear: { id: 'clear', name: 'Clear', icon: 'sun', summary: 'No special effect.' },
  fog: { id: 'fog', name: 'Fog', icon: 'fog', summary: 'Nothing reaches a model more than 4 hexes away.', maxReach: 4 },
  mud: { id: 'mud', name: 'Mud', icon: 'mud', summary: 'Every model moves 1 slower (minimum 1).', speedDelta: -1 },
  tailwind: { id: 'tailwind', name: 'Tailwind', icon: 'wind', summary: 'Every model moves 1 faster.', speedDelta: 1 },
  bloodmoon: { id: 'bloodmoon', name: 'Blood Moon', icon: 'moon', summary: '+1 on every die.', dieDelta: 1 },
  sandstorm: { id: 'sandstorm', name: 'Sandstorm', icon: 'sand', summary: '−1 on every die (minimum 1).', dieDelta: -1 },
  bonusbones: {
    id: 'bonusbones',
    name: 'Bonus Bones',
    icon: 'skull',
    summary: 'Each army gets 2 free Skeletons, placed last.',
    freeUnits: ['skeleton', 'skeleton'],
  },
  hotdrop: {
    id: 'hotdrop',
    name: 'Hot Drop',
    icon: 'drop',
    summary: 'Both armies deploy back to back in the middle.',
    incompatibleMissions: ['ctf'],
    deployShape: 'hotdrop',
  },
  smallmap: {
    id: 'smallmap',
    name: 'Small Map',
    icon: 'small',
    summary: 'The board is 2 rings smaller.',
    radiusDelta: -2,
    excludeShapes: ['close'],
  },
  bigmap: { id: 'bigmap', name: 'Big Map', icon: 'big', summary: 'The board is 2 rings larger.', radiusDelta: 2 },
};

export const conditionOf = (state: GameState): ConditionDef => CONDITIONS[state.condition];

/**
 * This game's Condition: a weighted, seeded pick from config.conditions (its own random
 * stream). A Condition that can't go with the mission (Hot Drop + Capture the Flag) is
 * rerolled, which is the same as picking among the compatible ones by weight.
 */
export function pickCondition(config: GameConfig, seed: number, mission: MissionId): ConditionId {
  const options = (Object.entries(config.conditions) as [ConditionId, number][]).filter(
    ([id, w]) => w > 0 && CONDITIONS[id] && !CONDITIONS[id].incompatibleMissions?.includes(mission),
  );
  const total = options.reduce((n, [, w]) => n + w, 0);
  if (!total) return 'clear';
  let roll = new Rng((seed ^ 0x3c6ef372) | 0).next() * total;
  for (const [id, w] of options) {
    roll -= w;
    if (roll < 0) return id;
  }
  return options[options.length - 1][0];
}

/**
 * The config the map is built from under a Condition: board radius changed (Small / Big
 * Map) with terrain scaled to the board's area, and the smallest zone the deployment
 * shapes must give (room for the largest army plus any free models).
 */
export function mapConfig(config: GameConfig, id: ConditionId): GameConfig {
  const c = CONDITIONS[id];
  const radius = config.boardRadius + (c.radiusDelta ?? 0);
  const area = (r: number) => 3 * r * (r + 1) + 1;
  const shapes = config.deployShapes.filter((s) => !c.excludeShapes?.includes(s));
  return {
    ...config,
    boardRadius: radius,
    terrainPairs: c.radiusDelta ? (config.terrainPairs * area(radius)) / area(config.boardRadius) : config.terrainPairs,
    deployShapes: shapes.length ? shapes : config.deployShapes,
  };
}
