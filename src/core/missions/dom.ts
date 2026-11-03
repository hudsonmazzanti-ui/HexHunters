/**
 * Domination. Three 7-hex sites: the center one and two mirrored flank sites (see
 * mapgen.dominationSites). No control point, no flag.
 *
 *  - Claim: a model inside a site spends its action to claim it (the 'claim' action; no
 *    roll, movement ends), unless an enemy model is inside that site. The site stays yours
 *    until the enemy claims it.
 *  - Scoring: at the end of each round, 1 point per site you own. First to 8 wins (if both
 *    get there in the same round, the higher score wins; an exact tie plays on), or
 *    eliminate the enemy.
 *  - Standard Bearer: your models inside any site get +2 on their rolls, and a round in
 *    which you score site points scores 1 extra.
 */
import { holdPoints } from '../auras';
import { siteIndexAt } from '../queries';
import type { PlayerId } from '../types';
import type { MissionDef } from './types';

export const dom: MissionDef = {
  name: 'Domination',
  icon: 'sites',
  brief: (c) => `Claim the 3 sites: 1 point each per round. First to ${c.dominationPointsToWin}.`,
  summary: (c) =>
    `Claim the three sites and hold them: 1 point per site you own at the end of each round. First to ${c.dominationPointsToWin} wins.`,
  rules: (c) => [
    'Three sites: one in the center and two on the flanks, each a hex and its six neighbors. No control point or flag.',
    'A model inside a site spends its action to claim it, but not while an enemy model is inside that site.',
    'A site stays yours until the enemy claims it.',
    'At the end of each round you score 1 point for each site you own.',
    `Standard Bearer: your models inside a site get +${c.specials.standardRollBonus} on their rolls, and a round in which you score site points scores 1 extra.`,
    `First to ${c.dominationPointsToWin} points wins (both in the same round: the higher score), or wipe out the enemy.`,
  ],
  usesControlPoint: false,
  usesPoints: true,
  pointsToWin: (c) => c.dominationPointsToWin,
  sites: true,
  setup: (state) => {
    state.siteOwners = (state.map.sites ?? []).map(() => null);
  },
  empowered: (state, unit) => !!unit.pos && siteIndexAt(state, unit.pos) >= 0,
  endOfRound: (state, events) => {
    const owned: [number, number] = [0, 0];
    for (const owner of state.siteOwners) if (owner !== null) owned[owner]++;
    // Standard Bearer: a scoring round is worth 1 more (holdPoints is 2 instead of 1).
    const points = ([0, 1] as PlayerId[]).map((p) => (owned[p] ? owned[p] + holdPoints(state, p) - 1 : 0)) as [number, number];
    state.scores[0] += points[0];
    state.scores[1] += points[1];
    events.push({ type: 'sitesScored', round: state.round, owned, points, scores: [...state.scores] });
  },
};
