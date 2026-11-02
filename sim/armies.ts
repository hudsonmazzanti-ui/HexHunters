/**
 * Armies the simulator plays. Edit PRESETS freely: each is a list of builder entries
 * (unit ids, or squad ids such as 'twins'). They're checked against the real army
 * rules when the simulator starts.
 */
import { addBlockedReason, armyCost, validateArmy } from '../src/core/army';
import { Rng } from '../src/core/rng';
import type { GameConfig } from '../src/core/types';
import { HERO_SYNERGIES, type HeroSynergy } from './synergies';

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
 *
 * A hero with a synergy rule (sim/synergies.ts) first gets the units its rule needs (e.g.
 * the Field Marshal 2+ Infantry), and the Mercenary's army leaves 1–3 points unspent.
 * If a draw can't meet the rule (rare), the army is drawn again.
 */
export function randomArmy(config: GameConfig, rng: Rng): ArmySpec {
  const { heroes, units } = buyable(config);
  const hero = rng.next() < 0.5 ? rng.pick(heroes) : null;
  const rule: HeroSynergy = (hero && HERO_SYNERGIES[hero]) || {};
  for (let attempt = 0; ; attempt++) {
    const army = draw(config, rng, units, hero, rule);
    if (army && meetsSynergy(config, army, rule)) return { name: 'Random', units: army };
    if (attempt > 50) throw new Error(`Can't build a random army for ${hero}: check sim/synergies.ts`);
  }
}

function draw(config: GameConfig, rng: Rng, units: string[], hero: string | null, rule: HeroSynergy): string[] | null {
  const army: string[] = hero ? [hero] : [];
  const fitsIn = (u: string, budget: number) =>
    addBlockedReason(config, army, u) === null && armyCost(config, [...army, u]) <= budget;
  const limit = config.armyPointLimit;
  // Leave room for the minimum unspent points (Mercenary).
  const budget = limit - (rule.unspent?.[0] ?? 0);
  // 1. The units the hero's rule needs.
  for (let i = 0; i < (rule.units ? (rule.atLeast ?? 2) : 0); i++) {
    const options = rule.units!.filter((u) => fitsIn(u, budget));
    if (!options.length) return null;
    army.push(rng.pick(options));
  }
  // 2. Random units, as before. With an unspent maximum, keep adding until it's reached.
  const maxUnspent = rule.unspent?.[1] ?? Infinity;
  for (;;) {
    const fits = units.filter((u) => fitsIn(u, budget));
    if (!fits.length) break;
    const unspent = limit - armyCost(config, army);
    if (army.length && unspent <= maxUnspent && rng.next() < 0.15) break;
    army.push(rng.pick(fits));
  }
  if (!army.length) army.push(rng.pick(units));
  return army;
}

/** Does this army satisfy the hero's synergy rule? */
export function meetsSynergy(config: GameConfig, army: string[], rule: HeroSynergy): boolean {
  if (rule.units && army.filter((u) => rule.units!.includes(u)).length < (rule.atLeast ?? 2)) return false;
  if (rule.unspent) {
    const unspent = config.armyPointLimit - armyCost(config, army);
    if (unspent < rule.unspent[0] || unspent > rule.unspent[1]) return false;
  }
  return validateArmy(config, army) === null;
}

export const describeArmy = (config: GameConfig, units: string[]): string =>
  `${units.join('+')} (${armyCost(config, units)} pts)`;
