/**
 * The computer opponent for the app. It reuses the simulator's heuristic bot (sim/bot.ts):
 * each step it scores every move, attack and special available and plays the best one.
 * This module only decides; the controller dispatches the actions through the same
 * applyAction as a human player, so the AI can never do anything the rules don't allow.
 */
import { validateArmy } from '../core/army';
import type { Action } from '../core/game';
import type { Rng } from '../core/rng';
import type { GameConfig, GameState, PlayerId } from '../core/types';
import { PRESETS, randomArmy } from '../../sim/armies';
import { planPlacement, planStep } from '../../sim/bot';

/** Presets too weak to be a fun opponent. */
const SKIP_PRESETS = new Set(['Skeleton Wall']);

/**
 * An army for the AI: half the time one of the tested preset armies, otherwise a random
 * legal army (built around its hero's synergy) that spends nearly all its points.
 */
export function aiArmy(config: GameConfig, rng: Rng): { name: string; units: string[] } {
  if (rng.next() < 0.5) {
    const options = PRESETS.filter((p) => !SKIP_PRESETS.has(p.name) && validateArmy(config, p.units) === null);
    if (options.length) return rng.pick(options);
  }
  let best = randomArmy(config, rng);
  const cost = (units: string[]) => units.reduce((n, u) => n + (config.units[u]?.cost ?? config.squads[u]?.cost ?? 0), 0);
  for (let i = 0; i < 12 && cost(best.units) < config.armyPointLimit - 2; i++) {
    const next = randomArmy(config, rng);
    if (cost(next.units) > cost(best.units)) best = next;
  }
  return best;
}

/**
 * What the AI does next when it is `player`'s move: one placement during deployment, or
 * during play the next step of its turn (a move and/or an action) or ending the turn.
 * Returns [] when it isn't the AI's move.
 */
export function aiActions(state: GameState, player: PlayerId, rng: Rng): Action[] {
  if (state.current !== player) return [];
  if (state.phase === 'deploy') return [planPlacement(state, rng)];
  if (state.phase === 'play') return planStep(state, rng) ?? [{ type: 'endTurn' }];
  return [];
}
