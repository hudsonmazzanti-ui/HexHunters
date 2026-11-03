/**
 * Turns game records into summaries, CSV files and a self-contained HTML report.
 * Pure functions (no file system), so they can be tested.
 *
 * "Score" = (wins + draws / 2) / games: a draw counts as half a win. Flags use it.
 */
import { MISSIONS } from '../src/core/missions';
import { CONDITIONS } from '../src/core/conditions';
import type { ConditionId, GameConfig, MissionId } from '../src/core/types';
import { entryName } from '../src/core/army';
import type { GameRecord, Outcome } from './runGame';

export interface Tally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

const tally = (): Tally => ({ games: 0, wins: 0, losses: 0, draws: 0 });
const add = (t: Tally, result: 'win' | 'loss' | 'draw') => {
  t.games++;
  if (result === 'win') t.wins++;
  else if (result === 'loss') t.losses++;
  else t.draws++;
};
export const score = (t: Tally): number => (t.games ? (t.wins + t.draws / 2) / t.games : 0.5);
const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);

const resultFor = (winner: Outcome, side: 'A' | 'B'): 'win' | 'loss' | 'draw' =>
  winner === 'draw' ? 'draw' : winner === side ? 'win' : 'loss';

/** A side's wins split by how they came. `other` = anything else (none today). */
export interface WinTypes {
  wins: number;
  elimination: number;
  objective: number;
  other: number;
}

/** Results split by whether the army won the coin flip (went first in round 1) or not. */
export interface SeatSplit {
  first: Tally;
  second: Tally;
}

export interface Summary {
  games: number;
  presetNames: string[];
  /** Per preset army, over all its preset games. */
  presets: Record<string, Tally & { rounds: number }>;
  /** grid[row][col]: the row army's results against the column army. */
  grid: Record<string, Record<string, Tally>>;
  /** Random armies: per builder entry (unit, hero or squad) included at least once. */
  entries: Record<string, Tally & { hero: boolean }>;
  /** Games won by the army that went first (coin flip), and how many were decisive. */
  firstMover: { games: number; wins: number; losses: number; draws: number };
  shapes: Record<string, { games: number; firstWins: number; draws: number; eliminations: number; rounds: number }>;
  /** Going first vs second: per preset (preset games), and per builder entry (random armies). */
  seat: { presets: Record<string, SeatSplit>; entries: Record<string, SeatSplit> };
  /** Per preset army: how its wins came (wipeout or the mission's objective: points / flag capture). */
  presetWinTypes: Record<string, WinTypes>;
  /** Capture the Flag: winning captures per unit type, overall and per preset army that made them. */
  captureUnits: Record<string, number>;
  presetCaptureUnits: Record<string, Record<string, number>>;
  /** presetShape[preset][shape] */
  presetShape: Record<string, Record<string, Tally>>;
  reasons: Record<string, number>;
  avgRounds: number;
  /** Sum of squared game lengths, for the standard error of avgRounds. */
  roundsSq: number;
  /** Average terrain generated per map. */
  avgTerrainPieces: number;
  avgTerrainHexes: number;
  usage: Record<string, { turns: number; attacks: number; specials: number }>;
  illegal: number;
  /** Capture the Flag totals: captures (both sides), pickups and drops. */
  flag: { captures: number; pickups: number; drops: number };
  /** Domination: site claims (both sides). */
  siteClaims: number;
  /** The same summary for each mission's games alone (only on the top-level summary). */
  byMission: Partial<Record<MissionId, Summary>>;
  /** The same summary for each battlefield Condition's games alone (only on the top-level summary). */
  byCondition: Partial<Record<ConditionId, Summary>>;
}

export function summarize(records: GameRecord[], config: GameConfig, presetNames: string[], splitMissions = true): Summary {
  const s: Summary = {
    games: records.length,
    presetNames,
    presets: {},
    grid: {},
    entries: {},
    firstMover: { games: 0, wins: 0, losses: 0, draws: 0 },
    shapes: {},
    presetShape: {},
    presetWinTypes: {},
    seat: { presets: {}, entries: {} },
    captureUnits: {},
    presetCaptureUnits: {},
    reasons: {},
    avgRounds: 0,
    roundsSq: 0,
    avgTerrainPieces: 0,
    avgTerrainHexes: 0,
    usage: {},
    illegal: 0,
    flag: { captures: 0, pickups: 0, drops: 0 },
    siteClaims: 0,
    byMission: {},
    byCondition: {},
  };
  for (const n of presetNames) {
    s.presets[n] = { ...tally(), rounds: 0 };
    s.grid[n] = {};
    s.presetShape[n] = {};
    s.presetWinTypes[n] = { wins: 0, elimination: 0, objective: 0, other: 0 };
    s.presetCaptureUnits[n] = {};
  }
  let rounds = 0;
  let pieces = 0;
  let hexes = 0;
  for (const r of records) {
    rounds += r.rounds;
    s.roundsSq += r.rounds * r.rounds;
    pieces += r.terrainPieces;
    hexes += r.terrainHexes;
    s.illegal += r.illegal;
    s.flag.captures += r.capturesA + r.capturesB;
    s.flag.pickups += r.flagPickups;
    s.flag.drops += r.flagDrops;
    s.siteClaims += r.siteClaims;
    if (r.captureUnit) s.captureUnits[r.captureUnit] = (s.captureUnits[r.captureUnit] ?? 0) + 1;
    s.reasons[r.reason] = (s.reasons[r.reason] ?? 0) + 1;

    const fm = resultFor(r.winner, r.firstMover);
    s.firstMover.games++;
    if (fm === 'win') s.firstMover.wins++;
    else if (fm === 'loss') s.firstMover.losses++;
    else s.firstMover.draws++;

    const sh = (s.shapes[r.shape] ??= { games: 0, firstWins: 0, draws: 0, eliminations: 0, rounds: 0 });
    sh.games++;
    sh.rounds += r.rounds;
    if (fm === 'win') sh.firstWins++;
    if (r.winner === 'draw') sh.draws++;
    if (r.reason === 'elimination') sh.eliminations++;

    for (const [type, u] of Object.entries(r.usage)) {
      const t = (s.usage[type] ??= { turns: 0, attacks: 0, specials: 0 });
      t.turns += u.turns;
      t.attacks += u.attacks;
      t.specials += u.specials;
    }

    for (const side of ['A', 'B'] as const) {
      const army = side === 'A' ? r.a : r.b;
      const opp = side === 'A' ? r.b : r.a;
      const res = resultFor(r.winner, side);
      const seat = r.firstMover === side ? 'first' : 'second';
      const split = (rec: Record<string, SeatSplit>, k: string) => (rec[k] ??= { first: tally(), second: tally() });
      if (r.kind === 'preset' && s.presets[army.name]) add(split(s.seat.presets, army.name)[seat], res);
      if (r.kind === 'random') for (const entry of new Set(army.units)) add(split(s.seat.entries, entry)[seat], res);
      if (r.kind === 'preset' && s.presets[army.name]) {
        add(s.presets[army.name], res);
        s.presets[army.name].rounds += r.rounds;
        add((s.grid[army.name][opp.name] ??= tally()), res);
        add((s.presetShape[army.name][r.shape] ??= tally()), res);
        if (res === 'win') {
          const wt = s.presetWinTypes[army.name];
          wt.wins++;
          if (r.reason === 'elimination') wt.elimination++;
          else if (r.reason === 'points' || r.reason === 'capture') wt.objective++;
          else wt.other++;
          if (r.captureUnit) {
            const cu = s.presetCaptureUnits[army.name];
            cu[r.captureUnit] = (cu[r.captureUnit] ?? 0) + 1;
          }
        }
      }
      if (r.kind === 'random') {
        for (const entry of new Set(army.units)) {
          const hero = !!(config.squads[entry]?.hero ?? config.units[entry]?.hero);
          add((s.entries[entry] ??= { ...tally(), hero }), res);
        }
      }
    }
  }
  s.avgRounds = records.length ? rounds / records.length : 0;
  s.avgTerrainPieces = records.length ? pieces / records.length : 0;
  s.avgTerrainHexes = records.length ? hexes / records.length : 0;
  if (splitMissions) {
    for (const m of Object.keys(MISSIONS) as MissionId[]) {
      const games = records.filter((r) => r.mission === m);
      if (games.length) s.byMission[m] = summarize(games, config, presetNames, false);
    }
    for (const c of Object.keys(CONDITIONS) as ConditionId[]) {
      const games = records.filter((r) => r.condition === c);
      if (games.length) s.byCondition[c] = summarize(games, config, presetNames, false);
    }
  }
  return s;
}

export interface Flag {
  what: string;
  score: number;
  games: number;
}

/** Everything with a score above `high` or below `low` and at least `minGames` games. */
export function findFlags(s: Summary, config: GameConfig, minGames: number, low = 0.4, high = 0.6): Flag[] {
  const flags: Flag[] = [];
  const check = (what: string, t: Tally) => {
    const sc = score(t);
    if (t.games >= minGames && (sc > high || sc < low)) flags.push({ what, score: sc, games: t.games });
  };
  for (const n of s.presetNames) check(`Preset: ${n}`, s.presets[n]);
  for (const a of s.presetNames) for (const b of s.presetNames) if (a < b && s.grid[a][b]) check(`Matchup: ${a} vs ${b}`, s.grid[a][b]);
  for (const [e, t] of Object.entries(s.entries)) check(`${t.hero ? 'Hero' : 'Unit'} in random armies: ${entryName(config, e)}`, t);
  return flags.sort((x, y) => Math.abs(y.score - 0.5) - Math.abs(x.score - 0.5));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export function gamesCsv(records: GameRecord[]): string {
  return csv([
    ['index', 'seed', 'kind', 'armyA', 'unitsA', 'armyB', 'unitsB', 'seatOfA', 'firstMover', 'mission', 'condition', 'shape', 'terrainPieces', 'terrainHexes',
      'winner', 'reason', 'rounds', 'scoreA', 'scoreB', 'capturesA', 'capturesB', 'flagPickups', 'flagDrops', 'captureUnit', 'siteClaims'],
    ...records.map((r) => [
      r.index, r.seed, r.kind, r.a.name, r.a.units.join(' '), r.b.name, r.b.units.join(' '),
      r.seatOfA + 1, r.firstMover, r.mission, r.condition, r.shape, r.terrainPieces, r.terrainHexes, r.winner, r.reason, r.rounds, r.scoreA, r.scoreB,
      r.capturesA, r.capturesB, r.flagPickups, r.flagDrops, r.captureUnit ?? '', r.siteClaims,
    ]),
  ]);
}

export function unitsCsv(s: Summary, config: GameConfig): string {
  const ids = [...new Set([...Object.keys(s.usage), ...Object.keys(s.entries)])].sort();
  // Per mission: random-army games and score with the entry, e.g. randomGames_ctf, randomScore_ctf.
  const missions = Object.keys(s.byMission) as MissionId[];
  return csv([
    ['id', 'name', 'modelTurns', 'attacks', 'specials', 'attacksPerTurn', 'specialsPerTurn', 'randomGames', 'randomWins', 'randomDraws', 'randomScore',
      ...missions.flatMap((m) => [`randomGames_${m}`, `randomScore_${m}`])],
    ...ids.map((id) => {
      const u = s.usage[id] ?? { turns: 0, attacks: 0, specials: 0 };
      const e = s.entries[id];
      return [
        id, entryName(config, id), u.turns, u.attacks, u.specials,
        u.turns ? (u.attacks / u.turns).toFixed(3) : '', u.turns ? (u.specials / u.turns).toFixed(3) : '',
        e?.games ?? 0, e?.wins ?? 0, e?.draws ?? 0, e ? score(e).toFixed(3) : '',
        ...missions.flatMap((m) => {
          const t = s.byMission[m]!.entries[id];
          return [t?.games ?? 0, t ? score(t).toFixed(3) : ''];
        }),
      ];
    }),
  ]);
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const p1 = (x: number) => `${x.toFixed(1)}%`;

/** Background for a score cell: red below 50%, green above. */
function heat(sc: number, games: number, minGames: number): string {
  if (!games) return '';
  const d = Math.max(-1, Math.min(1, (sc - 0.5) / 0.25));
  const hue = d >= 0 ? 140 : 0;
  const alpha = (Math.abs(d) * (games >= minGames ? 0.55 : 0.25)).toFixed(2);
  return ` style="background:hsla(${hue},70%,45%,${alpha})"`;
}

export interface ReportMeta {
  seed: number;
  perMatchup: number;
  randomGames: number;
  workers: number;
  seconds: number;
  minGames: number;
  maxRounds: number;
  /** Set when the run used a balance variant (temporary stat overrides). */
  variant?: string;
}

/** Going first minus going second, with whether the gap is beyond 2 standard errors. */
export function seatGap(sp: SeatSplit | undefined): { first: number; second: number; gap: number; real: boolean; n1: number; n2: number } | null {
  if (!sp?.first.games || !sp.second.games) return null;
  const a = score(sp.first);
  const b = score(sp.second);
  const se = Math.sqrt((a * (1 - a)) / sp.first.games + (b * (1 - b)) / sp.second.games);
  return { first: a, second: b, gap: a - b, real: Math.abs(a - b) > 2 * se, n1: sp.first.games, n2: sp.second.games };
}

/**
 * "Going first vs second": for every preset, hero and unit, the score when its army won the
 * coin flip (went first in round 1) and when it didn't, overall and per mission.
 */
function seatSection(s: Summary, config: GameConfig): string {
  const groups: { label: string; of: (x: Summary) => Summary | undefined }[] = [
    { label: 'Overall', of: (x) => x },
    ...(Object.keys(s.byMission) as MissionId[]).map((m) => ({ label: MISSIONS[m].name, of: (x: Summary) => x.byMission[m] })),
  ];
  const head = (first: string) =>
    `<tr><th rowspan="2">${first}</th>${groups.map((g) => `<th colspan="3">${esc(g.label)}</th>`).join('')}</tr>` +
    `<tr>${groups.map(() => '<th>1st</th><th>2nd</th><th>Gap</th>').join('')}</tr>`;
  const cells = (pick: (x: Summary) => SeatSplit | undefined) =>
    groups
      .map((g) => {
        const sub = g.of(s);
        const r = sub ? seatGap(pick(sub)) : null;
        if (!r) return '<td class="na">–</td><td class="na">–</td><td class="na">–</td>';
        const gap = `${r.gap >= 0 ? '+' : '−'}${Math.abs(100 * r.gap).toFixed(1)}`;
        return `<td title="${r.n1} games">${p1(100 * r.first)}</td><td title="${r.n2} games">${p1(100 * r.second)}</td>` +
          `<td class="${r.real ? 'gap real' : 'gap noise'}">${r.real ? `<b>${gap}</b>` : `${gap} ~`}</td>`;
      })
      .join('');
  const presets = s.presetNames.map((n) => `<tr><th>${esc(n)}</th>${cells((x) => x.seat.presets[n])}</tr>`).join('');
  const entries = (hero: boolean) =>
    Object.keys(s.entries)
      .filter((id) => s.entries[id].hero === hero)
      .sort((a, b) => entryName(config, a).localeCompare(entryName(config, b)))
      .map((id) => `<tr><th>${esc(entryName(config, id))}</th>${cells((x) => x.seat.entries[id])}</tr>`)
      .join('');
  return `<h2>Going first vs second</h2>
<section><p class="muted">Score (draw = half a win) when the army won the coin flip and went first in round 1 ("1st") and when it
didn't ("2nd"); Gap = 1st minus 2nd. <b>Bold</b> = beyond 2 standard errors (probably real); "~" = within noise. Hover a score for
its number of games; per-mission hero cells are small (about 25–30 games), so most of them are noise.</p>
<h3>Presets</h3><table>${head('Army')}${presets}</table>
<h3>Heroes in random armies</h3><table>${head('Hero')}${entries(true)}</table>
<h3>Units in random armies</h3><table>${head('Unit')}${entries(false)}</table></section>`;
}

/** "By Condition": game flow per battlefield Condition, and preset scores per Condition. */
function conditionSection(s: Summary, meta: ReportMeta): string {
  const cs = (Object.keys(s.byCondition) as ConditionId[]).map((id) => ({ id, name: CONDITIONS[id].name, s: s.byCondition[id]! }));
  if (!cs.length) return '';
  const decisive = (x: Summary) => x.firstMover.wins + x.firstMover.losses;
  const objective = (x: Summary) => (x.reasons.points ?? 0) + (x.reasons.capture ?? 0);
  const draws = (x: Summary) => (x.reasons.draw ?? 0) + (x.reasons.roundLimit ?? 0);
  const flow = cs
    .map(
      ({ name, s: x }) => `<tr><th>${esc(name)}</th><td>${x.games}</td><td>${p1(pct(x.games, s.games))}</td><td>${x.avgRounds.toFixed(1)}</td>
      <td>${p1(pct(objective(x), x.games))}</td><td>${p1(pct(x.reasons.elimination ?? 0, x.games))}</td><td>${p1(pct(draws(x), x.games))}</td>
      <td>${p1(pct(x.firstMover.wins, decisive(x)))}</td></tr>`,
    )
    .join('');
  const cell = (t: Tally | undefined) =>
    t?.games ? `<td${heat(score(t), t.games, meta.minGames)} title="${t.wins}W ${t.losses}L ${t.draws}D of ${t.games}">${Math.round(100 * score(t))}<span class="muted"> /${t.games}</span></td>` : '<td class="na">–</td>';
  const grid = s.presetNames.map((n) => `<tr><th>${esc(n)}</th>${cs.map((c) => cell(c.s.presets[n])).join('')}</tr>`).join('');
  return `<h2>By Condition</h2>
<section><table><tr><th>Condition</th><th>Games</th><th>Share</th><th>Avg rounds</th><th>Objective wins</th><th>Wipeouts</th><th>Draws</th><th>First mover wins (decisive)</th></tr>${flow}</table>
<h3>Preset score by Condition (%, then games)</h3>
<table><tr><th>Army</th>${cs.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>${grid}</table>
<p class="muted">Each game's Condition is random (Clear about half the time; Hot Drop never with Capture the Flag). Most non-Clear
Conditions have only a handful of games per preset, so treat this grid as a rough guide: pale cells have fewer than ${meta.minGames} games.</p></section>`;
}

/** Capture the Flag: which unit types made the winning captures, overall and per preset. */
function captureSection(s: Summary, config: GameConfig): string {
  const total = Object.values(s.captureUnits).reduce((a, b) => a + b, 0);
  if (!total) return '<h3>Capture the Flag: who made the winning capture</h3><p class="muted">No captures.</p>';
  const name = (id: string) => config.units[id]?.name ?? id;
  const rows = Object.entries(s.captureUnits)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `<tr><th>${esc(name(id))}</th><td>${n}</td><td>${p1(pct(n, total))}</td></tr>`)
    .join('');
  const presetRows = s.presetNames
    .map((p) => {
      const cu = s.presetCaptureUnits[p] ?? {};
      const n = Object.values(cu).reduce((a, b) => a + b, 0);
      const list = Object.entries(cu)
        .sort((a, b) => b[1] - a[1])
        .map(([id, k]) => `${esc(name(id))} ${k}`)
        .join(', ');
      return `<tr><th>${esc(p)}</th><td>${n}</td><td style="text-align:left;white-space:normal">${list || '–'}</td></tr>`;
    })
    .join('');
  return `<h3>Capture the Flag: who made the winning capture</h3>
<table><tr><th>Unit</th><th>Captures</th><th>Share</th></tr>${rows}</table>
<p class="muted">All ${total} winning captures (preset and random-army games), by the carrier's unit type when it scored.</p>
<h3>Winning captures by preset</h3>
<table><tr><th>Army</th><th>Captures</th><th>Carriers</th></tr>${presetRows}</table>`;
}

/** "By mission": flow, presets and random-army units/heroes side by side for each mission. */
function missionSection(s: Summary, config: GameConfig, meta: ReportMeta): string {
  const ms = (Object.keys(s.byMission) as MissionId[]).map((id) => ({ id, name: MISSIONS[id].name, s: s.byMission[id]! }));
  if (!ms.length) return '';
  const head = (first: string) => `<tr><th>${first}</th>${ms.map((m) => `<th>${esc(m.name)}</th>`).join('')}</tr>`;
  const row = (label: string, f: (x: Summary) => string) => `<tr><th>${esc(label)}</th>${ms.map((m) => `<td>${f(m.s)}</td>`).join('')}</tr>`;
  const decisive = (x: Summary) => x.firstMover.wins + x.firstMover.losses;
  const flow = [
    row('Games', (x) => String(x.games)),
    row('Avg length (rounds)', (x) => x.avgRounds.toFixed(1)),
    row('Objective wins (points / flag capture)', (x) => p1(pct((x.reasons.points ?? 0) + (x.reasons.capture ?? 0), x.games))),
    row('Wipeout wins', (x) => p1(pct(x.reasons.elimination ?? 0, x.games))),
    row('Draws', (x) => p1(pct((x.reasons.draw ?? 0) + (x.reasons.roundLimit ?? 0), x.games))),
    row('First mover wins (decisive)', (x) => p1(pct(x.firstMover.wins, decisive(x)))),
    row('Flag pickups / game', (x) => (x.flag.pickups ? (x.flag.pickups / x.games).toFixed(2) : '–')),
    row('Flag drops / game', (x) => (x.flag.pickups ? (x.flag.drops / x.games).toFixed(2) : '–')),
    row('Site claims / game', (x) => (x.siteClaims ? (x.siteClaims / x.games).toFixed(2) : '–')),
  ].join('');
  const cell = (t: Tally | undefined) =>
    t?.games ? `<td${heat(score(t), t.games, meta.minGames)} title="${t.wins}W ${t.losses}L ${t.draws}D of ${t.games}">${p1(100 * score(t))}</td>` : '<td class="na">–</td>';
  const presets = s.presetNames.map((n) => `<tr><th>${esc(n)}</th>${ms.map((m) => cell(m.s.presets[n])).join('')}</tr>`).join('');
  const entries = (hero: boolean) =>
    Object.entries(s.entries)
      .filter(([, t]) => t.hero === hero)
      .sort((x, y) => score(y[1]) - score(x[1]))
      .map(([id]) => `<tr><th>${esc(entryName(config, id))}</th>${ms.map((m) => cell(m.s.entries[id])).join('')}</tr>`)
      .join('');
  // How each preset's wins came, per mission: wins, then the share by wipeout / objective.
  const objectiveName: Partial<Record<MissionId, string>> = { koth: 'points', ctf: 'capture', dom: 'points' };
  const winHead = `<tr><th rowspan="2">Army</th>${ms.map((m) => `<th colspan="3">${esc(m.name)}</th>`).join('')}</tr>` +
    `<tr>${ms.map((m) => `<th>Wins</th><th>Wipeout</th><th>${esc(objectiveName[m.id] ?? 'objective')}</th>`).join('')}</tr>`;
  const winRows = s.presetNames
    .map((n) => `<tr><th>${esc(n)}</th>${ms
      .map((m) => {
        const t = m.s.presetWinTypes[n];
        if (!t?.wins) return '<td>0</td><td class="na">–</td><td class="na">–</td>';
        return `<td>${t.wins}</td><td>${p1(pct(t.elimination, t.wins))}</td><td>${p1(pct(t.objective, t.wins))}</td>`;
      })
      .join('')}</tr>`)
    .join('');
  const ctfS = s.byMission.ctf;
  const captures = ctfS ? captureSection(ctfS, config) : '';
  return `<h2>By mission</h2>
<section><h3>Game flow</h3><table>${head('')}${flow}</table>
<h3>Preset score (%)</h3><table>${head('Army')}${presets}</table>
<h3>How each preset wins</h3><table>${winHead}${winRows}</table>
<p class="muted">Wins in preset games, and the share of them by wipeout or by the mission's objective
(King of the Hill and Domination: points; Capture the Flag: a flag capture). A draw is not a win.</p>
${captures}
<h3>Random armies: hero score (%)</h3><table>${head('Hero')}${entries(true)}</table>
<h3>Random armies: unit score (%)</h3><table>${head('Unit')}${entries(false)}</table>
<p class="muted">Each game's mission is picked at random. Hover a cell for W/L/D. Pale cells have fewer than ${meta.minGames} games.</p></section>`;
}

export function reportHtml(s: Summary, config: GameConfig, meta: ReportMeta): string {
  const flags = findFlags(s, config, meta.minGames);
  const names = s.presetNames;
  const shapeNames = Object.keys(s.shapes).sort();
  const decisive = s.firstMover.wins + s.firstMover.losses;
  const specialOf = (id: string) => config.units[id]?.special;

  const presetRows = names
    .map((n) => {
      const t = s.presets[n];
      return `<tr><th>${esc(n)}</th><td>${t.games}</td><td>${p1(pct(t.wins, t.games))}</td><td>${p1(pct(t.losses, t.games))}</td>
        <td>${p1(pct(t.draws, t.games))}</td><td${heat(score(t), t.games, meta.minGames)}><b>${p1(100 * score(t))}</b></td>
        <td>${t.games ? (t.rounds / t.games).toFixed(1) : '–'}</td></tr>`;
    })
    .join('');

  const grid = `<tr><th>row vs column</th>${names.map((n) => `<th class="rot"><span>${esc(n)}</span></th>`).join('')}</tr>${names
    .map(
      (a) =>
        `<tr><th>${esc(a)}</th>${names
          .map((b) => {
            const t = s.grid[a][b];
            if (a === b || !t) return '<td class="na">–</td>';
            return `<td${heat(score(t), t.games, meta.minGames)} title="${t.wins}W ${t.losses}L ${t.draws}D of ${t.games}">${Math.round(100 * score(t))}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('')}`;

  const entryRows = (hero: boolean) =>
    Object.entries(s.entries)
      .filter(([, t]) => t.hero === hero)
      .sort((x, y) => score(y[1]) - score(x[1]))
      .map(
        ([id, t]) =>
          `<tr><th>${esc(entryName(config, id))}</th><td>${t.games}</td><td>${p1(pct(t.wins, t.games))}</td><td>${p1(pct(t.draws, t.games))}</td>
          <td${heat(score(t), t.games, meta.minGames)}><b>${p1(100 * score(t))}</b></td></tr>`,
      )
      .join('');

  const shapeRows = shapeNames
    .map((n) => {
      const t = s.shapes[n];
      return `<tr><th>${esc(n)}</th><td>${t.games}</td><td>${p1(pct(t.firstWins, t.games - t.draws))}</td><td>${p1(pct(t.draws, t.games))}</td>
        <td>${p1(pct(t.eliminations, t.games))}</td><td>${(t.rounds / t.games).toFixed(1)}</td></tr>`;
    })
    .join('');

  const presetShape = `<tr><th>preset \\ shape</th>${shapeNames.map((n) => `<th>${esc(n)}</th>`).join('')}</tr>${names
    .map(
      (a) =>
        `<tr><th>${esc(a)}</th>${shapeNames
          .map((sh) => {
            const t = s.presetShape[a][sh];
            return t ? `<td${heat(score(t), t.games, meta.minGames)} title="${t.games} games">${Math.round(100 * score(t))}</td>` : '<td class="na">–</td>';
          })
          .join('')}</tr>`,
    )
    .join('')}`;

  const reasonNames: Record<string, string> = {
    points: 'Points (King of the Hill / Domination)',
    capture: 'Flag capture (Capture the Flag)',
    elimination: 'Wipeout',
    draw: 'Draw (simultaneous wipeout)',
    roundLimit: `Draw (${meta.maxRounds}-round limit)`,
  };
  const reasonRows = Object.entries(s.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><th>${esc(reasonNames[k] ?? k)}</th><td>${v}</td><td>${p1(pct(v, s.games))}</td></tr>`)
    .join('');

  const usageRows = Object.entries(s.usage)
    .filter(([id]) => config.units[id])
    .sort((a, b) => config.units[a[0]].name.localeCompare(config.units[b[0]].name))
    .map(([id, u]) => {
      const sp = specialOf(id);
      const spRate = u.turns ? u.specials / u.turns : 0;
      const rare = sp && u.turns >= 100 && spRate < 0.03;
      return `<tr${rare ? ' class="rare"' : ''}><th>${esc(config.units[id].name)}</th><td>${sp ?? '—'}</td><td>${u.turns}</td>
        <td>${p1(100 * (u.turns ? u.attacks / u.turns : 0))}</td><td>${sp ? p1(100 * spRate) : '—'}</td>
        <td>${rare ? 'rarely used by the bot' : ''}</td></tr>`;
    })
    .join('');

  const flagRows = flags.length
    ? flags
        .map((f) => `<li class="${f.score > 0.5 ? 'hi' : 'lo'}"><b>${p1(100 * f.score)}</b> ${esc(f.what)} <span class="muted">(${f.games} games)</span></li>`)
        .join('')
    : '<li>Nothing outside 40–60% with enough games.</li>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HexHunters balance report</title>
<style>
  :root { --bg:#f7f6f2; --card:#fff; --text:#1d2330; --muted:#6b7385; --line:#e3e1da; --hi:#167a3e; --lo:#b42318; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:26px; margin:0 0 4px; } h2 { font-size:18px; margin:28px 0 8px; }
  .muted { color:var(--muted); } .note { background:#fff7e0; border:1px solid #f0d78a; padding:10px 12px; border-radius:8px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-top:12px; overflow-x:auto; }
  table { border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { padding:5px 8px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
  th:first-child { text-align:left; } td.na { color:#bbb; text-align:center; }
  th.rot { height:110px; vertical-align:bottom; } th.rot span { writing-mode:vertical-rl; transform:rotate(180deg); }
  .kpis { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:150px; }
  .kpi b { display:block; font-size:22px; }
  ul.flags { margin:0; padding-left:18px; } li.hi b { color:var(--hi); } li.lo b { color:var(--lo); }
  tr.rare td, tr.rare th { color:var(--lo); }
  td.gap.noise { color:var(--muted); } td.gap.real b { color:var(--text); }
</style></head><body><main>
<h1>HexHunters balance report${meta.variant ? `: ${esc(meta.variant)}` : ''}</h1>
<div class="muted">${s.games} games · seed ${meta.seed} · ${meta.perMatchup} per preset matchup + ${meta.randomGames} random-vs-random ·
${meta.workers} workers · ${meta.seconds.toFixed(1)} s</div>
<p class="note"><b>Read with care:</b> these games are played by a simple heuristic bot (one step of look-ahead,
no planning). Units that need clever play, such as the Twins, Sentinel, Hacker, Spot, Prep or Grappler setups,
may test weaker than they really are, and simple brawlers may test stronger. "Score" counts a draw as half a win.
Flags need at least ${meta.minGames} games.</p>

<div class="kpis">
  <div class="kpi"><span class="muted">Average length</span><b>${s.avgRounds.toFixed(1)} rounds</b></div>
  <div class="kpi"><span class="muted">First mover wins (decisive games)</span><b>${p1(pct(s.firstMover.wins, decisive))}</b></div>
  <div class="kpi"><span class="muted">Draws</span><b>${p1(pct(s.firstMover.draws, s.games))}</b></div>
  <div class="kpi"><span class="muted">Illegal bot moves</span><b>${s.illegal}</b></div>
</div>

<h2>Flags (score above 60% or below 40%)</h2>
<section><ul class="flags">${flagRows}</ul></section>

<h2>Preset armies</h2>
<section><table><tr><th>Army</th><th>Games</th><th>Win</th><th>Loss</th><th>Draw</th><th>Score</th><th>Avg rounds</th></tr>${presetRows}</table></section>

<h2>Matchup grid (row army's score vs column army, %)</h2>
<section><table>${grid}</table><p class="muted">Hover a cell for W/L/D. Each matchup alternates seats game by game.</p></section>

<h2>Random armies: score when the army includes…</h2>
<section><h3>Heroes</h3><table><tr><th>Hero</th><th>Games</th><th>Win</th><th>Draw</th><th>Score</th></tr>${entryRows(true)}</table>
<h3>Units</h3><table><tr><th>Unit</th><th>Games</th><th>Win</th><th>Draw</th><th>Score</th></tr>${entryRows(false)}</table></section>

<h2>Who went first</h2>
<section><p>The army that won the coin flip won <b>${s.firstMover.wins}</b>, lost <b>${s.firstMover.losses}</b> and drew <b>${s.firstMover.draws}</b>
of ${s.games} games: <b>${p1(pct(s.firstMover.wins, decisive))}</b> of decisive games.</p></section>

<h2>By deployment shape</h2>
<section><table><tr><th>Shape</th><th>Games</th><th>First mover wins</th><th>Draws</th><th>Wipeouts</th><th>Avg rounds</th></tr>${shapeRows}</table>
<h3>Preset score by shape (%)</h3><table>${presetShape}</table></section>

${missionSection(s, config, meta)}

${conditionSection(s, meta)}

${seatSection(s, config)}

<h2>How games end</h2>
<section><table><tr><th>Win type</th><th>Games</th><th>Share</th></tr>${reasonRows}</table></section>

<h2>Ability use (per model-turn)</h2>
<section><table><tr><th>Unit</th><th>Special</th><th>Model-turns</th><th>Basic attack</th><th>Special</th><th></th></tr>${usageRows}</table>
<p class="muted">How often, per turn a model was on the board, the bot used its basic attack and its special. Red rows: the special
was used on fewer than 3% of turns (with 100+ turns), so either it's weak or the bot doesn't know how to use it.</p></section>
</main></body></html>`;
}
