import { shapeZones } from '../src/core/mapgen';
import { describe, expect, it } from 'vitest';
import { addBlockedReason, armyCost, validateArmy } from '../src/core/army';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';

describe('army building', () => {
  it('has the agreed point costs', () => {
    const costs = Object.fromEntries(
      Object.entries(UNITS)
        .filter(([, u]) => !u.squadOnly && !u.formOnly) // squad members / alternate forms aren't bought directly
        .map(([id, u]) => [id, u.cost]),
    );
    expect(costs).toEqual({
      scout: 2,
      assassin: 2,
      infantry: 3,
      medic: 3,
      sniper: 4,
      grenadier: 3,
      heavy: 4,
      flamer: 4,
      monster: 5,
      artillery: 3,
      sentinel: 3,
      grappler: 5,
      marshal: 7,
      siegemaster: 8,
      warlord: 6,
      warden: 6,
      masterninja: 7,
      standardbearer: 6,
      zombie: 2,
      skeleton: 1,
      pyromancer: 6,
      hillgiant: 5,
      werewolf: 5,
      gambler: 6,
      necromancer: 7,
      hacker: 3,
      dualgunner: 4,
      dragon: 6,
      behemoth: 12,
      mercenary: 5,
    });
  });

  it('adds up costs, counting duplicates', () => {
    expect(armyCost(DEFAULT_CONFIG, [])).toBe(0);
    expect(armyCost(DEFAULT_CONFIG, ['heavy', 'heavy', 'scout'])).toBe(10);
  });

  it('accepts an army at or under the limit', () => {
    expect(DEFAULT_CONFIG.armyPointLimit).toBe(16);
    expect(validateArmy(DEFAULT_CONFIG, ['heavy', 'heavy', 'heavy', 'heavy'])).toBeNull(); // exactly 16
    expect(validateArmy(DEFAULT_CONFIG, Array(8).fill('scout'))).toBeNull(); // duplicates are fine
    expect(validateArmy(DEFAULT_CONFIG, ['infantry'])).toBeNull();
  });

  it('rejects an army over the limit', () => {
    expect(validateArmy(DEFAULT_CONFIG, ['heavy', 'heavy', 'heavy', 'heavy', 'scout'])).toMatch(/18 points.*16/);
    expect(validateArmy(DEFAULT_CONFIG, ['flamer', 'flamer', 'flamer', 'grenadier', 'assassin'])).toMatch(/17 points/);
  });

  it('rejects empty armies and unknown units', () => {
    expect(validateArmy(DEFAULT_CONFIG, [])).toMatch(/at least one/);
    expect(validateArmy(DEFAULT_CONFIG, ['unicorn'])).toMatch(/Unknown/);
  });

  it('follows the configured limit and supports any cost', () => {
    const config = {
      ...DEFAULT_CONFIG,
      armyPointLimit: 30,
      units: { ...UNITS, grunt: { ...UNITS.infantry, cost: 1 }, titan: { ...UNITS.heavy, cost: 7 } },
    };
    expect(validateArmy(config, ['titan', 'titan', 'titan', 'titan', 'grunt', 'grunt'])).toBeNull(); // 30
    expect(validateArmy(config, ['titan', 'titan', 'titan', 'titan', 'grunt', 'grunt', 'grunt'])).toMatch(/limit/);
    // Deployment zones grow to fit the largest legal army (30 grunts), so it's still legal.
    expect(validateArmy(config, Array(30).fill('grunt'))).toBeNull();
    for (const id of config.deployShapes) expect(shapeZones(config, id)[0].length).toBeGreaterThanOrEqual(30);
    // A zone that can't grow enough still rejects the army (the safety net).
    const huge = { ...config, armyPointLimit: 200 };
    expect(validateArmy(huge, Array(200).fill('grunt'))).toMatch(/Too many/);
  });
});

describe('addBlockedReason (builder sorting)', () => {
  it('allows entries that fit, and says how many points are missing otherwise', () => {
    const army = ['monster', 'heavy', 'grenadier']; // 12 of 16
    expect(addBlockedReason(DEFAULT_CONFIG, army, 'sniper')).toBeNull(); // 4: exactly fits
    expect(addBlockedReason(DEFAULT_CONFIG, army, 'grappler')).toBe('Needs 1 more pt');
    expect(addBlockedReason(DEFAULT_CONFIG, army, 'dragon')).toBe('Needs 2 more pts');
  });

  it('blocks a second hero even when it is affordable', () => {
    expect(addBlockedReason(DEFAULT_CONFIG, ['warlord'], 'gambler')).toBe('You already have a hero');
    expect(addBlockedReason(DEFAULT_CONFIG, ['warlord'], 'twins')).toBe('You already have a hero'); // 16 pts fits
    expect(addBlockedReason(DEFAULT_CONFIG, ['scout'], 'twins')).toBeNull();
  });
});
