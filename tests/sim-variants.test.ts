import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/core/army';
import { DEFAULT_CONFIG, UNITS } from '../src/data/config';
import { checkPresets } from '../sim/armies';
import { type Metric, change, compareCsv, compareHtml, spread, spreads } from '../sim/compare';
import { generateMap, zonesConnected } from '../src/core/mapgen';
import { hexKey } from '../src/core/hex';
import { mapAscii, mapSvg } from '../sim/mapImage';
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
    const csvLines = compareCsv(results, exp, 1).trim().split('\n');
    expect(csvLines[0]).toContain('Avg game length');
    expect(csvLines[1].startsWith('Baseline')).toBe(true);
    expect(csvLines).toHaveLength(3);
    expect(spreads(results[0].summary, 1).entries.count).toBeGreaterThan(0);
  }, 30_000);
});

describe('terrain variants', () => {
  it('terrain amount is one setting; fractional amounts average out', () => {
    expect(variantConfig('terrain-150')).toMatchObject({ terrainPairs: 4.5, terrainTries: 400 });
    expect(variantConfig('terrain-200')).toMatchObject({ terrainPairs: 6, terrainTries: 400 });
    expect(DEFAULT_CONFIG.terrainPairs).toBe(3);
    expect(DEFAULT_CONFIG.terrainTries).toBeUndefined();
    const avg = (id: string) => {
      const c = variantConfig(id);
      let pieces = 0;
      for (let s = 1; s <= 60; s++) pieces += generateMap(c, s * 101).terrain.length;
      return pieces / 60;
    };
    expect(avg('baseline')).toBe(6);
    expect(avg('terrain-150')).toBeGreaterThan(8);
    expect(avg('terrain-150')).toBeLessThan(10);
    expect(avg('terrain-200')).toBeGreaterThan(10.5);
  });

  it('denser maps stay mirrored, keep zones and the objective clear, and stay connected', () => {
    const c = variantConfig('terrain-200');
    for (let seed = 1; seed <= 25; seed++) {
      const map = generateMap(c, seed * 37);
      const blocked = new Set(Object.keys(map.heights));
      for (const k of blocked) {
        const [q, r] = k.split(',').map(Number);
        expect(map.heights[hexKey({ q: -q, r: -r })]).toBe(map.heights[k]);
      }
      for (const h of [...map.controlPoint, ...map.deployZones[0], ...map.deployZones[1]]) expect(blocked.has(hexKey(h))).toBe(false);
      expect(zonesConnected(map.radius, blocked, map.deployZones, map.controlPoint)).toBe(true);
      // Straight and curved walls, both heights, still in the mix.
      expect(map.terrain.every((t) => t.kind === 'wall' || t.kind === 'curve')).toBe(true);
    }
  });

  it('zonesConnected spots a zone that is walled off', () => {
    const map = generateMap(DEFAULT_CONFIG, 5);
    const z0 = map.deployZones[0];
    // Wall off everything around Player 1's zone.
    const ring = new Set<string>();
    for (const h of z0) for (const dq of [-1, 0, 1]) for (const dr of [-1, 0, 1]) ring.add(hexKey({ q: h.q + dq, r: h.r + dr }));
    for (const h of z0) ring.delete(hexKey(h));
    expect(zonesConnected(map.radius, new Set(), map.deployZones, map.controlPoint)).toBe(true);
    expect(zonesConnected(map.radius, ring, map.deployZones, map.controlPoint)).toBe(false);
  });

  it('marks changes beyond 2 standard errors as real and the rest as noise', () => {
    const m: Metric = {
      label: 'x',
      format: 'pct',
      cells: [
        { value: 0.5, se: 0.02, n: 600 },
        { value: 0.53, se: 0.02, n: 600 },
        { value: 0.6, se: 0.02, n: 600 },
        { value: 0.6, se: null, n: 0 },
      ],
    };
    expect(change(m, 0)).toBeNull();
    expect(change(m, 1)).toMatchObject({ real: false });
    expect(change(m, 2)).toMatchObject({ real: true });
    expect(change(m, 3)).toMatchObject({ real: null });
  });

  it('renders sample maps as SVG and ASCII', () => {
    const map = generateMap(variantConfig('terrain-200'), 7);
    expect(mapSvg(map)).toContain('<svg');
    const ascii = mapAscii(map);
    expect(ascii.split('\n').slice(0, 15)).toHaveLength(15);
    expect(ascii).toContain('O');
    expect(ascii).toMatch(/terrain pieces: \d+/);
  });
});

describe('pacing variants', () => {
  it('Slow-Large: every large model loses 1 speed (minimum 1); others and the real data are untouched', () => {
    const c = variantConfig('slow-large');
    for (const [id, def] of Object.entries(UNITS)) {
      const expected = def.size === 3 ? Math.max(1, def.speed - 1) : def.speed;
      expect([id, c.units[id].speed]).toEqual([id, expected]);
    }
    expect(c.units.behemoth.speed).toBe(1);
    expect(c.units.dragon.speed).toBe(UNITS.dragon.speed - 1);
    expect(c.units.infantry.speed).toBe(UNITS.infantry.speed);
    expect(UNITS.monster.speed).toBe(2); // real data unchanged by the variant
    expect(c.specials.warlordSpeedBonus).toBe(DEFAULT_CONFIG.specials.warlordSpeedBonus);
  });

  it('Tall Walls: about 60% of pieces are height 2 (default about 50%), same amount of terrain', () => {
    const share = (id: string) => {
      const c = variantConfig(id);
      let tall = 0;
      let all = 0;
      for (let s = 1; s <= 300; s++) for (const t of generateMap(c, s * 13).terrain) (all++, t.height === 2 && tall++);
      return { share: tall / all, perMap: all / 300 };
    };
    const base = share('baseline');
    const tall = share('slow-large-tall');
    expect(base.share).toBeGreaterThan(0.44);
    expect(base.share).toBeLessThan(0.56);
    expect(tall.share).toBeGreaterThan(0.55);
    expect(tall.share).toBeLessThan(0.66);
    expect(tall.perMap).toBe(base.perMap);
    expect(variantConfig('slow-large-tall').units.dragon.speed).toBe(UNITS.dragon.speed - 1);
  });

  it('the pacing experiment covers every hero', () => {
    const heroes = [...Object.entries(UNITS).filter(([, d]) => d.hero && !d.squadOnly).map(([id]) => id), 'twins'];
    for (const h of heroes) expect(EXPERIMENTS.pacing.focusUnits).toContain(h);
  });
});
