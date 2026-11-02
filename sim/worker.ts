/** Worker thread: plays the games it's given (under a balance variant) and posts the records back. */
import { parentPort } from 'node:worker_threads';
import { type GameJob, runGame } from './runGame';
import { variantConfig } from './variants';

parentPort!.on('message', ({ jobs, variant }: { jobs: GameJob[]; variant: string }) => {
  const config = variantConfig(variant);
  const records = [];
  for (const job of jobs) {
    records.push(runGame(job, { config }));
    if (records.length % 25 === 0) parentPort!.postMessage({ type: 'progress', done: 25 });
  }
  if (records.length % 25) parentPort!.postMessage({ type: 'progress', done: records.length % 25 });
  parentPort!.postMessage({ type: 'done', records });
});
