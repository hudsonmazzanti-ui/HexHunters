/**
 * Deployment shapes. One is picked at random each game (from GameConfig.deployShapes).
 * Each shape describes Player 1's zone (the bottom of the screen); Player 2's zone is
 * always its mirror image through the board center, so both sides are equal.
 *
 * To add a shape: add an entry here and its id to deployShapes in config.ts. Every
 * shape must give each player at least 16 hexes (the largest legal army: 16
 * Skeletons) and stay clear of the control point; tests/deploy.test.ts checks this.
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
  /** Is this hex in Player 1's zone? */
  zone(h: Hex, cfg: GameConfig): boolean;
}

/** Left/right position of a hex (in hex widths). */
const x = (h: Hex): number => h.q + h.r / 2;

export const DEPLOY_SHAPES: Record<string, DeployShape> = {
  standard: {
    name: 'Standard',
    description: 'The two rows nearest your edge.',
    zone: (h, cfg) => h.r > cfg.boardRadius - cfg.deployRows,
  },
  close: {
    name: 'Close Quarters',
    description: 'Like Standard, but two rows closer to the center.',
    zone: (h, cfg) => {
      const back = cfg.boardRadius - cfg.deployRows; // first row in front of the Standard zone
      return h.r <= back && h.r > back - cfg.deployRows;
    },
  },
  corners: {
    name: 'Corners',
    description: 'A triangle in your corner; the enemy holds the opposite corner.',
    zone: (h, cfg) => {
      const R = cfg.boardRadius;
      return hexDistance(h, hex(-R, R)) <= 4 && hexDistance(h, hex(0, 0)) >= R - 2;
    },
  },
  flanks: {
    name: 'Flanks',
    description: 'A strip along the left edge; the enemy deploys along the right.',
    zone: (h, cfg) => x(h) <= -(cfg.boardRadius - 2.5),
  },
  spearhead: {
    name: 'Spearhead',
    description: 'A wedge from your edge pointing at the center.',
    zone: (h, cfg) => h.r >= cfg.boardRadius - 3 && Math.abs(x(h)) <= h.r - (cfg.boardRadius - 3.5),
  },
  split: {
    name: 'Split',
    description: 'Two pockets on your side, left and right, with a gap between them.',
    zone: (h, cfg) => h.r >= cfg.boardRadius - 2 && Math.abs(x(h)) >= 1.5,
  },
};
