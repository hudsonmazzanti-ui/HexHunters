/**
 * Blink (Blinker): teleport to any empty, open hex within 3, through walls and models.
 * No roll. It may still attack afterwards with the same die (but not move on).
 */
import { hexDistance } from '../hex';
import { onBoard, terrainHeight, unitAt } from '../queries';
import type { SpecialDef } from './types';

export const blink: SpecialDef = {
  name: 'Blink',
  describe: (r) => `Teleport to an empty hex within ${r.blinkRange}, through walls and models, then make your attack with the same die.`,
  targeting: 'hex',
  tags: ['No roll', 'Through walls', 'Then attack'],
  allowsAttackAfter: true,
  checkChoice: (state, unit, { hex }) => {
    const d = hexDistance(unit.pos!, hex!);
    if (d < 1 || d > state.config.specials.blinkRange) return 'Out of range';
    if (!onBoard(state, hex!) || terrainHeight(state, hex!) > 0 || unitAt(state, hex!)) return 'Must be an empty hex';
    return null;
  },
  preview: (_s, _u, { hex }) => ({ area: [{ hex: hex!, kind: 'landing' }], effects: [] }),
  apply: (_s, unit, { hex }) => {
    const from = unit.pos!;
    unit.pos = hex!;
    unit.turnStartPos = hex!; // no undo back through the blink
    return { movedId: unit.id, from, to: hex! };
  },
};
