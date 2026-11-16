/** Full-screen cover used for handoffs between players, menus and the win screen. */

export interface OverlayButton {
  label: string;
  className?: string;
  onClick: () => void;
}

export interface OverlayOptions {
  title: string;
  lines?: string[];
  /** Optional element shown above the title (e.g. the coin-flip coin). */
  art?: HTMLElement;
  /** Background color; defaults to a dark neutral. */
  color?: string;
  /** If set, tapping anywhere closes the overlay and resolves the promise. */
  tapText?: string;
  buttons?: OverlayButton[];
  /** Extra class on the card (e.g. 'wide' for the briefing). */
  className?: string;
  /** Put the art under the title instead of above it (the briefing cards). */
  artBelowTitle?: boolean;
  /** A small line above the title, in capitals ("ROUND 3", "VICTORY"). */
  eyebrow?: string;
}

import { hexBackdrop } from './emblems';

const root = () => document.getElementById('overlay')!;

export function showOverlay(opts: OverlayOptions): Promise<void> {
  const overlay = root();
  overlay.style.setProperty('--overlay-bg', opts.color ?? '');
  const card = document.createElement('div');
  card.className = `overlay-card ${opts.className ?? ''}`.trim();

  if (opts.art && !opts.artBelowTitle) card.append(opts.art);
  if (opts.eyebrow) {
    const eyebrow = document.createElement('div');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = opts.eyebrow;
    card.append(eyebrow);
  }
  if (opts.title) {
    const h1 = document.createElement('h1');
    h1.textContent = opts.title;
    card.append(h1);
  }
  if (opts.art && opts.artBelowTitle) card.append(opts.art);
  for (const line of opts.lines ?? []) {
    const p = document.createElement('p');
    p.textContent = line;
    card.append(p);
  }

  return new Promise((resolve) => {
    const close = () => {
      overlay.hidden = true;
      overlay.onclick = null;
      resolve();
    };
    for (const b of opts.buttons ?? []) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.className = b.className ?? '';
      btn.onclick = (e) => {
        e.stopPropagation();
        close();
        b.onClick();
      };
      card.append(btn);
    }
    if (opts.tapText) {
      const tap = document.createElement('div');
      tap.className = 'tap';
      tap.textContent = opts.tapText;
      card.append(tap);
      // Ignore the tap that may have opened this overlay.
      setTimeout(() => (overlay.onclick = close), 250);
    } else {
      overlay.onclick = null;
    }
    // Each part of the card rises in, one after the other.
    [...card.children].forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)));
    overlay.classList.toggle('tinted', !!opts.color);
    overlay.replaceChildren(hexBackdrop(), card);
    overlay.hidden = false;
  });
}

export const hideOverlay = () => {
  root().hidden = true;
};
