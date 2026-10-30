import { describe, expect, it } from 'vitest';
import { type Action, type GameEvent, applyAction, canUndoMove } from '../src/core/game';
import { hex, hexKey } from '../src/core/hex';
import { getUnit } from '../src/core/queries';
import { hookPath, previewSpecial, specialBlockedReason, specialChoices } from '../src/core/specials';
import type { GameState } from '../src/core/types';
import { UNITS } from '../src/data/config';
import { addUnit, makeState } from './helpers';

function run(state: GameState, ...actions: Action[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const hook = (s: GameState, unitId: string, targetId: string) => run(s, { type: 'special', unitId, targetId });

/** An extra enemy far away, so removing a model never ends the game by accident. */
const bystander = (s: GameState) => addUnit(s, 'heavy', 1, hex(-6, 6));

describe('Grappler data', () => {
  it('has the agreed stats', () => {
    expect(UNITS.grappler).toMatchObject({
      cost: 5,
      size: 3,
      speed: 2,
      defense: 7,
      health: 12,
      range: 1,
      damage: 3,
      special: 'hook',
    });
    expect(UNITS.sniper.cost).toBe(4);
  });
});

describe('Hook', () => {
  it('needs a die of 7 or more', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 6 });
    addUnit(s, 'infantry', 1, hex(3, 0));
    expect(specialBlockedReason(s, g)).toBe('needs 7+');
    g.die = 7;
    expect(specialBlockedReason(s, g)).toBeNull();
  });

  it('needs line of sight and range 3', () => {
    const s = makeState({ terrain: [[hex(2, 0), 2]] });
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 12 });
    const hidden = addUnit(s, 'infantry', 1, hex(3, 0)); // behind a height-2 wall
    const far = addUnit(s, 'infantry', 1, hex(0, 4));
    const ok = addUnit(s, 'infantry', 1, hex(0, 3));
    expect(specialBlockedReason(s, g, { targetId: hidden.id })).toBe('No line of sight');
    expect(specialBlockedReason(s, g, { targetId: far.id })).toBe('Out of range');
    expect(specialBlockedReason(s, g, { targetId: ok.id })).toBeNull();
    expect(specialBlockedReason(s, g, { targetId: g.id })).toBe('Choose another model');
    expect(specialChoices(s, g).map((c) => c.targetId)).toEqual([ok.id]);
  });

  it('always hits an enemy for 1 and pulls it next to the Grappler along a clear path', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 7 });
    const enemy = addUnit(s, 'heavy', 1, hex(3, 0), { braced: true }); // high defense doesn't matter
    const p = previewSpecial(s, g, { targetId: enemy.id })!;
    expect(p.area.map((a) => [hexKey(a.hex), a.kind])).toEqual([['2,0', 'path'], ['1,0', 'landing']]);
    const { state, events } = hook(s, g.id, enemy.id);
    expect(getUnit(state, enemy.id)).toMatchObject({ hp: 11, pos: hex(1, 0) });
    expect(events[0]).toMatchObject({ type: 'special', special: 'hook', amount: 2, from: hex(3, 0), to: hex(1, 0) });
    expect(getUnit(state, g.id)).toMatchObject({ acted: true, movesLeft: 0 });
  });

  it('hits and pulls allies too', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 9 });
    const ally = addUnit(s, 'artillery', 0, hex(0, 3), { loaded: true });
    bystander(s);
    const { state } = hook(s, g.id, ally.id);
    expect(getUnit(state, ally.id)).toMatchObject({ hp: 7, pos: hex(0, 1), loaded: true });
  });

  it('stops in the last empty hex before terrain or a model', () => {
    const wall = makeState({ terrain: [[hex(1, 0), 1]] });
    const g = addUnit(wall, 'grappler', 0, hex(0, 0), { die: 12 });
    const t = addUnit(wall, 'infantry', 1, hex(3, 0)); // medium: visible over the height-1 wall
    expect(hookPath(wall, g, t).map(hexKey)).toEqual(['2,0']);
    expect(getUnit(hook(wall, g.id, t.id).state, t.id)!.pos).toEqual(hex(2, 0));

    const crowd = makeState();
    const g2 = addUnit(crowd, 'grappler', 0, hex(0, 0), { die: 12 });
    addUnit(crowd, 'medic', 0, hex(1, 0)); // small friendly: the Grappler sees over it, but it blocks the pull
    const t2 = addUnit(crowd, 'infantry', 1, hex(3, 0));
    const { state, events } = hook(crowd, g2.id, t2.id);
    expect(getUnit(state, t2.id)!.pos).toEqual(hex(2, 0));
    expect(events[0]).toMatchObject({ amount: 1 });
  });

  it('an adjacent or immediately blocked target takes damage but is not moved', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 12 });
    const adj = addUnit(s, 'scout', 1, hex(1, 0));
    const { state, events } = hook(s, g.id, adj.id);
    expect(getUnit(state, adj.id)).toMatchObject({ hp: 2, pos: hex(1, 0) });
    expect(events[0]).toMatchObject({ amount: 0 });
    expect(events[0]).not.toHaveProperty('movedId');
  });

  it('kills a 1-health target without pulling it', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'medic', 1, hex(2, 0), { hp: 1 });
    bystander(s);
    const { state, events } = hook(s, g.id, t.id);
    expect(getUnit(state, t.id)).toBeUndefined();
    expect(events[0]).toMatchObject({ effects: [{ unitId: t.id, killed: true }] });
  });

  it('on an edge line, takes whichever side pulls the target farther', () => {
    // (1,1) -> (0,0) runs between (1,0) and (0,1).
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 12 });
    addUnit(s, 'scout', 1, hex(1, 0));
    const t = addUnit(s, 'infantry', 1, hex(1, 1));
    expect(hookPath(s, g, t).map(hexKey)).toEqual(['0,1']);
    addUnit(s, 'scout', 1, hex(0, 1));
    expect(hookPath(s, g, t)).toEqual([]);
  });

  it('a hooked ally keeps its die and can still move and act', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 8 });
    const ally = addUnit(s, 'infantry', 0, hex(0, 3), { die: 11 });
    const enemy = addUnit(s, 'scout', 1, hex(3, 1));
    bystander(s);
    let state = hook(s, g.id, ally.id).state;
    expect(getUnit(state, ally.id)).toMatchObject({ pos: hex(0, 1), die: 11, acted: false, movesLeft: 3 });
    expect(canUndoMove(state, getUnit(state, ally.id)!)).toBe(false); // can't undo the pull
    state = run(state, { type: 'move', unitId: ally.id, to: hex(1, 1) }).state;
    const { state: after, events } = run(state, { type: 'attack', unitId: ally.id, targetId: enemy.id });
    expect(events[0]).toMatchObject({ type: 'attack', hit: true });
    expect(getUnit(after, enemy.id)!.hp).toBe(1);
  });

  it('pulling a Sentinel on overwatch cancels its overwatch', () => {
    const s = makeState();
    const g = addUnit(s, 'grappler', 0, hex(0, 0), { die: 12 });
    const sentinel = addUnit(s, 'sentinel', 1, hex(3, 0), { overwatch: { die: 9, hexes: [hex(3, 1)] } });
    const { state } = hook(s, g.id, sentinel.id);
    expect(getUnit(state, sentinel.id)).toMatchObject({ pos: hex(1, 0), overwatch: null });
  });
});
