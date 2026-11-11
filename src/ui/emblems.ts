/**
 * Big decorative art for the full-screen overlays: the game's logo, each player's crest,
 * the victory trophy and the drifting hex backdrop. Inline SVG / DOM built from theme
 * colors (no image files).
 */
import { COLORS, PLAYER_COLORS } from './theme';

const hexPath = (cx: number, cy: number, r: number): string =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ') + 'Z';

function wrap(className: string, html: string): HTMLElement {
  const div = document.createElement('div');
  div.className = className;
  div.innerHTML = html;
  return div;
}

/** A tiling hex-grid backdrop that drifts slowly behind every overlay. */
export function hexBackdrop(): HTMLElement {
  const w = 104;
  const h = 180;
  const cells = [hexPath(52, 30, 30), hexPath(0, 120, 30), hexPath(104, 120, 30), hexPath(52, 210, 30), hexPath(0, -60, 30), hexPath(104, -60, 30)];
  return wrap(
    'overlay-backdrop',
    `<svg width="100%" height="100%" aria-hidden="true"><defs>
      <pattern id="ov-hex" width="${w}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="scale(0.9)">
        <path d="${cells.join(' ')}" fill="none" stroke="${COLORS.white}" stroke-opacity="0.07" stroke-width="2"/>
        <path d="${hexPath(52, 30, 30)}" fill="${COLORS.white}" fill-opacity="0.025"/>
      </pattern></defs><rect class="ov-hex-rect" x="-20%" y="-20%" width="140%" height="140%" fill="url(#ov-hex)"/></svg>`,
  );
}

/** The HexHunters logo: a crosshair hex emblem over the wordmark. */
export function logo(): HTMLElement {
  return wrap(
    'logo',
    `<svg viewBox="0 0 320 250" aria-label="HexHunters">
      <defs>
        <linearGradient id="lg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.moon}"/><stop offset="1" stop-color="${COLORS.accent}"/></linearGradient>
        <linearGradient id="lg-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.white}"/><stop offset="1" stop-color="${COLORS.miniSteel}"/></linearGradient>
      </defs>
      <g class="logo-emblem">
        <path d="${hexPath(160, 78, 70)}" fill="${COLORS.bg}" stroke="url(#lg-gold)" stroke-width="7" stroke-linejoin="round"/>
        <path d="${hexPath(160, 78, 54)}" fill="none" stroke="${COLORS.p0}" stroke-width="3" stroke-dasharray="56.5 113" stroke-linejoin="round" opacity="0.9"/>
        <path d="${hexPath(160, 78, 54)}" fill="none" stroke="${COLORS.p1}" stroke-width="3" stroke-dasharray="56.5 113" stroke-dashoffset="-84.75" stroke-linejoin="round" opacity="0.9"/>
        <circle cx="160" cy="78" r="26" fill="none" stroke="url(#lg-gold)" stroke-width="5"/>
        <path d="M160 36v24M160 96v24M118 78h24M178 78h24" stroke="url(#lg-gold)" stroke-width="5" stroke-linecap="round"/>
        <circle cx="160" cy="78" r="6" fill="${COLORS.p1}"/>
      </g>
      <text x="160" y="200" text-anchor="middle" class="logo-word"><tspan fill="url(#lg-steel)">HEX</tspan><tspan fill="url(#lg-gold)">HUNTERS</tspan></text>
      <text x="160" y="232" text-anchor="middle" class="logo-tag" fill="${COLORS.muted}">TABLETOP TACTICS FOR TWO</text>
    </svg>`,
  );
}

/** A player's crest: a hex shield in their color with their number, over turning rays. */
export function crest(player: 0 | 1): HTMLElement {
  const c = PLAYER_COLORS[player];
  const dark = player === 0 ? COLORS.p0Dark : COLORS.p1Dark;
  const light = player === 0 ? COLORS.p0Light : COLORS.p1Light;
  return wrap(
    'crest',
    `<div class="crest-rays" style="--ray:${c}"></div>
    <svg viewBox="0 0 160 170" aria-hidden="true">
      <defs><linearGradient id="cr-${player}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.45" stop-color="${c}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
      <path d="${hexPath(80, 88, 70)}" fill="${COLORS.black}" opacity="0.35"/>
      <path d="${hexPath(80, 82, 70)}" fill="url(#cr-${player})" stroke="${COLORS.white}" stroke-opacity="0.85" stroke-width="4" stroke-linejoin="round"/>
      <path d="${hexPath(80, 82, 53)}" fill="${COLORS.bg}" fill-opacity="0.82" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
      <text x="80" y="84" text-anchor="middle" dominant-baseline="central" class="crest-num" fill="${COLORS.white}">P${player + 1}</text>
      <path d="M38 42 Q80 14 122 42" fill="none" stroke="${COLORS.white}" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round"/>
    </svg>`,
  );
}

/** The victory trophy. */
export function trophy(): HTMLElement {
  return wrap(
    'trophy',
    `<div class="crest-rays" style="--ray:${COLORS.accent}"></div>
    <svg viewBox="0 0 160 170" aria-hidden="true">
      <defs><linearGradient id="tr-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS.moon}"/><stop offset="0.5" stop-color="${COLORS.accent}"/><stop offset="1" stop-color="${COLORS.cpEdge}"/></linearGradient></defs>
      <g stroke="${COLORS.miniInk}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
        <path d="M44 34 H22 Q22 78 54 82 M116 34 H138 Q138 78 106 82" fill="none" stroke="url(#tr-gold)" stroke-width="9"/>
        <path d="M42 22 H118 V58 Q118 104 80 108 Q42 104 42 58 Z" fill="url(#tr-gold)"/>
        <path d="M70 108 H90 V128 H70 Z" fill="url(#tr-gold)"/>
        <path d="M50 128 H110 V146 H50 Z" fill="url(#tr-gold)"/>
        <path d="M80 40 L86 54 L101 55 L89 65 L93 80 L80 72 L67 80 L71 65 L59 55 L74 54 Z" fill="${COLORS.white}" stroke-width="2.5"/>
      </g>
      <path d="M54 30 V60 Q54 80 64 90" fill="none" stroke="${COLORS.white}" stroke-opacity="0.5" stroke-width="5" stroke-linecap="round"/>
    </svg>`,
  );
}
