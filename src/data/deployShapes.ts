/**
 * Deployment shapes. One is picked at random each game (from GameConfig.deployShapes).
 * Each shape describes Player 1's zone (the bottom of the screen); Player 2's zone is
 * always its mirror image through the board center, so both sides are equal.
 *
 * To add a shape: add an entry here and its id to deployShapes in config.ts.
 *
 * Shapes are drawn relative to the board edge, so they work on any board size (Small and
 * Big Map). Every zone stays at least 3 hexes from the center (clear of the control point
 * and its ring). If a zone is too small for the largest army (16 Skeletons, or 18 with
 * Bonus Bones), it grows: `grow` makes it one row / step deeper at a time (see
 * mapgen.shapeZones). Tests check every shape on every board size.
 *
 * Coordinates are axial (q, r): r grows toward Player 1's edge; `x = q + r / 2` is the
 * left/right position (negative = left).
 */
import { type Hex, hex, hexDistance } from '../core/hex';
import type { GameConfig } from '../core/types';

export interface DeployShape {
  name: string;
  /** One line for the reveal screen. */
  description: string;
  /** Is this hex in Player 1's zone? `grow` = how many steps deeper than normal (0 = normal). */
  zone(h: Hex, cfg: GameConfig, grow: number): boolean;
  /** Not in the random pool: only used when a Condition asks for it (Hot Drop). */
  special?: boolean;
}

/** Left/right position of a hex (in hex widths). */
const x = (h: Hex): number => h.q + h.r / 2;

export const DEPLOY_SHAPES: Record<string, DeployShape> = {
  standard: {
    name: 'Standard',
    description: 'The two rows nearest your edge.',
    zone: (h, cfg, g) => h.r > cfg.boardRadius - cfg.deployRows - g,
  },
  close: {
    name: 'Close Quarters',
    description: 'Like Standard, but two rows closer to the center.',
    zone: (h, cfg, g) => {
      const back = cfg.boardRadius - cfg.deployRows; // first row in front of the Standard zone
      return h.r <= back && h.r > back - cfg.deployRows - g;
    },
  },
  corners: {
    name: 'Corners',
    description: 'A triangle in your corner; the enemy holds the opposite corner.',
    zone: (h, cfg, g) => {
      const R = cfg.boardRadius;
      return hexDistance(h, hex(-R, R)) <= 4 + g && hexDistance(h, hex(0, 0)) >= R - 2 - g;
    },
  },
  flanks: {
    name: 'Flanks',
    description: 'A strip along the left edge; the enemy deploys along the right.',
    zone: (h, cfg, g) => x(h) <= -(cfg.boardRadius - 2.5 - g),
  },
  spearhead: {
    name: 'Spearhead',
    description: 'A wedge from your edge pointing at the center.',
    zone: (h, cfg, g) => h.r >= cfg.boardRadius - 3 - g && Math.abs(x(h)) <= h.r - (cfg.boardRadius - 3.5 - g),
  },
  split: {
    name: 'Split',
    description: 'Two pockets on your side, left and right, with a gap between them.',
    zone: (h, cfg, g) => h.r >= cfg.boardRadius - 2 - g && Math.abs(x(h)) >= 1.5,
  },
  // Hot Drop (a Condition): both armies in the middle, back to back. Player 1 holds the two
  // rows just below the center line plus the left part of the center row; Player 2 the
  // mirror image. The zones touch along the center row on both sides of the control point.
  hotdrop: {
    name: 'Hot Drop',
    description: 'Both armies deploy back to back in the middle of the board.',
    special: true,
    zone: (h) => h.r === 1 || h.r === 2 || (h.r === 0 && h.q < 0),
  },
};
