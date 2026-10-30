/**
 * Small seeded PRNG (mulberry32). The generator state is a plain number so it can
 * live inside the serializable GameState; every draw returns the next state.
 */

export function nextRandom(state: number): [value: number, nextState: number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Mutable wrapper for code that draws many numbers in a row (e.g. map generation). */
export class Rng {
  constructor(public state: number) {}

  /** Float in [0, 1). */
  next(): number {
    const [value, next] = nextRandom(this.state);
    this.state = next;
    return value;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}

export const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);
