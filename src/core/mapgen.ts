/**
 * Procedural map generation.
 *
 * Each map gets a random deployment shape (src/data/deployShapes.ts). Terrain is
 * placed in pairs: every piece has a twin mirrored through the board center (point
 * symmetry), so neither side gets a better layout. Pieces are kept out of both
 * deployment zones (plus a one-hex buffer), off the control point and its
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
  hexToPixel,
  hexagon,
  mirror,
  neighbors,
} from './hex';
import { DEPLOY_SHAPES } from '../data/deployShapes';
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

/** The most models a legal army can have (16 Skeletons at 1 point each, by default). */
export function largestArmy(cfg: GameConfig): number {
  const perModel = [
    ...Object.values(cfg.units).filter((u) => !u.squadOnly && !u.formOnly && u.cost > 0).map((u) => u.cost),
    ...Object.values(cfg.squads).map((s) => s.cost / s.members.length),
  ];
  return Math.floor(cfg.armyPointLimit / Math.min(...perModel));
}

/**
 * Both players' zones for a deployment shape: Player 1's, and its mirror image for Player 2.
 * Zone hexes are at least 3 from the center (clear of the control point and its ring). A
 * zone with fewer than `need` hexes grows one step at a time until the army fits.
 */
export function shapeZones(cfg: GameConfig, shapeId: string, need = largestArmy(cfg)): [Hex[], Hex[]] {
  const shape = DEPLOY_SHAPES[shapeId];
  if (!shape) throw new Error(`Unknown deployment shape "${shapeId}"`);
  let zone: Hex[] = [];
  for (let grow = 0; grow <= cfg.boardRadius; grow++) {
    zone = hexagon(cfg.boardRadius).filter((h) => hexDistance(h, ORIGIN) >= 3 && shape.zone(h, cfg, grow));
    if (zone.length >= need) break;
  }
  return [zone, zone.map(mirror)];
}

/** Picks this seed's deployment shape (its own random stream, so terrain doesn't depend on it). */
export function pickDeployShape(cfg: GameConfig, seed: number): string {
  return new Rng((seed ^ 0x2c1b3c6d) | 0).pick(cfg.deployShapes);
}

/**
 * Domination's three sites: the center site (center hex + its 6 neighbors) and two flank
 * sites, mirrored through the center. A flank site sits on the axis perpendicular to the
 * line between the deployment zones (it turns with the shape), about radius - 2 hexes from
 * the center, as equidistant from both zones as the hex grid allows. Candidates that would
 * leave the board, touch a zone or overlap the center site are skipped (then the next ring
 * inward is tried).
 */
export function dominationSites(radius: number, zones: [Hex[], Hex[]]): Hex[][] {
  const area = (h: Hex) => [h, ...neighbors(h)];
  const zoneKeys = new Set([...zones[0], ...zones[1]].map(hexKey));
  const toZone = (h: Hex, z: Hex[]) => Math.min(...z.map((x) => hexDistance(h, x)));
  // Axis toward Player 1's zone (its centroid, in screen space); flank sites lie across it.
  const pts = zones[0].map((h) => hexToPixel(h, 1));
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const len = Math.hypot(cx, cy) || 1;
  const along = (h: Hex) => {
    const p = hexToPixel(h, 1);
    return Math.abs((p.x * cx + p.y * cy) / (len * Math.hypot(p.x, p.y)));
  };
  for (let ring = radius - 2; ring >= 3; ring--) {
    const options = hexagon(radius).filter(
      (h) =>
        hexDistance(h, ORIGIN) === ring &&
        area(h).every((a) => hexDistance(a, ORIGIN) <= radius && !zoneKeys.has(hexKey(a))) &&
        area(mirror(h)).every((a) => !zoneKeys.has(hexKey(a))),
    );
    if (!options.length) continue;
    // Equal distance to both zones first, then closest to the perpendicular, then board order.
    const score = (h: Hex) => Math.abs(toZone(h, zones[0]) - toZone(h, zones[1])) * 10 + along(h);
    const best = options.reduce((a, b) => (score(b) < score(a) - 1e-9 ? b : a));
    // Of the pair, list the one on the left (or top) of the screen first, so the order is stable.
    const p = hexToPixel(best, 1);
    const first = p.x < -1e-9 || (Math.abs(p.x) < 1e-9 && p.y < 0) ? best : mirror(best);
    return [area(ORIGIN), area(first), area(mirror(first))];
  }
  throw new Error('No room for the Domination sites');
}

export interface MapOptions {
  /** Use this deployment shape instead of a random one (Hot Drop). */
  shape?: string;
  /** Extra models each army gets on top of the largest army (Bonus Bones), so zones must fit them. */
  extraModels?: number;
  /** Domination: place the three sites (kept clear of terrain, and reachable). */
  sites?: boolean;
}

/** Can terrain go on this hex? Not in or next to a deployment zone, nor on or next to the control point. */
function terrainAllowed(h: Hex, cfg: GameConfig, nearZones: Set<string>): boolean {
  return hexDistance(h, ORIGIN) <= cfg.boardRadius && !nearZones.has(hexKey(h)) && hexDistance(h, ORIGIN) >= 2;
}

/** A straight wall, or a curved wall that turns one direction each step (an arc). */
function randomPiece(rng: Rng, cfg: GameConfig, candidates: Hex[]): Omit<Terrain, 'id'> {
  const length = rng.int(cfg.terrainMinLength, cfg.terrainMaxLength);
  const kind = length >= 3 && rng.next() < 0.5 ? 'curve' : 'wall';
  // Height 2 with probability terrainTallShare (default: 50/50, drawn exactly as before).
  const tall = cfg.terrainTallShare;
  const height = (tall === undefined ? rng.int(1, 2) : rng.next() < tall ? 2 : 1) as TerrainHeight;
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

/**
 * Can each deployment zone reach the control point and the enemy zone over open hexes?
 * (Implied by isConnected, but checked explicitly so a future relaxation of that rule
 * can't produce a map where an army is walled off.)
 */
export function zonesConnected(radius: number, blocked: Set<string>, zones: [Hex[], Hex[]], objective: Hex[]): boolean {
  const reach = (from: Hex[]) => {
    const seen = new Set(from.filter((h) => !blocked.has(hexKey(h))).map(hexKey));
    const stack = from.filter((h) => !blocked.has(hexKey(h)));
    while (stack.length) {
      const h = stack.pop()!;
      for (const n of neighbors(h)) {
        const k = hexKey(n);
        if (hexDistance(n, ORIGIN) > radius || blocked.has(k) || seen.has(k)) continue;
        seen.add(k);
        stack.push(n);
      }
    }
    return seen;
  };
  const touches = (seen: Set<string>, hexes: Hex[]) => hexes.some((h) => seen.has(hexKey(h)));
  const from0 = reach(zones[0]);
  const from1 = reach(zones[1]);
  return touches(from0, objective) && touches(from0, zones[1]) && touches(from1, objective);
}

export function generateMap(cfg: GameConfig, seed: number, opts: MapOptions = {}): GameMap {
  const rng = new Rng(seed);
  const deployShape = opts.shape ?? pickDeployShape(cfg, seed);
  const zones = shapeZones(cfg, deployShape, largestArmy(cfg) + (opts.extraModels ?? 0));
  const sites = opts.sites ? dominationSites(cfg.boardRadius, zones) : undefined;
  // A fractional terrainPairs (density) rounds up or down at random: 4.5 = 4 or 5 pairs, 50/50.
  // (Only draws a random number when fractional, so whole-number maps are unchanged.)
  const whole = Math.floor(cfg.terrainPairs);
  const frac = cfg.terrainPairs - whole;
  const pairCount = frac > 0 && rng.next() < frac ? whole + 1 : whole;
  // Zone hexes plus a one-hex buffer around them stay free of terrain.
  const nearZones = new Set([...zones[0], ...zones[1]].flatMap((h) => [h, ...neighbors(h)]).map(hexKey));
  // Domination's site hexes stay clear of terrain (the center one already is).
  for (const site of sites ?? []) for (const h of site) nearZones.add(hexKey(h));
  const allowed = (h: Hex) => terrainAllowed(h, cfg, nearZones);
  const candidates = hexagon(cfg.boardRadius).filter(allowed);

  for (let attempt = 0; attempt < 100; attempt++) {
    const terrain: Terrain[] = [];
    const used = new Set<string>();
    // `used` plus its neighbors: new pieces may not touch existing ones.
    const touches = (hexes: Hex[]) =>
      hexes.some((h) => used.has(hexKey(h)) || neighbors(h).some((n) => used.has(hexKey(n))));

    // (A cramped board, e.g. Small Map with Domination's sites, may have no room for terrain.)
    for (let pair = 0; pair < (candidates.length ? pairCount : 0); pair++) {
      for (let tries = 0; tries < (cfg.terrainTries ?? 50); tries++) {
        const piece = randomPiece(rng, cfg, candidates);
        const twin = piece.hexes.map(mirror);
        if (!piece.hexes.every(allowed)) continue;
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
    if (!zonesConnected(cfg.boardRadius, used, zones, controlPointHexes())) continue;
    if (sites && !sites.every((site) => zonesConnected(cfg.boardRadius, used, zones, site))) continue;

    const heights: Record<string, TerrainHeight> = {};
    for (const t of terrain) for (const h of t.hexes) heights[hexKey(h)] = t.height;
    return {
      radius: cfg.boardRadius,
      terrain,
      heights,
      controlPoint: controlPointHexes(),
      deployShape,
      deployZones: zones,
      ...(sites ? { sites } : {}),
    };
  }
  throw new Error('Could not generate a valid map');
}
