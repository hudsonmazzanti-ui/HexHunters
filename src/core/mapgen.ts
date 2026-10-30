/**
 * Procedural map generation.
 *
 * Terrain is placed in pairs: every piece has a twin mirrored through the board
 * center (point symmetry), so neither side gets a better layout. Pieces are kept
 * out of the deployment rows (plus a one-row buffer), off the control point and its
 * surrounding ring, and at least one empty hex apart, so the map stays sparse and
 * every open hex remains reachable.
 */
import {
  type Hex,
  ORIGIN,
  direction,
  hexAdd,
  hexDistance,
  hexKey,
  hexagon,
  mirror,
  neighbors,
} from './hex';
import { Rng } from './rng';
import type { GameConfig, GameMap, Terrain, TerrainHeight } from './types';

export function controlPointHexes(): Hex[] {
  return [ORIGIN, ...neighbors(ORIGIN)];
}

/** Player 0 deploys on the bottom rows (positive r), player 1 on the top rows. */
export function deployZones(radius: number, rows: number): [Hex[], Hex[]] {
  const all = hexagon(radius);
  const edge = radius - rows + 1;
  return [all.filter((h) => h.r >= edge), all.filter((h) => h.r <= -edge)];
}

/** Can terrain go on this hex? */
function terrainAllowed(h: Hex, cfg: GameConfig): boolean {
  const limit = cfg.boardRadius - cfg.deployRows; // keeps a 1-row buffer before deployment
  return hexDistance(h, ORIGIN) <= cfg.boardRadius && Math.abs(h.r) < limit && hexDistance(h, ORIGIN) >= 2;
}

/** A straight wall, or a curved wall that turns one direction each step (an arc). */
function randomPiece(rng: Rng, cfg: GameConfig, candidates: Hex[]): Omit<Terrain, 'id'> {
  const length = rng.int(cfg.terrainMinLength, cfg.terrainMaxLength);
  const kind = length >= 3 && rng.next() < 0.5 ? 'curve' : 'wall';
  const height = rng.int(1, 2) as TerrainHeight;
  const turn = rng.next() < 0.5 ? 1 : -1;
  let dir = rng.int(0, 5);
  let cur = rng.pick(candidates);
  const hexes = [cur];
  for (let i = 1; i < length; i++) {
    cur = hexAdd(cur, direction(dir));
    hexes.push(cur);
    if (kind === 'curve') dir += turn;
  }
  return { kind, height, hexes };
}

/** True if every open (non-terrain) hex can reach every other one. */
export function isConnected(radius: number, blocked: Set<string>): boolean {
  const open = hexagon(radius).filter((h) => !blocked.has(hexKey(h)));
  if (open.length === 0) return true;
  const seen = new Set([hexKey(open[0])]);
  const stack = [open[0]];
  while (stack.length) {
    const h = stack.pop()!;
    for (const n of neighbors(h)) {
      const k = hexKey(n);
      if (hexDistance(n, ORIGIN) > radius || blocked.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  return seen.size === open.length;
}

export function generateMap(cfg: GameConfig, seed: number): GameMap {
  const rng = new Rng(seed);
  const candidates = hexagon(cfg.boardRadius).filter((h) => terrainAllowed(h, cfg));

  for (let attempt = 0; attempt < 100; attempt++) {
    const terrain: Terrain[] = [];
    const used = new Set<string>();
    // `used` plus its neighbors: new pieces may not touch existing ones.
    const touches = (hexes: Hex[]) =>
      hexes.some((h) => used.has(hexKey(h)) || neighbors(h).some((n) => used.has(hexKey(n))));

    for (let pair = 0; pair < cfg.terrainPairs; pair++) {
      for (let tries = 0; tries < 50; tries++) {
        const piece = randomPiece(rng, cfg, candidates);
        const twin = piece.hexes.map(mirror);
        if (!piece.hexes.every((h) => terrainAllowed(h, cfg))) continue;
        if (touches(piece.hexes) || touches(twin)) continue;
        // The piece must not touch its own twin either.
        const pieceKeys = new Set(piece.hexes.map(hexKey));
        if (twin.some((h) => pieceKeys.has(hexKey(h)) || neighbors(h).some((n) => pieceKeys.has(hexKey(n))))) {
          continue;
        }
        terrain.push({ ...piece, id: terrain.length });
        terrain.push({ ...piece, hexes: twin, id: terrain.length });
        for (const h of [...piece.hexes, ...twin]) used.add(hexKey(h));
        break;
      }
    }

    if (!isConnected(cfg.boardRadius, used)) continue;

    const heights: Record<string, TerrainHeight> = {};
    for (const t of terrain) for (const h of t.hexes) heights[hexKey(h)] = t.height;
    return {
      radius: cfg.boardRadius,
      terrain,
      heights,
      controlPoint: controlPointHexes(),
      deployZones: deployZones(cfg.boardRadius, cfg.deployRows),
    };
  }
  throw new Error('Could not generate a valid map');
}
