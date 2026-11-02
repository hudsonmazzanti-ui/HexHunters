/**
 * Haptic feedback through the Vibration API. Does nothing where it isn't supported
 * (e.g. iOS Safari) or when the player turned haptics off in the menu.
 */
import { getSettings } from './settings';

export const PATTERNS = {
  /** Selecting a model, confirming a move or placement. */
  tap: 10,
  /** An attack or special hits. */
  hit: 30,
  /** A model is destroyed. */
  kill: [40, 30, 80],
} as const;

function vibrate(pattern: number | readonly number[]): void {
  if (!getSettings().haptics) return;
  try {
    const nav = globalThis.navigator as (Navigator & { vibrate?: (p: number | number[]) => boolean }) | undefined;
    nav?.vibrate?.(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // Unsupported or blocked: fail silently.
  }
}

export const haptics = {
  tap: () => vibrate(PATTERNS.tap),
  hit: () => vibrate(PATTERNS.hit),
  kill: () => vibrate(PATTERNS.kill),
};
