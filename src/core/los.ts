/**
 * Line of sight.
 *
 * RULES
 * - Draw a line between the two hex centers. Only the hexes strictly between the
 *   viewer and the target matter (not the viewer's or target's own hex).
 * - A hex in between blocks the line if it holds:
 *     - terrain with height >= the target's size, or
 *     - a model with size (height) >= the target's size, EXCEPT a model friendly to
 *       the viewer that is smaller than the viewer (big models shoot over their own
 *       smaller troops).
 *   Only the target's size matters otherwise: small models hide behind height 1+,
 *   medium behind height 2+, and large models are only hidden by other large models.
 *
 * EDGE RULE (lines running exactly along hex edges)
 *   We trace the line twice, nudged a tiny amount to each side of the true line.
 *   The target is visible if EITHER nudged line is clear ("ties go to the shooter").
 *   For lines that don't touch an edge both traces are identical, so this only
 *   changes the outcome when the line grazes the border between two hexes, where a
 *   single blocker on one side is not enough to hide the target.
 */
import { type Hex, hexEquals, hexLine } from './hex';

const NUDGE = 1e-6;

/** Hexes strictly between a and b, for each of the two nudged traces. */
export function linesBetween(a: Hex, b: Hex): [Hex[], Hex[]] {
  const inner = (line: Hex[]) => line.slice(1, -1);
  return [inner(hexLine(a, b, NUDGE)), inner(hexLine(a, b, -NUDGE))];
}

/** Generic LOS test: visible if either nudged line has no blocking hex. */
export function hasLineOfSight(a: Hex, b: Hex, blocks: (h: Hex) => boolean): boolean {
  if (hexEquals(a, b)) return true;
  return linesBetween(a, b).some((line) => !line.some(blocks));
}

export interface Blocker {
  /** Terrain height at the hex, 0 if open. */
  terrainHeight: number;
  /** Model standing on the hex, if any. */
  model?: { size: number; friendlyToViewer: boolean };
}

/** Does this hex hide a target of `targetSize` from a viewer of `viewerSize`? */
export function blocksSight(b: Blocker, viewerSize: number, targetSize: number): boolean {
  if (b.terrainHeight >= targetSize) return true;
  if (!b.model) return false;
  if (b.model.friendlyToViewer && b.model.size < viewerSize) return false;
  return b.model.size >= targetSize;
}
