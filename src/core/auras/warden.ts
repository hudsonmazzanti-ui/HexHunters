import type { AuraDef } from './types';

export const warden: AuraDef = {
  describe: (r) =>
    `Your Medics get +${r.wardenDefenseBonus} defense and +${r.wardenMedicDamageBonus} attack damage. ` +
    `Your Sentinels get +${r.wardenDefenseBonus} defense and +${r.wardenSentinelHealthBonus} max health (from the start).`,
  short: (r, unit) =>
    unit.special === 'heal'
      ? `+${r.wardenDefenseBonus} def, +${r.wardenMedicDamageBonus} dmg`
      : `+${r.wardenDefenseBonus} def, +${r.wardenSentinelHealthBonus} HP`,
  affects: (_s, unit) => unit.type === 'medic' || unit.type === 'sentinel',
  effects: (r, unit) =>
    unit.special === 'heal'
      ? { defenseBonus: r.wardenDefenseBonus, damageBonus: r.wardenMedicDamageBonus }
      : { defenseBonus: r.wardenDefenseBonus, healthBonus: r.wardenSentinelHealthBonus },
};
