/**
 * Armies the simulator plays. Edit PRESETS freely: each is a list of builder entries
 * (unit ids, or squad ids such as 'twins'). They're checked against the real army
 * rules when the simulator starts.
 */
import { addBlockedReason, armyCost, validateArmy } from '../src/core/army';
import { Rng } from '../src/core/rng';
import type { GameConfig } from '../src/core/types';

export interface ArmySpec {
  name: string;
  units: string[];
}

const times = (n: number, id: string): string[] => Array(n).fill(id);

export const PRESETS: ArmySpec[] = [
  { name: 'Firing Squad', units: ['marshal', ...times(3, 'infantry')] },
  { name: 'Undead Swarm', units: ['necromancer', ...times(2, 'zombie'), ...times(5, 'skeleton')] },
  { name: 'Ninja Dive', units: ['masterninja', ...times(4, 'assassin'), 'skeleton'] },
  { name: 'Gun Line', units: ['siegemaster', ...times(2, 'artillery'), 'zombie'] },
  { name: 'Big Guys', units: ['warlord', 'monster', 'hillgiant'] },
  { name: 'Hook Gambler', units: ['gambler', ...times(2, 'grappler')] },
  { name: 'Mercenary Mix', units: ['mercenary', 'monster', 'infantry'] },
  { name: 'Skeleton Wall', units: times(16, 'skeleton') },
  { name: 'Behemoth', units: ['behemoth', 'heavy'] },
];

/** Problems with the presets (empty if all are legal armies). */
export function checkPresets(config: GameConfig, presets: ArmySpec[] = PRESETS): string[] {
  return presets.flatMap((p) => {
    const reason = validateArmy(config, p.units);
    return reason ? [`${p.name}: ${reason}`] : [];
  });
}

/** Every buyable builder entry (units that aren't squad members or alternate forms, plus squads). */
function buyable(config: GameConfig): { heroes: string[]; units: string[] } {
  const heroes: string[] = [];
  const units: string[] = [];
  for (const [id, def] of Object.entries(config.units)) {
    if (def.squadOnly || def.formOnly) continue;
    (def.hero ? heroes : units).push(id);
  }
  for (const [id, squad] of Object.entries(config.squads)) (squad.hero ? heroes : units).push(id);
  return { heroes: heroes.sort(), units: units.sort() };
}

/**
 * A random legal army: half the time a random hero first, then random units until
 * nothing more fits (or, 15% of the time per pick, stopping early), so sizes vary.
 */
export function randomArmy(config: GameConfig, rng: Rng): ArmySpec {
  const { heroes, units } = buyable(config);
  const army: string[] = [];
  if (rng.next() < 0.5) army.push(rng.pick(heroes));
  for (;;) {
    const fits = units.filter((u) => addBlockedReason(config, army, u) === null);
    if (!fits.length) break;
    if (army.length && rng.next() < 0.15) break;
    army.push(rng.pick(fits));
  }
  if (!army.length) army.push(rng.pick(units));
  return { name: 'Random', units: army };
}

export const describeArmy = (config: GameConfig, units: string[]): string =>
  `${units.join('+')} (${armyCost(config, units)} pts)`;
