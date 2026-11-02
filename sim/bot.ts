/**
 * A simple heuristic bot. No search beyond the current step and no learning:
 *
 *  - Deployment: tanky / melee models take the zone hexes nearest the control point,
 *    ranged and support models the ones farthest back.
 *  - Each step of its turn it looks at every model that can still do something, every
 *    hex that model can reach (including staying put) and, at that hex, every action
 *    it has: its basic attack on each enemy, each valid choice of its special, or
 *    nothing. Each option gets a score (see weights.ts); the best one is played, and
 *    the step repeats until nothing scores above `minGain`, then it ends the turn.
 *
 * It knows its own die (rolled at the start of the turn), so attack outcomes are
 * exact. A Gambler's unrolled "?" die is evaluated as the average roll.
 *
 * The bot only produces Actions; the real rules (applyAction) decide what happens.
 */
import type { Action } from '../src/core/game';
import { freePartnerHexes, isInDeployZone, unplacedUnits } from '../src/core/game';
import { type Hex, ORIGIN, hexDistance, hexEquals, hexKey, neighbors, parseHexKey } from '../src/core/hex';
import { previewAttack } from '../src/core/combat';
import {
  actionDie,
  attackDamage,
  burnsOn,
  canAct,
  canSeeHex,
  effectiveDefense,
  getUnit,
  livingUnits,
  maxHealth,
  moveReach,
  onBoard,
  other,
  terrainHeight,
  unitAt,
  unitDef,
  unitSize,
  unitSpeed,
} from '../src/core/queries';
import type { Rng } from '../src/core/rng';
import {
  type SpecialChoice,
  type SpecialPreview,
  dashAmount,
  eatHeal,
  healAmount,
  partnerOf,
  previewSpecial,
  specialBlockedReason,
  specialIdOf,
  specialOf,
} from '../src/core/specials';
import type { GameState, PlayerId, Unit } from '../src/core/types';
import { WEIGHTS, type Weights } from './weights';

// ---------------------------------------------------------------------------
// Unit value and threat helpers
// ---------------------------------------------------------------------------

/** How much a model is worth: its point cost (with a floor for squad members / forms). */
export function unitValue(state: GameState, unit: Unit, w: Weights = WEIGHTS): number {
  const def = unitDef(state, unit);
  return Math.max(w.minUnitValue, def.cost);
}

/** Chance that `attacker` hits `target` with a fresh d12 next turn. */
function hitChance(state: GameState, attacker: Unit, target: Unit): number {
  const def = unitDef(state, attacker);
  if (def.noDie) return 1;
  const need = effectiveDefense(state, target) - (def.hitBonus ?? 0);
  return Math.min(1, Math.max(0, (state.config.dieSides - need + 1) / state.config.dieSides));
}

const onPoint = (state: GameState, h: Hex) => state.map.controlPoint.some((c) => hexEquals(c, h));

/** Value of dealing `damage` to `target` (negative for own models). */
function damageValue(state: GameState, actor: Unit, target: Unit, damage: number, w: Weights): number {
  if (damage <= 0) return 0;
  const value = unitValue(state, target, w);
  const dealt = Math.min(damage, target.hp);
  let v = (w.damage * dealt * value) / maxHealth(state, target);
  if (damage >= target.hp) v += w.kill * value;
  return target.owner === actor.owner ? -w.friendlyFire * v : v;
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/** Expected damage enemies could deal to `unit` standing on `h` next turn (raw HP). */
function incomingDamage(state: GameState, unit: Unit, h: Hex, w: Weights): number {
  let total = 0;
  const size = unitSize(state, unit);
  for (const e of livingUnits(state, other(unit.owner))) {
    const def = unitDef(state, e);
    const d = hexDistance(e.pos!, h);
    const reach = unitSpeed(state, e) + def.range;
    if (d > reach) continue;
    let factor = 1;
    if (d <= def.range) {
      if (!def.indirectFire && !canSeeHex(state, e, h, size)) factor = w.dangerUnseen;
    } else {
      factor = 0.7; // it would have to move first
    }
    total += attackDamage(state, e) * hitChance(state, e, unit) * factor;
  }
  return Math.min(total, unit.hp);
}

/** How good it is for `unit` to end up on `h` (higher is better). */
function positionScore(state: GameState, unit: Unit, h: Hex, w: Weights): number {
  let s = 0;
  const def = unitDef(state, unit);
  const enemies = livingUnits(state, other(unit.owner));
  if (onPoint(state, h)) {
    s += w.onPoint;
    if (enemies.some((e) => onPoint(state, e.pos!))) s += w.contestPoint;
    if (state.turnInRound === 1) s += w.pointLateBonus;
  }
  // Head for an enemy within its range, or the control point, whichever is closer.
  const dEnemy = enemies.length ? Math.min(...enemies.map((e) => hexDistance(e.pos!, h))) : 99;
  const toEnemy = Math.max(0, dEnemy - def.range);
  const toPoint = Math.max(0, hexDistance(h, ORIGIN) - 1);
  s -= w.approach * Math.min(toEnemy, toPoint);
  // Stay out of reach of enemies that could hurt it next turn.
  const value = unitValue(state, unit, w);
  s -= (w.danger * incomingDamage(state, unit, h, w) * value) / maxHealth(state, unit);
  return s;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Plausible choices for the unit's special (validated by the real rules afterwards). */
function specialCandidates(state: GameState, unit: Unit): SpecialChoice[] {
  const sp = specialOf(state, unit);
  if (!sp) return [];
  const pos = unit.pos!;
  const enemies = livingUnits(state, other(unit.owner));
  switch (sp.targeting) {
    case 'none':
      return [{}];
    case 'enemy':
      return enemies.map((u) => ({ targetId: u.id }));
    case 'ally':
      return livingUnits(state, unit.owner)
        .filter((u) => u.id !== unit.id)
        .map((u) => ({ targetId: u.id }));
    case 'model':
      return state.units.filter((u) => u.pos && u.id !== unit.id).map((u) => ({ targetId: u.id }));
    case 'direction':
      return [0, 1, 2, 3, 4, 5].map((dir) => ({ dir }));
    case 'hex': {
      // Adjacent hexes, hexes 2 away (Vault landings), and enemies plus their neighbors (Grenade).
      const seen = new Map<string, Hex>();
      const add = (h: Hex) => onBoard(state, h) && seen.set(hexKey(h), h);
      for (const n of neighbors(pos)) {
        add(n);
        for (const m of neighbors(n)) add(m);
      }
      for (const e of enemies) {
        add(e.pos!);
        for (const n of neighbors(e.pos!)) add(n);
      }
      return [...seen.values()].map((hex) => ({ hex }));
    }
    case 'hexAndEnemy':
      return neighbors(pos)
        .filter((h) => terrainHeight(state, h) > 0)
        .flatMap((hex) => enemies.map((u) => ({ hex, targetId: u.id })));
  }
}

/** Generic value of a special's predicted effects (damage, kills, friendly fire, burn). */
function effectsValue(state: GameState, unit: Unit, preview: SpecialPreview | null, w: Weights): number {
  let v = 0;
  for (const e of preview?.effects ?? []) {
    if (e.hit === false) continue;
    const t = getUnit(state, e.unitId);
    if (!t) continue;
    v += damageValue(state, unit, t, e.damage, w);
    if (e.burned) v += t.owner === unit.owner ? -w.burn : w.burn;
  }
  return v;
}

function enemyInRange(state: GameState, unit: Unit, h: Hex): boolean {
  const range = unitDef(state, unit).range;
  return livingUnits(state, other(unit.owner)).some((e) => hexDistance(e.pos!, h) <= range);
}

/** Score of using the special with `choice` from where the unit now stands. */
function specialScore(state: GameState, unit: Unit, choice: SpecialChoice, w: Weights): number {
  const id = specialIdOf(state, unit)!;
  const preview = previewSpecial(state, unit, choice);
  let v = effectsValue(state, unit, preview, w);
  const target = choice.targetId ? getUnit(state, choice.targetId) : undefined;
  const pos = unit.pos!;
  const die = actionDie(state, unit);
  switch (id) {
    case 'heal': {
      const t = target!;
      const amount = Math.min(healAmount(state, die), maxHealth(state, t) - t.hp);
      v += (w.heal * amount * unitValue(state, t, w)) / maxHealth(state, t);
      break;
    }
    case 'eat':
      if (preview?.effects[0]?.hit) v += (w.heal * eatHeal(state, unit, target!) * unitValue(state, unit, w)) / maxHealth(state, unit);
      break;
    case 'brace':
      v += (w.brace * incomingDamage(state, unit, pos, w) * unitValue(state, unit, w)) / maxHealth(state, unit);
      break;
    case 'prep':
      v += w.prep;
      break;
    case 'spot': {
      const t = target!;
      const helper = livingUnits(state, unit.owner).some(
        (a) => a.id !== unit.id && canAct(state, a) && hexDistance(a.pos!, t.pos!) <= unitDef(state, a).range + a.movesLeft,
      );
      if (helper) v += w.spot * unitValue(state, t, w);
      break;
    }
    case 'dash':
      if (!enemyInRange(state, unit, pos)) v += w.dash * dashAmount(state, die);
      break;
    case 'vault': {
      const before = Math.min(...livingUnits(state, other(unit.owner)).map((e) => hexDistance(e.pos!, pos)));
      const after = Math.min(...livingUnits(state, other(unit.owner)).map((e) => hexDistance(e.pos!, choice.hex!)));
      if (after < before) v += w.vault;
      break;
    }
    case 'load':
      if (!unit.loaded) v += w.load;
      break;
    case 'overwatch': {
      // Only worth it when there's nothing to shoot right now.
      const canShoot = livingUnits(state, other(unit.owner)).some((e) => {
        const p = previewAttack(state, unit, e);
        return !p.blockedReason && p.hit;
      });
      if (canShoot) {
        v += 0.1;
        break;
      }
      const range = unitDef(state, unit).range;
      const coming = livingUnits(state, other(unit.owner)).filter(
        (e) => hexDistance(e.pos!, pos) <= unitSpeed(state, e) + range,
      ).length;
      v += w.overwatch + w.overwatchPerEnemy * coming;
      break;
    }
    case 'hack':
      v += w.hack * unitValue(state, target!, w);
      break;
    case 'smash':
      v += livingUnits(state, other(unit.owner)).some((e) => hexDistance(e.pos!, pos) <= 4) ? w.smash : -0.1;
      break;
    case 'pounce': {
      const reach = unit.movesLeft + state.config.specials.pounceMoves + 1;
      const enemies = livingUnits(state, other(unit.owner));
      const adjacent = enemies.some((e) => hexDistance(e.pos!, pos) <= 1);
      if (!adjacent && enemies.some((e) => hexDistance(e.pos!, pos) <= reach)) v += w.pounce;
      break;
    }
    case 'swap': {
      const p = partnerOf(state, unit);
      if (p) {
        const here = pos;
        const there = p.pos!;
        const gain =
          positionScore(state, unit, there, w) - positionScore(state, unit, here, w) +
          positionScore(state, p, here, w) - positionScore(state, p, there, w);
        v += w.swap * gain;
      }
      break;
    }
    case 'hook':
      if (target && target.owner !== unit.owner) v += w.hookPull * (preview?.area.length ?? 0);
      break;
    case 'premiumShot':
      v -= w.premiumShotCost;
      break;
    default:
      break;
  }
  return v;
}

/** Score of a basic attack on `target` from where the unit stands (null if not allowed). */
function attackScore(state: GameState, unit: Unit, target: Unit, w: Weights): number | null {
  const p = previewAttack(state, unit, target);
  if (p.blockedReason) return null;
  if (!p.hit) return -0.05; // a wasted die
  let v = damageValue(state, unit, target, p.damage, w);
  if (burnsOn(state, unit, 'attack') && p.damage < target.hp) v += w.burn;
  return v;
}

// ---------------------------------------------------------------------------
// Turn planning
// ---------------------------------------------------------------------------

interface Option {
  score: number;
  actions: Action[];
}

/** The Gambler's "?" die is judged as the average roll (d12 + bonus + Prep/Marshal, capped). */
function expectedDie(state: GameState, unit: Unit): number {
  const r = state.config.specials;
  return Math.min(r.gamblerMaxDie, Math.round((state.config.dieSides + 1) / 2) + r.gamblerRollBonus + unit.dieBonus);
}

/**
 * The bot's next step: a move and/or an action for one model, or null to end the turn.
 * Pure apart from the rng draws (jitter).
 */
export function planStep(state: GameState, rng: Rng, w: Weights = WEIGHTS): Action[] | null {
  if (state.phase !== 'play') return null;
  const work = structuredClone(state); // scratch copy: models are moved around while scoring
  let best: Option | null = null;
  const consider = (score: number, actions: Action[]) => {
    const s = score + (rng.next() - 0.5) * w.jitter;
    if (score >= w.minGain && (!best || s > best.score)) best = { score: s, actions };
  };

  for (const unit of livingUnits(work, work.current)) {
    if (!canAct(work, unit) && unit.movesLeft <= 0) continue;
    const origin = unit.pos!;
    const hexes = [origin];
    if (unit.movesLeft > 0) for (const k of moveReach(work, unit).costs.keys()) hexes.push(parseHexKey(k));

    // Judge a Gambler's unrolled die as the average roll.
    const gambling = unit.gambling;
    if (gambling) {
      unit.gambling = false;
      unit.die = expectedDie(work, unit);
    }
    const base = positionScore(work, unit, origin, w);
    for (const h of hexes) {
      unit.pos = h;
      const moved = !hexEquals(h, origin);
      const move: Action[] = moved ? [{ type: 'move', unitId: unit.id, to: h }] : [];
      const gain = moved ? positionScore(work, unit, h, w) - base : 0;
      if (moved) consider(gain, move);
      if (!canAct(work, unit)) continue;
      for (const enemy of livingUnits(work, other(unit.owner))) {
        const s = attackScore(work, unit, enemy, w);
        if (s !== null) consider(gain + s, [...move, { type: 'attack', unitId: unit.id, targetId: enemy.id }]);
      }
      if (specialOf(work, unit) && !specialBlockedReason(work, unit)) {
        for (const choice of specialCandidates(work, unit)) {
          if (specialBlockedReason(work, unit, choice)) continue;
          consider(gain + specialScore(work, unit, choice, w), [...move, { type: 'special', unitId: unit.id, ...choice }]);
        }
      }
    }
    unit.pos = origin;
    if (gambling) {
      unit.gambling = true;
      unit.die = null;
    }
  }
  return best ? (best as Option).actions : null;
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Front-liners: melee, short range or tough models. */
function isFrontLiner(state: GameState, unit: Unit): boolean {
  const def = unitDef(state, unit);
  return def.range <= 2 || def.health >= 10 || def.size === 3;
}

/** The bot's next placement during deployment. */
export function planPlacement(state: GameState, rng: Rng): Action {
  const me: PlayerId = state.current;
  const todo = unplacedUnits(state, me);
  // Front-liners first, so they get the forward hexes.
  const unit = todo.find((u) => isFrontLiner(state, u)) ?? todo[0];
  const front = isFrontLiner(state, unit);
  const free = state.map.deployZones[me].filter((h) => !unitAt(state, h));
  const needsPartner = !!unit.partnerId && !getUnit(state, unit.partnerId)?.pos;
  const options = needsPartner ? free.filter((h) => freePartnerHexes(state, h).length) : free;
  // Forward = close to the control point. A little noise spreads models out.
  const rank = (h: Hex) => (front ? 1 : -1) * hexDistance(h, ORIGIN) + rng.next() * 1.5;
  const hex = [...options].sort((a, b) => rank(a) - rank(b))[0];
  if (!needsPartner) return { type: 'place', unitId: unit.id, hex };
  const partnerHex = [...freePartnerHexes(state, hex)]
    .filter((h) => isInDeployZone(state, me, h))
    .sort((a, b) => rank(a) - rank(b))[0];
  return { type: 'place', unitId: unit.id, hex, partnerHex };
}
