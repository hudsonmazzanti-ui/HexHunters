/**
 * Pan & zoom for the SVG board, plus tap detection.
 * One finger (or mouse) drags to pan, two fingers pinch to zoom, the mouse wheel
 * zooms on desktop. A press that barely moves is reported as a tap, in world
 * coordinates.
 */
import type { Point } from '../core/hex';

const TAP_SLOP = 10; // px a press may move and still count as a tap
const MAX_SCALE = 4;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  private x = 0;
  private y = 0;
  private scale = 1;
  private minScale = 0.2;
  private pointers = new Map<number, Point>();
  private gesture: { start: Point; moved: boolean; multi: boolean } | null = null;
  private lastPinch: { dist: number; mid: Point } | null = null;

  constructor(
    private svg: SVGSVGElement,
    private world: SVGGElement,
    private bounds: Bounds,
    private onTap: (world: Point) => void,
  ) {
    svg.addEventListener('pointerdown', this.onDown);
    svg.addEventListener('pointermove', this.onMove);
    svg.addEventListener('pointerup', this.onUp);
    svg.addEventListener('pointercancel', this.onCancel);
    svg.addEventListener('wheel', this.onWheel, { passive: false });
    // Refit when the width changes (rotation, window resize), but not when a mobile
    // browser's address bar slides in and out, which only changes the height.
    let lastWidth = 0;
    new ResizeObserver(() => {
      const { width } = svg.getBoundingClientRect();
      if (Math.abs(width - lastWidth) > 1) this.fit();
      lastWidth = width;
    }).observe(svg);
  }

  /** Zoom and center so the whole board is visible. */
  fit(): void {
    const { width, height } = this.svg.getBoundingClientRect();
    if (!width || !height) return;
    const pad = 12;
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    this.scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
    this.minScale = this.scale * 0.8;
    this.x = width / 2 - ((this.bounds.minX + this.bounds.maxX) / 2) * this.scale;
    this.y = height / 2 - ((this.bounds.minY + this.bounds.maxY) / 2) * this.scale;
    this.apply();
  }

  private apply(): void {
    this.world.setAttribute('transform', `translate(${this.x} ${this.y}) scale(${this.scale})`);
  }

  private local(e: { clientX: number; clientY: number }): Point {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toWorld(p: Point): Point {
    return { x: (p.x - this.x) / this.scale, y: (p.y - this.y) / this.scale };
  }

  private zoomAt(screen: Point, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(this.minScale, this.scale * factor));
    const k = next / this.scale;
    this.x = screen.x - (screen.x - this.x) * k;
    this.y = screen.y - (screen.y - this.y) * k;
    this.scale = next;
  }

  private pinchInfo(): { dist: number; mid: Point } {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  private onDown = (e: PointerEvent): void => {
    this.svg.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.gesture = { start: p, moved: false, multi: false };
    } else if (this.gesture) {
      this.gesture.multi = true;
      this.lastPinch = this.pinchInfo();
    }
  };

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.gesture) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size >= 2 && this.lastPinch) {
      const now = this.pinchInfo();
      this.x += now.mid.x - this.lastPinch.mid.x;
      this.y += now.mid.y - this.lastPinch.mid.y;
      if (this.lastPinch.dist > 0) this.zoomAt(now.mid, now.dist / this.lastPinch.dist);
      this.lastPinch = now;
      this.apply();
      return;
    }

    if (!this.gesture.moved) {
      const d = Math.hypot(p.x - this.gesture.start.x, p.y - this.gesture.start.y);
      if (d < TAP_SLOP) return;
      this.gesture.moved = true;
    }
    this.x += p.x - prev.x;
    this.y += p.y - prev.y;
    this.apply();
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.lastPinch = null;
    if (this.pointers.size > 0 || !this.gesture) return;
    const g = this.gesture;
    this.gesture = null;
    if (p && !g.moved && !g.multi) this.onTap(this.toWorld(p));
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = null;
    this.lastPinch = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomAt(this.local(e), Math.exp(-e.deltaY * 0.0015));
    this.apply();
  };
}
