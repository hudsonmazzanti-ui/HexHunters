import type { AuraDef } from './types';

/**
 * Necromancer: Skeletons +1 defense and never rest; Zombies crawl only at half health;
 * enemies dying within 2 of your Zombies or the Necromancer rise as your Skeletons
 * (see src/core/necro.ts). The Necromancer itself is a raise source while alive.
 */
export const necro: AuraDef = {
  describe: (r) =>
    `Your Skeletons get +${r.necroSkeletonDefense} defense and never rest. Your Zombies only crawl at half health or ` +
    `less. Raise Dead: an enemy dying within ${r.necroRaiseRange} hexes of your Zombies or the Necromancer rises as ` +
    'your Skeleton (it acts from your next turn).',
  short: (r, unit) =>
    unit.restsOnDoubleTurn ? `+${r.necroSkeletonDefense} def, no rest` : unit.woundedForm ? 'crawls at half, raises' : 'raises the dead',
  affects: (state, unit) => {
    const def = state.config.units[unit.type];
    return !!def.restsOnDoubleTurn || !!def.woundedForm || def.hero?.aura === 'necro';
  },
  effects: (r, unit) => {
    if (unit.restsOnDoubleTurn) return { defenseBonus: r.necroSkeletonDefense, noRest: true };
    if (unit.woundedForm) return { crawlAtHalf: true, raisesDead: true };
    return { raisesDead: true }; // the Necromancer
  },
};
