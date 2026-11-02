/**
 * The visual theme: every color, font, spacing step and radius in one place.
 *
 * `applyTheme()` writes these as CSS custom properties on <html> at startup
 * (`--c-<name>` for colors, `--font-*`, `--space-*`, `--radius-*`), and style.css
 * only ever refers to those variables. TypeScript code (team colors, effect
 * colors) imports from here too, so changing a value here changes it everywhere.
 */

export const COLORS = {
  // App surfaces
  bg: '#0f141d',
  panel: '#182030',
  panel2: '#232c3e',
  raised: '#2e3950',
  overlay: '#0b0f16',
  text: '#eef2f8',
  muted: '#8f9bb1',
  ink: '#0f141d', // dark text on light chips/buttons
  white: '#ffffff',
  black: '#000000',

  // Teams: one strong color each, plus darker/lighter shades
  p0: '#3d8bfd',
  p0Dark: '#1e55c4',
  p0Light: '#9cc5ff',
  p1: '#ff4d5a',
  p1Dark: '#b8222f',
  p1Light: '#ffa3aa',
  /** Handoff screen backgrounds, per team. */
  p0Handoff: '#10264d',
  p1Handoff: '#4d1016',

  // Board: light cream tiles on a dark surround, dark terrain (high contrast)
  boardGlow: '#2b3447',
  boardEdge: '#11161f',
  tile: '#e8e2d4',
  tileEdge: '#b3aa96',
  cpTile: '#f2d98a',
  cpEdge: '#b8860b',
  terrain1: '#8d939e',
  terrain1Edge: '#5c626d',
  terrain2: '#474e5c',
  terrain2Edge: '#2a2f39',
  /** "Can't see there" shading on the tiles. */
  hide: '#141a26',
  boulder: '#8c6b45',
  boulderEdge: '#5b4329',

  // Signals
  accent: '#ffc83d', // gold: selection, primary buttons, heroes, control point
  good: '#34d399',
  bad: '#ff6b6b',
  target: '#ff3b3b',
  special: '#b36bff', // purple: special-action targeting, the Twins
  fire: '#ff8a3d',
  fireDark: '#7c2d12',
  watch: '#22d3ee',
  watchDark: '#0e7490',
  watchEnemy: '#f472b6',
  watchEnemyDark: '#9d174d',
  hack: '#4ade80',
  hackDark: '#052e16',
  moon: '#fde68a',
  shell: '#f59e0b',
  /** Capture the Flag: the flag's cloth (neutral magenta, unlike either team) and its pole. */
  flag: '#e11d8c',
  flagDark: '#831843',
  flagPole: '#1f2937',

  // Briefing icons (missions and battlefield Conditions)
  iconSun: '#fbbf24',
  iconFog: '#cbd5e1',
  iconMud: '#a16207',
  iconWind: '#7dd3fc',
  iconBloodMoon: '#ef4444',
  iconSand: '#e7c27d',
  iconBone: '#f5f5f4',
  iconDrop: '#fb923c',
  iconMap: '#a7f3d0',

  // Badges
  dieFace: '#ffffff',
  dieBoosted: '#bbf7d0',
  dieHacked: '#fecaca',
  dieUsed: '#5b6476',
  dieUsedText: '#d1d5db',
  hpBadge: '#0f141d',
  hpLow: '#c22a37',
  armorFace: '#e5e7eb',
  armorShield: '#64748b',

  // Floating text
  fxDamage: '#ffb4b4',
  fxMiss: '#e5e7eb',
  fxInfo: '#d6b8ff',
  fxGold: '#fde68a',
  fxBust: '#ff6b6b',
  fxBoulder: '#a8835a',
} as const;

export type ColorName = keyof typeof COLORS;

export const FONTS = {
  /** Headings, buttons and every number: crisp and slightly techy. */
  display: "'Rajdhani', 'Arial Narrow', system-ui, sans-serif",
  /** Body text. */
  body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

/** Google Fonts stylesheet for the fonts above (loaded from index.html). */
export const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Rajdhani:wght@600;700&display=swap';

/** Spacing scale in px: --space-1 … --space-6. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 } as const;

export const RADIUS = { sm: 6, md: 12, lg: 16, pill: 999 } as const;

/** Minimum touch target height (px). */
export const TAP = 48;

/** Team colors in player order, for TypeScript code. */
export const PLAYER_COLORS = [COLORS.p0, COLORS.p1] as const;
export const HANDOFF_COLORS = [COLORS.p0Handoff, COLORS.p1Handoff] as const;

/** camelCase -> kebab-case ("p0Dark" -> "p0-dark", "terrain1Edge" -> "terrain1-edge"). */
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** All theme tokens as CSS custom properties. */
export function themeVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(COLORS)) vars[`--c-${kebab(k)}`] = v;
  vars['--font-display'] = FONTS.display;
  vars['--font-body'] = FONTS.body;
  for (const [k, v] of Object.entries(SPACE)) vars[`--space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(RADIUS)) vars[`--radius-${k}`] = `${v}px`;
  vars['--tap'] = `${TAP}px`;
  return vars;
}

export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVariables())) root.style.setProperty(k, v);
}
