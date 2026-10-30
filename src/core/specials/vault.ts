/**
 * Vault: leap over an adjacent terrain hex (either height) and land on the hex
 * directly beyond it. The landing hex must be on the board, open and empty, so a
 * wall two hexes thick can't be vaulted. The model keeps its unused movement and
 * can move on after landing.
 */
import { type Hex, DIRECTIONS, hexAdd, hexEquals, hexScale } from '../hex';
import { onBoard, terrainHeight, unitAt } from '../queries';
import type { SpecialDef } from './types';

/** The terrain hex being jumped, if `landing` is a straight two-hex leap from `from`. */
export function vaultOver(from: Hex, landing: Hex): Hex | null {
  for (const d of DIRECTIONS) {
    if (hexEquals(hexAdd(from, hexScale(d, 2)), landing)) return hexAdd(from, d);
  }
  return null;
}

export const vault: SpecialDef = {
  name: 'Vault',
  describe: () =>
    'Leap over an adjacent wall (either height) to the empty hex directly beyond it, then keep moving.',
  targeting: 'hex',
  tags: ['Keeps moving after'],
  keepsMovement: true,
  checkChoice: (state, unit, { hex }) => {
    const wall = vaultOver(unit.pos!, hex!);
    if (!wall || terrainHeight(state, wall) === 0) return 'Must land just past an adjacent wall';
    if (!onBoard(state, hex!) || terrainHeight(state, hex!) > 0 || unitAt(state, hex!)) return 'Landing hex blocked';
    return null;
  },
  preview: (_s, unit, { hex }) => ({
    area: [
      { hex: vaultOver(unit.pos!, hex!)!, kind: 'path' },
      { hex: hex!, kind: 'landing' },
    ],
    effects: [],
  }),
  apply: (_s, unit, { hex }) => {
    const from = unit.pos!;
    unit.pos = hex!;
    return { movedId: unit.id, from, to: hex! };
  },
};
