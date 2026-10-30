/**
 * Registry of special actions. Each special lives in its own module; to add one,
 * write the module, add its id to SpecialId (types.ts) and list it here.
 *
 * Every special uses the model's die for the turn (like an attack). A special that
 * would do nothing (Heal on a full-health ally, Dash for 0, Torch at empty hexes...)
 * is not allowed, so a die is never wasted by accident.
 */
import { DIRECTIONS, hexagon } from '../hex';
import { canAct, getUnit } from '../queries';
import type { GameState, SpecialId, Unit } from '../types';
import { brace } from './brace';
import { dash } from './dash';
import { grenade } from './grenade';
import { heal } from './heal';
import { hook } from './hook';
import { load } from './load';
import { overwatch } from './overwatch';
import { prep } from './prep';
import { shove } from './shove';
import { spot } from './spot';
import { sweep } from './sweep';
import { torch } from './torch';
import type { ResolvedChoice, SpecialChoice, SpecialDef, SpecialPreview, SpecialResult } from './types';
import { vault } from './vault';

export * from './types';
export { dashAmount } from './dash';
export { healAmount } from './heal';
export { shoveDestination } from './shove';
export { vaultOver } from './vault';
export { grenadeArcClear } from './grenade';
export { torchLine } from './torch';
export { hookPath } from './hook';

export const SPECIALS: Record<SpecialId, SpecialDef> = {
  brace,
  prep,
  heal,
  spot,
  dash,
  shove,
  vault,
  grenade,
  torch,
  sweep,
  load,
  overwatch,
  hook,
};

/** The unit's special, or undefined for heroes (they have none). */
export const specialIdOf = (state: GameState, unit: Unit): SpecialId | undefined =>
  state.config.units[unit.type].special;

export const specialOf = (state: GameState, unit: Unit): SpecialDef | undefined => {
  const id = specialIdOf(state, unit);
  return id && SPECIALS[id];
};

/** Look up the target unit and check the choice has the fields this targeting needs. */
function resolve(state: GameState, unit: Unit, sp: SpecialDef, choice: SpecialChoice): ResolvedChoice | string {
  switch (sp.targeting) {
    case 'none':
      return {};
    case 'ally':
    case 'enemy':
    case 'model': {
      const target = choice.targetId ? getUnit(state, choice.targetId) : undefined;
      if (!target?.pos) return 'Choose a target';
      if (sp.targeting === 'ally' && (target.owner !== unit.owner || target.id === unit.id)) return 'Choose an ally';
      if (sp.targeting === 'enemy' && target.owner === unit.owner) return 'Choose an enemy';
      if (target.id === unit.id) return 'Choose another model';
      return { target };
    }
    case 'hex':
      return choice.hex ? { hex: choice.hex } : 'Choose a hex';
    case 'direction':
      return Number.isInteger(choice.dir) && choice.dir! >= 0 && choice.dir! < 6 ? { dir: choice.dir } : 'Choose a direction';
  }
}

/** Why this special can't be used (with this choice), or null if it can. Without a choice, checks general usability only. */
export function specialBlockedReason(state: GameState, unit: Unit, choice?: SpecialChoice): string | null {
  if (!canAct(state, unit)) return 'This model cannot act';
  const sp = specialOf(state, unit);
  if (!sp) return 'No special action';
  const general = sp.usable?.(state, unit);
  if (general) return general;
  if (!choice) return null;
  const resolved = resolve(state, unit, sp, choice);
  if (typeof resolved === 'string') return resolved;
  return sp.checkChoice?.(state, unit, resolved) ?? null;
}

/** Every valid choice for this unit's special right now (empty for untargeted specials). */
export function specialChoices(state: GameState, unit: Unit): SpecialChoice[] {
  const sp = specialOf(state, unit);
  if (!sp) return [];
  let candidates: SpecialChoice[];
  switch (sp.targeting) {
    case 'none':
      return [];
    case 'ally':
    case 'enemy':
    case 'model':
      candidates = state.units.map((u) => ({ targetId: u.id }));
      break;
    case 'hex':
      candidates = hexagon(state.map.radius).map((hex) => ({ hex }));
      break;
    case 'direction':
      candidates = DIRECTIONS.map((_, dir) => ({ dir }));
      break;
  }
  return candidates.filter((c) => specialBlockedReason(state, unit, c) === null);
}

/** Units this special could target (for unit-targeted specials). */
export const specialTargets = (state: GameState, unit: Unit): Unit[] =>
  specialChoices(state, unit)
    .map((c) => (c.targetId ? getUnit(state, c.targetId) : undefined))
    .filter((u): u is Unit => !!u);

/** Area and predicted effects of a valid choice, or null if the special has no preview. */
export function previewSpecial(state: GameState, unit: Unit, choice: SpecialChoice): SpecialPreview | null {
  const sp = specialOf(state, unit);
  if (!sp?.preview || specialBlockedReason(state, unit, choice)) return null;
  const resolved = resolve(state, unit, sp, choice) as ResolvedChoice;
  return sp.preview(state, unit, resolved);
}

/** Applies a special, mutating `state`. Throws if it isn't legal. */
export function applySpecial(state: GameState, unit: Unit, choice: SpecialChoice = {}): SpecialResult {
  const reason = specialBlockedReason(state, unit, choice);
  if (reason) throw new Error(reason);
  const sp = specialOf(state, unit)!; // a unit without a special was rejected above
  const resolved = resolve(state, unit, sp, choice) as ResolvedChoice;
  unit.acted = true;
  // Using the die ends movement, unless the special says otherwise (Dash, Vault).
  if (!sp.keepsMovement) unit.movesLeft = 0;
  return { special: specialIdOf(state, unit)!, ...sp.apply(state, unit, resolved) };
}
