/**
 * Tabletop miniatures: one painted-figure icon per unit type, drawn on the model's base.
 *
 * Each icon is SVG markup on a 100×100 grid, centered on (50, 50) and kept within about 40
 * of the center (it sits on the dark top of the base). Bone-colored shapes with a dark ink
 * outline, plus a few accent colors, so every unit reads at a glance on either team's
 * base. To add a unit, add an entry keyed by its unit id; a unit without one falls back
 * to its letter label.
 */
import { COLORS } from './theme';

const B = COLORS.miniBone;
const K = COLORS.miniInk;
const fill = (c: string, w = 4) => `fill="${c}" stroke="${K}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const line = (c: string, w: number) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
/** A thick line with an ink outline (rifles, hooks, poles). */
const rod = (d: string, c: string, w: number) => `<path d="${d}" ${line(K, w + 6)}/><path d="${d}" ${line(c, w)}/>`;

const pistol = (t = '') =>
  `<g transform="${t}"><path d="M20 40 h46 a4 4 0 0 1 4 4 v6 h-30 l-5 20 h-12 l3-20 h-6 z" ${fill(B)}/><path d="M62 44 h4" ${line(K, 3)}/></g>`;

export const MINI_ICONS: Record<string, string> = {
  // ---------- Units ----------
  infantry: `${rod('M24 76 L74 26', COLORS.miniWood, 6)}
    <path d="M24 56 a26 24 0 0 1 52 0 h6 v7 h-64 v-7z" ${fill(B)}/>
    <path d="M34 63 h32 v8 q-16 8 -32 0z" ${fill(B)}/>
    <path d="M30 50 q20-10 40 0" ${line(K, 3)} opacity=".5"/>`,
  medic: `<path d="M38 18h24v20h20v24H62v20H38V62H18V38h20z" ${fill(B)}/>
    <path d="M44 26h12v18h18v12H56v18H44V56H26V44h18z" fill="${COLORS.miniRed}"/>`,
  sniper: `<circle cx="50" cy="50" r="27" ${fill(B, 5)}/><circle cx="50" cy="50" r="15" fill="${COLORS.miniSteelDark}"/>
    <path d="M50 16v22M50 62v22M16 50h22M62 50h22" ${line(K, 5)}/><circle cx="50" cy="50" r="4.5" fill="${COLORS.miniRed}"/>`,
  scout: `<path d="M24 44 h18 v14 h-18z M58 44 h18 v14 h-18z" ${fill(B)}/>
    <circle cx="33" cy="64" r="15" ${fill(B)}/><circle cx="67" cy="64" r="15" ${fill(B)}/>
    <path d="M42 52 h16 v10 h-16z" ${fill(B)}/>
    <circle cx="33" cy="64" r="8" ${fill(COLORS.miniLens, 3)}/><circle cx="67" cy="64" r="8" ${fill(COLORS.miniLens, 3)}/>
    <circle cx="30" cy="61" r="2.5" fill="${COLORS.white}"/><circle cx="64" cy="61" r="2.5" fill="${COLORS.white}"/>`,
  heavy: `<path d="M50 16 L80 27 V52 Q78 73 50 86 Q22 73 20 52 V27 Z" ${fill(B, 5)}/>
    <path d="M50 24 V78 M28 46 H72" ${line(K, 4)} opacity=".55"/><circle cx="50" cy="46" r="7" ${fill(COLORS.miniSteel, 3)}/>`,
  assassin: `<path d="M74 18 L82 26 L46 62 L38 54 Z" ${fill(B)}/>
    <path d="M30 50 L50 70" ${line(K, 9)}/><path d="M30 50 L50 70" ${line(COLORS.miniGold, 4)}/>
    ${rod('M37 63 L22 78', COLORS.miniWood, 6)}`,
  grenadier: `<circle cx="48" cy="58" r="23" ${fill(COLORS.miniOlive, 4)}/>
    <path d="M30 50 h36 M30 64 h36 M42 37 v42 M56 37 v42" ${line(K, 2.5)} opacity=".45"/>
    <rect x="40" y="24" width="18" height="12" rx="2" ${fill(COLORS.miniSteel, 3.5)}/>
    <circle cx="68" cy="26" r="7" ${line(K, 6)}/><circle cx="68" cy="26" r="7" ${line(COLORS.miniSteel, 2.5)}/>`,
  flamer: `<path d="M50 14 C66 32 76 42 72 60 C69 76 60 86 50 86 C39 86 28 77 28 62 C28 50 36 44 39 33 C44 41 46 46 50 47 C53 37 51 26 50 14Z" ${fill(COLORS.miniFlame)}/>
    <path d="M50 52 C58 60 62 66 60 74 C58 80 54 82 50 82 C45 82 41 78 41 72 C41 66 46 62 50 52Z" fill="${COLORS.miniGold}"/>`,
  monster: `<path d="M30 40 q-16-4 -18-24 q14 10 24 12z" ${fill(B)}/><path d="M70 40 q16-4 18-24 q-14 10 -24 12z" ${fill(B)}/>
    <path d="M26 44 q24-18 48 0 l2 18 q-6 18 -26 22 q-20-4 -26-22z" ${fill(B)}/>
    <path d="M34 52 l10 5 l-10 3z M66 52 l-10 5 l10 3z" ${fill(COLORS.miniRed, 2)}/>
    <path d="M38 70 l4 6 l4-6 l4 6 l4-6 l4 6 l4-6" ${line(K, 3)}/>`,
  artillery: `<path d="M22 70 L72 26" ${line(K, 22)}/><path d="M22 70 L72 26" ${line(COLORS.miniSteel, 14)}/>
    <circle cx="72" cy="26" r="6" fill="${K}"/>
    <circle cx="40" cy="66" r="17" ${fill(COLORS.miniWood, 4)}/><circle cx="40" cy="66" r="5" fill="${K}"/>
    <path d="M40 51v30M25 66h30M29 55l22 22M51 55l-22 22" ${line(K, 2.5)}/>`,
  sentinel: `<path d="M14 50 Q50 18 86 50 Q50 82 14 50Z" ${fill(B, 5)}/>
    <circle cx="50" cy="50" r="15" ${fill(COLORS.miniCyan, 4)}/><circle cx="50" cy="50" r="6" fill="${K}"/><circle cx="45" cy="45" r="3" fill="${COLORS.white}"/>`,
  grappler: `<circle cx="56" cy="20" r="8" ${line(K, 10)}/><circle cx="56" cy="20" r="8" ${line(COLORS.miniSteel, 4)}/>
    ${rod('M56 28 V62 a16 16 0 1 1 -30 -8', COLORS.miniSteel, 8)}
    <path d="M22 48 L26 58 L34 52 Z" ${fill(COLORS.miniSteel, 3)}/>`,
  zombie: `<path d="M26 30 q24-16 48 0 l4 30 q-6 22 -28 24 q-22-2 -28-24z" ${fill(COLORS.miniZombie)}/>
    <path d="M34 44 l10 10 M44 44 l-10 10" ${line(K, 4)}/><circle cx="62" cy="49" r="6" ${fill('#fff', 3)}/><circle cx="62" cy="49" r="2.5" fill="${K}"/>
    <path d="M36 70 h28 M40 66 v8 M48 66 v8 M56 66 v8" ${line(K, 3)}/>`,
  skeleton: `<path d="M50 14c-18 0-30 12-30 28 0 10 5 16 10 19v13h40V61c5-3 10-9 10-19 0-16-12-28-30-28z" ${fill(B)}/>
    <circle cx="38" cy="44" r="8" fill="${K}"/><circle cx="62" cy="44" r="8" fill="${K}"/>
    <path d="M50 52l-5 9h10z" fill="${K}"/><path d="M41 74v-7M50 74v-7M59 74v-7" ${line(K, 3)}/>`,
  hillgiant: `<path d="M20 60 L28 32 L50 20 L74 28 L84 54 L72 78 L42 84 L24 76 Z" ${fill(COLORS.miniRock, 5)}/>
    <path d="M50 20 L46 44 L60 56 L56 84 M46 44 L28 50" ${line(K, 3)} opacity=".55"/>`,
  werewolf: `<path d="M64 16 A34 34 0 1 0 82 66 A27 27 0 1 1 64 16Z" ${fill(COLORS.miniMoon, 4)}/>
    <circle cx="44" cy="40" r="4" fill="${K}" opacity=".25"/><circle cx="36" cy="60" r="6" fill="${K}" opacity=".2"/>`,
  werewolfbeast: `<path d="M26 18 L40 38 H60 L74 18 L78 50 Q76 72 50 86 Q24 72 22 50 Z" ${fill(COLORS.miniFur)}/>
    <path d="M40 66 Q50 74 60 66 L50 80 Z" ${fill(B, 3)}/>
    <path d="M32 50 l10 4 l-10 3z M68 50 l-10 4 l10 3z" ${fill(COLORS.miniGold, 2)}/><circle cx="50" cy="64" r="4" fill="${K}"/>`,
  hacker: `<rect x="18" y="24" width="64" height="52" rx="8" ${fill(COLORS.miniSteelDark, 4)}/>
    <path d="M38 38 L26 50 L38 62 M62 38 L74 50 L62 62" ${line(COLORS.miniGreen, 6)}/><path d="M55 34 L45 66" ${line(B, 5)}/>`,
  dualgunner: `${pistol('translate(2 -14)')}${pistol('translate(100 14) scale(-1 1) translate(2 0)')}`,
  dragon: `<path d="M34 30 L26 12 L44 26 Z M50 26 L50 10 L60 26 Z" ${fill(COLORS.miniDragon, 3.5)}/>
    <path d="M18 74 Q16 46 36 32 Q50 24 64 30 L84 40 Q88 48 80 52 L86 60 Q78 66 64 62 Q58 76 40 80 Z" ${fill(COLORS.miniDragon)}/>
    <path d="M64 62 L70 70 L60 66 Z" ${fill(B, 2.5)}/>
    <path d="M48 40 l12 4 l-11 4z" ${fill(COLORS.miniGold, 2.5)}/><circle cx="80" cy="45" r="2.5" fill="${K}"/>
    <path d="M30 56 q6 6 14 6 M28 66 q6 4 12 4" ${line(K, 3)} opacity=".45"/>`,
  // ---------- Heroes ----------
  marshal: `<path d="M50 12 L59 36 L84 37 L64 52 L71 76 L50 62 L29 76 L36 52 L16 37 L41 36 Z" ${fill(COLORS.miniGold)}/>
    <path d="M30 80 L50 88 L70 80" ${line(K, 7)}/><path d="M30 80 L50 88 L70 80" ${line(COLORS.miniGold, 3)}/>`,
  siegemaster: `<path d="M26 84 V38 h9 v-12 h9 v12 h12 v-12 h9 v12 h9 V84Z" ${fill(B)}/>
    <path d="M42 84 V66 a8 8 0 0 1 16 0 V84" fill="${K}"/><path d="M34 50 h6 M60 50 h6" ${line(K, 4)}/>`,
  warlord: `<path d="M28 44 q-18-4 -16-28 q10 14 22 16z" ${fill(B)}/><path d="M72 44 q18-4 16-28 q-10 14 -22 16z" ${fill(B)}/>
    <path d="M24 60 a26 28 0 0 1 52 0 v10 h-52z" ${fill(COLORS.miniSteel)}/>
    <path d="M50 40 V78" ${line(K, 6)}/><path d="M50 40 V78" ${line(COLORS.miniGold, 2.5)}/><path d="M24 70 h52" ${line(K, 4)}/>`,
  warden: `<path d="M38 22 h24 M50 14 v8" ${line(K, 5)}/><path d="M34 28 h32 l-4 8 h-24z" ${fill(COLORS.miniSteel, 3.5)}/>
    <rect x="32" y="36" width="36" height="40" rx="6" ${fill(COLORS.miniLantern, 4)}/>
    <path d="M50 46 C56 54 58 60 56 66 C54 70 46 70 44 66 C42 60 46 54 50 46Z" fill="${COLORS.miniFlame}"/>
    <path d="M30 80 h40" ${line(K, 6)}/>`,
  masterninja: `<path d="M50 12 L58 42 L88 50 L58 58 L50 88 L42 58 L12 50 L42 42Z" ${fill(COLORS.miniSteel, 4)}/>
    <circle cx="50" cy="50" r="7" fill="${K}"/>`,
  standardbearer: `${rod('M30 86 V14', COLORS.miniWood, 6)}
    <path d="M32 18 H76 V58 L66 50 L56 58 L56 58 L32 58 Z" ${fill(COLORS.miniGold)}/><path d="M42 30 h22 M42 42 h22" ${line(K, 3)} opacity=".5"/>`,
  pyromancer: `<path d="M50 14 C58 26 66 30 66 40 C72 34 72 28 70 24 C80 32 84 46 80 58 C76 74 64 84 50 84 C36 84 22 74 20 58 C18 46 24 36 32 30 C32 36 34 40 38 42 C38 30 44 22 50 14Z" ${fill(COLORS.miniFlame)}/>
    <circle cx="50" cy="62" r="14" ${fill(COLORS.miniGold, 3)}/>`,
  gambler: `<g transform="rotate(-12 50 50)"><rect x="20" y="20" width="60" height="60" rx="12" ${fill(B, 5)}/>
    <circle cx="35" cy="35" r="6" fill="${K}"/><circle cx="65" cy="35" r="6" fill="${K}"/><circle cx="50" cy="50" r="6" fill="${COLORS.miniRed}"/>
    <circle cx="35" cy="65" r="6" fill="${K}"/><circle cx="65" cy="65" r="6" fill="${K}"/></g>`,
  necromancer: `<path d="M50 12 Q80 22 80 58 L84 86 H16 L20 58 Q20 22 50 12Z" ${fill(COLORS.miniHood)}/>
    <path d="M32 58 Q32 34 50 30 Q68 34 68 58 Q60 70 50 70 Q40 70 32 58Z" fill="${K}"/>
    <circle cx="42" cy="52" r="4.5" fill="${COLORS.miniGreen}"/><circle cx="58" cy="52" r="4.5" fill="${COLORS.miniGreen}"/>`,
  behemoth: `<path d="M24 30 Q24 16 50 16 Q76 16 76 30 V74 Q50 88 24 74 Z" ${fill(COLORS.miniSteel, 5)}/>
    <path d="M30 44 H70" ${line(K, 7)}/><path d="M50 50 V78" ${line(K, 4)}/>
    <circle cx="32" cy="28" r="3" fill="${K}"/><circle cx="68" cy="28" r="3" fill="${K}"/><circle cx="32" cy="64" r="3" fill="${K}"/><circle cx="68" cy="64" r="3" fill="${K}"/>`,
  mercenary: `<path d="M40 26 Q50 32 60 26 L58 36 Q82 48 78 70 Q74 86 50 86 Q26 86 22 70 Q18 48 42 36 Z" ${fill(COLORS.miniBag)}/>
    <path d="M38 34 Q50 40 62 34" ${line(K, 4)}/>
    <path d="M58 52 Q50 46 43 51 Q38 57 50 60 Q62 63 57 70 Q50 75 41 69 M50 44 V78" ${line(K, 4.5)}/>`,
  twintank: `<rect x="26" y="16" width="48" height="68" rx="12" ${fill(B, 5)}/>
    <path d="M50 20 V80" ${line(COLORS.miniSpecial, 6)}/><path d="M30 50 H70" ${line(K, 4)} opacity=".5"/>`,
  twinshooter: `${pistol('rotate(-20 50 50) translate(2 2)')}<circle cx="74" cy="72" r="9" ${fill(COLORS.miniSpecial, 3)}/>`,
};

/** The icon for a unit type, or null (fall back to its letter label). */
export const miniIcon = (type: string): string | null => MINI_ICONS[type] ?? null;

/**
 * Scale for an icon inside a base of radius r (small models get a slightly bigger icon so
 * it still reads).
 */
export const miniIconScale = (r: number, size: number): number => (r * (size === 1 ? 2.1 : 1.85)) / 100;

/**
 * A small standalone miniature (for the roster chips and the army builder): the
 * team-colored rim, the dark top and the figure. null for a unit without an icon.
 */
export function miniBadge(type: string, rim: string, rimDark: string, px: number): SVGSVGElement | null {
  const icon = miniIcon(type);
  if (!icon) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('class', 'mini-badge');
  svg.setAttribute('aria-hidden', 'true');
  const k = 0.84;
  svg.innerHTML =
    `<circle cx="50" cy="52" r="47" fill="${rimDark}"/><circle cx="50" cy="50" r="47" fill="${rim}"/>` +
    `<circle cx="50" cy="50" r="37" fill="${COLORS.miniTopDark}" stroke="${COLORS.miniInk}" stroke-opacity=".5" stroke-width="2"/>` +
    `<g transform="translate(${50 - 50 * k} ${49 - 52 * k}) scale(${k})">${icon}</g>`;
  return svg;
}
