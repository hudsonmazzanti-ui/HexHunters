import { describe, expect, it } from 'vitest';
import { armyCost, validateArmy } from '../src/core/army';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';

describe('army building', () => {
  it('has the agreed point costs', () => {
    const costs = Object.fromEntries(Object.entries(UNITS).map(([id, u]) => [id, u.cost]));
    expect(costs).toEqual({
      scout: 2,
      assassin: 2,
      infantry: 3,
      medic: 3,
      sniper: 3,
      grenadier: 3,
      heavy: 4,
      flamer: 4,
      monster: 5,
      artillery: 3,
      sentinel: 3,
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
    expect(validateArmy(DEFAULT_CONFIG, ['dragon'])).toMatch(/Unknown/);
  });

  it('follows the configured limit and supports any cost', () => {
    const config = {
      ...DEFAULT_CONFIG,
      armyPointLimit: 30,
      units: { ...UNITS, grunt: { ...UNITS.infantry, cost: 1 }, titan: { ...UNITS.heavy, cost: 7 } },
    };
    expect(validateArmy(config, ['titan', 'titan', 'titan', 'titan', 'grunt', 'grunt'])).toBeNull(); // 30
    expect(validateArmy(config, ['titan', 'titan', 'titan', 'titan', 'grunt', 'grunt', 'grunt'])).toMatch(/limit/);
    // More models than the deployment zone (17 hexes) can hold.
    expect(validateArmy(config, Array(18).fill('grunt'))).toMatch(/Too many/);
  });
});
