import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/core/army';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';
import { checkPresets } from '../sim/armies';
import { compareCsv, compareHtml, spread, spreads } from '../sim/compare';
import { summarize } from '../sim/report';
import { runJobs } from '../sim/runGame';
import { buildJobs } from '../sim/schedule';
import { EXPERIMENTS, VARIANTS, applyVariant, variantConfig } from '../sim/variants';

describe('balance variants', () => {
  it('apply overrides to a copy and never touch the real data', () => {
    const before = structuredClone(DEFAULT_CONFIG);
    const c = variantConfig('monster-hp14-no-hit');
    expect(c.units.monster.health).toBe(14);
    expect(c.units.monster.hitBonus).toBeUndefined();
    expect(c.units.monster.damage).toBe(UNITS.monster.damage);
    expect(variantConfig('monster-cost6').units.monster.cost).toBe(6);
    expect(DEFAULT_CONFIG).toEqual(before);
    expect(UNITS.monster).toMatchObject({ health: 14, cost: 5 });
    expect(variantConfig('monster-cost6').units.heavy).toEqual(UNITS.heavy);
    expect(variantConfig('baseline')).toEqual(DEFAULT_CONFIG);
  });

  it('every variant and experiment is valid', () => {
    for (const id of Object.keys(VARIANTS)) expect(validateConfig(variantConfig(id))).toEqual([]);
    for (const exp of Object.values(EXPERIMENTS)) for (const id of exp.variants) expect(VARIANTS[id]).toBeDefined();
    expect(EXPERIMENTS.monster.variants).toEqual(['baseline', 'monster-hp14', 'monster-no-hit', 'monster-hp14-no-hit', 'monster-cost6']);
  });

  it('rejects unknown units, rules and variant ids', () => {
    expect(() => applyVariant(DEFAULT_CONFIG, { label: 'x', description: '', units: { dragonn: { health: 1 } } })).toThrow('unknown unit');
    expect(() => applyVariant(DEFAULT_CONFIG, { label: 'x', description: '', specials: { nope: 1 } as never })).toThrow('unknown special');
    expect(() => variantConfig('nope')).toThrow('Unknown variant');
  });

  it('a variant can make a preset illegal (Big Guys at 17 points with a 6-point Monster)', () => {
    expect(checkPresets(variantConfig('monster-cost6'))).toEqual(['Big Guys: Army costs 17 points; the limit is 16']);
    expect(checkPresets(variantConfig('monster-hp14'))).toEqual([]);
  });

  it('variant games use the variant stats', () => {
    const config = variantConfig('monster-hp14');
    const jobs = buildJobs(config, { seed: 2, perMatchup: 0, randomGames: 3 });
    for (const r of runJobs(jobs, { config })) expect(r.illegal).toBe(0);
  }, 30_000);
});

describe('comparison', () => {
  it('spread is the standard deviation and range of scores', () => {
    expect(spread([0.5, 0.5])).toEqual({ sd: 0, range: 0, count: 2 });
    const s = spread([0.2, 0.8]);
    expect(s.sd).toBeCloseTo(0.3);
    expect(s.range).toBeCloseTo(0.6);
  });

  it('builds a comparison table with deltas and "not legal" cells', () => {
    const exp = EXPERIMENTS.monster;
    const results = ['baseline', 'monster-cost6'].map((id) => {
      const config = variantConfig(id);
      const excluded = checkPresets(config);
      const names = ['Big Guys', 'Mercenary Mix', 'Firing Squad'].filter((n) => !excluded.some((e) => e.startsWith(n)));
      const jobs = buildJobs(config, { seed: 3, perMatchup: 0, randomGames: 4 });
      const summary = summarize(runJobs(jobs, { config }), config, names);
      return { id, label: VARIANTS[id].label, description: VARIANTS[id].description, config, summary, excluded, seconds: 1 };
    });
    const html = compareHtml(results, exp, { seed: 3, perMatchup: 0, randomGames: 4, minGames: 1, workers: 1 });
    expect(html).toContain('D: Monster cost 6');
    expect(html).toContain('not legal');
    expect(html).toContain('Preset spread');
    expect(compareCsv(results, exp, 1).split('\n')[0]).toContain('Baseline');
    expect(spreads(results[0].summary, 1).entries.count).toBeGreaterThan(0);
  }, 30_000);
});
