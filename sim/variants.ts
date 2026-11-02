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
  /** Other top-level settings (e.g. armyPointLimit, pointsToWin). */
  settings?: Partial<Pick<GameConfig, 'armyPointLimit' | 'pointsToWin' | 'maxHeroesPerArmy' | 'boardRadius'>>;
}

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
};

/**
 * Named groups of variants to compare side by side, and what to highlight in the
 * comparison: unit/hero ids (score when included in random armies) and preset names.
 */
export interface Experiment {
  title: string;
  variants: string[];
  focusUnits: string[];
  focusPresets: string[];
}

export const EXPERIMENTS: Record<string, Experiment> = {
  monster: {
    title: 'Monster balance',
    variants: ['baseline', 'monster-hp14', 'monster-no-hit', 'monster-hp14-no-hit', 'monster-cost6'],
    focusUnits: ['monster', 'warlord'],
    focusPresets: ['Big Guys', 'Mercenary Mix'],
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
  Object.assign(config, variant.settings ?? {});
  return config;
}

/** The config for a variant id (throws on an unknown id). */
export function variantConfig(id: string, base: GameConfig = DEFAULT_CONFIG): GameConfig {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`Unknown variant "${id}". Known: ${Object.keys(VARIANTS).join(', ')}`);
  return applyVariant(base, variant);
}
