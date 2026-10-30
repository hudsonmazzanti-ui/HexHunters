/**
 * Torch: a 2-hex line of flame in one of the 6 directions. The Flamer's die is
 * compared against each model's base defense separately (defense bonuses such as
 * Brace and the Warden's aura are ignored, and Spot doesn't apply). Friendly fire applies. Terrain
 * stops the flame: nothing beyond a wall hex is hit.
 */
import { dealDamage } from '../combat';
import { type Hex, direction, hexAdd, hexScale } from '../hex';
import { actionDie, onBoard, terrainHeight, unitAt, unitDef } from '../queries';
import type { GameState, Unit } from '../types';
import type { Effect, SpecialDef, SpecialPreview } from './types';

/** Hexes the flame reaches in direction `dir`, stopping at terrain or the board edge. */
export function torchLine(state: GameState, from: Hex, dir: number): Hex[] {
  const out: Hex[] = [];
  for (let i = 1; i <= state.config.specials.torchLength; i++) {
    const h = hexAdd(from, hexScale(direction(dir), i));
    if (!onBoard(state, h) || terrainHeight(state, h) > 0) break;
    out.push(h);
  }
  return out;
}

function flames(state: GameState, unit: Unit, dir: number): SpecialPreview {
  const line = torchLine(state, unit.pos!, dir);
  const roll = actionDie(state, unit);
  const damage = unitDef(state, unit).damage;
  const effects: Effect[] = [];
  for (const h of line) {
    const target = unitAt(state, h);
    if (!target) continue;
    const defense = unitDef(state, target).defense; // base defense: ignores Brace and aura bonuses (Warden)
    const hit = roll >= defense;
    effects.push({ unitId: target.id, roll, defense, hit, damage: hit ? damage : 0, killed: hit && target.hp <= damage });
  }
  return { area: line.map((hex) => ({ hex, kind: 'flame' as const })), effects };
}

export const torch: SpecialDef = {
  name: 'Torch',
  describe: (r) =>
    `Flame the next ${r.torchLength} hexes in one direction. Rolls this model's die against EACH model's defense ` +
    'there, IGNORING defense bonuses (Brace, Warden). Friendly fire! Terrain stops the flame.',
  targeting: 'direction',
  tags: ['Ignores defense bonuses', 'Friendly fire', 'Stopped by walls'],
  checkChoice: (state, unit, { dir }) => {
    if (torchLine(state, unit.pos!, dir!).length === 0) return 'Flame blocked';
    return flames(state, unit, dir!).effects.length ? null : 'No models in the flame';
  },
  preview: (state, unit, { dir }) => flames(state, unit, dir!),
  apply: (state, unit, { dir }) => {
    const { effects } = flames(state, unit, dir!);
    for (const e of effects) {
      if (!e.hit) continue;
      const u = state.units.find((x) => x.id === e.unitId) as Unit;
      e.killed = dealDamage(state, u, e.damage);
    }
    return { dir, effects };
  },
};
