/** Point-based army building. */
import { deployZones } from './mapgen';
import type { GameConfig } from './types';

/** Total point cost of a list of unit type ids. Unknown types count as 0 (validateArmy rejects them). */
export const armyCost = (config: GameConfig, types: string[]): number =>
  types.reduce((sum, t) => sum + (config.units[t]?.cost ?? 0), 0);

/** Why this army isn't legal, or null if it is. Duplicates are allowed. */
export function validateArmy(config: GameConfig, types: string[]): string | null {
  if (types.length === 0) return 'Add at least one unit';
  const unknown = types.find((t) => !config.units[t]);
  if (unknown) return `Unknown unit "${unknown}"`;
  const cost = armyCost(config, types);
  if (cost > config.armyPointLimit) return `Army costs ${cost} points; the limit is ${config.armyPointLimit}`;
  const room = deployZones(config.boardRadius, config.deployRows)[0].length;
  if (types.length > room) return `Too many models to deploy (max ${room})`;
  return null;
}
