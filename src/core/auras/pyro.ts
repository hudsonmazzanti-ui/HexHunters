import type { AuraDef } from './types';

/** Pyromancer: these actions set Burn on every model they hit (see Unit.burning). */
export const pyro: AuraDef = {
  describe: (r) =>
    `Burn: the Pyromancer's attacks, the Flamer's Torch and the Grenadier's Grenade set every model they hit ` +
    `burning (allies too). A burning model takes ${r.burnDamage} damage at the start of its owner's next turn.`,
  short: (_r, unit) => (unit.hero ? 'attacks burn' : unit.special === 'torch' ? 'Torch burns' : 'Grenade burns'),
  affects: (_s, unit) => unit.type === 'pyromancer' || unit.type === 'flamer' || unit.type === 'grenadier',
  effects: (_r, unit) => ({ burnsOn: unit.hero ? ['attack'] : ['special'] }),
};
