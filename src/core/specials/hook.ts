/**
 * Hook (Grappler): needs a die of 7+. Target any other model, friend or foe, within
 * range 3 that the Grappler can see (normal line of sight). Always hits for 1 damage,
 * then pulls the target along the straight line toward the Grappler, one hex at a
 * time, stopping in the last empty hex before terrain or a model (with a clear path,
 * the hex next to the Grappler). A target that's already adjacent or blocked right
 * away isn't moved but still takes the damage.
 *
 * When the line runs exactly along hex edges (two possible paths, see los.ts), the
 * path that pulls the target farther is used.
 *
 * The pulled model keeps its die, movement and acted status, so a hooked ally that
 * hasn't acted can still move and act. Its "undo move" point becomes where it landed,
 * and a pulled Sentinel loses its overwatch.
 */
import { dealDamage } from '../combat';
import { type Hex, hexDistance, hexLine } from '../hex';
import { actionDie, canSeeUnit, terrainHeight, unitAt } from '../queries';
import type { GameState, Unit } from '../types';
import type { SpecialDef, SpecialPreview } from './types';

const NUDGE = 1e-6;

/** Hexes the target is dragged through, ending at its landing hex ([] if it can't move). */
export function hookPath(state: GameState, grappler: Unit, target: Unit): Hex[] {
  const traces = [NUDGE, -NUDGE].map((n) => hexLine(target.pos!, grappler.pos!, n).slice(1, -1));
  const walks = traces.map((steps) => {
    const path: Hex[] = [];
    for (const h of steps) {
      if (terrainHeight(state, h) > 0 || unitAt(state, h)) break;
      path.push(h);
    }
    return path;
  });
  return walks[1].length > walks[0].length ? walks[1] : walks[0];
}

function pull(state: GameState, unit: Unit, target: Unit): SpecialPreview {
  const path = hookPath(state, unit, target);
  const damage = state.config.specials.hookDamage;
  const area = path.map((hex, i) => ({ hex, kind: i === path.length - 1 ? ('landing' as const) : ('path' as const) }));
  if (!path.length) area.push({ hex: target.pos!, kind: 'landing' });
  return { area, effects: [{ unitId: target.id, damage, killed: target.hp <= damage }] };
}

export const hook: SpecialDef = {
  name: 'Hook',
  describe: (r) =>
    `Needs a die of ${r.hookMinDie}+. Hook any model (ally or enemy) within ${r.hookRange} that you can see: ` +
    `always hits for ${r.hookDamage} damage and pulls it straight toward you until it's adjacent or blocked.`,
  targeting: 'model',
  tags: ['Needs die 7+', 'Always hits', 'Hits allies too'],
  usable: (state, unit) => {
    const min = state.config.specials.hookMinDie;
    return actionDie(state, unit) < min ? `needs ${min}+` : null;
  },
  checkChoice: (state, unit, { target }) => {
    if (hexDistance(unit.pos!, target!.pos!) > state.config.specials.hookRange) return 'Out of range';
    return canSeeUnit(state, unit, target!) ? null : 'No line of sight';
  },
  preview: (state, unit, { target }) => pull(state, unit, target!),
  apply: (state, unit, { target }) => {
    const t = target!;
    const path = hookPath(state, unit, t);
    const from = t.pos!;
    const { effects } = pull(state, unit, t);
    effects[0].killed = dealDamage(state, t, effects[0].damage);
    if (effects[0].killed || !path.length) return { targetId: t.id, amount: 0, effects };
    const to = path[path.length - 1];
    t.pos = to;
    t.overwatch = null; // the watched area belonged to where it stood
    if (t.turnStartPos) t.turnStartPos = to; // can't undo your way out of a pull
    return { targetId: t.id, amount: path.length, movedId: t.id, from, to, path, effects };
  },
};
