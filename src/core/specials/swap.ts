/**
 * Swap (the Twins): the two twins trade places, from anywhere on the map. No range or
 * line of sight needed. Uses the activating twin's die (and ends its movement); the
 * partner keeps its die, movement and acted status, so it can still move and act.
 * Unavailable once either twin has died.
 */
import { getUnit } from '../queries';
import type { GameState, Unit } from '../types';
import type { SpecialDef } from './types';

/** The living partner twin, if any. */
export const partnerOf = (state: GameState, unit: Unit): Unit | undefined => {
  const p = unit.partnerId ? getUnit(state, unit.partnerId) : undefined;
  return p?.pos ? p : undefined;
};

export const swap: SpecialDef = {
  name: 'Swap',
  describe: () => 'The twins instantly trade places, anywhere on the map. The other twin can still move and act.',
  targeting: 'none',
  tags: ['Any distance', 'Partner keeps its action'],
  usable: (state, unit) => (partnerOf(state, unit) ? null : 'partner fallen'),
  preview: (state, unit) => {
    const partner = partnerOf(state, unit)!;
    return {
      area: [
        { hex: unit.pos!, kind: 'landing' },
        { hex: partner.pos!, kind: 'landing' },
      ],
      effects: [],
    };
  },
  apply: (state, unit) => {
    const partner = partnerOf(state, unit)!;
    const from = unit.pos!;
    const to = partner.pos!;
    unit.pos = to;
    partner.pos = from;
    // The partner's undo point moves with it, so the swap can't be undone.
    if (partner.turnStartPos) partner.turnStartPos = from;
    return { targetId: partner.id, movedId: unit.id, from, to };
  },
};
