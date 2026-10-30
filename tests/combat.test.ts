import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/game';
import { hex } from '../src/core/hex';
import { previewAttack } from '../src/core/combat';
import { getUnit } from '../src/core/queries';
import { addUnit, makeState } from './helpers';

describe('attack resolution', () => {
  it('hits when die + modifiers >= defense (ties hit)', () => {
    const s = makeState();
    const a = addUnit(s, 'infantry', 0, hex(0, 0), { die: 7 });
    const t = addUnit(s, 'infantry', 1, hex(2, 0)); // defense 7
    expect(previewAttack(s, a, t).hit).toBe(true);
    a.die = 6;
    expect(previewAttack(s, a, t).hit).toBe(false);
  });

  it('a hit deals fixed damage', () => {
    const s = makeState();
    const a = addUnit(s, 'infantry', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'infantry', 1, hex(2, 0));
    const { state, events } = applyAction(s, { type: 'attack', unitId: a.id, targetId: t.id });
    expect(getUnit(state, t.id)!.hp).toBe(6 - 2);
    expect(events[0]).toMatchObject({ type: 'attack', hit: true, damage: 2, killed: false });
    expect(getUnit(state, a.id)!.acted).toBe(true);
    expect(getUnit(state, a.id)!.movesLeft).toBe(0);
  });

  it('a miss deals nothing but still uses the die', () => {
    const s = makeState();
    const a = addUnit(s, 'infantry', 0, hex(0, 0), { die: 1 });
    const t = addUnit(s, 'infantry', 1, hex(2, 0));
    const { state } = applyAction(s, { type: 'attack', unitId: a.id, targetId: t.id });
    expect(getUnit(state, t.id)!.hp).toBe(6);
    expect(getUnit(state, a.id)!.acted).toBe(true);
  });

  it('removes a model reduced to 0 health', () => {
    const s = makeState();
    const a = addUnit(s, 'heavy', 0, hex(0, 0), { die: 12 });
    const t = addUnit(s, 'scout', 1, hex(2, 0));
    addUnit(s, 'scout', 1, hex(5, -5)); // keep the enemy alive overall
    const { state, events } = applyAction(s, { type: 'attack', unitId: a.id, targetId: t.id });
    expect(getUnit(state, t.id)).toBeUndefined();
    expect(events[0]).toMatchObject({ killed: true });
    expect(state.phase).toBe('play');
  });

  it('Brace adds +2 defense', () => {
    const s = makeState();
    const a = addUnit(s, 'infantry', 0, hex(0, 0), { die: 8 });
    const t = addUnit(s, 'infantry', 1, hex(2, 0), { braced: true });
    expect(previewAttack(s, a, t)).toMatchObject({ defense: 9, hit: false });
  });

  it('Spot adds +2 for the spotting side and is consumed', () => {
    const s = makeState();
    const a = addUnit(s, 'infantry', 0, hex(0, 0), { die: 5 });
    const t = addUnit(s, 'infantry', 1, hex(2, 0), { spottedBy: 0 });
    expect(previewAttack(s, a, t)).toMatchObject({ bonus: 2, hit: true });
    const { state } = applyAction(s, { type: 'attack', unitId: a.id, targetId: t.id });
    expect(getUnit(state, t.id)!.spottedBy).toBeNull();
  });

  it('requires range and line of sight', () => {
    const s = makeState({ terrain: [[hex(1, 0), 2]] });
    const medic = addUnit(s, 'medic', 0, hex(0, 0), { die: 12 }); // range 3
    const far = addUnit(s, 'infantry', 1, hex(0, 4));
    const hidden = addUnit(s, 'scout', 1, hex(2, 0));
    expect(previewAttack(s, medic, far).blockedReason).toBe('Out of range');
    expect(previewAttack(s, medic, hidden).blockedReason).toBe('No line of sight');
    expect(() => applyAction(s, { type: 'attack', unitId: medic.id, targetId: far.id })).toThrow('Out of range');
  });

  it('cannot attack twice or attack friends', () => {
    const s = makeState();
    const a = addUnit(s, 'infantry', 0, hex(0, 0), { die: 12 });
    const friend = addUnit(s, 'infantry', 0, hex(1, 0));
    const t = addUnit(s, 'heavy', 1, hex(2, -1));
    expect(previewAttack(s, a, friend).blockedReason).toBe('Not an enemy');
    const { state } = applyAction(s, { type: 'attack', unitId: a.id, targetId: t.id });
    expect(() => applyAction(state, { type: 'attack', unitId: a.id, targetId: t.id })).toThrow();
  });
});
