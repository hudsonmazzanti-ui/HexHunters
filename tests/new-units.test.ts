import { describe, expect, it } from 'vitest';
import { validateArmy, validateConfig } from '../src/core/army';
import { previewAttack } from '../src/core/combat';
import { type Action, type GameEvent, applyAction } from '../src/core/game';
import { hex, hexKey } from '../src/core/hex';
import { effectiveDefense, getUnit, isGuarded, moveReach } from '../src/core/queries';
import { previewSpecial, specialBlockedReason } from '../src/core/specials';
import type { GameState } from '../src/core/types';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';
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
const END: Action = { type: 'endTurn' };

describe('new units: data', () => {
  it('five new units, each with its own special, legal to buy', () => {
    expect(UNITS.bomber).toMatchObject({ cost: 2, size: 1, special: 'detonate' });
    expect(UNITS.guardian).toMatchObject({ cost: 3, size: 2, special: 'guard' });
    expect(UNITS.cryomancer).toMatchObject({ cost: 3, special: 'freeze' });
    expect(UNITS.blinker).toMatchObject({ cost: 3, special: 'blink' });
    expect(UNITS.poisoner).toMatchObject({ cost: 3, special: 'poison' });
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    expect(validateArmy(DEFAULT_CONFIG, ['bomber', 'guardian', 'cryomancer', 'blinker', 'poisoner'])).toBeNull();
  });
});

describe('Bomber: Detonate', () => {
  it('hits every adjacent model, friend and foe, and destroys the Bomber', () => {
    const s = makeState();
    const bomber = addUnit(s, 'bomber', 0, hex(0, 0));
    const enemy = addUnit(s, 'infantry', 1, hex(1, 0));
    const weak = addUnit(s, 'scout', 1, hex(0, -1), { hp: 2 });
    const ally = addUnit(s, 'heavy', 0, hex(-1, 0));
    const far = addUnit(s, 'infantry', 1, hex(3, 0));
    const { state, events } = run(s, { type: 'special', unitId: bomber.id });
    expect(getUnit(state, bomber.id)).toBeUndefined();
    expect(getUnit(state, enemy.id)!.hp).toBe(UNITS.infantry.health - 3);
    expect(getUnit(state, weak.id)).toBeUndefined();
    expect(getUnit(state, ally.id)!.hp).toBe(UNITS.heavy.health - 3);
    expect(getUnit(state, far.id)!.hp).toBe(UNITS.infantry.health);
    expect(events.some((e) => e.type === 'special' && e.special === 'detonate')).toBe(true);
  });

  it('needs someone next to it', () => {
    const s = makeState();
    const bomber = addUnit(s, 'bomber', 0, hex(0, 0));
    addUnit(s, 'infantry', 1, hex(3, 0));
    expect(specialBlockedReason(s, bomber)).toBe('no model adjacent');
  });

  it('can end the game: the last enemy dies and its side wins; both wiped out is a draw', () => {
    const s = makeState();
    const bomber = addUnit(s, 'bomber', 0, hex(0, 0));
    addUnit(s, 'infantry', 0, hex(0, 4));
    addUnit(s, 'scout', 1, hex(1, 0), { hp: 1 });
    expect(run(s, { type: 'special', unitId: bomber.id }).state).toMatchObject({ phase: 'over', winner: 0 });
    const d = makeState();
    const lone = addUnit(d, 'bomber', 0, hex(0, 0));
    addUnit(d, 'scout', 1, hex(1, 0), { hp: 1 });
    expect(run(d, { type: 'special', unitId: lone.id }).state).toMatchObject({ phase: 'over', winner: null, winReason: 'draw' });
  });
});

describe('Guardian: Guard', () => {
  it('gives friendly models next to it +2 defense, not itself or enemies, until its next turn', () => {
    const s = makeState();
    const g = addUnit(s, 'guardian', 0, hex(0, 2));
    const near = addUnit(s, 'infantry', 0, hex(1, 2));
    const far = addUnit(s, 'infantry', 0, hex(3, 2));
    const enemy = addUnit(s, 'infantry', 1, hex(0, 1));
    const t = run(s, { type: 'special', unitId: g.id }).state;
    const u = (id: string) => getUnit(t, id)!;
    expect(effectiveDefense(t, u(near.id))).toBe(UNITS.infantry.defense + 2);
    expect(effectiveDefense(t, u(far.id))).toBe(UNITS.infantry.defense);
    expect(effectiveDefense(t, u(g.id))).toBe(UNITS.guardian.defense);
    expect(effectiveDefense(t, u(enemy.id))).toBe(UNITS.infantry.defense);
    expect(isGuarded(t, u(near.id))).toBe(true);
    // The enemy's attack sees the higher defense.
    const p2 = run(t, END).state;
    expect(previewAttack(p2, getUnit(p2, enemy.id)!, getUnit(p2, near.id)!).defense).toBe(UNITS.infantry.defense + 2);
    // It ends when the Guardian's owner starts their next turn.
    const back = run(p2, END).state;
    expect(effectiveDefense(back, getUnit(back, near.id)!)).toBe(UNITS.infantry.defense);
  });

  it('is checked live (an ally that walks away loses it) and two Guardians don\'t stack', () => {
    const s = makeState();
    const g1 = addUnit(s, 'guardian', 0, hex(0, 2), { guarding: true });
    addUnit(s, 'guardian', 0, hex(2, 1), { guarding: true });
    const inf = addUnit(s, 'infantry', 0, hex(1, 1)); // next to both
    expect(effectiveDefense(s, inf)).toBe(UNITS.infantry.defense + 2);
    expect(effectiveDefense(s, g1)).toBe(UNITS.guardian.defense); // not next to the other Guardian
    inf.pos = hex(-3, 3);
    expect(effectiveDefense(s, inf)).toBe(UNITS.infantry.defense);
  });
});

describe('Cryomancer: Freeze', () => {
  it('the target can\'t move on its next turn but can still attack; then it thaws', () => {
    const s = makeState();
    const cryo = addUnit(s, 'cryomancer', 0, hex(0, 2));
    const enemy = addUnit(s, 'infantry', 1, hex(0, 0));
    const p2 = run(s, { type: 'special', unitId: cryo.id, targetId: enemy.id }, END).state;
    const frozen = getUnit(p2, enemy.id)!;
    expect(frozen).toMatchObject({ frozen: true, movesLeft: 0 });
    expect(moveReach(p2, frozen).costs.size).toBe(0);
    expect(() => applyAction(p2, { type: 'move', unitId: enemy.id, to: hex(0, -1) })).toThrow();
    expect(previewAttack(p2, frozen, getUnit(p2, cryo.id)!).blockedReason).toBeNull();
    const again = run(p2, END, END).state; // its following turn
    expect(getUnit(again, enemy.id)).toMatchObject({ frozen: false });
    if (again.current === 1) expect(getUnit(again, enemy.id)!.movesLeft).toBe(UNITS.infantry.speed);
  });

  it('needs range 3 and line of sight, and doesn\'t stack', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2]] });
    const cryo = addUnit(s, 'cryomancer', 0, hex(0, 2));
    const hidden = addUnit(s, 'infantry', 1, hex(0, 0));
    const far = addUnit(s, 'infantry', 1, hex(4, 2));
    const ok = addUnit(s, 'infantry', 1, hex(2, 2), { frozen: true });
    expect(specialBlockedReason(s, cryo, { targetId: hidden.id })).toBe('No line of sight');
    expect(specialBlockedReason(s, cryo, { targetId: far.id })).toBe('Out of range');
    expect(specialBlockedReason(s, cryo, { targetId: ok.id })).toBe('Already frozen');
  });
});

describe('Blinker: Blink', () => {
  it('teleports through a wall to an empty hex within 3, then may still attack', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2], [hex(1, 0), 2], [hex(-1, 1), 2]] });
    const b = addUnit(s, 'blinker', 0, hex(0, 2), { die: 12 });
    const enemy = addUnit(s, 'infantry', 1, hex(0, -1));
    const t = run(s, { type: 'special', unitId: b.id, hex: hex(0, 0) }).state;
    const me = getUnit(t, b.id)!;
    expect(me.pos).toEqual(hex(0, 0));
    expect(me).toMatchObject({ movesLeft: 0, acted: false, specialUsed: true });
    const hit = run(t, { type: 'attack', unitId: b.id, targetId: enemy.id });
    expect(hit.events.some((e) => e.type === 'attack' && e.hit)).toBe(true);
  });

  it('can\'t land on terrain, a model, or farther than 3; and can\'t be undone', () => {
    const s = makeState({ terrain: [[hex(0, 1), 1]] });
    const b = addUnit(s, 'blinker', 0, hex(0, 2));
    addUnit(s, 'infantry', 1, hex(1, 1));
    expect(specialBlockedReason(s, b, { hex: hex(0, 1) })).toBe('Must be an empty hex');
    expect(specialBlockedReason(s, b, { hex: hex(1, 1) })).toBe('Must be an empty hex');
    expect(specialBlockedReason(s, b, { hex: hex(0, -2) })).toBe('Out of range');
    const t = run(s, { type: 'special', unitId: b.id, hex: hex(0, 0) }).state;
    expect(() => applyAction(t, { type: 'undoMove', unitId: b.id })).toThrow();
  });

  it('a flag carrier that blinks drops the flag where it stood', () => {
    const s = makeState();
    s.mission = 'ctf';
    const b = addUnit(s, 'blinker', 0, hex(0, 2));
    s.flag = { pos: null, carrierId: b.id };
    const t = run(s, { type: 'special', unitId: b.id, hex: hex(0, 0) }).state;
    expect(t.flag).toEqual({ pos: hex(0, 2), carrierId: null });
  });
});

describe('Poisoner: Poison', () => {
  it('1 damage at the start of each of the target\'s next 2 turns, then it wears off', () => {
    const s = makeState();
    const po = addUnit(s, 'poisoner', 0, hex(0, 3));
    const enemy = addUnit(s, 'heavy', 1, hex(0, 0));
    let r = run(s, { type: 'special', unitId: po.id, targetId: enemy.id });
    expect(getUnit(r.state, enemy.id)).toMatchObject({ poison: 2, hp: UNITS.heavy.health });
    const hpAt: number[] = [];
    let state = r.state;
    const ticks: GameEvent[] = [];
    for (let i = 0; i < 8; i++) {
      r = run(state, END);
      state = r.state;
      ticks.push(...r.events.filter((e) => e.type === 'poison'));
      hpAt.push(getUnit(state, enemy.id)!.hp);
    }
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({ unitId: enemy.id, damage: 1, killed: false, left: 1 });
    expect(hpAt.at(-1)).toBe(UNITS.heavy.health - 2);
    expect(getUnit(state, enemy.id)!.poison).toBe(0);
  });

  it('can kill, doesn\'t stack, and doesn\'t crack the Behemoth\'s armor', () => {
    const s = makeState();
    const po = addUnit(s, 'poisoner', 0, hex(0, 3));
    const weak = addUnit(s, 'scout', 1, hex(0, 0), { hp: 1 });
    addUnit(s, 'infantry', 1, hex(5, -5));
    const already = addUnit(s, 'infantry', 1, hex(1, 1), { poison: 1 });
    expect(specialBlockedReason(s, po, { targetId: already.id })).toBe('Already poisoned');
    const r = run(s, { type: 'special', unitId: po.id, targetId: weak.id }, END);
    expect(getUnit(r.state, weak.id)).toBeUndefined();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'poison', killed: true }));

    const b = makeState();
    const po2 = addUnit(b, 'poisoner', 0, hex(0, 3));
    const beh = addUnit(b, 'behemoth', 1, hex(0, 0));
    const after = run(b, { type: 'special', unitId: po2.id, targetId: beh.id }, END).state;
    expect(getUnit(after, beh.id)).toMatchObject({ hp: UNITS.behemoth.health - 1, armorCracks: 0 });
  });

  it('previews its target', () => {
    const s = makeState();
    const po = addUnit(s, 'poisoner', 0, hex(0, 3));
    const enemy = addUnit(s, 'heavy', 1, hex(0, 0));
    expect(previewSpecial(s, po, { targetId: enemy.id })!.area.map((a) => hexKey(a.hex))).toEqual([hexKey(hex(0, 0))]);
  });
});
