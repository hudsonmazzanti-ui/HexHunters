/**
 * King of the Hill: at the end of each round, the player with more models on the
 * control point (the center hex and its six neighbors) scores 1 (Standard Bearer: 2).
 */
import { hexEquals } from '../hex';
import { holdPoints } from '../auras';
import type { PlayerId } from '../types';
import { unitsOnControlPoint } from '../queries';
import type { MissionDef } from './types';

export const koth: MissionDef = {
  name: 'King of the Hill',
  summary: (c) => `Have more models on the control point at the end of each round: 1 point. First to ${c.pointsToWin} wins.`,
  rules: (c) => [
    'The control point is the center hex and the six around it.',
    'At the end of each round, whoever has more models on it scores 1 point (a tie scores nothing).',
    `Standard Bearer: your models on the point get +${c.specials.standardRollBonus} on their rolls, and winning the point scores ${c.specials.standardHoldPoints}.`,
    `First to ${c.pointsToWin} points wins, or wipe out the enemy.`,
  ],
  usesControlPoint: true,
  usesPoints: true,
  empowered: (state, unit) => !!unit.pos && state.map.controlPoint.some((h) => hexEquals(h, unit.pos!)),
  endOfRound: (state, events) => {
    const counts: [number, number] = [unitsOnControlPoint(state, 0).length, unitsOnControlPoint(state, 1).length];
    const scorer: PlayerId | null = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : null;
    const points = scorer === null ? 0 : holdPoints(state, scorer);
    if (scorer !== null) state.scores[scorer] += points;
    events.push({ type: 'roundScored', round: state.round, counts, scorer, points });
  },
};
