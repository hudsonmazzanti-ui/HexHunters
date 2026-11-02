/**
 * Capture the Flag's flag (see src/core/missions/ctf.ts for the mission's rules).
 * Small helpers with no game-engine imports, so queries, combat and specials can all
 * use them. Drops are recorded in `state.flagChanges` and turned into game events when
 * the current action finishes (or at fixed points in the turn: after Burn, after overwatch).
 */
import { type Hex, hexDistance, hexEquals, hexKey, hexagon } from './hex';
import type { FlagDropReason, GameState, Unit } from './types';

/** Is this model carrying the flag? */
export const isCarrier = (state: GameState, unit: Unit): boolean => !!state.flag && state.flag.carrierId === unit.id;

/** The flag's carrier, if it's carried by a living model. */
export const flagCarrier = (state: GameState): Unit | undefined => {
  const id = state.flag?.carrierId;
  return id ? state.units.find((u) => u.id === id && u.pos) : undefined;
};

/** Where the flag is: on the ground, or under its carrier. null outside Capture the Flag. */
export const flagHex = (state: GameState): Hex | null => state.flag?.pos ?? flagCarrier(state)?.pos ?? null;

/** Is the flag lying on the ground on this hex? */
export const flagOnGround = (state: GameState, h: Hex): boolean => !!state.flag?.pos && hexEquals(state.flag.pos, h);

/** The carrier drops the flag on `hex`. Does nothing if `unit` isn't carrying it. */
export function dropFlag(state: GameState, unit: Unit, hex: Hex, reason: FlagDropReason, by?: string): void {
  if (!isCarrier(state, unit)) return;
  state.flag = { pos: hex, carrierId: null };
  state.flagChanges.push({ kind: 'dropped', unitId: unit.id, hex, reason, ...(by ? { by } : {}) });
}

/**
 * A flag lying on terrain (a Hurl boulder landed on a killed carrier's hex) rolls to the
 * nearest open hex. Ties go to the first hex in board order, so it's deterministic.
 */
export function settleFlag(state: GameState): void {
  const at = state.flag?.pos;
  if (!at || !state.map.heights[hexKey(at)]) return;
  const open = hexagon(state.map.radius).filter((h) => !state.map.heights[hexKey(h)]);
  let best = open[0];
  for (const h of open) if (hexDistance(h, at) < hexDistance(best, at)) best = h;
  state.flag!.pos = best;
  state.flagChanges.push({ kind: 'shifted', from: at, to: best });
}
