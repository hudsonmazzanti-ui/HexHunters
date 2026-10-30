/**
 * Movement range and paths. Every step costs 1, so this is a breadth-first search.
 * Generic over two predicates so it has no knowledge of game rules:
 *   - canEnter(hex): may the mover pass through this hex?
 *   - canStop(hex):  may the mover end its move here?
 */
import { type Hex, hexKey, neighbors } from './hex';

export interface Reach {
  /** hexKey -> steps needed to stop there (only hexes where stopping is allowed). */
  costs: Map<string, number>;
  /** hexKey -> previous hex on a shortest path (covers pass-through hexes too). */
  prev: Map<string, Hex>;
}

export function reachable(
  start: Hex,
  maxSteps: number,
  canEnter: (h: Hex) => boolean,
  canStop: (h: Hex) => boolean,
): Reach {
  const costs = new Map<string, number>();
  const prev = new Map<string, Hex>();
  const visited = new Map<string, number>([[hexKey(start), 0]]);
  let frontier = [start];

  for (let step = 1; step <= maxSteps && frontier.length; step++) {
    const next: Hex[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        const k = hexKey(n);
        if (visited.has(k) || !canEnter(n)) continue;
        visited.set(k, step);
        prev.set(k, h);
        if (canStop(n)) costs.set(k, step);
        next.push(n);
      }
    }
    frontier = next;
  }
  return { costs, prev };
}

/** Path from the search start to `to`, excluding the start, or null if unreachable. */
export function pathTo(reach: Reach, to: Hex): Hex[] | null {
  if (!reach.costs.has(hexKey(to))) return null;
  const path = [to];
  let cur = reach.prev.get(hexKey(to));
  while (cur) {
    path.unshift(cur);
    cur = reach.prev.get(hexKey(cur));
  }
  return path.slice(1);
}
