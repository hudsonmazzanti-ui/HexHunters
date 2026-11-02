/**
 * Side-by-side comparison of several balance variants run with the same seed.
 * Pure functions (no file system), so they can be tested.
 */
import { entryName } from '../src/core/army';
import type { GameConfig } from '../src/core/types';
import { type Summary, type Tally, score } from './report';
import type { Experiment } from './variants';

export interface VariantResult {
  id: string;
  label: string;
  description: string;
  config: GameConfig;
  summary: Summary;
  /** Presets left out because they're illegal under this variant, with the reason. */
  excluded: string[];
  seconds: number;
}

export interface Spread {
  /** Standard deviation of the scores (0–1 scale). */
  sd: number;
  /** Highest minus lowest score. */
  range: number;
  count: number;
}

export function spread(scores: number[]): Spread {
  if (!scores.length) return { sd: 0, range: 0, count: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  return { sd, range: Math.max(...scores) - Math.min(...scores), count: scores.length };
}

/** Spread of preset scores (legal presets only) and of unit/hero scores in random armies (enough games only). */
export function spreads(s: Summary, minGames: number): { presets: Spread; entries: Spread } {
  const presets = s.presetNames.filter((n) => s.presets[n]?.games).map((n) => score(s.presets[n]));
  const entries = Object.values(s.entries)
    .filter((t) => t.games >= minGames)
    .map(score);
  return { presets: spread(presets), entries: spread(entries) };
}

/** Score of a unit/hero/squad in random armies, or of a preset (null if not played). */
const entryTally = (s: Summary, id: string): Tally | null => s.entries[id] ?? null;
const presetTally = (s: Summary, name: string): Tally | null => (s.presets[name]?.games ? s.presets[name] : null);

export interface CompareMeta {
  seed: number;
  perMatchup: number;
  randomGames: number;
  minGames: number;
  workers: number;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const pp = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Rows of the main comparison table: one per metric, one column per variant. */
export function compareRows(results: VariantResult[], exp: Experiment, minGames: number) {
  type Cell = { value: number | null; games: number; note?: string };
  const rows: { label: string; kind: 'score' | 'spread'; cells: Cell[] }[] = [];
  for (const id of exp.focusUnits) {
    const name = entryName(results[0].config, id);
    const isHero = !!(results[0].config.units[id]?.hero ?? results[0].config.squads[id]?.hero);
    rows.push({
      label: `${name} (${isHero ? 'hero' : 'unit'} in random armies)`,
      kind: 'score',
      cells: results.map((r) => {
        const t = entryTally(r.summary, id);
        return { value: t ? score(t) : null, games: t?.games ?? 0 };
      }),
    });
  }
  for (const name of exp.focusPresets) {
    rows.push({
      label: `${name} (preset)`,
      kind: 'score',
      cells: results.map((r) => {
        const t = presetTally(r.summary, name);
        const why = r.excluded.find((e) => e.startsWith(`${name}:`));
        return { value: t ? score(t) : null, games: t?.games ?? 0, note: why ? 'not legal' : undefined };
      }),
    });
  }
  const sp = results.map((r) => spreads(r.summary, minGames));
  rows.push({ label: 'Preset spread (SD of preset scores)', kind: 'spread', cells: sp.map((s) => ({ value: s.presets.sd, games: s.presets.count })) });
  rows.push({ label: 'Preset range (best − worst)', kind: 'spread', cells: sp.map((s) => ({ value: s.presets.range, games: s.presets.count })) });
  rows.push({ label: `Unit/hero spread (SD, ${minGames}+ games)`, kind: 'spread', cells: sp.map((s) => ({ value: s.entries.sd, games: s.entries.count })) });
  rows.push({ label: 'Unit/hero range (best − worst)', kind: 'spread', cells: sp.map((s) => ({ value: s.entries.range, games: s.entries.count })) });
  return rows;
}

export function compareCsv(results: VariantResult[], exp: Experiment, minGames: number): string {
  const rows = compareRows(results, exp, minGames);
  const header = ['metric', ...results.flatMap((r) => [`${r.label}`, `${r.label} games`])];
  const lines = [header, ...rows.map((row) => [row.label, ...row.cells.flatMap((c) => [c.value === null ? (c.note ?? '') : c.value.toFixed(4), String(c.games)])])];
  return lines.map((l) => l.map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
}

function cellBg(delta: number | null, kind: 'score' | 'spread'): string {
  if (delta === null || Math.abs(delta) < 0.005) return '';
  // For spreads, smaller is better (more balanced); for scores just show direction.
  const good = kind === 'spread' ? delta < 0 : null;
  const hue = good === null ? 210 : good ? 140 : 0;
  const alpha = Math.min(0.5, Math.abs(delta) * (kind === 'spread' ? 6 : 2.5)).toFixed(2);
  return ` style="background:hsla(${hue},70%,45%,${alpha})"`;
}

export function compareHtml(results: VariantResult[], exp: Experiment, meta: CompareMeta): string {
  const base = results[0];
  const rows = compareRows(results, exp, meta.minGames);
  const head = `<tr><th>Metric</th>${results.map((r) => `<th>${esc(r.label)}</th>`).join('')}</tr>`;
  const body = rows
    .map((row) => {
      const cells = row.cells
        .map((c, i) => {
          if (c.value === null) return `<td class="na">${c.note ?? '–'}</td>`;
          const b = row.cells[0].value;
          const delta = i > 0 && b !== null ? c.value - b : null;
          const d = delta === null ? '' : `<span class="d">${pp(delta)}</span>`;
          const n = row.kind === 'score' ? `<span class="n">${c.games} games</span>` : '';
          return `<td${cellBg(delta, row.kind)}><b>${pct(c.value)}</b>${d}${n}</td>`;
        })
        .join('');
      return `<tr><th>${esc(row.label)}</th>${cells}</tr>`;
    })
    .join('');

  // Every preset's score per variant.
  const presetNames = base.summary.presetNames;
  const presetTable = `<tr><th>Preset</th>${results.map((r) => `<th>${esc(r.label)}</th>`).join('')}</tr>${presetNames
    .map(
      (n) =>
        `<tr><th>${esc(n)}</th>${results
          .map((r, i) => {
            const t = presetTally(r.summary, n);
            if (!t) return `<td class="na">${r.excluded.some((e) => e.startsWith(`${n}:`)) ? 'not legal' : '–'}</td>`;
            const b = presetTally(base.summary, n);
            const delta = i > 0 && b ? score(t) - score(b) : null;
            return `<td${cellBg(delta, 'score')}>${pct(score(t))}${delta === null ? '' : `<span class="d">${pp(delta)}</span>`}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('')}`;

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
  main { max-width:1150px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:26px; margin:0 0 4px; } h2 { font-size:18px; margin:28px 0 8px; }
  .muted { color:var(--muted); } .note { background:#fff7e0; border:1px solid #f0d78a; padding:10px 12px; border-radius:8px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-top:12px; overflow-x:auto; }
  table { border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { padding:6px 10px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; vertical-align:top; }
  th:first-child { text-align:left; } td.na { color:#999; text-align:center; }
  td b { display:block; font-size:15px; } .d { display:block; font-size:12px; color:#333; } .n { display:block; font-size:11px; color:var(--muted); }
  .warn { color:#b42318; } li { margin:4px 0; }
</style></head><body><main>
<h1>${esc(exp.title)}: variant comparison</h1>
<div class="muted">Seed ${meta.seed} for every variant · ${meta.perMatchup} games per preset matchup + ${meta.randomGames} random-vs-random each ·
${meta.workers} workers</div>
<p class="note">Same seed and setup for every variant: maps, deployment shapes and dice line up, so differences come from the
stat change (random armies are rebuilt per variant, so a cost change also changes which armies get built). Scores count a
draw as half a win; the small numbers under each score are the change from the baseline in percentage points. Spread rows:
green = more balanced than the baseline. The bot is simple, so treat this as a signal, not a verdict.
With ~${meta.perMatchup * 8} games per preset, differences under about 5 points are within noise.</p>

<h2>Comparison</h2>
<section><table>${head}${body}</table></section>

<h2>Every preset</h2>
<section><table>${presetTable}</table></section>

<h2>Variants</h2>
<section><ul>${variantList}</ul></section>
</main></body></html>`;
}
