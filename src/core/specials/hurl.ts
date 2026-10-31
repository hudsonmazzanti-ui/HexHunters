/**
 * Hurl (Hill Giant): tear an adjacent terrain hex (either height) out of the map and
 * throw it at an enemy within 4 in line of sight (checked with the chunk already
 * lifted). Normal hit roll (Spot, Standard Bearer and Brace count). The terrain is gone
 * either way. A hit deals 2 + the terrain's height; if that kills the target, the
 * boulder lands as height-1 terrain on its hex, otherwise it shatters.
 */
import { dealDamage } from '../combat';
import { type Hex, hexDistance, hexKey, neighbors } from '../hex';
import { actionDie, canSeeUnit, effectiveDefense, terrainHeight } from '../queries';
import type { GameState, TerrainHeight, Unit } from '../types';
import type { SpecialDef, SpecialPreview } from './types';

/** Adjacent terrain hexes the Giant could tear out. */
export const hurlChunks = (state: GameState, unit: Unit): Hex[] =>
  neighbors(unit.pos!).filter((h) => terrainHeight(state, h) > 0);

/** Line of sight with the chunk lifted off the board. */
function seesWithout(state: GameState, unit: Unit, chunk: Hex, target: Unit): boolean {
  const key = hexKey(chunk);
  const height = state.map.heights[key];
  delete state.map.heights[key];
  const sees = canSeeUnit(state, unit, target);
  if (height) state.map.heights[key] = height;
  return sees;
}

function throwAt(state: GameState, unit: Unit, chunk: Hex, target: Unit): SpecialPreview & { spot: number } {
  const r = state.config.specials;
  const spot = target.spottedBy === unit.owner ? r.spotAttackBonus : 0;
  const roll = actionDie(state, unit) + spot;
  const defense = effectiveDefense(state, target);
  const hit = roll >= defense;
  const damage = hit ? r.hurlBaseDamage + terrainHeight(state, chunk) : 0;
  return {
    area: [
      { hex: chunk, kind: 'path' },
      { hex: target.pos!, kind: 'impact' },
    ],
    effects: [{ unitId: target.id, roll, defense, hit, damage, killed: hit && target.hp <= damage }],
    spot,
  };
}

function removeTerrain(state: GameState, h: Hex): void {
  delete state.map.heights[hexKey(h)];
  for (const t of state.map.terrain) t.hexes = t.hexes.filter((x) => hexKey(x) !== hexKey(h));
  state.map.terrain = state.map.terrain.filter((t) => t.hexes.length);
}

function addBoulder(state: GameState, h: Hex): void {
  const height: TerrainHeight = 1;
  state.map.heights[hexKey(h)] = height;
  const id = Math.max(-1, ...state.map.terrain.map((t) => t.id)) + 1;
  state.map.terrain.push({ id, kind: 'boulder', height, hexes: [h] });
}

export const hurl: SpecialDef = {
  name: 'Hurl',
  describe: (r) =>
    `Rip an adjacent terrain hex out of the map and throw it at an enemy within ${r.hurlRange} you can see. ` +
    `Normal hit roll; a hit deals ${r.hurlBaseDamage} + the terrain's height. A kill leaves a height-1 boulder there.`,
  targeting: 'hexAndEnemy',
  tags: ['Changes the map', 'Needs adjacent terrain'],
  usable: (state, unit) => (hurlChunks(state, unit).length ? null : 'no terrain adjacent'),
  checkChoice: (state, unit, { hex, target }) => {
    if (hexDistance(unit.pos!, hex!) !== 1 || terrainHeight(state, hex!) === 0) return 'Pick adjacent terrain';
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.hurlRange) return 'Out of range';
    return seesWithout(state, unit, hex!, target!) ? null : 'No line of sight';
  },
  preview: (state, unit, { hex, target }) => throwAt(state, unit, hex!, target!),
  apply: (state, unit, { hex, target }) => {
    const { effects, spot } = throwAt(state, unit, hex!, target!);
    if (spot) target!.spottedBy = null; // Spot is used up, hit or miss
    removeTerrain(state, hex!);
    const e = effects[0];
    const landing = target!.pos!;
    if (e.hit) {
      e.killed = dealDamage(state, target!, e.damage);
      if (e.killed) addBoulder(state, landing);
    }
    return { hex: hex!, targetId: target!.id, to: e.killed ? landing : undefined, effects };
  },
};
