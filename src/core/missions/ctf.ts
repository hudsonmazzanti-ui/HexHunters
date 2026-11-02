/**
 * Capture the Flag. One neutral flag starts on the center hex (no control point).
 *
 *  - Pick up: a model standing on the flag spends its action to pick it up (the
 *    'pickUp' action; no roll). Any model can carry it.
 *  - The carrier moves 1 slower (minimum 1) and can still attack and use specials.
 *  - Walking only: if the carrier moves any other way than its own normal move
 *    (Vault, Dash, Pounce, Swap, Hook, Shove...), the flag drops on the hex it stood on
 *    just before. A Dragon carrying the flag walks instead of flying.
 *  - Hack on the carrier, or its death, drops the flag on its hex.
 *  - Capture: a carrier that ends its owner's turn inside its own deployment zone (after
 *    the opponent's overwatch) scores 2, and the flag goes back to the center hex.
 *  - Standard Bearer: the carrier gets +2 on its rolls; each capture scores 1 more.
 */
import { ORIGIN, hexEquals } from '../hex';
import { captureBonus } from '../auras';
import { flagCarrier } from '../flag';
import type { MissionDef } from './types';

export const ctf: MissionDef = {
  name: 'Capture the Flag',
  summary: (c) =>
    `Grab the flag in the center and walk it into your deployment zone: ${c.specials.flagCapturePoints} points. First to ${c.pointsToWin} wins.`,
  rules: (c) => {
    const r = c.specials;
    return [
      'The flag starts on the center hex. There is no control point.',
      'A model standing on the flag spends its action to pick it up. Any model can carry it.',
      `The carrier moves ${r.flagCarrierSlow} slower (minimum 1) but can still attack and use its special.`,
      'Walking only: if the carrier moves any other way (Vault, Dash, Pounce, Swap, a Hook pull...), the flag drops where it stood. A Dragon carrying it walks.',
      'A Hack on the carrier, or killing it, drops the flag on its hex.',
      `End your turn with your carrier inside your own deployment zone to score ${r.flagCapturePoints}; the flag returns to the center.`,
      `Standard Bearer: your carrier gets +${r.standardRollBonus} on its rolls, and each capture scores ${r.standardCaptureBonus} more.`,
      `First to ${c.pointsToWin} points wins, or wipe out the enemy.`,
    ];
  },
  usesControlPoint: false,
  setup: (state) => {
    state.flag = { pos: ORIGIN, carrierId: null };
  },
  empowered: (state, unit) => !!state.flag && state.flag.carrierId === unit.id,
  endOfTurn: (state, player, events) => {
    const carrier = flagCarrier(state);
    if (!carrier || carrier.owner !== player) return;
    if (!state.map.deployZones[player].some((z) => hexEquals(z, carrier.pos!))) return;
    const points = state.config.specials.flagCapturePoints + captureBonus(state, player);
    state.scores[player] += points;
    state.flag = { pos: ORIGIN, carrierId: null };
    events.push({ type: 'flagCaptured', player, unitId: carrier.id, points, scores: [...state.scores] });
  },
};
