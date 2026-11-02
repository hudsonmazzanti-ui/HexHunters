/**
 * Balance simulator CLI. Plays bot-vs-bot games with the real rules and writes a report.
 *
 *   npm run sim -- --games 2000
 *   npm run sim -- --per-matchup 40 --random 1000 --seed 7 --workers 4 --out sim-results
 *   npm run sim -- --replay <seed> --a "Big Guys" --b "Gun Line" [--seat 2]
 *
 * Options:
 *   --games N        total games: about half preset round robin, half random-vs-random (default 2000)
 *   --per-matchup N  games per preset pairing (overrides the split)
 *   --random N       random-vs-random games (overrides the split)
 *   --seed N         base seed (default: random, printed); every game's own seed is in games.csv
 *   --workers N      worker threads (default: CPU count)
 *   --out DIR        output directory (default sim-results)
 *   --min-games N    smallest sample that gets flagged (default 25)
 *   --replay SEED    play one game and print every action; --a/--b take preset names or
 *                    space-separated unit ids; --seat 1|2 is army A's seat (default 1)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { validateConfig } from '../src/core/army';
import type { PlayerId } from '../src/core/types';
import { DEFAULT_CONFIG } from '../src/data/config';
import { type ArmySpec, PRESETS, checkPresets } from './armies';
import { findFlags, gamesCsv, reportHtml, summarize, unitsCsv } from './report';
import { type GameJob, type GameRecord, runGame } from './runGame';
import { buildJobs, splitGames } from './schedule';

const config = DEFAULT_CONFIG;
const MAX_ROUNDS = 30;

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i++, next) : 'true';
  }
  return out;
}

const int = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Math.max(0, Math.floor(Number(v))));

function armyArg(v: string | undefined, fallback: ArmySpec): ArmySpec {
  if (!v) return fallback;
  const preset = PRESETS.find((p) => p.name.toLowerCase() === v.toLowerCase());
  return preset ?? { name: 'Custom', units: v.split(/[\s,+]+/).filter(Boolean) };
}

async function runParallel(jobs: GameJob[], workers: number): Promise<GameRecord[]> {
  const chunks: GameJob[][] = Array.from({ length: workers }, () => []);
  jobs.forEach((j, i) => chunks[i % workers].push(j)); // interleaved, so every worker gets a fair mix
  let done = 0;
  const started = Date.now();
  let lastTenth = -1;
  const progress = () => {
    const pctDone = Math.floor((100 * done) / jobs.length);
    const line = `  ${done}/${jobs.length} games (${pctDone}%) · ${((Date.now() - started) / 1000).toFixed(0)} s`;
    if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
    else if (Math.floor(pctDone / 10) > lastTenth) {
      lastTenth = Math.floor(pctDone / 10);
      console.log(line); // logs and CI: one line per 10%
    }
  };
  const workerUrl = new URL('./worker.js', import.meta.url);
  const parts = await Promise.all(
    chunks
      .filter((c) => c.length)
      .map(
        (chunk) =>
          new Promise<GameRecord[]>((resolveChunk, reject) => {
            const w = new Worker(workerUrl);
            w.on('message', (m: { type: 'progress'; done: number } | { type: 'done'; records: GameRecord[] }) => {
              if (m.type === 'progress') {
                done += m.done;
                progress();
              } else {
                resolveChunk(m.records);
                void w.terminate();
              }
            });
            w.on('error', reject);
            w.postMessage(chunk);
          }),
      ),
  );
  if (process.stdout.isTTY) process.stdout.write('\n');
  return parts.flat().sort((a, b) => a.index - b.index);
}

async function main(): Promise<void> {
  const a = args();
  const problems = [...validateConfig(config), ...checkPresets(config)];
  if (problems.length) {
    console.error(`Fix these first:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  if (a.replay) {
    const seed = int(a.replay, 1);
    const job: GameJob = {
      index: 0,
      seed,
      kind: 'preset',
      a: armyArg(a.a, PRESETS[0]),
      b: armyArg(a.b, PRESETS[1]),
      seatOfA: (a.seat === '2' ? 1 : 0) as PlayerId,
    };
    const r = runGame(job, { keepLog: true });
    console.log(`Seed ${seed}: ${job.a.name} [${job.a.units.join(' ')}] (P${job.seatOfA + 1}) vs ${job.b.name} [${job.b.units.join(' ')}]`);
    console.log(`Shape ${r.shape} · first mover ${r.firstMover}`);
    r.log!.forEach((act, i) => console.log(`${String(i + 1).padStart(4)}. ${JSON.stringify(act)}`));
    console.log(`Result: ${r.winner === 'draw' ? 'draw' : `${r.winner === 'A' ? job.a.name : job.b.name} wins`} (${r.reason}) after ${r.rounds} rounds, ${r.scoreA}-${r.scoreB}`);
    return;
  }

  const seed = a.seed !== undefined ? int(a.seed, 1) : 1 + Math.floor(Math.random() * 2 ** 30);
  const split = splitGames(int(a.games, 2000), PRESETS.length);
  const perMatchup = a['per-matchup'] !== undefined ? int(a['per-matchup'], split.perMatchup) : split.perMatchup;
  const randomGames = a.random !== undefined ? int(a.random, split.randomGames) : split.randomGames;
  const workers = Math.max(1, int(a.workers, availableParallelism()));
  const minGames = int(a['min-games'], 25);
  const out = resolve(a.out ?? 'sim-results');

  const jobs = buildJobs(config, { seed, perMatchup, randomGames });
  console.log(`HexHunters balance sim · seed ${seed} · ${jobs.length} games (${perMatchup} per preset matchup, ${randomGames} random) · ${workers} workers`);
  const t0 = Date.now();
  const records = await runParallel(jobs, workers);
  const seconds = (Date.now() - t0) / 1000;

  const summary = summarize(records, config, PRESETS.map((p) => p.name));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'games.csv'), gamesCsv(records));
  writeFileSync(join(out, 'units.csv'), unitsCsv(summary, config));
  writeFileSync(
    join(out, 'report.html'),
    reportHtml(summary, config, { seed, perMatchup, randomGames, workers, seconds, minGames, maxRounds: MAX_ROUNDS }),
  );

  console.log(`Done in ${seconds.toFixed(1)} s · avg ${summary.avgRounds.toFixed(1)} rounds · illegal bot moves: ${summary.illegal}`);
  const flags = findFlags(summary, config, minGames);
  console.log(flags.length ? `Flags (${flags.length}):` : 'No flags.');
  for (const f of flags.slice(0, 15)) console.log(`  ${(100 * f.score).toFixed(1).padStart(5)}%  ${f.what} (${f.games} games)`);
  console.log(`Wrote ${join(out, 'report.html')}, games.csv, units.csv`);
}

void main();
