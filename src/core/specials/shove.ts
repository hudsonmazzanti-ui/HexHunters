import { type Hex, hexAdd, hexDistance, hexSub } from '../hex';
import { onBoard, terrainHeight, unitAt } from '../queries';
import type { SpecialDef } from './types';

/** Where a shoved target would land: one hex directly away from the shover. */
export const shoveDestination = (shover: Hex, target: Hex): Hex => hexAdd(target, hexSub(target, shover));

export const shove: SpecialDef = {
  name: 'Shove',
  describe: () => 'Push an adjacent enemy 1 hex directly away.',
  targeting: 'enemy',
  checkChoice: (state, unit, { target }) => {
    if (hexDistance(unit.pos!, target!.pos!) !== 1) return 'Must be adjacent';
    const dest = shoveDestination(unit.pos!, target!.pos!);
    if (!onBoard(state, dest) || terrainHeight(state, dest) > 0 || unitAt(state, dest)) return 'Nowhere to push';
    return null;
  },
  preview: (_s, unit, { target }) => ({
    area: [{ hex: shoveDestination(unit.pos!, target!.pos!), kind: 'landing' }],
    effects: [],
  }),
  apply: (_s, unit, { target }) => {
    const from = target!.pos!;
    const to = shoveDestination(unit.pos!, from);
    target!.pos = to;
    return { targetId: target!.id, movedId: target!.id, from, to };
  },
};
