/**
 * Sentinel overwatch.
 *
 * Activating it locks in that turn's die and fixes the watched area: every hex within
 * the Sentinel's range where even a small model would be visible to it. At the END of
 * the opponent's next turn, if any enemy is standing in the area, the Sentinel fires
 * once at one of them (die + modifiers vs defense, normal damage). Overwatch then ends,
 * whether or not it fired. It also ends if the Sentinel dies, moves or uses its die.
 * Enemies that passed through the area but left it are not shot.
 */
import { dealDamage } from './combat';
import { type Hex, hexDistance, hexEquals, hexagon } from './hex';
import { attackDamage, canSeeHex, effectiveDefense, livingUnits, other, terrainHeight, unitDef } from './queries';
import type { GameState, PlayerId, Unit } from './types';

/** Hexes a unit would watch from where it stands now. */
export function watchArea(state: GameState, unit: Unit): Hex[] {
  const range = unitDef(state, unit).range;
  return hexagon(state.map.radius).filter((h) => {
    const d = hexDistance(h, unit.pos!);
    return d >= 1 && d <= range && terrainHeight(state, h) === 0 && canSeeHex(state, unit, h, 1);
  });
}

/**
 * Which enemy in the watched area to shoot. Change this to change the rule.
 * Current rule: lowest defense, then lowest health, then board order.
 */
export function chooseOverwatchTarget(state: GameState, candidates: Unit[]): Unit | undefined {
  return [...candidates].sort(
    (a, b) => effectiveDefense(state, a) - effectiveDefense(state, b) || a.hp - b.hp,
  )[0];
}

export interface OverwatchShot {
  unitId: string;
  targetId: string;
  roll: number;
  bonus: number;
  defense: number;
  hit: boolean;
  damage: number;
  killed: boolean;
}

/**
 * Called when `endedPlayer`'s turn ends: the opponent's Sentinels on overwatch fire,
 * then their overwatch ends. Mutates state.
 */
export function resolveOverwatch(state: GameState, endedPlayer: PlayerId): OverwatchShot[] {
  const shots: OverwatchShot[] = [];
  for (const sentinel of livingUnits(state, other(endedPlayer))) {
    const watch = sentinel.overwatch;
    if (!watch) continue;
    sentinel.overwatch = null;
    const inArea = livingUnits(state, endedPlayer).filter((u) => watch.hexes.some((h) => hexEquals(h, u.pos!)));
    const target = chooseOverwatchTarget(state, inArea);
    if (!target) continue;

    const spotBonus = target.spottedBy === sentinel.owner ? state.config.specials.spotAttackBonus : 0;
    if (spotBonus) target.spottedBy = null;
    const bonus = spotBonus + (unitDef(state, sentinel).hitBonus ?? 0);
    const defense = effectiveDefense(state, target);
    const hit = watch.die + bonus >= defense;
    const damage = hit ? attackDamage(state, sentinel) : 0;
    const killed = hit && dealDamage(state, target, damage);
    shots.push({ unitId: sentinel.id, targetId: target.id, roll: watch.die, bonus, defense, hit, damage, killed });
  }
  return shots;
}
