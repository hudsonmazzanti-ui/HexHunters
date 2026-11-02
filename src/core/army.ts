/** Point-based army building. An army is a list of builder entries: unit ids or squad ids. */
import { shapeZones } from './mapgen';
import type { GameConfig } from './types';

const entryCost = (config: GameConfig, t: string): number => config.squads[t]?.cost ?? config.units[t]?.cost ?? 0;

/** Unit type ids of every model an entry adds (a squad adds all its members). */
export const entryModels = (config: GameConfig, t: string): string[] => config.squads[t]?.members ?? [t];

const isHeroEntry = (config: GameConfig, t: string): boolean =>
  config.squads[t] ? !!config.squads[t].hero : !!config.units[t]?.hero;

/** Display name of a builder entry. */
export const entryName = (config: GameConfig, t: string): string => config.squads[t]?.name ?? config.units[t]?.name ?? t;

/** Total point cost of an army list. Unknown entries count as 0 (validateArmy rejects them). */
export const armyCost = (config: GameConfig, types: string[]): number =>
  types.reduce((sum, t) => sum + entryCost(config, t), 0);

/** Why this army isn't legal, or null if it is. Duplicates are allowed. */
export function validateArmy(config: GameConfig, types: string[]): string | null {
  if (types.length === 0) return 'Add at least one unit';
  const unknown = types.find((t) => !config.units[t] && !config.squads[t]);
  if (unknown) return `Unknown unit "${unknown}"`;
  const form = types.find((t) => config.units[t]?.formOnly);
  if (form) return `${config.units[form].name} can't be bought: another unit turns into it`;
  const loose = types.find((t) => config.units[t]?.squadOnly);
  if (loose) return `${config.units[loose].name} only comes with ${entryName(config, config.units[loose].squadOnly!)}`;
  const cost = armyCost(config, types);
  if (cost > config.armyPointLimit) return `Army costs ${cost} points; the limit is ${config.armyPointLimit}`;
  const heroes = types.filter((t) => isHeroEntry(config, t)).length;
  if (heroes > config.maxHeroesPerArmy) {
    const max = config.maxHeroesPerArmy;
    return `Only ${max === 1 ? 'one hero' : `${max} heroes`} per army (you have ${heroes})`;
  }
  const models = types.reduce((n, t) => n + entryModels(config, t).length, 0);
  // The deployment shape isn't known yet: the army must fit the smallest one.
  const room = Math.min(...config.deployShapes.map((id) => shapeZones(config, id)[0].length));
  if (models > room) return `Too many models to deploy (max ${room})`;
  return null;
}

/**
 * Why one more of `entry` can't be added to `army` (over the point limit, hero limit...),
 * or null if it can. The builder lists addable entries first.
 */
export function addBlockedReason(config: GameConfig, army: string[], entry: string): string | null {
  const reason = validateArmy(config, [...army, entry]);
  if (!reason) return null;
  const left = config.armyPointLimit - armyCost(config, army);
  if (entryCost(config, entry) > left) return `Needs ${entryCost(config, entry) - left} more pt${entryCost(config, entry) - left === 1 ? '' : 's'}`;
  if (isHeroEntry(config, entry) && army.filter((t) => isHeroEntry(config, t)).length >= config.maxHeroesPerArmy) {
    return config.maxHeroesPerArmy === 1 ? 'You already have a hero' : 'Hero limit reached';
  }
  return reason;
}

/** How many uses a limited special gets (Mercenary's Premium Shot): unspent points, capped. */
export function specialUsesFor(config: GameConfig, army: string[], unitType: string): number | null {
  const uses = config.units[unitType]?.specialUses;
  if (!uses) return null;
  return Math.max(0, Math.min(uses.max, config.armyPointLimit - armyCost(config, army)));
}

/** Range-type settings of specials, checked against maxRange. */
const SPECIAL_RANGES = ['hookRange', 'hackRange', 'hurlRange', 'spotRange', 'premiumRange'] as const;

/**
 * Checks the unit data: no attack or special may reach farther than `maxRange`.
 * Returns the problems found (empty if the config is fine).
 */
export function validateConfig(config: GameConfig): string[] {
  const problems: string[] = [];
  for (const [id, def] of Object.entries(config.units)) {
    if (def.range > config.maxRange) problems.push(`${id}: range ${def.range} is above the cap of ${config.maxRange}`);
  }
  for (const key of SPECIAL_RANGES) {
    const value = config.specials[key];
    if (value > config.maxRange) problems.push(`specials.${key}: ${value} is above the cap of ${config.maxRange}`);
  }
  return problems;
}
