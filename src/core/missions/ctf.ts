/**
 * Capture the Flag. One neutral flag starts on the center hex (no control point, no points).
 *
 *  - Pick up: a model standing on the flag spends its action to pick it up (the
 *    'pickUp' action; no roll). Any model can carry it.
 *  - The carrier ignores every speed bonus (e.g. the Warlord's +1) and moves 1 slower than
 *    its own speed (minimum 1). It can still attack and use specials.
 *  - Walking only: if the carrier moves any other way than its own normal move
 *    (Vault, Dash, Pounce, Swap, a Hook pull...), the flag drops on the hex it stood on
 *    just before. A Dragon carrying the flag walks instead of flying.
 *  - Hack on the carrier, or its death, drops the flag on its hex.
 *  - Capture: a carrier that ends its owner's turn inside its own deployment zone (after
 *    the opponent's overwatch) wins the game. Or eliminate the enemy.
 *  - Standard Bearer: the carrier isn't slowed (its own speed, still no bonuses) and gets +2 on its rolls.
 */
import { hexEquals } from '../hex';
import { flagCarrier } from '../flag';
import type { MissionDef } from './types';

export const ctf: MissionDef = {
  name: 'Capture the Flag',
  summary: () => 'Grab the flag in the center and carry it into your own deployment zone to win.',
  rules: (c) => {
    const r = c.specials;
    return [
      'The flag starts on the center hex. There is no control point and no points.',
      'A model standing on the flag spends its action to pick it up. Any model can carry it.',
      `The carrier gets no speed bonuses (such as the Warlord's) and moves ${r.flagCarrierSlow} slower than its own speed (minimum 1), but can still attack and use its special.`,
      'Walking only: if the carrier moves any other way (Vault, Dash, Pounce, Swap, a Hook pull...), the flag drops where it stood. A Dragon carrying it walks.',
      'A Hack on the carrier, or killing it, drops the flag on its hex. A dropped flag stays until someone picks it up.',
      'Win: end your turn with your carrier inside your own deployment zone, or wipe out the enemy.',
      `Standard Bearer: your carrier isn't slowed and gets +${r.standardRollBonus} on its rolls.`,
    ];
  },
  usesControlPoint: false,
  usesPoints: false,
  setup: (state) => {
    state.flag = { pos: { q: 0, r: 0 }, carrierId: null };
  },
  empowered: (state, unit) => !!state.flag && state.flag.carrierId === unit.id,
  endOfTurn: (state, player, events) => {
    const carrier = flagCarrier(state);
    if (!carrier || carrier.owner !== player) return null;
    if (!state.map.deployZones[player].some((z) => hexEquals(z, carrier.pos!))) return null;
    events.push({ type: 'flagCaptured', player, unitId: carrier.id });
    return { winner: player, reason: 'capture' };
  },
};
