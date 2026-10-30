/**
 * SVG board renderer. Static layers (hexes, terrain) are drawn once per map;
 * shading, movement dots and models are updated in place on every render so CSS
 * transitions can animate them.
 */
import { type Hex, type Point, hexCorners, hexKey, hexToPixel, hexagon } from '../core/hex';
import { unitDef } from '../core/queries';
import type { GameMap, GameState, PlayerId, Unit } from '../core/types';
import type { Bounds } from './camera';

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
  /** hexKey -> owner of a Sentinel watching that hex (overwatch, shown to both players). */
  watch: Map<string, PlayerId>;
}

interface UnitNodes {
  g: SVGGElement;
  die: SVGGElement;
  dieText: SVGTextElement;
  owText: SVGTextElement;
  hp: SVGGElement;
  hpText: SVGTextElement;
}

export class BoardView {
  readonly world: SVGGElement;
  private layers: Record<'base' | 'terrain' | 'watch' | 'shade' | 'cp' | 'dots' | 'units' | 'fx', SVGGElement>;
  private shades = new Map<string, SVGPolygonElement>();
  private watches = new Map<string, SVGPolygonElement>();
  private dots = new Map<string, SVGCircleElement>();
  private units = new Map<string, UnitNodes>();
  /** Dice currently mid-animation; render() leaves their text alone. */
  private rolling = new Set<string>();

  constructor(svg: SVGSVGElement) {
    this.world = el('g', {}, svg);
    this.layers = {
      base: el('g', {}, this.world),
      terrain: el('g', {}, this.world),
      watch: el('g', {}, this.world),
      shade: el('g', {}, this.world),
      cp: el('g', {}, this.world),
      dots: el('g', {}, this.world),
      units: el('g', {}, this.world),
      fx: el('g', {}, this.world),
    };
  }

  /** Draws the static board and returns its bounds in world units. */
  setMap(map: GameMap): Bounds {
    for (const layer of Object.values(this.layers)) layer.replaceChildren();
    this.shades.clear();
    this.watches.clear();
    this.dots.clear();
    this.units.clear();

    const cpKeys = new Set(map.controlPoint.map(hexKey));
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (const h of hexagon(map.radius)) {
      const key = hexKey(h);
      el('polygon', { points: points(h), class: `hex-base${cpKeys.has(key) ? ' cp' : ''}` }, this.layers.base);
      this.shades.set(key, el('polygon', { points: points(h), class: 'shade' }, this.layers.shade));
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

    for (const t of map.terrain) {
      for (const h of t.hexes) {
        el('polygon', { points: points(h, HEX_SIZE - 1), class: `terrain h${t.height}` }, this.layers.terrain);
        const c = hexToPixel(h, HEX_SIZE);
        el('text', { x: c.x, y: c.y, class: 'terrain-label' }, this.layers.terrain).textContent = String(t.height);
      }
    }

    // Thick outline around the 7-hex control point: draw only edges not shared with another CP hex.
    for (const h of map.controlPoint) {
      const corners = hexCorners(h, HEX_SIZE);
      for (let i = 0; i < 6; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 6];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const c = hexToPixel(h, HEX_SIZE);
        // Neighbor across this edge is the hex whose center mirrors ours through the edge midpoint.
        const across = { x: 2 * mid.x - c.x, y: 2 * mid.y - c.y };
        const isInner = map.controlPoint.some((o) => {
          const oc = hexToPixel(o, HEX_SIZE);
          return Math.hypot(oc.x - across.x, oc.y - across.y) < 1;
        });
        if (!isInner) el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cp-outline' }, this.layers.cp);
      }
    }

    return bounds;
  }

  render(state: GameState, overlay: BoardOverlay): void {
    for (const [key, poly] of this.shades) poly.setAttribute('class', `shade ${overlay.shade.get(key) ?? ''}`);
    for (const [key, poly] of this.watches) {
      const owner = overlay.watch.get(key);
      poly.setAttribute('class', owner === undefined ? 'watch' : `watch on watch-${owner}`);
    }
    for (const [key, dot] of this.dots) dot.setAttribute('visibility', overlay.dots.has(key) ? 'visible' : 'hidden');

    const alive = new Set<string>();
    for (const unit of state.units) {
      if (!unit.pos) continue;
      alive.add(unit.id);
      const nodes = this.units.get(unit.id) ?? this.createUnit(state, unit);
      this.updateUnit(state, unit, nodes, overlay);
    }
    for (const [id, nodes] of this.units) {
      if (alive.has(id)) continue;
      this.units.delete(id);
      nodes.g.classList.add('dead');
      setTimeout(() => nodes.g.remove(), 400);
    }
  }

  private createUnit(state: GameState, unit: Unit): UnitNodes {
    const def = unitDef(state, unit);
    const r = BODY_RADIUS[def.size];
    const g = el('g', { class: 'unit' }, this.layers.units);
    // Place immediately (no transition from the origin) on first appearance.
    g.style.transition = 'none';
    el('circle', { r: r + 9, class: 'ring tgt' }, g);
    el('circle', { r: r + 4, class: 'ring sel' }, g);
    el('circle', { r: r + 3, class: 'brace' }, g);
    el('circle', { r, class: 'body' }, g);
    el('text', { class: 'label', 'font-size': LABEL_SIZE[def.size] }, g).textContent = def.label;

    // Spotted marker: small crosshair at the lower left.
    const spot = el('g', { class: 'spot', transform: `translate(${-r - 2} ${r - 2})` }, g);
    el('circle', { r: 6, fill: '#f97316', stroke: '#111', 'stroke-width': 1.5 }, spot);
    el('path', { d: 'M-4 0H4M0 -4V4', stroke: '#111', 'stroke-width': 1.5 }, spot);

    // The pop animation uses a CSS transform, so position the badge with a wrapper group.
    const dieWrap = el('g', { transform: `translate(${r * 0.8 + 3} ${-r * 0.8 - 3})` }, g);
    const die = el('g', { class: 'badge die' }, dieWrap);
    el('rect', { x: -9, y: -9, width: 18, height: 18, rx: 4 }, die);
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
    el('rect', { x: -12, y: -7, width: 24, height: 14, rx: 7 }, hp);
    const hpText = el('text', {}, hp);

    const nodes = { g, die, dieText, owText, hp, hpText };
    this.units.set(unit.id, nodes);
    requestAnimationFrame(() => requestAnimationFrame(() => (g.style.transition = '')));
    return nodes;
  }

  private updateUnit(state: GameState, unit: Unit, n: UnitNodes, o: BoardOverlay): void {
    const def = unitDef(state, unit);
    const p = hexToPixel(unit.pos!, HEX_SIZE);
    n.g.style.transform = `translate(${p.x}px, ${p.y}px)`;

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
    cls.toggle('overwatching', !!unit.overwatch);
    n.owText.textContent = unit.overwatch ? String(unit.overwatch.die) : '';

    n.die.style.display = unit.die === null ? 'none' : '';
    n.die.classList.toggle('used', unit.acted);
    n.die.classList.toggle('boosted', unit.dieBonus > 0);
    if (!this.rolling.has(unit.id)) n.dieText.textContent = unit.die === null ? '' : String(unit.die);

    n.hpText.textContent = String(unit.hp);
    n.hp.classList.toggle('low', unit.hp <= Math.ceil(def.health / 3));
  }

  /** Walks a unit along a path one hex at a time. */
  async animateMove(unitId: string, path: Hex[]): Promise<void> {
    const n = this.units.get(unitId);
    if (!n) return;
    for (const h of path) {
      const p = hexToPixel(h, HEX_SIZE);
      n.g.style.transform = `translate(${p.x}px, ${p.y}px)`;
      await sleep(150);
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
    const end = performance.now() + 700;
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
