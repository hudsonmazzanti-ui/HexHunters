/**
 * Big, simple icons for the briefing screen and the in-game corner buttons: one per
 * mission and per battlefield Condition (the `icon` key in their data). Drawn as inline
 * SVG on a 48×48 grid, colored from the theme.
 */
import { COLORS } from './theme';

const NS = 'http://www.w3.org/2000/svg';

type Part = [tag: string, attrs: Record<string, string | number>];

const stroke = (color: string, width = 3.5) => ({ fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const hexPoints = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const ICONS: Record<string, Part[]> = {
  crown: [
    ['path', { d: 'M8 36h32l3-20-10 8-9-14-9 14-10-8z', fill: COLORS.accent, stroke: COLORS.ink, 'stroke-width': 2, 'stroke-linejoin': 'round' }],
    ['rect', { x: 8, y: 37, width: 32, height: 5, rx: 1.5, fill: COLORS.accent, stroke: COLORS.ink, 'stroke-width': 2 }],
  ],
  flag: [
    ['line', { x1: 14, y1: 6, x2: 14, y2: 43, ...stroke(COLORS.text, 4) }],
    ['path', { d: 'M15 7l24 8-24 9z', fill: COLORS.flag, stroke: COLORS.flagDark, 'stroke-width': 2, 'stroke-linejoin': 'round' }],
  ],
  sun: [
    ['circle', { cx: 24, cy: 24, r: 9, fill: COLORS.iconSun }],
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((deg): Part => {
      const a = (deg * Math.PI) / 180;
      return ['line', { x1: 24 + 14 * Math.cos(a), y1: 24 + 14 * Math.sin(a), x2: 24 + 19 * Math.cos(a), y2: 24 + 19 * Math.sin(a), ...stroke(COLORS.iconSun) }];
    }),
  ],
  fog: [12, 22, 32].map((y, i): Part => ['path', { d: `M${6 + i * 3} ${y}q6-5 12 0t12 0t12 0`, ...stroke(COLORS.iconFog, 4) }]),
  mud: [
    ['path', { d: 'M5 34c4-6 10-7 15-4s10 3 13-1 9-3 10 3c1 6-6 9-19 9S2 40 5 34z', fill: COLORS.iconMud }],
    ['circle', { cx: 16, cy: 18, r: 4, fill: COLORS.iconMud }],
    ['circle', { cx: 30, cy: 13, r: 3, fill: COLORS.iconMud }],
  ],
  wind: [
    ['path', { d: 'M5 18h26a6 6 0 1 0-6-6', ...stroke(COLORS.iconWind, 4) }],
    ['path', { d: 'M5 28h32a6 6 0 1 1-6 6', ...stroke(COLORS.iconWind, 4) }],
    ['path', { d: 'M5 38h14', ...stroke(COLORS.iconWind, 4) }],
  ],
  moon: [['path', { d: 'M30 6a18 18 0 1 0 12 30A15 15 0 0 1 30 6z', fill: COLORS.iconBloodMoon }]],
  sand: [
    ['path', { d: 'M6 16h24a5 5 0 1 0-5-5', ...stroke(COLORS.iconSand, 3.5) }],
    ['path', { d: 'M10 26h30', ...stroke(COLORS.iconSand, 3.5) }],
    ['path', { d: 'M6 36h22a5 5 0 1 1-5 5', ...stroke(COLORS.iconSand, 3.5) }],
    ...[[36, 14], [40, 36], [16, 31], [32, 20]].map(([cx, cy]): Part => ['circle', { cx, cy, r: 1.8, fill: COLORS.iconSand }]),
  ],
  skull: [
    ['path', { d: 'M24 5c-10 0-17 7-17 16 0 6 3 9 6 11v7h22v-7c3-2 6-5 6-11 0-9-7-16-17-16z', fill: COLORS.iconBone }],
    ['circle', { cx: 17, cy: 21, r: 4.5, fill: COLORS.bg }],
    ['circle', { cx: 31, cy: 21, r: 4.5, fill: COLORS.bg }],
    ['path', { d: 'M24 26l-3 5h6z', fill: COLORS.bg }],
    ['path', { d: 'M19 39v-4M24 39v-4M29 39v-4', ...stroke(COLORS.bg, 2) }],
  ],
  drop: [
    ['path', { d: 'M6 20a18 14 0 0 1 36 0z', fill: COLORS.iconDrop }],
    ['path', { d: 'M7 20l17 18M41 20L24 38M18 20l6 18M30 20l-6 18', ...stroke(COLORS.text, 1.8) }],
    ['rect', { x: 20, y: 36, width: 8, height: 8, rx: 2, fill: COLORS.text }],
  ],
  small: [
    ['polygon', { points: hexPoints(24, 24, 19), ...stroke(COLORS.muted, 2.5) }],
    ['polygon', { points: hexPoints(24, 24, 10), fill: COLORS.iconMap }],
    ['path', { d: 'M24 4v7M24 44v-7M6 14l6 3.5M42 34l-6-3.5M6 34l6-3.5M42 14l-6 3.5', ...stroke(COLORS.text, 2.5) }],
  ],
  big: [
    ['polygon', { points: hexPoints(24, 24, 20), fill: COLORS.iconMap }],
    ['polygon', { points: hexPoints(24, 24, 9), ...stroke(COLORS.bg, 2.5) }],
    ['path', { d: 'M24 15v-9M24 33v9M16 19.5l-7-4M32 28.5l7 4M16 28.5l-7 4M32 19.5l7-4', ...stroke(COLORS.bg, 2.5) }],
  ],
};

/** An icon as an SVG element (`size` in px). Unknown keys draw nothing. */
export function icon(name: string, size = 48): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(ICONS);
