/**
 * Balance variants: temporary stat overrides for the simulator. The game's real data
 * (src/data/config.ts) is never changed: each variant produces a modified copy of the
 * config that only the simulator uses.
 *
 * To test an idea, add a variant here (and, optionally, an experiment that groups it
 * with a baseline), then run:
 *
 *   npm run sim -- --variant monster-hp14 --games 2000 --seed 2026
 *   npm run sim -- --experiment monster --games 2000 --seed 2026
 *   npm run sim -- --variants baseline,monster-cost6 --games 2000 --seed 2026
 *
 * Every variant in a comparison uses the same seed, so the maps, deployment shapes and
 * dice sequences line up. Random armies are rebuilt per variant, though: if a variant
 * changes a cost, the armies that fit in 16 points change too (that's part of the effect).
 * A preset that becomes illegal under a variant (e.g. over 16 points) is left out of
 * that variant's round robin and reported as "not legal".
 */
import type { GameConfig, SpecialRules, UnitDef } from '../src/core/types';
import { DEFAULT_CONFIG } from '../src/data/config';

export interface Variant {
  /** Short label for reports, e.g. "A: Monster health 14". */
  label: string;
  description: string;
  /** Per unit id: the stats to override (anything in UnitDef). `null` removes a field. */
  units?: Record<string, { [K in keyof UnitDef]?: UnitDef[K] | null }>;
  /** Special-rule numbers to override (SpecialRules). */
  specials?: Partial<SpecialRules>;
  /**
   * Rule and map settings: anything in GameConfig except the unit tables, e.g.
   * terrainPairs (terrain amount, may be fractional), terrainTries, pointsToWin,
   * armyPointLimit, deployShapes, boardRadius.
   */
  settings?: Partial<Omit<GameConfig, 'units' | 'squads' | 'specials'>>;
  /** Computed changes applied last, for rules like "every large model gets -1 speed". Mutates the copy. */
  modify?: (config: GameConfig) => void;
}

/** Every large (size 3) model, including alternate forms and squad members, loses 1 speed (minimum 1). */
const slowLarge = (config: GameConfig) => {
  for (const def of Object.values(config.units)) if (def.size === 3) def.speed = Math.max(1, def.speed - 1);
};

export const VARIANTS: Record<string, Variant> = {
  baseline: { label: 'Baseline', description: 'The current game data, unchanged.' },

  // ---- Monster experiment (run before the rebalance; health 14 and no +1 to hit are now
  // the real values, so the first three are no-ops against today's data) ----
  'monster-hp14': {
    label: 'A: Monster health 14',
    description: 'Monster health 18 → 14.',
    units: { monster: { health: 14 } },
  },
  'monster-no-hit': {
    label: 'B: Monster no +1 to hit',
    description: 'Monster loses its +1 to hit on basic attacks.',
    units: { monster: { hitBonus: null } },
  },
  'monster-hp14-no-hit': {
    label: 'C: Monster health 14, no +1 to hit',
    description: 'Monster health 18 → 14 and no +1 to hit.',
    units: { monster: { health: 14, hitBonus: null } },
  },
  'monster-cost6': {
    label: 'D: Monster cost 6',
    description: 'Monster costs 6 points instead of 5; stats unchanged.',
    units: { monster: { cost: 6 } },
  },

  // ---- Terrain experiment: 3 mirrored pairs (6 pieces) today ----
  'terrain-150': {
    label: 'Terrain +50%',
    description: '4.5 terrain pairs per map on average (about 9 pieces instead of 6), 400 placement tries.',
    settings: { terrainPairs: 4.5, terrainTries: 400 },
  },
  'terrain-200': {
    label: 'Terrain +100%',
    description: '6 terrain pairs per map (about 11.7 pieces placed instead of 6), 400 placement tries.',
    settings: { terrainPairs: 6, terrainTries: 400 },
  },

  // ---- Pacing experiment ----
  'slow-large': {
    label: 'Slow-Large',
    description: 'Every large (size 3) model gets -1 speed (minimum 1); the Warlord\'s +1 still applies on top.',
    modify: slowLarge,
  },
  'slow-large-tall': {
    label: 'Slow-Large + Tall Walls',
    description: 'Slow-Large, plus 60% of terrain pieces are height 2 (today: 50%), same terrain amount.',
    settings: { terrainTallShare: 0.6 },
    modify: slowLarge,
  },
};

/** Every hero entry (hero units and hero squads such as the Twins). */
const allHeroes = (): string[] => [
  ...Object.entries(DEFAULT_CONFIG.units)
    .filter(([, d]) => d.hero && !d.squadOnly)
    .map(([id]) => id),
  ...Object.entries(DEFAULT_CONFIG.squads)
    .filter(([, s]) => s.hero)
    .map(([id]) => id),
];

/**
 * Named groups of variants to compare side by side, and what to highlight in the
 * comparison: unit/hero ids (score when included in random armies) and preset names.
 */
export interface Experiment {
  title: string;
  variants: string[];
  focusUnits: string[];
  /** Presets to call out (every preset is always shown). */
  focusPresets: string[];
}

export const EXPERIMENTS: Record<string, Experiment> = {
  monster: {
    title: 'Monster balance',
    variants: ['baseline', 'monster-hp14', 'monster-no-hit', 'monster-hp14-no-hit', 'monster-cost6'],
    focusUnits: ['monster', 'warlord'],
    focusPresets: ['Big Guys', 'Mercenary Mix'],
  },
  terrain: {
    title: 'Terrain amount',
    variants: ['baseline', 'terrain-150', 'terrain-200'],
    focusUnits: ['monster', 'heavy', 'hillgiant', 'werewolf', 'dragon', 'behemoth', 'sniper', 'artillery', 'infantry', 'dualgunner', 'assassin'],
    focusPresets: [],
  },
  pacing: {
    title: 'Pacing: slower large models and taller walls',
    variants: ['baseline', 'slow-large', 'slow-large-tall'],
    focusUnits: [
      'monster', 'heavy', 'hillgiant', 'werewolf', 'dragon', 'grappler', 'sniper', 'artillery', 'infantry', 'dualgunner', 'assassin',
      ...allHeroes(),
    ],
    focusPresets: [],
  },
};

/** A copy of `base` with the variant's overrides applied. Never modifies `base`. */
export function applyVariant(base: GameConfig, variant: Variant): GameConfig {
  const config: GameConfig = structuredClone(base);
  for (const [id, patch] of Object.entries(variant.units ?? {})) {
    const def = config.units[id] as unknown as Record<string, unknown> | undefined;
    if (!def) throw new Error(`Variant "${variant.label}": unknown unit "${id}"`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete def[key];
      else def[key] = value;
    }
  }
  for (const [key, value] of Object.entries(variant.specials ?? {})) {
    if (!(key in config.specials)) throw new Error(`Variant "${variant.label}": unknown special rule "${key}"`);
    (config.specials as unknown as Record<string, unknown>)[key] = value;
  }
  for (const key of Object.keys(variant.settings ?? {})) {
    if (!(key in config) && key !== 'terrainTries' && key !== 'terrainTallShare') throw new Error(`Variant "${variant.label}": unknown setting "${key}"`);
  }
  Object.assign(config, variant.settings ?? {});
  variant.modify?.(config);
  return config;
}

/** The config for a variant id (throws on an unknown id). */
export function variantConfig(id: string, base: GameConfig = DEFAULT_CONFIG): GameConfig {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`Unknown variant "${id}". Known: ${Object.keys(VARIANTS).join(', ')}`);
  return applyVariant(base, variant);
}
