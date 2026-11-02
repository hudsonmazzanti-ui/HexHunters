/** Worker thread: plays the games it's given and posts the records back. */
import { parentPort } from 'node:worker_threads';
import { type GameJob, runGame } from './runGame';

parentPort!.on('message', (jobs: GameJob[]) => {
  const records = [];
  for (const job of jobs) {
    records.push(runGame(job));
    if (records.length % 25 === 0) parentPort!.postMessage({ type: 'progress', done: 25 });
  }
  if (records.length % 25) parentPort!.postMessage({ type: 'progress', done: records.length % 25 });
  parentPort!.postMessage({ type: 'done', records });
});
