/**
 * Grenade: needs a high die. Lob at a hex within the Grenadier's range; it always
 * hits. Impact hex takes heavy damage, the 6 neighbors take splash (friendly fire,
 * including the thrower).
 *
 * The arc ignores normal line of sight but is blocked by any hex in between with
 * height-2 terrain or a model of size 2+. It uses the same two-trace edge rule as
 * line of sight (blocked only if both traces are blocked). Walls don't stop splash.
 */
import { dealDamage } from '../combat';
import { type Hex, hexDistance, neighbors } from '../hex';
import { hasLineOfSight } from '../los';
import { actionDie, onBoard, terrainHeight, unitAt, unitDef } from '../queries';
import type { GameState, Unit } from '../types';
import type { Effect, SpecialDef, SpecialPreview } from './types';

/** Height that stops a grenade: height-2 terrain, or a model of size 2+. */
const ARC_BLOCK_HEIGHT = 2;

export function grenadeArcClear(state: GameState, from: Hex, to: Hex): boolean {
  return hasLineOfSight(from, to, (h) => {
    if (terrainHeight(state, h) >= ARC_BLOCK_HEIGHT) return true;
    const model = unitAt(state, h);
    return !!model && unitDef(state, model).size >= ARC_BLOCK_HEIGHT;
  });
}

function blast(state: GameState, impact: Hex): SpecialPreview {
  const { grenadeImpactDamage, grenadeSplashDamage } = state.config.specials;
  const ring = neighbors(impact).filter((h) => onBoard(state, h));
  const effects: Effect[] = [];
  const hitAt = (h: Hex, damage: number) => {
    const u = unitAt(state, h);
    if (u) effects.push({ unitId: u.id, damage, killed: u.hp <= damage });
  };
  hitAt(impact, grenadeImpactDamage);
  ring.forEach((h) => hitAt(h, grenadeSplashDamage));
  return {
    area: [{ hex: impact, kind: 'impact' }, ...ring.map((hex) => ({ hex, kind: 'splash' as const }))],
    effects,
  };
}

export const grenade: SpecialDef = {
  name: 'Grenade',
  describe: (r) =>
    `Needs a die of ${r.grenadeMinDie}+. Always hits a hex in range: ${r.grenadeImpactDamage} damage there, ` +
    `${r.grenadeSplashDamage} to every adjacent model (friendly fire!). Arcs over height-1 walls and small models.`,
  targeting: 'hex',
  tags: ['Needs die 10+', 'Always hits', 'Friendly fire'],
  usable: (state, unit) => {
    const min = state.config.specials.grenadeMinDie;
    return actionDie(state, unit) < min ? `needs ${min}+` : null;
  },
  checkChoice: (state, unit, { hex }) => {
    const d = hexDistance(unit.pos!, hex!);
    if (d < 1 || d > unitDef(state, unit).range) return 'Out of range';
    if (terrainHeight(state, hex!) > 0) return 'Cannot target terrain';
    return grenadeArcClear(state, unit.pos!, hex!) ? null : 'Arc blocked';
  },
  preview: (state, _unit, { hex }) => blast(state, hex!),
  apply: (state, _unit, { hex }) => {
    const { effects } = blast(state, hex!);
    for (const e of effects) {
      const u = state.units.find((x) => x.id === e.unitId) as Unit;
      e.killed = dealDamage(state, u, e.damage);
    }
    return { hex: hex!, effects };
  },
};
