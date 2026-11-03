/**
 * Side-by-side comparison of several balance variants run with the same seed:
 * one row per variant, changes from the baseline (the first variant), and whether
 * each change is bigger than the noise. Pure functions (no file system).
 *
 * Noise: a change counts as real when it's more than 2 standard errors (about 95%).
 *  - rates and scores: SE = sqrt(p(1-p)/n) for each variant, combined for the difference
 *    (this ignores that variants share seeds, so it's on the cautious side);
 *  - average rounds: SE from the spread of game lengths;
 *  - spreads (SD and best-minus-worst): bootstrap over games (see bootstrapSpreads).
 */
import { entryName } from '../src/core/army';
import { Rng } from '../src/core/rng';
import type { GameConfig } from '../src/core/types';
import { type SeatSplit, type Summary, score, seatGap, summarize } from './report';
import { MISSIONS } from '../src/core/missions';
import type { MissionId } from '../src/core/types';
import type { GameRecord } from './runGame';
import type { Experiment } from './variants';

export interface Spread {
  /** Standard deviation of the scores (0–1 scale). */
  sd: number;
  /** Highest minus lowest score. */
  range: number;
  count: number;
}

export interface SpreadNoise {
  presetsSd: number;
  presetsRange: number;
  entriesSd: number;
  entriesRange: number;
}

export interface VariantResult {
  id: string;
  label: string;
  description: string;
  config: GameConfig;
  summary: Summary;
  /** Presets left out because they're illegal under this variant, with the reason. */
  excluded: string[];
  seconds: number;
  /** Standard errors of the spread metrics (bootstrap), if computed. */
  spreadNoise?: SpreadNoise;
  /** A sample map for this variant (same seed for every variant). */
  sampleMap?: { svg: string; ascii: string };
}

export function spread(scores: number[]): Spread {
  if (!scores.length) return { sd: 0, range: 0, count: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  return { sd, range: Math.max(...scores) - Math.min(...scores), count: scores.length };
}

/** Spread of preset scores (presets that played) and of unit/hero scores in random armies (enough games only). */
export function spreads(s: Summary, minGames: number): { presets: Spread; entries: Spread } {
  const presets = s.presetNames.filter((n) => s.presets[n]?.games).map((n) => score(s.presets[n]));
  const entries = Object.values(s.entries)
    .filter((t) => t.games >= minGames)
    .map(score);
  return { presets: spread(presets), entries: spread(entries) };
}

/** Standard errors of the spread metrics, by resampling games with replacement. */
export function bootstrapSpreads(
  records: GameRecord[],
  config: GameConfig,
  presetNames: string[],
  minGames: number,
  iterations = 200,
  seed = 1,
): SpreadNoise {
  const rng = new Rng(seed);
  const samples: number[][] = [[], [], [], []];
  for (let i = 0; i < iterations; i++) {
    const resampled = records.map(() => records[Math.floor(rng.next() * records.length)]);
    const sp = spreads(summarize(resampled, config, presetNames), minGames);
    [sp.presets.sd, sp.presets.range, sp.entries.sd, sp.entries.range].forEach((v, k) => samples[k].push(v));
  }
  const sd = (xs: number[]) => spread(xs).sd;
  return { presetsSd: sd(samples[0]), presetsRange: sd(samples[1]), entriesSd: sd(samples[2]), entriesRange: sd(samples[3]) };
}

// ---------------------------------------------------------------------------
// Metrics: each is a value per variant plus its standard error (for the noise check)
// ---------------------------------------------------------------------------

export interface Metric {
  label: string;
  /** How to print it. */
  format: 'pct' | 'num';
  /** Per variant: value, standard error (null = not estimated), sample size, note. */
  cells: { value: number | null; se: number | null; n: number; note?: string }[];
}

const propSe = (p: number, n: number) => (n ? Math.sqrt((p * (1 - p)) / n) : null);

export interface MetricGroups {
  flow: Metric[];
  presets: Metric[];
  units: Metric[];
  heroes: Metric[];
  spread: Metric[];
  /** The same preset and focus unit/hero scores, for each mission's games alone. */
  byMission: { mission: MissionId; name: string; presets: Metric[]; units: Metric[]; heroes: Metric[] }[];
  /** Going first minus going second (score gap): every preset, hero and unit, overall; presets per mission. */
  seat: { presets: Metric[]; heroes: Metric[]; units: Metric[]; presetsByMission: { name: string; presets: Metric[] }[] };
}

export function compareMetrics(results: VariantResult[], exp: Experiment, minGames: number): MetricGroups {
  const s = results.map((r) => r.summary);
  const rate = (label: string, f: (x: Summary) => { k: number; n: number }): Metric => ({
    label,
    format: 'pct',
    cells: s.map((x) => {
      const { k, n } = f(x);
      const p = n ? k / n : 0;
      return { value: n ? p : null, se: propSe(p, n), n };
    }),
  });

  const flow: Metric[] = [
    { label: 'Terrain pieces / map', format: 'num', cells: s.map((x) => ({ value: x.avgTerrainPieces, se: null, n: x.games })) },
    { label: 'Terrain hexes / map', format: 'num', cells: s.map((x) => ({ value: x.avgTerrainHexes, se: null, n: x.games })) },
    {
      label: 'Avg game length (rounds)',
      format: 'num',
      cells: s.map((x) => {
        const variance = Math.max(0, x.roundsSq / x.games - x.avgRounds ** 2);
        return { value: x.avgRounds, se: Math.sqrt(variance / x.games), n: x.games };
      }),
    },
    rate('Wipeout wins', (x) => ({ k: x.reasons.elimination ?? 0, n: x.games })),
    rate('Objective wins (points / flag capture)', (x) => ({ k: (x.reasons.points ?? 0) + (x.reasons.capture ?? 0), n: x.games })),
    rate('Draws', (x) => ({ k: (x.reasons.draw ?? 0) + (x.reasons.roundLimit ?? 0), n: x.games })),
    rate('First mover wins (decisive games)', (x) => ({ k: x.firstMover.wins, n: x.firstMover.wins + x.firstMover.losses })),
  ];
  // The same flow, split by mission (each game's mission is random).
  const missions = [...new Set(s.flatMap((x) => Object.keys(x.byMission)))] as MissionId[];
  for (const m of missions) {
    const name = MISSIONS[m].name;
    const of = (x: Summary) => x.byMission[m];
    flow.push(
      rate(`${name}: share of games`, (x) => ({ k: of(x)?.games ?? 0, n: x.games })),
      {
        label: `${name}: avg game length`,
        format: 'num',
        cells: s.map((x) => {
          const y = of(x);
          if (!y?.games) return { value: null, se: null, n: 0 };
          const variance = Math.max(0, y.roundsSq / y.games - y.avgRounds ** 2);
          return { value: y.avgRounds, se: Math.sqrt(variance / y.games), n: y.games };
        }),
      },
      rate(`${name}: wipeout wins`, (x) => ({ k: of(x)?.reasons.elimination ?? 0, n: of(x)?.games ?? 0 })),
      rate(`${name}: objective wins`, (x) => ({ k: (of(x)?.reasons.points ?? 0) + (of(x)?.reasons.capture ?? 0), n: of(x)?.games ?? 0 })),
      rate(`${name}: first mover wins`, (x) => ({ k: of(x)?.firstMover.wins ?? 0, n: (of(x)?.firstMover.wins ?? 0) + (of(x)?.firstMover.losses ?? 0) })),
    );
  }

  const presetNames = [...new Set(results.flatMap((r) => r.summary.presetNames).concat(results.flatMap((r) => r.excluded.map((e) => e.split(':')[0]))))];
  // `pick` chooses the summary: the whole run, or one mission's games.
  type Pick = (x: Summary) => Summary | undefined;
  const all: Pick = (x) => x;
  const presetMetrics = (pick: Pick): Metric[] => presetNames.map((name) => ({
    label: name,
    format: 'pct',
    cells: results.map((r) => {
      const t = pick(r.summary)?.presets[name];
      if (!t?.games) return { value: null, se: null, n: 0, note: r.excluded.some((e) => e.startsWith(`${name}:`)) ? 'not legal' : undefined };
      const p = score(t);
      return { value: p, se: propSe(p, t.games), n: t.games };
    }),
  }));
  const presets = presetMetrics(all);

  const config = results[0].config;
  const isHero = (id: string) => !!(config.units[id]?.hero ?? config.squads[id]?.hero);
  const focus = (ids: string[], pick: Pick = all): Metric[] => ids.map((id) => ({
    label: entryName(config, id),
    format: 'pct',
    cells: results.map((r) => {
      const t = pick(r.summary)?.entries[id];
      if (!t?.games) return { value: null, se: null, n: 0 };
      const p = score(t);
      return { value: p, se: propSe(p, t.games), n: t.games };
    }),
  }));

  const sp = results.map((r) => spreads(r.summary, minGames));
  const noise = (r: VariantResult, k: keyof SpreadNoise) => r.spreadNoise?.[k] ?? null;
  const spreadMetric = (label: string, f: (x: { presets: Spread; entries: Spread }) => Spread, part: 'sd' | 'range', k: keyof SpreadNoise): Metric => ({
    label,
    format: 'pct',
    cells: results.map((r, i) => ({ value: f(sp[i])[part], se: noise(r, k), n: f(sp[i]).count })),
  });
  const spread: Metric[] = [
    spreadMetric('Preset spread (SD)', (x) => x.presets, 'sd', 'presetsSd'),
    spreadMetric('Preset range (best − worst)', (x) => x.presets, 'range', 'presetsRange'),
    spreadMetric(`Unit/hero spread (SD, ${minGames}+ games)`, (x) => x.entries, 'sd', 'entriesSd'),
    spreadMetric('Unit/hero range (best − worst)', (x) => x.entries, 'range', 'entriesRange'),
  ];
  const unitIds = exp.focusUnits.filter((id) => !isHero(id));
  const heroIds = exp.focusUnits.filter(isHero);
  const byMission = missions.map((m) => {
    const pick: Pick = (x) => x.byMission[m];
    return { mission: m, name: MISSIONS[m].name, presets: presetMetrics(pick), units: focus(unitIds, pick), heroes: focus(heroIds, pick) };
  });
  // Going first vs second: the score gap (1st − 2nd) and its standard error.
  const gapMetric = (label: string, pick: (x: Summary) => SeatSplit | undefined): Metric => ({
    label,
    format: 'pct',
    cells: results.map((r) => {
      const g = seatGap(pick(r.summary));
      if (!g) return { value: null, se: null, n: 0 };
      const se = Math.sqrt((g.first * (1 - g.first)) / g.n1 + (g.second * (1 - g.second)) / g.n2);
      return { value: g.gap, se, n: g.n1 + g.n2 };
    }),
  });
  const entryIds = [...new Set(results.flatMap((r) => Object.keys(r.summary.entries)))].sort((a, b) =>
    entryName(config, a).localeCompare(entryName(config, b)),
  );
  const seat = {
    presets: presetNames.map((n) => gapMetric(n, (x) => x.seat.presets[n])),
    heroes: entryIds.filter(isHero).map((id) => gapMetric(entryName(config, id), (x) => x.seat.entries[id])),
    units: entryIds.filter((id) => !isHero(id)).map((id) => gapMetric(entryName(config, id), (x) => x.seat.entries[id])),
    presetsByMission: missions.map((m) => ({
      name: MISSIONS[m].name,
      presets: presetNames.map((n) => gapMetric(n, (x) => x.byMission[m]?.seat.presets[n])),
    })),
  };
  return { flow, presets, units: focus(unitIds), heroes: focus(heroIds), spread, byMission, seat };
}

/** Change from the baseline and whether it's beyond 2 standard errors (null when it can't be judged). */
export function change(metric: Metric, i: number): { delta: number; real: boolean | null } | null {
  const b = metric.cells[0];
  const c = metric.cells[i];
  if (i === 0 || b.value === null || c.value === null) return null;
  const delta = c.value - b.value;
  const se = b.se !== null && c.se !== null ? Math.sqrt(b.se ** 2 + c.se ** 2) : null;
  return { delta, real: se === null ? null : Math.abs(delta) > 2 * se };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CompareMeta {
  seed: number;
  perMatchup: number;
  randomGames: number;
  minGames: number;
  workers: number;
}

const fmt = (m: Metric, v: number) => (m.format === 'pct' ? `${(100 * v).toFixed(1)}%` : v.toFixed(2));
const fmtDelta = (m: Metric, d: number) => {
  const sign = d >= 0 ? '+' : '−';
  return m.format === 'pct' ? `${sign}${Math.abs(100 * d).toFixed(1)}` : `${sign}${Math.abs(d).toFixed(2)}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function compareCsv(results: VariantResult[], exp: Experiment, minGames: number): string {
  const g = compareMetrics(results, exp, minGames);
  const metrics = [
    ...g.flow,
    ...g.presets.map((m) => ({ ...m, label: `Preset: ${m.label}` })),
    ...g.units.map((m) => ({ ...m, label: `Random armies: ${m.label}` })),
    ...g.heroes.map((m) => ({ ...m, label: `Random armies (hero): ${m.label}` })),
    ...g.byMission.flatMap((b) => [
      ...b.presets.map((m) => ({ ...m, label: `${b.name}: preset ${m.label}` })),
      ...b.units.map((m) => ({ ...m, label: `${b.name}: random armies ${m.label}` })),
      ...b.heroes.map((m) => ({ ...m, label: `${b.name}: random armies (hero) ${m.label}` })),
    ]),
    ...g.seat.presets.map((m) => ({ ...m, label: `1st − 2nd gap: preset ${m.label}` })),
    ...g.seat.presetsByMission.flatMap((b) => b.presets.map((m) => ({ ...m, label: `1st − 2nd gap (${b.name}): preset ${m.label}` }))),
    ...g.seat.heroes.map((m) => ({ ...m, label: `1st − 2nd gap: hero ${m.label}` })),
    ...g.seat.units.map((m) => ({ ...m, label: `1st − 2nd gap: unit ${m.label}` })),
    ...g.spread,
  ];
  const header = ['variant', ...metrics.flatMap((m) => [m.label, `${m.label} (change)`, `${m.label} (beyond noise)`])];
  const rows = results.map((r, i) => [
    r.label,
    ...metrics.flatMap((m) => {
      const c = m.cells[i];
      const ch = change(m, i);
      return [c.value === null ? (c.note ?? '') : c.value.toFixed(4), ch ? ch.delta.toFixed(4) : '', ch?.real === null || !ch ? '' : ch.real ? 'yes' : 'no'];
    }),
  ]);
  return [header, ...rows].map((l) => l.map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
}

function table(title: string, metrics: Metric[], results: VariantResult[]): string {
  const head = `<tr><th>Variant</th>${metrics.map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr>`;
  const rows = results
    .map((r, i) => {
      const cells = metrics
        .map((m) => {
          const c = m.cells[i];
          if (c.value === null) return `<td class="na">${c.note ?? '–'}</td>`;
          const ch = change(m, i);
          let d = '';
          if (ch) {
            const cls = ch.real === null ? 'd' : ch.real ? `d real ${ch.delta > 0 ? 'up' : 'down'}` : 'd noise';
            const tag = ch.real === false ? ' ~' : '';
            d = `<span class="${cls}">${fmtDelta(m, ch.delta)}${tag}</span>`;
          }
          const n = m.format === 'pct' && c.se !== null && i === 0 ? `<span class="n">±${(200 * c.se).toFixed(1)}</span>` : '';
          return `<td><b>${fmt(m, c.value)}</b>${d}${n}</td>`;
        })
        .join('');
      return `<tr${i === 0 ? ' class="base"' : ''}><th>${esc(r.label)}</th>${cells}</tr>`;
    })
    .join('');
  return `<h2>${esc(title)}</h2><section><table>${head}${rows}</table></section>`;
}

export function compareHtml(results: VariantResult[], exp: Experiment, meta: CompareMeta): string {
  const g = compareMetrics(results, exp, meta.minGames);
  const maps = results
    .filter((r) => r.sampleMap)
    .map((r) => `<figure><figcaption>${esc(r.label)}</figcaption>${r.sampleMap!.svg}</figure>`)
    .join('');
  const variantList = results
    .map(
      (r) =>
        `<li><b>${esc(r.label)}</b> (<code>${esc(r.id)}</code>): ${esc(r.description)} · ${r.summary.games} games ·
        <a href="${encodeURIComponent(r.id)}/report.html">full report</a>${r.excluded.length ? `<br><span class="warn">Left out: ${r.excluded.map(esc).join('; ')}</span>` : ''}</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(exp.title)}: variant comparison</title>
<style>
  :root { --bg:#f7f6f2; --card:#fff; --text:#1d2330; --muted:#6b7385; --line:#e3e1da; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
  main { max-width:1250px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:26px; margin:0 0 4px; } h2 { font-size:18px; margin:28px 0 8px; }
  .muted { color:var(--muted); } .note { background:#fff7e0; border:1px solid #f0d78a; padding:10px 12px; border-radius:8px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-top:12px; overflow-x:auto; }
  table { border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { padding:6px 9px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; vertical-align:top; }
  th:first-child { text-align:left; } td.na { color:#999; text-align:center; } tr.base td, tr.base th { background:#faf9f5; }
  td b { display:block; font-size:15px; }
  .d { display:block; font-size:12px; } .d.noise { color:#9aa0ac; } .d.real { font-weight:700; } .d.up { color:#167a3e; } .d.down { color:#b42318; }
  .n { display:block; font-size:11px; color:var(--muted); }
  .maps { display:flex; flex-wrap:wrap; gap:16px; } figure { margin:0; } figcaption { font-weight:700; margin-bottom:4px; }
  figure svg { width:300px; height:auto; }
  .warn { color:#b42318; } li { margin:4px 0; }
</style></head><body><main>
<h1>${esc(exp.title)}: variant comparison</h1>
<div class="muted">Seed ${meta.seed} for every variant · ${meta.perMatchup} games per preset matchup + ${meta.randomGames} random-vs-random each ·
${meta.workers} workers</div>
<p class="note">Every variant uses the same seed and setup, so deployment shapes, coin flips and armies line up; differences come from
the variant (its maps and dice still differ once the terrain changes). Scores count a draw as half a win. Under each value is the change
from the baseline: <b class="up">bold green</b> / <b class="down">bold red</b> = beyond 2 standard errors (probably real),
<span style="color:#9aa0ac">grey with ~</span> = within noise. The baseline row shows each score's 95% margin (±). The bot is simple,
so treat this as a signal, not a verdict.</p>

${maps ? `<h2>Sample maps (same seed)</h2><section><div class="maps">${maps}</div><p class="muted">Cream = open, gray = height 1,
dark = height 2, gold = control point, blue/red = deployment zones.</p></section>` : ''}
${table('Game flow', g.flow, results)}
${table('Preset armies (score)', g.presets, results)}
${g.units.length ? table('Random armies: score when the army includes the unit…', g.units, results) : ''}
${g.heroes.length ? table('Random armies: score when the army includes the hero…', g.heroes, results) : ''}
${g.byMission
  .map(
    (b) =>
      table(`${b.name}: preset armies (score)`, b.presets, results) +
      (b.heroes.length || b.units.length ? table(`${b.name}: random armies, heroes and units (score)`, [...b.heroes, ...b.units], results) : ''),
  )
  .join('\n')}
<h2>Going first vs second</h2>
<p class="muted">Each value is the score gap 1st − 2nd (how much better the army does when it wins the coin flip), in points.
The baseline row shows its 95% margin; under the other rows, the change from the baseline (green/red bold = beyond noise).
Each variant's own report has the full table (1st and 2nd scores, overall and per mission).</p>
${table('Gap: preset armies (overall)', g.seat.presets, results)}
${g.seat.presetsByMission.map((b) => table(`Gap: preset armies (${b.name})`, b.presets, results)).join('\n')}
${table('Gap: heroes in random armies (overall)', g.seat.heroes, results)}
${table('Gap: units in random armies (overall)', g.seat.units, results)}
${table('Overall spread', g.spread, results)}

<h2>Variants</h2>
<section><ul>${variantList}</ul></section>
</main></body></html>`;
}
