/**
 * SVG board renderer. Static layers (hexes, terrain) are drawn once per map;
 * shading, movement dots and models are updated in place on every render so CSS
 * transitions can animate them.
 */
import { type Hex, type Point, hexCorners, hexKey, hexToPixel, hexagon } from '../core/hex';
import { aurasOn } from '../core/auras';
import { actionBonus, armorLabel, maxHealth, turnsUntilTransform, unitAt, unitDef, unitSize } from '../core/queries';
import { isCarrier } from '../core/flag';
import type { GameMap, GameState, PlayerId, Unit } from '../core/types';
import type { Bounds } from './camera';
import { getSettings } from './settings';
import { miniIcon, miniIconScale } from './minis';
import { COLORS } from './theme';

export const HEX_SIZE = 32;

const BODY_RADIUS: Record<number, number> = { 1: 12, 2: 16, 3: 21 };
const LABEL_SIZE: Record<number, number> = { 1: 11, 2: 14, 3: 17 };

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

const points = (h: Hex, size = HEX_SIZE) =>
  hexCorners(h, size)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Movement animation speed: milliseconds per hex. */
export const MOVE_MS = 130;

/** Undo: a quick straight slide back to the start hex. */
export const UNDO_MS = 180;

/** Smooth start and stop (sine in-out). */
export const easeInOut = (t: number): number => 0.5 - Math.cos(Math.PI * t) / 2;

/** What to highlight on top of the plain board. */
export interface BoardOverlay {
  /** hexKey -> CSS class for the shade layer (deploy zone, range, hidden...). */
  shade: Map<string, string>;
  /** hexKeys that get a "you can move here" dot. */
  dots: Set<string>;
  selectedId: string | null;
  targetIds: Set<string>;
  specialTargetIds: Set<string>;
  pendingTargetId: string | null;
  /** The selected model's twin, outlined so the pair is easy to spot. */
  partnerId: string | null;
  /** hexKey -> owner of a Sentinel watching that hex (overwatch, shown to both players). */
  watch: Map<string, PlayerId>;
  /** Capture the Flag: the zone where the current player's flag carrier scores, outlined. */
  scoreZone: { player: PlayerId; hexes: Set<string> } | null;
  /** A selected hero with a ranged aura (Field Marshal): the hexes it reaches, and the models inside getting it. */
  auraArea: Set<string>;
  auraUnits: Set<string>;
}

/** Shared SVG definitions: the felt mat texture and the miniatures' gradients. */
function boardDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <filter id="felt-noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.16 0"/>
    </filter>
    <pattern id="felt" width="96" height="96" patternUnits="userSpaceOnUse">
      <rect width="96" height="96" fill="${COLORS.tile}"/>
      <rect width="96" height="96" filter="url(#felt-noise)" fill="${COLORS.feltNoise}"/>
    </pattern>
    <radialGradient id="mini-top" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="${COLORS.miniTop}"/><stop offset="1" stop-color="${COLORS.miniTopDark}"/>
    </radialGradient>
    <radialGradient id="mini-bevel" cx="0.35" cy="0.3" r="0.85">
      <stop offset="0" stop-color="${COLORS.white}" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${COLORS.white}" stop-opacity="0"/>
      <stop offset="1" stop-color="${COLORS.black}" stop-opacity="0.3"/>
    </radialGradient>`;
  return defs;
}

/** A standing banner prop (pole and swallowtail cloth), its foot at the left of hex `h`. */
function banner(h: Hex, parent: SVGElement, cls: string): SVGGElement {
  const c = hexToPixel(h, HEX_SIZE);
  const g = el('g', { class: `prop-banner ${cls}`, transform: `translate(${c.x - HEX_SIZE * 0.62} ${c.y + HEX_SIZE * 0.25})` }, parent);
  el('ellipse', { cx: 1, cy: 0, rx: 5, ry: 2, class: 'prop-shadow' }, g);
  el('line', { x1: 0, y1: 0, x2: 0, y2: -30, class: 'prop-pole' }, g);
  el('path', { d: 'M1 -29 H15 V-15 L8 -19 L1 -15 Z', class: 'prop-cloth' }, g);
  el('circle', { cx: 0, cy: -31, r: 2, class: 'prop-tip' }, g);
  return g;
}

/** Thick outline around an area of hexes: draws only the edges not shared with another hex of it. */
function outlineArea(area: Hex[], cls: string, parent: SVGElement): void {
  for (const h of area) {
    const corners = hexCorners(h, HEX_SIZE);
    const c = hexToPixel(h, HEX_SIZE);
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      // The neighbor across this edge mirrors our center through the edge's midpoint.
      const across = { x: a.x + b.x - c.x, y: a.y + b.y - c.y };
      const inner = area.some((o) => {
        const oc = hexToPixel(o, HEX_SIZE);
        return Math.hypot(oc.x - across.x, oc.y - across.y) < 1;
      });
      if (!inner) el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls }, parent);
    }
  }
}

/** A pennant on a pole, pole foot at (0, 0). `dir` 1 = cloth to the right, -1 = left. */
function pennant(parent: SVGElement, dir: 1 | -1, cls: string): SVGGElement {
  const g = el('g', { class: cls }, parent);
  el('line', { x1: 0, y1: 0, x2: 0, y2: -22, class: 'pole' }, g);
  el('path', { d: `M0 -22L${15 * dir} -16.5L0 -11Z`, class: 'cloth' }, g);
  return g;
}

interface UnitNodes {
  g: SVGGElement;
  die: SVGGElement;
  dieText: SVGTextElement;
  dieRect: SVGRectElement;
  owText: SVGTextElement;
  hp: SVGGElement;
  hpText: SVGTextElement;
  /** Size the model was drawn at; redrawn if it changes (a Zombie starting to crawl). */
  size: number;
  /** Unit type it was drawn as; redrawn if it changes (a Werewolf transforming). */
  type: string;
  moonText: SVGTextElement;
  /** Cracking Armor (Behemoth): current defense, "DEF 7 (-3)". */
  armor: SVGGElement;
  armorText: SVGTextElement;
  armorRect: SVGRectElement;
  /** Limited special uses left (Mercenary's Premium Shots). */
  usesText: SVGTextElement;
}

export class BoardView {
  readonly world: SVGGElement;
  private layers: Record<'base' | 'terrain' | 'watch' | 'shade' | 'goal' | 'cp' | 'dots' | 'units' | 'flag' | 'fx', SVGGElement>;
  private goals = new Map<string, SVGPolygonElement>();
  /** Domination: one group per site (its tinted hexes and outline), colored by owner. */
  private sites: SVGGElement[] = [];
  /** Domination: the banner standing on each site. */
  private siteBanners: SVGGElement[] = [];
  /** Capture the Flag: the flag lying on the ground (hidden while carried). */
  private groundFlag: SVGGElement | null = null;
  private shades = new Map<string, SVGPolygonElement>();
  private watches = new Map<string, SVGPolygonElement>();
  private dots = new Map<string, SVGCircleElement>();
  private units = new Map<string, UnitNodes>();
  /** Dice currently mid-animation; render() leaves their text alone. */
  private rolling = new Set<string>();
  /** Models currently gliding (their position is driven by the tween, not by render). */
  private moving = new Set<string>();

  constructor(svg: SVGSVGElement) {
    svg.prepend(boardDefs());
    this.world = el('g', {}, svg);
    this.layers = {
      base: el('g', {}, this.world),
      terrain: el('g', {}, this.world),
      watch: el('g', {}, this.world),
      shade: el('g', {}, this.world),
      goal: el('g', {}, this.world),
      cp: el('g', {}, this.world),
      dots: el('g', {}, this.world),
      units: el('g', {}, this.world),
      flag: el('g', {}, this.world),
      fx: el('g', {}, this.world),
    };
  }

  /**
   * Draws the static board and returns its bounds in world units. The control point is
   * only drawn in missions that use it (not in Capture the Flag).
   */
  setMap(map: GameMap, showControlPoint = true): Bounds {
    for (const layer of Object.values(this.layers)) layer.replaceChildren();
    this.shades.clear();
    this.goals.clear();
    this.groundFlag = null;
    this.watches.clear();
    this.dots.clear();
    this.units.clear();

    const cpKeys = new Set(showControlPoint ? map.controlPoint.map(hexKey) : []);
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (const h of hexagon(map.radius)) {
      const key = hexKey(h);
      el('polygon', { points: points(h), class: `hex-base${cpKeys.has(key) ? ' cp' : ''}` }, this.layers.base);
      this.shades.set(key, el('polygon', { points: points(h), class: 'shade' }, this.layers.shade));
      this.goals.set(key, el('polygon', { points: points(h, HEX_SIZE - 3), class: 'goal' }, this.layers.goal));
      this.watches.set(key, el('polygon', { points: points(h, HEX_SIZE - 2), class: 'watch' }, this.layers.watch));
      const c = hexToPixel(h, HEX_SIZE);
      const dot = el('circle', { cx: c.x, cy: c.y, r: 6, class: 'reach-dot', visibility: 'hidden' }, this.layers.dots);
      this.dots.set(key, dot);
      for (const p of hexCorners(h, HEX_SIZE)) {
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.minY = Math.min(bounds.minY, p.y);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.maxY = Math.max(bounds.maxY, p.y);
      }
    }

    this.drawTerrain(map);

    // Thick outline around the 7-hex control point.
    if (showControlPoint) outlineArea(map.controlPoint, 'cp-outline', this.layers.cp);

    // Domination: each site's hexes tinted by its owner, with a thick outline (also owner-colored).
    this.sites = (map.sites ?? []).map((site) => {
      const g = el('g', { class: 'site owner-none' }, this.layers.cp);
      for (const h of site) el('polygon', { points: points(h), class: 'site-hex' }, g);
      outlineArea(site, 'site-outline', g);
      return g;
    });
    // Props: a banner on the control point (gold), and one on each Domination site (its
    // owner's color), standing at the center hex's left so a model there doesn't hide it.
    this.siteBanners = (map.sites ?? []).map((site) => banner(site[0], this.layers.flag, 'owner-none'));
    if (showControlPoint) banner(map.controlPoint[0], this.layers.flag, 'cp');

    return bounds;
  }

  /** Draws (or redraws, after a Hill Giant's Hurl changed the map) the terrain layer. */
  /**
   * Draws (or redraws, after a Hill Giant's Hurl changed the map) the terrain: raised stone
   * blocks, height 2 twice as tall as height 1, drawn back to front so nearer blocks cover
   * the ones behind them. Each has a soft shadow, two lit side faces and a top face.
   */
  drawTerrain(map: GameMap): void {
    this.layers.terrain.replaceChildren();
    const pieces = map.terrain
      .flatMap((t) => t.hexes.map((h) => ({ h, t, c: hexToPixel(h, HEX_SIZE) })))
      .sort((a, b) => a.c.y - b.c.y || a.c.x - b.c.x);
    const size = HEX_SIZE - 1;
    for (const { h, t } of pieces) {
      const lift = HEX_SIZE * 0.2 * t.height;
      const ground = hexCorners(h, size);
      const top = ground.map((p) => ({ x: p.x, y: p.y - lift }));
      const pts = (ps: Point[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const g = el('g', { class: `terrain h${t.height} ${t.kind}` }, this.layers.terrain);
      el('polygon', { points: pts(ground.map((p) => ({ x: p.x + 4, y: p.y + 5 }))), class: 'terrain-shadow' }, g);
      // The two front faces (lower-right and lower-left edges), lit from the upper left.
      for (const [i, cls] of [[1, 'side-light'], [2, 'side-dark']] as const) {
        const a = ground[i];
        const b2 = ground[(i + 1) % 6];
        el('polygon', { points: pts([a, b2, top[(i + 1) % 6], top[i]]), class: `terrain-side ${cls}` }, g);
      }
      el('polygon', { points: pts(top), class: 'terrain-top' }, g);
    }
  }

  render(state: GameState, overlay: BoardOverlay): void {
    for (const [key, poly] of this.shades) poly.setAttribute('class', `shade ${overlay.shade.get(key) ?? ''}`);
    for (const [key, poly] of this.watches) {
      const owner = overlay.watch.get(key);
      poly.setAttribute('class', owner === undefined ? 'watch' : `watch on watch-${owner}`);
    }
    for (const [key, dot] of this.dots) dot.setAttribute('visibility', overlay.dots.has(key) ? 'visible' : 'hidden');
    const zone = overlay.scoreZone;
    for (const [key, poly] of this.goals) {
      const cls = overlay.auraArea.has(key) ? 'goal on aura-area' : zone?.hexes.has(key) ? `goal on goal-${zone.player}` : 'goal';
      poly.setAttribute('class', cls);
    }
    this.renderFlag(state);
    this.sites.forEach((g, i) => {
      const owner = state.siteOwners[i];
      const cls = `owner-${owner === undefined || owner === null ? 'none' : owner}`;
      g.setAttribute('class', `site ${cls}`);
      this.siteBanners[i]?.setAttribute('class', `prop-banner ${cls}`);
    });

    const alive = new Set<string>();
    for (const unit of state.units) {
      if (!unit.pos) continue;
      alive.add(unit.id);
      let nodes = this.units.get(unit.id);
      if (nodes && (nodes.size !== unitSize(state, unit) || nodes.type !== unit.type)) {
        nodes.g.remove();
        nodes = undefined;
      }
      nodes ??= this.createUnit(state, unit);
      this.updateUnit(state, unit, nodes, overlay);
    }
    for (const [id, nodes] of this.units) {
      if (alive.has(id)) continue;
      this.units.delete(id);
      nodes.g.classList.add('dead');
      setTimeout(() => nodes.g.remove(), 400);
    }
  }

  /** Capture the Flag: the flag on the ground, drawn above models (offset to the side if one stands on it). */
  private renderFlag(state: GameState): void {
    const at = state.flag?.pos;
    if (!at) {
      this.groundFlag?.setAttribute('visibility', 'hidden');
      return;
    }
    if (!this.groundFlag) {
      this.groundFlag = el('g', { class: 'ground-flag' }, this.layers.flag);
      el('ellipse', { cx: 0, cy: 0, rx: 7, ry: 2.5, class: 'flag-shadow' }, this.groundFlag);
      pennant(el('g', { transform: 'scale(1.35)' }, this.groundFlag), 1, 'flag-pennant');
    }
    const c = hexToPixel(at, HEX_SIZE);
    // A model standing on the flag: draw it at the hex's lower left so both stay visible.
    const dx = unitAt(state, at) ? -HEX_SIZE * 0.55 : 0;
    const dy = unitAt(state, at) ? HEX_SIZE * 0.55 : 9;
    this.groundFlag.setAttribute('transform', `translate(${c.x + dx} ${c.y + dy})`);
    this.groundFlag.setAttribute('visibility', 'visible');
  }

  private createUnit(state: GameState, unit: Unit): UnitNodes {
    const def = unitDef(state, unit);
    const size = unitSize(state, unit);
    const r = BODY_RADIUS[size];
    const g = el('g', { class: 'unit' }, this.layers.units);
    // Place immediately (no transition from the origin) on first appearance.
    g.style.transition = 'none';
    el('circle', { r: r + 9, class: 'ring tgt' }, g);
    el('circle', { r: r + 4, class: 'ring sel' }, g);
    el('circle', { r: r + 3, class: 'brace' }, g);
    // In a selected hero's aura area and getting its bonus (Field Marshal): a gold dashed ring.
    el('circle', { r: r + 6, class: 'aura-ring' }, g);
    // The miniature: a shadow, the base's thickness and team-colored beveled rim, then the
    // painted figure on the base's dark top (src/ui/minis.ts). Units without an icon keep
    // their letter label.
    const mini = el('g', { class: 'mini' }, g);
    el('ellipse', { cx: 2, cy: r * 0.5, rx: r * 1.02, ry: r * 0.45, class: 'mini-shadow' }, mini);
    el('circle', { cy: 2.5, r, class: 'mini-edge' }, mini);
    el('circle', { r, class: 'body' }, mini);
    el('circle', { r, class: 'mini-bevel', fill: 'url(#mini-bevel)' }, mini);
    const icon = miniIcon(unit.type);
    if (icon) {
      el('circle', { r: r * 0.78, class: 'mini-top', fill: 'url(#mini-top)' }, mini);
      const k = miniIconScale(r, size);
      el('g', { class: 'mini-icon', transform: `translate(${-50 * k} ${-52 * k}) scale(${k})` }, mini).innerHTML = icon;
      el('ellipse', { cx: -r * 0.35, cy: -r * 0.55, rx: r * 0.42, ry: r * 0.16, class: 'mini-shine', transform: `rotate(-25 ${-r * 0.35} ${-r * 0.55})` }, mini);
    } else {
      el('text', { class: 'label', 'font-size': LABEL_SIZE[size] }, g).textContent = def.label;
    }

    // Burning: a small flame at the left.
    const flame = el('g', { class: 'flame-icon', transform: `translate(${-r - 5} 0)` }, g);
    el('path', { d: 'M0 6C-4 6 -5 2 -3 -1C-2 1 -1 1 -1 0C-1 -3 1 -5 1 -7C3 -4 5 -1 4 2C3.5 4.5 2 6 0 6Z' }, flame);

    // Twins: a purple chain-link badge at the upper left marks the pair.
    const link = el('g', { class: 'twin-link', transform: `translate(${-r - 3} ${-r + 3})` }, g);
    el('circle', { r: 6.5, class: 'twin-bg' }, link);
    el('ellipse', { cx: -2, cy: 0, rx: 3, ry: 2.2 }, link);
    el('ellipse', { cx: 2, cy: 0, rx: 3, ry: 2.2 }, link);

    // Werewolf: turns left until it transforms, in a small moon at the right.
    const moon = el('g', { class: 'moon', transform: `translate(${r + 6} 2)` }, g);
    el('circle', { r: 6.5 }, moon);
    const moonText = el('text', {}, moon);

    // Hacked (Hacker): a small green "</>" chip at the left, until its owner's hacked turn is over.
    const hackMark = el('g', { class: 'hack-mark', transform: `translate(${-r - 6} 2)` }, g);
    el('rect', { x: -8, y: -6, width: 16, height: 12, rx: 3 }, hackMark);
    el('text', {}, hackMark).textContent = '</>';

    // Resting (Skeleton on a back-to-back turn): "Zz" above the model.
    el('text', { class: 'zz', x: r * 0.6, y: -r - 2 }, g).textContent = 'Zz';

    // Capture the Flag: the carrier holds a pennant, rising from its upper left.
    const carry = el('g', { class: 'carry-flag', transform: `translate(${-r * 0.45} ${-r * 0.35}) scale(1.25)` }, g);
    pennant(carry, -1, 'flag-pennant');

    // Hero crown, above the model.
    const crown = el('g', { class: 'crown', transform: `translate(0 ${-r - 3})` }, g);
    el('path', { d: 'M-7 3L-7 -3L-3.5 0L0 -5L3.5 0L7 -3L7 3Z' }, crown);

    // Spotted marker: small crosshair at the lower left.
    const spot = el('g', { class: 'spot', transform: `translate(${-r - 2} ${r - 2})` }, g);
    el('circle', { r: 6, class: 'spot-bg' }, spot);
    el('path', { d: 'M-4 0H4M0 -4V4', class: 'spot-cross' }, spot);

    // The pop animation uses a CSS transform, so position the badge with a wrapper group.
    const dieWrap = el('g', { transform: `translate(${r * 0.8 + 3} ${-r * 0.8 - 3})` }, g);
    const die = el('g', { class: 'badge die' }, dieWrap);
    const dieRect = el('rect', { x: -10, y: -10, width: 20, height: 20, rx: 5 }, die);
    const dieText = el('text', {}, die);

    // Overwatch: eye + locked die at the upper left (visible to both players).
    const ow = el('g', { class: 'badge ow', transform: `translate(${-r - 6} ${-r + 1})` }, g);
    el('rect', { x: -12, y: -8, width: 26, height: 16, rx: 8 }, ow);
    el('ellipse', { cx: -5, cy: 0, rx: 5, ry: 3.2, class: 'eye' }, ow);
    el('circle', { cx: -5, cy: 0, r: 1.6, class: 'pupil' }, ow);
    const owText = el('text', { x: 6 }, ow);

    // Loaded shell at the lower right (units that must load to fire).
    const shell = el('g', { class: 'shell', transform: `translate(${r * 0.8 + 3} ${r * 0.6})` }, g);
    el('path', { d: 'M-4 6V-2A4 4 0 0 1 4 -2V6Z' }, shell);

    const hp = el('g', { class: 'badge hp', transform: `translate(0 ${r + 5})` }, g);
    el('rect', { x: -14, y: -8, width: 28, height: 16, rx: 8 }, hp);
    const hpText = el('text', {}, hp);

    // Cracking Armor (Behemoth): its current defense, under the health badge.
    // Placed where other models show their die (it has none), with a shield icon.
    const armor = el('g', { class: 'badge armor', transform: `translate(${r * 0.8 + 3} ${-r * 0.8 - 3})` }, g);
    const armorRect = el('rect', { x: -18, y: -9, width: 53, height: 18, rx: 4 }, armor);
    el('path', { class: 'shield', d: 'M-15 -6L-10 -8L-5 -6V-1C-5 3 -8 5 -10 6C-12 5 -15 3 -15 -1Z' }, armor);
    const armorText = el('text', { x: -3, class: 'armor-text' }, armor);

    // Limited special (Mercenary): shots left, as a gold "★2" tag at the lower right.
    const uses = el('g', { class: 'uses', transform: `translate(${r * 0.8 + 4} ${r * 0.6})` }, g);
    el('rect', { x: -9, y: -6, width: 18, height: 12, rx: 3 }, uses);
    const usesText = el('text', {}, uses);

    const nodes = { g, die, dieText, dieRect, owText, moonText, hp, hpText, size, type: unit.type, armor, armorText, armorRect, usesText };
    this.units.set(unit.id, nodes);
    requestAnimationFrame(() => requestAnimationFrame(() => (g.style.transition = '')));
    return nodes;
  }

  private updateUnit(state: GameState, unit: Unit, n: UnitNodes, o: BoardOverlay): void {
    const def = unitDef(state, unit);
    // While a model is gliding along its path, the tween owns its position.
    if (!this.moving.has(unit.id)) {
      const p = hexToPixel(unit.pos!, HEX_SIZE);
      n.g.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }

    const isCurrent = state.phase === 'play' && unit.owner === state.current;
    const spent = isCurrent && unit.acted && unit.movesLeft === 0;
    const cls = n.g.classList;
    cls.toggle('p0', unit.owner === 0);
    cls.toggle('p1', unit.owner === 1);
    cls.toggle('spent', spent);
    cls.toggle('selected', o.selectedId === unit.id);
    cls.toggle('target', o.targetIds.has(unit.id));
    cls.toggle('special-target', o.specialTargetIds.has(unit.id));
    cls.toggle('pending', o.pendingTargetId === unit.id);
    cls.toggle('braced', unit.braced);
    cls.toggle('spotted', unit.spottedBy !== null);
    cls.toggle('loaded', unit.loaded);
    cls.toggle('hero', !!def.hero);
    cls.toggle('crawling', unit.crawling);
    cls.toggle('resting', unit.resting && state.phase === 'play' && unit.owner === state.current);
    cls.toggle('burning', unit.burning);
    cls.toggle('hacked', unit.hacked || (unit.hackPenalty > 0 && (unit.die !== null || unit.gambling)));
    cls.toggle('twin', !!unit.partnerId);
    cls.toggle('carrier', isCarrier(state, unit));
    cls.toggle('partner', o.partnerId === unit.id);
    const transformsIn = turnsUntilTransform(state, unit);
    cls.toggle('counting', transformsIn !== null);
    n.moonText.textContent = transformsIn === null ? '' : String(transformsIn);
    cls.toggle('aura', aurasOn(state, unit).length > 0);
    cls.toggle('in-aura', o.auraUnits.has(unit.id));
    cls.toggle('overwatching', !!unit.overwatch);
    n.owText.textContent = unit.overwatch ? String(unit.overwatch.die) : '';

    n.die.style.display = unit.die === null && !unit.gambling ? 'none' : '';
    n.die.classList.toggle('used', unit.acted);
    if (!this.rolling.has(unit.id)) {
      // Standard Bearer: show "8+2" while the model would get a bonus for acting here.
      const bonus = unit.die !== null && !unit.acted ? actionBonus(state, unit) : 0;
      let text = unit.gambling ? '?' : unit.die === null ? '' : bonus ? `${unit.die}+${bonus}` : String(unit.die);
      // Hacked: the die is already reduced; show by how much ("7 (-2)").
      if (text && unit.hackPenalty) text += ` (-${unit.hackPenalty})`;
      n.dieText.textContent = text;
      const width = text.length > 2 ? Math.max(30, text.length * 8 + 4) : 20;
      n.dieRect.setAttribute('width', String(width));
      n.dieRect.setAttribute('x', String(-width / 2));
      n.die.classList.toggle('boosted', unit.dieBonus > 0 || bonus > 0);
      n.die.classList.toggle('hacked', unit.hackPenalty > 0);
    }

    cls.toggle('limited', unit.usesLeft !== null);
    cls.toggle('empty-uses', unit.usesLeft === 0);
    n.usesText.textContent = unit.usesLeft === null ? '' : `★${unit.usesLeft}`;
    n.armor.style.display = def.crackingArmor ? '' : 'none';
    if (def.crackingArmor) {
      const text = armorLabel(state, unit)!;
      n.armorText.textContent = text;
      // Shield on the left, the text starts after it.
      n.armorRect.setAttribute('width', String(text.length * 7 + 18));
      n.armor.classList.toggle('cracked', unit.armorCracks > 0);
    }
    n.hpText.textContent = String(unit.hp);
    n.hp.classList.toggle('low', unit.hp <= Math.ceil(maxHealth(state, unit) / 3));
  }

  /**
   * Glides a model from `from` along `path` (the hexes it actually passes through, so
   * never through walls), ~MOVE_MS per hex, eased in at the start and out at the end.
   * `airborne` adds the Dragon's lift-off shadow. With animations off it just snaps.
   */
  async animateMove(
    unitId: string,
    from: Hex,
    path: Hex[],
    opts: { airborne?: boolean; durationMs?: number } = {},
  ): Promise<void> {
    const n = this.units.get(unitId);
    if (!n || !path.length) return;
    const pts = [from, ...path].map((h) => hexToPixel(h, HEX_SIZE));
    const place = (p: Point) => (n.g.style.transform = `translate(${p.x}px, ${p.y}px)`);
    if (!getSettings().animations) {
      place(pts[pts.length - 1]);
      return;
    }
    // Distance along the polyline, so a 2-hex Vault leap takes as long as 2 steps.
    const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    const total = seg.reduce((a, b) => a + b, 0);
    const duration = opts.durationMs ?? Math.max(1, Math.round(total / (HEX_SIZE * Math.sqrt(3)))) * MOVE_MS;
    this.moving.add(unitId);
    n.g.classList.toggle('airborne', !!opts.airborne);
    place(pts[0]); // start where it was (a render may already have drawn it at the end)
    try {
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          let d = easeInOut(t) * total;
          let i = 0;
          while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
          const k = seg[i] ? Math.min(1, d / seg[i]) : 1;
          place({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k });
          if (t < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    } finally {
      this.moving.delete(unitId);
      n.g.classList.remove('airborne');
      place(pts[pts.length - 1]);
    }
  }

  /** Brief line from attacker to target. */
  shot(from: Hex, to: Hex, color: string): void {
    const a = hexToPixel(from, HEX_SIZE);
    const b = hexToPixel(to, HEX_SIZE);
    const line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'shot', stroke: color }, this.layers.fx);
    line.style.stroke = color;
    setTimeout(() => line.remove(), 650);
  }

  /** Briefly highlights hexes (explosions, flames). */
  flash(hexes: Hex[], className: string): void {
    for (const h of hexes) {
      const poly = el('polygon', { points: points(h), class: `flash ${className}` }, this.layers.fx);
      setTimeout(() => poly.remove(), 700);
    }
  }

  /** Text that floats up from a hex and fades out. */
  floatText(at: Hex, text: string, color: string): void {
    const p: Point = hexToPixel(at, HEX_SIZE);
    const t = el('text', { x: p.x, y: p.y - 22, class: 'float-text', fill: color }, this.layers.fx);
    t.textContent = text;
    setTimeout(() => t.remove(), 1150);
  }

  /** Spins the dice badges through random numbers, then reveals the real results. */
  async rollDice(dice: Record<string, number>, sides: number): Promise<void> {
    const ids = Object.keys(dice).filter((id) => this.units.has(id));
    ids.forEach((id) => {
      this.rolling.add(id);
      this.units.get(id)!.die.classList.add('rolling');
    });
    const end = performance.now() + (getSettings().animations ? 700 : 0);
    while (performance.now() < end) {
      for (const id of ids) this.units.get(id)!.dieText.textContent = String(1 + Math.floor(Math.random() * sides));
      await sleep(60);
    }
    for (const id of ids) {
      const n = this.units.get(id)!;
      this.rolling.delete(id);
      n.die.classList.remove('rolling');
      n.dieText.textContent = String(dice[id]);
      n.die.classList.remove('pop');
      void n.die.getBoundingClientRect(); // restart the animation
      n.die.classList.add('pop');
    }
  }
}
