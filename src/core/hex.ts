/**
 * Hex grid math. Axial coordinates (q, r) with the implied cube coordinate s = -q - r.
 * Hexes are "pointy-top": rows run horizontally and r increases downward on screen.
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

export interface Hex {
  q: number;
  r: number;
}

export const hex = (q: number, r: number): Hex => ({ q, r });

export const ORIGIN: Hex = hex(0, 0);

/** Stable string key for use in Sets/Records. Normalizes -0 to 0. */
export const hexKey = (h: Hex): string => `${h.q + 0},${h.r + 0}`;

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return hex(q, r);
}

export const hexS = (h: Hex): number => -h.q - h.r;

export const hexEquals = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export const hexAdd = (a: Hex, b: Hex): Hex => hex(a.q + b.q, a.r + b.r);

export const hexSub = (a: Hex, b: Hex): Hex => hex(a.q - b.q, a.r - b.r);

export const hexScale = (a: Hex, k: number): Hex => hex(a.q * k, a.r * k);

/** The six neighbor directions, in clockwise order starting from east. */
export const DIRECTIONS: readonly Hex[] = [
  hex(1, 0), // E
  hex(1, -1), // NE
  hex(0, -1), // NW
  hex(-1, 0), // W
  hex(-1, 1), // SW
  hex(0, 1), // SE
];

/** Direction by index; wraps around so callers can "turn" with +/-1. */
export const direction = (i: number): Hex => DIRECTIONS[((i % 6) + 6) % 6];

export const neighbor = (h: Hex, dir: number): Hex => hexAdd(h, direction(dir));

export const neighbors = (h: Hex): Hex[] => DIRECTIONS.map((d) => hexAdd(h, d));

export function hexDistance(a: Hex, b: Hex): number {
  const d = hexSub(a, b);
  return (Math.abs(d.q) + Math.abs(d.r) + Math.abs(hexS(d))) / 2;
}

/** Index of the direction from `a` to adjacent hex `b`, or -1 if they are not adjacent. */
export function directionTo(a: Hex, b: Hex): number {
  const d = hexSub(a, b);
  return DIRECTIONS.findIndex((dir) => dir.q === -d.q && dir.r === -d.r);
}

/** Point reflection through the origin (the board center). */
export const mirror = (h: Hex): Hex => hex(-h.q + 0, -h.r + 0);

/** All hexes within `radius` of the origin: a hexagon-shaped board. */
export function hexagon(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) out.push(hex(q, r));
  }
  return out;
}

/** Round fractional cube coordinates to the nearest hex. */
export function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return hex(rq + 0, rr + 0);
}

/**
 * Hexes on the straight line from a to b (inclusive), sampled at hex centers.
 * `nudge` shifts both endpoints by a tiny cube offset; used to break ties when the
 * line runs exactly along hex edges (see los.ts for the rule built on top of this).
 */
export function hexLine(a: Hex, b: Hex, nudge = 0): Hex[] {
  const n = hexDistance(a, b);
  // Nudge vector in cube space (q, r, s) must sum to zero.
  const nq = nudge;
  const nr = nudge * 2;
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + nq + (b.q - a.q) * t;
    const r = a.r + nr + (b.r - a.r) * t;
    out.push(hexRound(q, r));
  }
  return out;
}

// ---- Pixel conversion (pure math; used by the renderer) ----

const SQRT3 = Math.sqrt(3);

export interface Point {
  x: number;
  y: number;
}

/** Center of a pointy-top hex with circumradius `size`. */
export function hexToPixel(h: Hex, size: number): Point {
  return { x: size * SQRT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

export function pixelToHex(p: Point, size: number): Hex {
  const q = ((SQRT3 / 3) * p.x - (1 / 3) * p.y) / size;
  const r = ((2 / 3) * p.y) / size;
  return hexRound(q, r);
}

/** Corner points of a pointy-top hex, for drawing polygons. */
export function hexCorners(h: Hex, size: number): Point[] {
  const c = hexToPixel(h, size);
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    out.push({ x: c.x + size * Math.cos(angle), y: c.y + size * Math.sin(angle) });
  }
  return out;
}
