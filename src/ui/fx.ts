/**
 * Combat and feedback effects, drawn into the board's fx layer with the Web Animations
 * API: tracers, arcing shells, explosions, slashes, flames, beams, sparks, smoke, rings.
 * Each effect cleans up after itself. With animations off (menu setting) effects are
 * skipped and their promises resolve at once.
 */
import type { Point } from '../core/hex';
import { getSettings } from './settings';
import { COLORS } from './theme';

const NS = 'http://www.w3.org/2000/svg';

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  n.setAttribute('pointer-events', 'none');
  parent.appendChild(n);
  return n;
}

const on = () => getSettings().animations;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs a WAAPI animation and removes the element when it ends. */
function run(n: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  const done = () => n.remove();
  try {
    return n.animate(frames, { fill: 'forwards', ...opts }).finished.then(done, done);
  } catch {
    done();
    return Promise.resolve();
  }
}

export type AttackStyle = 'bullet' | 'heavy' | 'shell' | 'melee' | 'fire';

export class Fx {
  constructor(
    private layer: SVGGElement,
    /** The element to shake on big hits (the board's world group). */
    private world: SVGGElement,
  ) {}

  /** A fast, bright tracer round from a to b, with a muzzle flash. */
  async tracer(a: Point, b: Point, color: string = COLORS.fxGold, heavy = false): Promise<void> {
    if (!on()) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dash = heavy ? 34 : 22;
    this.burstAt(a, heavy ? 11 : 8, COLORS.white, 120);
    const glow = node('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': heavy ? 7 : 5, 'stroke-linecap': 'round', opacity: 0.35, 'stroke-dasharray': `${dash} ${len + dash}` }, this.layer);
    const core = node('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: COLORS.white, 'stroke-width': heavy ? 3 : 2, 'stroke-linecap': 'round', 'stroke-dasharray': `${dash} ${len + dash}` }, this.layer);
    const ms = Math.min(260, 70 + len * (heavy ? 0.45 : 0.6));
    const frames = [{ strokeDashoffset: dash }, { strokeDashoffset: -len }];
    void run(glow, frames, { duration: ms, easing: 'linear' });
    await run(core, frames, { duration: ms, easing: 'linear' });
  }

  /** A lobbed shell: rises and falls along an arc with a shadow underneath. */
  async shell(a: Point, b: Point, color: string = COLORS.miniSteelDark): Promise<void> {
    if (!on()) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ms = Math.min(620, 260 + len * 1.1);
    const height = Math.min(90, 26 + len * 0.3);
    this.burstAt(a, 10, COLORS.white, 140);
    const shadow = node('ellipse', { rx: 5, ry: 2.5, fill: COLORS.black, opacity: 0.3 }, this.layer);
    const ball = node('circle', { r: 4.5, fill: color, stroke: COLORS.miniInk, 'stroke-width': 1.5 }, this.layer);
    const steps = 14;
    const frames = (lift: boolean): Keyframe[] =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t - (lift ? Math.sin(Math.PI * t) * height : 0);
        const s = lift ? 1 + Math.sin(Math.PI * t) * 0.7 : 1 - Math.sin(Math.PI * t) * 0.4;
        return { transform: `translate(${x}px, ${y}px) scale(${s})`, offset: t };
      });
    void run(shadow, frames(false), { duration: ms, easing: 'linear' });
    await run(ball, frames(true), { duration: ms, easing: 'linear' });
  }

  /** A fireball or flame bolt. */
  async fireBolt(a: Point, b: Point): Promise<void> {
    if (!on()) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ms = Math.min(360, 120 + len * 0.8);
    const ball = node('circle', { r: 7, fill: COLORS.miniFlame, stroke: COLORS.miniGold, 'stroke-width': 3 }, this.layer);
    const trail = node('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: COLORS.miniFlame, 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.5, 'stroke-dasharray': `30 ${len + 30}` }, this.layer);
    void run(trail, [{ strokeDashoffset: 30 }, { strokeDashoffset: -len }], { duration: ms, easing: 'linear' });
    await run(ball, [{ transform: `translate(${a.x}px, ${a.y}px)` }, { transform: `translate(${b.x}px, ${b.y}px)` }], { duration: ms, easing: 'ease-in' });
  }

  /** A melee slash across the target. */
  async slash(p: Point, color: string = COLORS.white): Promise<void> {
    if (!on()) return;
    const d = `M${p.x - 20} ${p.y - 14} Q${p.x + 4} ${p.y - 8} ${p.x + 20} ${p.y + 16}`;
    const arc = node('path', { d, fill: 'none', stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': '60 60' }, this.layer);
    const arc2 = node('path', { d, fill: 'none', stroke: COLORS.fxGold, 'stroke-width': 11, 'stroke-linecap': 'round', opacity: 0.35, 'stroke-dasharray': '60 60' }, this.layer);
    const frames = [{ strokeDashoffset: 60, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.55 }, { strokeDashoffset: -20, opacity: 0 }];
    void run(arc2, frames, { duration: 260, easing: 'ease-out' });
    await run(arc, frames, { duration: 260, easing: 'ease-out' });
  }

  /** A flickering energy beam (Hack, Spot, Heal links). */
  async beam(a: Point, b: Point, color: string): Promise<void> {
    if (!on()) return;
    const n = 7;
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const zig = () =>
      Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n;
        const off = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 12;
        return `${a.x + (b.x - a.x) * t + (nx / len) * off},${a.y + (b.y - a.y) * t + (ny / len) * off}`;
      }).join(' ');
    for (let k = 0; k < 3; k++) {
      const line = node('polyline', { points: zig(), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, this.layer);
      void run(line, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay: k * 70 });
    }
    await wait(300);
  }

  /** A rope that shoots out to b and snaps back (Hook). */
  async rope(a: Point, b: Point): Promise<void> {
    if (!on()) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const line = node('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: COLORS.miniSteel, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': `${len} ${len}` }, this.layer);
    await run(line, [{ strokeDashoffset: len }, { strokeDashoffset: 0, offset: 0.45 }, { strokeDashoffset: 0, offset: 0.7 }, { strokeDashoffset: len }], { duration: 420, easing: 'ease-in-out' });
  }

  /** A quick flash of light at a point (muzzle flash, impact). */
  burstAt(p: Point, r: number, color: string, ms = 180): void {
    if (!on()) return;
    const c = node('circle', { cx: p.x, cy: p.y, r, fill: color }, this.layer);
    c.style.transformOrigin = `${p.x}px ${p.y}px`;
    void run(c, [{ transform: 'scale(0.4)', opacity: 0.95 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }

  /** Sparks flying out from a point. */
  sparks(p: Point, color: string, count = 7, reach = 22): void {
    if (!on()) return;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.7;
      const d = reach * (0.6 + Math.random() * 0.7);
      const s = node('circle', { cx: p.x, cy: p.y, r: 1.6 + Math.random() * 1.6, fill: color }, this.layer);
      void run(s, [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * d}px, ${Math.sin(angle) * d + 6}px)`, opacity: 0 }], {
        duration: 320 + Math.random() * 180,
        easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)',
      });
    }
  }

  /** An expanding ring (buffs, claims, shockwaves). */
  ring(p: Point, color: string, radius = 30, ms = 520): void {
    if (!on()) return;
    const c = node('circle', { cx: p.x, cy: p.y, r: radius, fill: 'none', stroke: color, 'stroke-width': 4 }, this.layer);
    c.style.transformOrigin = `${p.x}px ${p.y}px`;
    void run(c, [{ transform: 'scale(0.2)', opacity: 1 }, { transform: 'scale(1)', opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }

  /** Drifting smoke puffs (a model destroyed, terrain smashed). */
  smoke(p: Point, count = 6, color: string = COLORS.miniRock): void {
    if (!on()) return;
    for (let i = 0; i < count; i++) {
      const dx = (Math.random() - 0.5) * 30;
      const puff = node('circle', { cx: p.x + (Math.random() - 0.5) * 12, cy: p.y + (Math.random() - 0.5) * 8, r: 6 + Math.random() * 6, fill: color }, this.layer);
      void run(puff, [{ transform: 'translate(0,0) scale(0.5)', opacity: 0.75 }, { transform: `translate(${dx}px, ${-22 - Math.random() * 18}px) scale(1.6)`, opacity: 0 }], {
        duration: 600 + Math.random() * 400,
        delay: i * 30,
        easing: 'ease-out',
      });
    }
  }

  /** A blast: flash, fireball, shockwave ring, sparks and smoke. */
  explosion(p: Point, radius = 44): void {
    if (!on()) return;
    this.burstAt(p, radius * 0.55, COLORS.white, 160);
    this.burstAt(p, radius * 0.8, COLORS.miniFlame, 380);
    this.ring(p, COLORS.miniGold, radius, 460);
    this.sparks(p, COLORS.miniGold, 12, radius);
    this.smoke(p, 5, COLORS.miniSteelDark);
    this.shake(7);
  }

  /** Flames licking over hexes (Torch, Breath), nearest first. */
  flames(points: Point[], origin: Point): void {
    if (!on()) return;
    const sorted = [...points].sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
    sorted.forEach((p, i) => {
      for (let k = 0; k < 6; k++) {
        const x = p.x + (Math.random() - 0.5) * 30;
        const y = p.y + (Math.random() - 0.5) * 22;
        const f = node('circle', { cx: x, cy: y, r: 7 + Math.random() * 6, fill: k % 2 ? COLORS.miniFlame : COLORS.miniGold }, this.layer);
        f.style.transformOrigin = `${x}px ${y}px`;
        void run(f, [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 0.9, offset: 0.3 }, { transform: 'translateY(-16px) scale(0.5)', opacity: 0 }], {
          duration: 480 + Math.random() * 220,
          delay: i * 70 + k * 35,
          easing: 'ease-out',
        });
      }
    });
  }

  /** Confetti falling over the board (victory). */
  confetti(bounds: { minX: number; maxX: number; minY: number; maxY: number }, colors: string[]): void {
    if (!on()) return;
    for (let i = 0; i < 70; i++) {
      const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const piece = node('rect', { x, y: bounds.minY - 30, width: 6, height: 10, rx: 1.5, fill: colors[i % colors.length] }, this.layer);
      piece.style.transformOrigin = `${x}px ${bounds.minY}px`;
      void run(piece, [{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 120}px, ${bounds.maxY - bounds.minY + 80}px) rotate(${(Math.random() - 0.5) * 1400}deg)`, opacity: 0.9 }], {
        duration: 1800 + Math.random() * 1600,
        delay: Math.random() * 900,
        easing: 'cubic-bezier(0.3, 0.1, 0.7, 1)',
      });
    }
  }

  /** Shakes the whole board (px = strength). */
  shake(px: number): void {
    if (!on()) return;
    const frames: Keyframe[] = [0, 1, -1, 0.7, -0.5, 0.25, 0].map((k, i) => ({
      translate: `${k * px}px ${i % 2 ? -k * px * 0.6 : k * px * 0.4}px`,
    }));
    try {
      this.world.animate(frames, { duration: 300, easing: 'ease-out' });
    } catch {
      // No animation support: skip.
    }
  }
}
