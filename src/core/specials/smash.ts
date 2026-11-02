/**
 * Smash (Behemoth): destroy one terrain hex adjacent to the Behemoth (either height).
 * No roll. The hex is removed from the map for good.
 */
import { hexDistance } from '../hex';
import { terrainHeight } from '../queries';
import { hurlChunks, removeTerrain } from './hurl';
import type { SpecialDef } from './types';

export const smash: SpecialDef = {
  name: 'Smash',
  describe: () => 'Destroy one terrain hex next to the Behemoth (either height). No roll. It is gone for good.',
  targeting: 'hex',
  tags: ['No roll', 'Changes the map', 'Needs adjacent terrain'],
  usable: (state, unit) => (hurlChunks(state, unit).length ? null : 'no terrain adjacent'),
  checkChoice: (state, unit, { hex }) =>
    hexDistance(unit.pos!, hex!) === 1 && terrainHeight(state, hex!) > 0 ? null : 'Pick adjacent terrain',
  preview: (_state, _unit, { hex }) => ({ area: [{ hex: hex!, kind: 'impact' }], effects: [] }),
  apply: (state, _unit, { hex }) => {
    removeTerrain(state, hex!);
    return { hex: hex! };
  },
};
