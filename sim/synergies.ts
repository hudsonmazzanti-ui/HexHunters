/**
 * Hero synergy rules for the simulator's random army builder (simulator only; the game's
 * army rules are unchanged). When a random army includes one of these heroes, it is built
 * so the hero's rule has something to work with, then the remaining points are filled at
 * random as usual (see randomArmy in armies.ts).
 *
 * To add a hero: give its id an entry here.
 *  - `units` + `atLeast`: the army also gets at least `atLeast` models picked from `units`
 *    (any mix, chosen at random among those that still fit).
 *  - `unspent`: the army leaves between min and max points unspent (the Mercenary's
 *    Premium Shots come from unspent points).
 * Heroes without an entry (Standard Bearer, Gambler, the Twins, Behemoth) are unrestricted.
 */
export interface HeroSynergy {
  /** The models the hero's rule works with. */
  units?: string[];
  /** How many of them the army must include (default 2). */
  atLeast?: number;
  /** Points the army must leave unspent: [min, max]. */
  unspent?: [number, number];
}

export const HERO_SYNERGIES: Record<string, HeroSynergy> = {
  marshal: { units: ['infantry'], atLeast: 2 }, // Field Marshal
  siegemaster: { units: ['artillery'], atLeast: 2 }, // Siege Master
  necromancer: { units: ['zombie', 'skeleton'], atLeast: 2 },
  masterninja: { units: ['assassin', 'scout'], atLeast: 2 }, // Master Ninja
  warden: { units: ['medic', 'sentinel'], atLeast: 2 },
  pyromancer: { units: ['flamer', 'grenadier'], atLeast: 2 },
  // Large models (the Werewolf counts: it becomes a large beast after it transforms).
  warlord: { units: ['heavy', 'grappler', 'hillgiant', 'monster', 'dragon', 'werewolf'], atLeast: 2 },
  mercenary: { unspent: [1, 3] }, // Premium Shots
};
