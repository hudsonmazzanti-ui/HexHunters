import { describe, expect, it } from 'vitest';
import { validateArmy } from '../src/core/army';
import { Rng } from '../src/core/rng';
import { DEFAULT_CONFIG } from '../src/data/config';
import { PRESETS, checkPresets, meetsSynergy, randomArmy } from '../sim/armies';
import { HERO_SYNERGIES } from '../sim/synergies';
import { armyCost } from '../src/core/army';
import { specialUsesFor } from '../src/core/army';
import { findFlags, gamesCsv, reportHtml, summarize, unitsCsv } from '../sim/report';
import { type GameJob, runGame, runJobs } from '../sim/runGame';
import { buildJobs, splitGames } from '../sim/schedule';

const config = DEFAULT_CONFIG;
const job = (seed: number, a = PRESETS[0], b = PRESETS[4], seatOfA: 0 | 1 = 0): GameJob => ({
  index: 0,
  seed,
  kind: 'preset',
  a,
  b,
  seatOfA,
});

describe('armies', () => {
  it('every preset is a legal army', () => {
    expect(checkPresets(config)).toEqual([]);
    expect(PRESETS.map((p) => p.name)).toContain('Skeleton Wall');
  });

  it('random armies are always legal and vary in size and heroes', () => {
    const rng = new Rng(9);
    const armies = Array.from({ length: 300 }, () => randomArmy(config, rng));
    for (const a of armies) expect(validateArmy(config, a.units)).toBeNull();
    const sizes = new Set(armies.map((a) => a.units.length));
    expect(sizes.size).toBeGreaterThan(4);
    const withHero = armies.filter((a) => a.units.some((u) => config.units[u]?.hero || config.squads[u]?.hero)).length;
    expect(withHero).toBeGreaterThan(90);
    expect(withHero).toBeLessThan(210);
  });
});

describe('hero synergies in random armies', () => {
  it('the synergy config names real heroes and units', () => {
    for (const [hero, rule] of Object.entries(HERO_SYNERGIES)) {
      expect(config.units[hero]?.hero).toBeTruthy();
      for (const u of rule.units ?? []) expect(config.units[u]).toBeDefined();
    }
    expect(Object.keys(HERO_SYNERGIES).sort()).toEqual(
      ['marshal', 'siegemaster', 'necromancer', 'masterninja', 'warden', 'pyromancer', 'warlord', 'mercenary'].sort(),
    );
  });

  it('a hero with a synergy always comes with 2+ of its units; the Mercenary leaves 1-3 points', () => {
    const rng = new Rng(17);
    const seen = new Set<string>();
    for (let i = 0; i < 700; i++) {
      const army = randomArmy(config, rng).units;
      expect(validateArmy(config, army)).toBeNull();
      expect(armyCost(config, army)).toBeLessThanOrEqual(config.armyPointLimit);
      for (const [hero, rule] of Object.entries(HERO_SYNERGIES)) {
        if (!army.includes(hero)) continue;
        seen.add(hero);
        expect(meetsSynergy(config, army, rule)).toBe(true);
        if (rule.units) expect(army.filter((u) => rule.units!.includes(u)).length).toBeGreaterThanOrEqual(2);
        if (hero === 'mercenary') {
          const unspent = config.armyPointLimit - armyCost(config, army);
          expect(unspent).toBeGreaterThanOrEqual(1);
          expect(unspent).toBeLessThanOrEqual(3);
          expect(specialUsesFor(config, army, 'mercenary')).toBe(unspent); // it has Premium Shots
        }
      }
      for (const free of ['standardbearer', 'gambler', 'twins', 'behemoth']) if (army.includes(free)) seen.add(free);
    }
    // Every hero shows up, with and without rules; the remaining points are still random.
    expect(seen.size).toBe(12);
  }, 60_000);

  it('heroes without synergies stay unrestricted (no extra units forced in)', () => {
    const rng = new Rng(3);
    const sizes = new Set<number>();
    for (let i = 0; i < 700; i++) {
      const army = randomArmy(config, rng).units;
      if (army.includes('gambler')) sizes.add(army.length);
    }
    expect([...sizes].some((n) => n <= 2)).toBe(true);
  }, 60_000);
});

describe('simulator games', () => {
  it('plays complete, legal games for presets and random armies', () => {
    const jobs = buildJobs(config, { seed: 3, perMatchup: 1, randomGames: 6 }).filter((_, i) => i % 6 === 0 || i >= 36);
    for (const r of runJobs(jobs)) {
      expect(r.illegal).toBe(0); // the rules never refused a bot action
      expect(['A', 'B', 'draw']).toContain(r.winner);
      expect(['points', 'capture', 'elimination', 'draw', 'roundLimit']).toContain(r.reason);
      if (r.reason === 'capture') expect(r.mission).toBe('ctf');
      expect(r.rounds).toBeGreaterThanOrEqual(1);
      expect(r.rounds).toBeLessThanOrEqual(30);
      if (r.reason === 'points') expect(Math.max(r.scoreA, r.scoreB)).toBeGreaterThanOrEqual(r.mission === 'dom' ? 8 : config.pointsToWin);
      // Both sides actually fought.
      const actions = Object.values(r.usage).reduce((n, u) => n + u.attacks + u.specials, 0);
      expect(actions).toBeGreaterThan(0);
    }
  }, 60_000);

  it('a game still going after 30 rounds ends as a draw', () => {
    const r = runGame(job(11), { bot: 'passive' }); // nobody ever moves, so nobody scores
    expect(r).toMatchObject({ winner: 'draw', reason: 'roundLimit', rounds: 30, scoreA: 0, scoreB: 0 });
    expect(runGame(job(11), { bot: 'passive', maxRounds: 4 })).toMatchObject({ reason: 'roundLimit', rounds: 4 });
  });

  it('the same seed and armies replay identically; another seed differs', () => {
    const one = runGame(job(1234), { keepLog: true });
    const two = runGame(job(1234), { keepLog: true });
    expect(two).toEqual(one);
    expect(one.log!.length).toBeGreaterThan(10);
    const other = runGame(job(1235), { keepLog: true });
    expect(other.log).not.toEqual(one.log);
  });

  it('splitting games across workers gives the same results as one worker', () => {
    const jobs = buildJobs(config, { seed: 8, perMatchup: 0, randomGames: 8 });
    const single = runJobs(jobs);
    const chunks = [0, 1, 2].map((w) => jobs.filter((_, i) => i % 3 === w));
    const merged = chunks.flatMap((c) => runJobs(c)).sort((a, b) => a.index - b.index);
    expect(merged).toEqual(single);
  }, 60_000);

  it('the schedule alternates seats and is deterministic', () => {
    const jobs = buildJobs(config, { seed: 5, perMatchup: 4, randomGames: 10 });
    expect(jobs).toHaveLength(36 * 4 + 10);
    expect(jobs.slice(0, 4).map((j) => j.seatOfA)).toEqual([0, 1, 0, 1]);
    expect(buildJobs(config, { seed: 5, perMatchup: 4, randomGames: 10 })).toEqual(jobs);
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(jobs.length);
    expect(splitGames(2000, 9)).toEqual({ perMatchup: 28, randomGames: 992 });
  });
});

describe('report', () => {
  it('summarizes results into CSV and HTML with flags and the bot caveat', () => {
    const jobs = buildJobs(config, { seed: 4, perMatchup: 1, randomGames: 4 }).filter((_, i) => i < 3 || i >= 36);
    const records = runJobs(jobs);
    const s = summarize(records, config, PRESETS.map((p) => p.name));
    expect(s.games).toBe(records.length);
    expect(s.illegal).toBe(0);
    expect(Object.values(s.reasons).reduce((a, b) => a + b, 0)).toBe(records.length);
    expect(gamesCsv(records).split('\n')[0]).toContain('seed');
    expect(gamesCsv(records).trim().split('\n')).toHaveLength(records.length + 1);
    expect(unitsCsv(s, config)).toContain('specialsPerTurn');
    expect(findFlags(s, config, 1000)).toEqual([]); // nothing has 1000 games
    const html = reportHtml(s, config, {
      seed: 4, perMatchup: 1, randomGames: 4, workers: 1, seconds: 1, minGames: 25, maxRounds: 30,
    });
    expect(html).toContain('Matchup grid');
    expect(html).toContain('simple heuristic bot');
    expect(html).toContain('Twins');
  }, 60_000);
});

describe('missions in the simulator', () => {
  it('plays legal Capture the Flag games where the bot picks up, carries and captures the flag', () => {
    const ctfConfig = { ...config, missions: ['ctf' as const] };
    const jobs = buildJobs(ctfConfig, { seed: 21, perMatchup: 0, randomGames: 30 });
    const records = runJobs(jobs, { config: ctfConfig });
    expect(records.every((r) => r.mission === 'ctf' && r.illegal === 0)).toBe(true);
    const total = (f: (r: (typeof records)[number]) => number) => records.reduce((n, r) => n + f(r), 0);
    expect(total((r) => r.flagPickups)).toBeGreaterThan(10);
    expect(total((r) => r.capturesA + r.capturesB)).toBeGreaterThan(0);
    for (const r of records) if (r.capturesA + r.capturesB) expect(r).toMatchObject({ reason: 'capture', winner: r.capturesA ? 'A' : 'B' });
    for (const r of records) expect(r.captureUnit !== null).toBe(r.reason === 'capture');
    for (const r of records) if (r.captureUnit) expect(ctfConfig.units[r.captureUnit]).toBeDefined();
    const sum = summarize(records, ctfConfig, []);
    expect(Object.values(sum.captureUnits).reduce((a, b) => a + b, 0)).toBe(records.filter((r) => r.reason === 'capture').length);
  }, 60_000);

  it('plays legal Domination games where the bot claims sites and wins on points', () => {
    const domConfig = { ...config, missions: ['dom' as const] };
    const records = runJobs(buildJobs(domConfig, { seed: 23, perMatchup: 0, randomGames: 30 }), { config: domConfig });
    expect(records.every((r) => r.mission === 'dom' && r.illegal === 0)).toBe(true);
    expect(records.reduce((n, r) => n + r.siteClaims, 0)).toBeGreaterThan(30);
    expect(records.some((r) => r.reason === 'points')).toBe(true);
    for (const r of records) if (r.reason === 'points') expect(Math.max(r.scoreA, r.scoreB)).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('random missions are mixed in a run and the report breaks results down by mission', () => {
    const jobs = buildJobs(config, { seed: 4, perMatchup: 1, randomGames: 60 }).filter((_, i) => i % 3 === 0 || i >= 36);
    const records = runJobs(jobs);
    const missions = new Set(records.map((r) => r.mission));
    expect(missions).toEqual(new Set(['koth', 'ctf', 'dom']));
    const s = summarize(records, config, PRESETS.map((p) => p.name));
    expect((s.byMission.koth?.games ?? 0) + (s.byMission.ctf?.games ?? 0) + (s.byMission.dom?.games ?? 0)).toBe(records.length);
    expect(s.byMission.ctf?.byMission).toEqual({}); // only one level deep
    const html = reportHtml(s, config, { seed: 4, perMatchup: 1, randomGames: 30, workers: 1, seconds: 1, minGames: 25, maxRounds: 30 });
    expect(html).toContain('By mission');
    expect(html).toContain('How each preset wins');
    expect(html).toContain('By Condition');
    expect(Object.values(s.byCondition).reduce((n, c) => n + c!.games, 0)).toBe(records.length);
    expect(gamesCsv(records).split('\n')[0]).toContain('condition');
    for (const r of records) expect(r.mission === 'ctf' && r.condition === 'hotdrop').toBe(false);
    expect(html).toContain('who made the winning capture');
    for (const [name, t] of Object.entries(s.presetWinTypes)) {
      expect(t.elimination + t.objective + t.other).toBe(t.wins);
      expect(t.wins).toBe(s.presets[name].wins);
      const perMission = Object.values(s.byMission).reduce((n, m) => n + (m!.presetWinTypes[name]?.wins ?? 0), 0);
      expect(perMission).toBe(t.wins);
    }
    expect(html).toContain('Capture the Flag');
    expect(gamesCsv(records).split('\n')[0]).toContain('mission');
    expect(gamesCsv(records).split('\n')[0]).toContain('captureUnit');
    expect(unitsCsv(s, config).split('\n')[0]).toContain('randomScore_ctf');
  }, 60_000);
});
