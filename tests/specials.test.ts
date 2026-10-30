import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/game';
import { hex } from '../src/core/hex';
import { getUnit } from '../src/core/queries';
import { specialBlockedReason, specialTargets } from '../src/core/specials';
import { addUnit, makeState } from './helpers';

/** No army uses Shove right now, so give the Heavy Shove to keep the mechanic tested. */
function withShove(s: ReturnType<typeof makeState>) {
  const units = { ...s.config.units, heavy: { ...s.config.units.heavy, special: 'shove' as const } };
  s.config = { ...s.config, units };
  return s;
}

const special = (s: ReturnType<typeof makeState>, unitId: string, targetId?: string) =>
  applyAction(s, { type: 'special', unitId, targetId }).state;

describe('special actions', () => {
  it('Brace sets the braced flag and uses the die', () => {
    const s = makeState();
    const u = addUnit(s, 'heavy', 0, hex(0, 0));
    const next = special(s, u.id);
    expect(getUnit(next, u.id)).toMatchObject({ braced: true, acted: true, movesLeft: 0 });
  });

  it('Prep sets the prepped flag and uses the die', () => {
    const s = makeState();
    const u = addUnit(s, 'infantry', 0, hex(0, 0));
    const next = special(s, u.id);
    expect(getUnit(next, u.id)).toMatchObject({ prepped: true, acted: true, movesLeft: 0 });
    expect(specialBlockedReason(s, { ...u, prepped: true })).toBe('Already prepped');
  });

  it('Heal restores floor(die/2) to an adjacent damaged ally, capped at max', () => {
    const s = makeState();
    const medic = addUnit(s, 'medic', 0, hex(0, 0), { die: 7 });
    const ally = addUnit(s, 'heavy', 0, hex(1, 0), { hp: 5 });
    expect(getUnit(special(s, medic.id, ally.id), ally.id)!.hp).toBe(8);

    ally.hp = 11;
    expect(getUnit(special(s, medic.id, ally.id), ally.id)!.hp).toBe(12);
  });

  it('Heal needs an adjacent, damaged, friendly target and a die of 2+', () => {
    const s = makeState();
    const medic = addUnit(s, 'medic', 0, hex(0, 0), { die: 6 });
    const far = addUnit(s, 'heavy', 0, hex(2, 0), { hp: 5 });
    const full = addUnit(s, 'heavy', 0, hex(0, 1));
    const enemy = addUnit(s, 'heavy', 1, hex(-1, 0), { hp: 5 });
    expect(specialBlockedReason(s, medic, far)).toBe('Must be adjacent');
    expect(specialBlockedReason(s, medic, full)).toBe('Already at full health');
    expect(specialBlockedReason(s, medic, enemy)).toBe('Choose an ally');
    expect(specialBlockedReason(s, medic, medic)).toBe('Choose an ally');
    const hurt = addUnit(s, 'infantry', 0, hex(0, -1), { hp: 1 });
    medic.die = 1;
    expect(specialBlockedReason(s, medic, hurt)).toBe('Die too low to heal');
  });

  it('Spot marks a visible enemy for the spotting side', () => {
    const s = makeState({ terrain: [[hex(0, 1), 2]] });
    const sniper = addUnit(s, 'sniper', 0, hex(0, 0));
    const seen = addUnit(s, 'scout', 1, hex(6, 0)); // beyond nothing; range is irrelevant for Spot
    const hidden = addUnit(s, 'scout', 1, hex(0, 2));
    expect(specialTargets(s, sniper).map((u) => u.id)).toEqual([seen.id]);
    expect(specialBlockedReason(s, sniper, hidden)).toBe('No line of sight');
    expect(getUnit(special(s, sniper.id, seen.id), seen.id)!.spottedBy).toBe(0);
  });

  it('Dash adds floor(die/3) hexes on top of remaining movement, even after acting', () => {
    const s = makeState();
    const scout = addUnit(s, 'scout', 0, hex(0, 0), { die: 11, movesLeft: 1 });
    const next = special(s, scout.id);
    expect(getUnit(next, scout.id)).toMatchObject({ acted: true, movesLeft: 1 + 3 });
    // and it can actually move afterwards
    const moved = applyAction(next, { type: 'move', unitId: scout.id, to: hex(4, 0) }).state;
    expect(getUnit(moved, scout.id)!.pos).toEqual(hex(4, 0));
  });

  it('Dash is not allowed for 0 hexes', () => {
    const s = makeState();
    const scout = addUnit(s, 'scout', 0, hex(0, 0), { die: 2 });
    expect(specialBlockedReason(s, scout)).toBe('Die too low to dash');
  });

  it('Shove pushes an adjacent enemy one hex directly away', () => {
    const s = withShove(makeState());
    const heavy = addUnit(s, 'heavy', 0, hex(0, 0));
    const enemy = addUnit(s, 'infantry', 1, hex(0, 1));
    expect(getUnit(special(s, heavy.id, enemy.id), enemy.id)!.pos).toEqual(hex(0, 2));
  });

  it('Shove fails into terrain, models, or off the board', () => {
    const s = withShove(makeState({ terrain: [[hex(2, 0), 1]] }));
    const heavy = addUnit(s, 'heavy', 0, hex(0, 0));
    const intoWall = addUnit(s, 'infantry', 1, hex(1, 0));
    const intoModel = addUnit(s, 'infantry', 1, hex(-1, 0));
    addUnit(s, 'medic', 0, hex(-2, 0));
    expect(specialBlockedReason(s, heavy, intoWall)).toBe('Nowhere to push');
    expect(specialBlockedReason(s, heavy, intoModel)).toBe('Nowhere to push');

    const edge = withShove(makeState());
    const h2 = addUnit(edge, 'heavy', 0, hex(6, 0));
    const e2 = addUnit(edge, 'infantry', 1, hex(7, 0));
    expect(specialBlockedReason(edge, h2, e2)).toBe('Nowhere to push');
  });

  it('only one action per turn', () => {
    const s = makeState();
    const u = addUnit(s, 'infantry', 0, hex(0, 0));
    const next = special(s, u.id);
    expect(() => special(next, u.id)).toThrow();
  });
});
