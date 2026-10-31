/**
 * Raise Dead (Necromancer's aura). Deaths are collected by dealDamage during an action
 * and processed once the action is over, so boulders, splash damage and so on have
 * settled first. When an enemy model died within range of one of your living raise
 * sources (your Zombies, or the Necromancer while alive), a free Skeleton rises in that
 * hex, or the nearest empty open hex. It can't act until your next turn.
 */
import { auraEffects } from './auras';
import { type Hex, hexDistance, hexagon } from './hex';
import { livingUnits, maxHealth, onBoard, other, terrainHeight, unitAt } from './queries';
import type { GameState, PlayerId, Unit } from './types';

/** The empty, open hex closest to `from` (from itself first), or null if the board is full. */
export function nearestEmptyHex(state: GameState, from: Hex): Hex | null {
  const free = (h: Hex) => onBoard(state, h) && terrainHeight(state, h) === 0 && !unitAt(state, h);
  if (free(from)) return from;
  const candidates = hexagon(state.map.radius)
    .filter(free)
    .sort((a, b) => hexDistance(a, from) - hexDistance(b, from));
  return candidates[0] ?? null;
}

/** Creates a risen Skeleton for `owner` at `pos`. */
function raiseSkeleton(state: GameState, owner: PlayerId, pos: Hex): Unit {
  const unit: Unit = {
    id: `p${owner}-skeleton-risen${state.spawned++}`,
    type: 'skeleton',
    owner,
    pos,
    hp: 0,
    die: null,
    dieBonus: 0,
    movesLeft: 0,
    acted: true, // can't act until its owner's next turn
    specialUsed: false,
    turnStartPos: pos,
    braced: false,
    prepped: false,
    spottedBy: null,
    loaded: false,
    overwatch: null,
    crawling: false,
    resting: false,
    burning: false,
    partnerId: null,
    gambling: false,
  };
  state.units.push(unit);
  unit.hp = maxHealth(state, unit);
  return unit;
}

/** Processes the deaths of the last action. Returns the risen Skeletons. */
export function raiseDead(state: GameState): Unit[] {
  const risen: Unit[] = [];
  const deaths = state.deaths;
  state.deaths = [];
  if (state.phase !== 'play') return risen;
  for (const death of deaths) {
    const raiser = other(death.owner);
    if (!state.auras[raiser].includes('necro')) continue;
    const near = livingUnits(state, raiser).some(
      (u) => auraEffects(state, u).raisesDead && hexDistance(u.pos!, death.pos) <= state.config.specials.necroRaiseRange,
    );
    if (!near) continue;
    const at = nearestEmptyHex(state, death.pos);
    if (at) risen.push(raiseSkeleton(state, raiser, at));
  }
  return risen;
}
