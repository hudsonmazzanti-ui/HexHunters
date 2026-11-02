/**
 * Sample map renders for reports: a small SVG picture and an ASCII version.
 * Colors follow the game (cream tiles, gray/dark terrain by height, gold control point,
 * blue/red deployment zones).
 */
import { type Hex, hexCorners, hexEquals, hexKey, hexToPixel, hexagon } from '../src/core/hex';
import type { GameMap } from '../src/core/types';
import { DEPLOY_SHAPES } from '../src/data/deployShapes';

const inZone = (map: GameMap, h: Hex, p: 0 | 1) => map.deployZones[p].some((z) => hexEquals(z, h));
const onCp = (map: GameMap, h: Hex) => map.controlPoint.some((c) => hexEquals(c, h));

const FILL = {
  open: '#e8e2d4',
  cp: '#f2d98a',
  z0: '#a9c7f5',
  z1: '#f5b3b8',
  h1: '#8d939e',
  h2: '#474e5c',
  edge: '#b3aa96',
};

export function mapSvg(map: GameMap, size = 12): string {
  const extent = size * Math.sqrt(3) * (map.radius + 1);
  const polys = hexagon(map.radius)
    .map((h) => {
      const height = map.heights[hexKey(h)];
      const fill = height === 2 ? FILL.h2 : height === 1 ? FILL.h1 : onCp(map, h) ? FILL.cp : inZone(map, h, 0) ? FILL.z0 : inZone(map, h, 1) ? FILL.z1 : FILL.open;
      const pts = hexCorners(h, size)
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');
      const label = height ? `<text x="${hexToPixel(h, size).x.toFixed(1)}" y="${hexToPixel(h, size).y.toFixed(1)}">${height}</text>` : '';
      return `<polygon points="${pts}" fill="${fill}"/>${label}`;
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-extent} ${-extent} ${2 * extent} ${2 * extent}" width="${Math.round(2 * extent)}">` +
    `<style>polygon{stroke:${FILL.edge};stroke-width:0.8}text{font:bold ${size * 0.8}px sans-serif;fill:#fff;text-anchor:middle;dominant-baseline:central}</style>` +
    `${polys}</svg>`
  );
}

/**
 * ASCII render, one board row per line (offset so the hex grid lines up):
 * `.` open, `1`/`2` terrain height, `O` control point, `a`/`b` Player 1/2 zone.
 */
export function mapAscii(map: GameMap): string {
  const R = map.radius;
  const lines: string[] = [];
  for (let r = -R; r <= R; r++) {
    const cells: string[] = [];
    for (let q = -R; q <= R; q++) {
      const h = { q, r };
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
      const height = map.heights[hexKey(h)];
      cells.push(height ? String(height) : onCp(map, h) ? 'O' : inZone(map, h, 0) ? 'a' : inZone(map, h, 1) ? 'b' : '.');
    }
    lines.push(' '.repeat(Math.abs(r)) + cells.join(' '));
  }
  const shape = DEPLOY_SHAPES[map.deployShape]?.name ?? map.deployShape;
  return `${lines.join('\n')}\n\nDeployment: ${shape} · terrain pieces: ${map.terrain.length} · terrain hexes: ${Object.keys(map.heights).length}\n`;
}
