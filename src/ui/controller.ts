/**
 * Glue between the pure game logic and the screen. Holds the current GameState
 * plus UI-only state (what's selected), turns taps into Actions, plays the
 * resulting events as animations, and re-renders.
 */
import { previewAttack } from '../core/combat';
import { DEPLOY_SHAPES } from '../data/deployShapes';
import {
  type Action,
  type GameEvent,
  RuleError,
  applyAction,
  canUndoMove,
  freePartnerHexes,
  isInDeployZone,
  newGame,
  unplacedUnits,
} from '../core/game';
import { type Hex, type Point, hexCorners, hexDistance, hexEquals, hexKey, hexToPixel, hexagon, neighbors, pixelToHex } from '../core/hex';
import {
  actionBonus,
  armorLabel,
  actionDie,
  attackDamage,
  baseDefense,
  naturalDefense,
  canAct,
  canSeeHex,
  effectiveDefense,
  effectiveRange,
  getUnit,
  hasDoubleAction,
  livingUnits,
  maxHealth,
  moveReach,
  needsLoading,
  onBoard,
  claimBlockedReason,
  other,
  pickUpBlockedReason,
  siteIndexAt,
  terrainHeight,
  turnsUntilTransform,
  unitAt,
  unitDef,
  unitSize,
  unitSpeed,
} from '../core/queries';
import { randomSeed } from '../core/rng';
import {
  type Effect,
  type SpecialChoice,
  SPECIALS,
  dashAmount,
  eatHeal,
  partnerOf,
  healAmount,
  hookPath,
  previewSpecial,
  specialBlockedReason,
  specialChoices,
  specialIdOf,
  specialOf,
  specialTargets,
  targetsUnit,
} from '../core/specials';
import type { GameConfig, GameState, PlayerId, Unit, WinReason } from '../core/types';
import { heroName, speedName } from '../data/config';
import { AURAS, aurasOn } from '../core/auras';
import { flagCarrier, isCarrier } from '../core/flag';
import { MISSIONS, missionPointsToWin } from '../core/missions';
import { CONDITIONS } from '../core/conditions';
import { icon } from './icons';
import { BoardView, type BoardOverlay, HEX_SIZE, UNDO_MS } from './board';
import { showBuilder } from './builder';
import { Camera } from './camera';
import { PLAYER_COLORS, PLAYER_NAMES, type PanelAction, type PanelModel, renderPanel, renderTopBar } from './hud';
import { COLORS, HANDOFF_COLORS } from './theme';
import { haptics } from './haptics';
import { play } from './sound';
import type { AttackStyle } from './fx';
import { applySettingsClasses, getSettings, updateSettings } from './settings';
import { showOverlay } from './overlay';
import { crest, logo, trophy } from './emblems';

// Opaque, so the next player's freshly rolled dice (or army) aren't visible during handoff.
const HANDOFF_BG = HANDOFF_COLORS;
const NEUTRAL_BG = COLORS.raised;

const SIZE_NAMES = ['', 'small', 'medium', 'large'];

interface UiState {
  selectedId: string | null;
  /** Enemy chosen as the target of an attack, awaiting confirmation. */
  pendingTargetId: string | null;
  /** True while choosing a target for the selected unit's special action. */
  specialMode: boolean;
  /** Target chosen for the special, previewed and awaiting confirmation. */
  pendingChoice: SpecialChoice | null;
  /** Tap End Turn twice when models still have unused dice. */
  confirmEndTurn: boolean;
  message: string | null;
  /** Deploying a twin: the first hex is chosen; waiting for the partner's adjacent hex. */
  pendingTwin: { unitId: string; hex: Hex } | null;
}

export class Controller {
  private state!: GameState;
  private ui: UiState = this.freshUi();
  private board: BoardView;
  private camera!: Camera;
  private busy = false;
  /** The title screen shows once per page load. */
  private titleShown = false;
  /** The action whose events are playing (Undo snaps instead of gliding). */
  private action: Action | null = null;

  constructor(
    private config: GameConfig,
    svg: SVGSVGElement,
  ) {
    this.board = new BoardView(svg);
    document.getElementById('btn-fit')!.onclick = () => this.camera.fit();
    document.getElementById('btn-menu')!.onclick = () => this.openMenu();
  }

  private freshUi(): UiState {
    return {
      selectedId: null,
      pendingTargetId: null,
      specialMode: false,
      pendingChoice: null,
      confirmEndTurn: false,
      message: null,
      pendingTwin: null,
    };
  }

  async start(seed: number): Promise<void> {
    this.state = newGame(this.config, seed);
    this.ui = this.freshUi();
    const bounds = this.board.setMap(this.state.map, MISSIONS[this.state.mission].usesControlPoint);
    const svg = this.board.world.ownerSVGElement!;
    if (!this.camera) {
      this.camera = new Camera(svg, this.board.world, bounds, (p) => this.onTap(p));
    }
    this.camera.fit();
    this.render();
    if (!this.titleShown) {
      this.titleShown = true;
      await showOverlay({ title: '', art: logo(), className: 'title-screen', buttons: [{ label: 'Play', className: 'primary big', onClick: () => {} }] });
    }
    await this.buildArmies();
  }

  // ---------- Dispatch & events ----------

  private async dispatch(action: Action): Promise<boolean> {
    if (this.busy) return false; // an animation is still playing
    let result;
    try {
      result = applyAction(this.state, action);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.ui.message = e.message;
      play('error');
      this.render();
      return false;
    }
    const before = this.state;
    this.state = result.state;
    this.ui.message = null;
    this.ui.confirmEndTurn = false;
    if (action.type === 'attack' || action.type === 'special') {
      this.ui.pendingTargetId = null;
      this.ui.pendingChoice = null;
      this.ui.specialMode = false;
    }
    if (action.type === 'move' || action.type === 'place') haptics.tap();
    this.action = action;
    this.setBusy(true);
    try {
      await this.playEvents(before, result.events);
    } finally {
      this.setBusy(false);
    }
    const crawl = crawlText(before, this.state);
    if (crawl) this.ui.message = `${this.ui.message ?? ''} ${crawl}`.trim();
    this.render();
    return true;
  }

  /** Locks input (board, chips, panel) while events animate. */
  private setBusy(busy: boolean): void {
    this.busy = busy;
    document.getElementById('app')?.classList.toggle('busy', busy);
  }

  private async playEvents(before: GameState, events: GameEvent[]): Promise<void> {
    for (const ev of events) {
      const feel = eventFeel(ev);
      if (feel) haptics[feel]();
      switch (ev.type) {
        case 'armyChosen':
          if (ev.next === null) {
            await this.showBriefing();
            await this.deployHandoff(this.state.current);
          }
          break;
        case 'placed': {
          this.ui = this.freshUi();
          this.render();
          play('place');
          this.board.fx.ring(this.board.at(ev.hex), COLORS.tileEdge, 20, 300);
          const placer = getUnit(this.state, ev.unitId)!.owner;
          if (ev.next !== null && ev.next !== placer) await this.deployHandoff(ev.next);
          break;
        }
        case 'move': {
          const mover = getUnit(before, ev.unitId);
          if (!mover?.pos) {
            this.render();
            break;
          }
          // Undo: a quick straight slide back (no need to retrace the path).
          if (this.action?.type === 'undoMove') {
            await this.board.animateMove(ev.unitId, mover.pos, ev.path, { durationMs: UNDO_MS });
            break;
          }
          // Real moves glide along their path.
          await this.board.animateMove(ev.unitId, mover.pos, ev.path, { airborne: !!unitDef(before, mover).flying });
          break;
        }
        case 'attack': {
          const attacker = getUnit(before, ev.unitId)!;
          const target = getUnit(before, ev.targetId)!;
          await this.board.attackFx(attacker.id, attacker.pos!, target.pos!, attackStyle(before, attacker), PLAYER_COLORS[attacker.owner]);
          this.board.impact(target.id, target.pos!, ev);
          const roll = `${ev.roll}${ev.bonus ? `+${ev.bonus}` : ''} vs ${ev.defense}`;
          this.board.floatText(target.pos!, ev.hit ? `-${ev.damage}` : 'MISS', ev.hit ? COLORS.fxDamage : COLORS.fxMiss);
          this.ui.message = ev.hit
            ? `${unitDef(before, attacker).name} hits ${unitDef(before, target).name} (${roll}) for ${ev.damage}${ev.killed ? ' — destroyed!' : '.'}`
            : `${unitDef(before, attacker).name} misses ${unitDef(before, target).name} (${roll}).`;
          // Dual Gunner: the turn stays open for Second Shot.
          const after = getUnit(this.state, ev.unitId);
          const follow = after && specialOf(this.state, after);
          if (after && follow?.afterAttack && canAct(this.state, after)) this.ui.message += ` ${follow.name} ready: same die.`;
          this.render();
          break;
        }
        case 'special':
          await this.playSpecial(before, ev);
          break;
        case 'coinFlip': {
          play('reveal');
          const coin = document.createElement('div');
          coin.className = 'coin';
          coin.textContent = `P${ev.winner + 1}`;
          await showOverlay({
            title: `${PLAYER_NAMES[ev.winner]} goes first!`,
            lines: ['The coin decides round 1. After that, who goes first flips every two rounds.'],
            art: coin,
            color: HANDOFF_BG[ev.winner],
            tapText: 'Tap to continue',
          });
          break;
        }
        case 'gambleRoll':
          this.render();
          await this.board.rollDice({ [ev.unitId]: ev.roll }, this.state.config.dieSides + this.state.config.specials.gamblerRollBonus);
          break;
        case 'gambleFailed': {
          const u = getUnit(this.state, ev.unitId);
          if (u?.pos) this.board.floatText(u.pos, 'BUST', COLORS.fxBust);
          play('error');
          this.ui.message = `Gamble failed: rolled ${ev.roll} (${ev.reason}). The action is wasted.`;
          break;
        }
        case 'transformed': {
          const u = getUnit(this.state, ev.unitId);
          this.render();
          if (u?.pos) {
            this.board.floatText(u.pos, 'TRANSFORMS!', COLORS.fxGold);
            this.board.fx.ring(this.board.at(u.pos), COLORS.moon, 34);
            this.board.fx.smoke(this.board.at(u.pos), 5);
            play('rumble');
          }
          break;
        }
        case 'raised': {
          this.render();
          this.board.floatText(ev.at, 'RISEN', COLORS.fxInfo);
          this.board.fx.ring(this.board.at(ev.at), COLORS.hack, 26);
          play('buff');
          const line = `A Skeleton rises for ${PLAYER_NAMES[getUnit(this.state, ev.unitId)?.owner ?? 0]}!`;
          this.ui.message = `${this.ui.message ?? ''} ${line}`.trim();
          break;
        }
        case 'cracked': {
          this.render();
          const u = getUnit(this.state, ev.unitId);
          if (u?.pos) {
            this.board.floatText(u.pos, 'CRACK', COLORS.fxDamage);
            this.board.fx.sparks(this.board.at(u.pos), COLORS.miniSteel, 8, 24);
          }
          this.ui.message = `${this.ui.message ?? ''} ${crackText(this.state, ev)}`.trim();
          break;
        }
        case 'burn': {
          const pos = getUnit(before, ev.unitId)?.pos;
          if (pos) {
            this.board.floatText(pos, `BURN -${ev.damage}`, COLORS.fire);
            this.board.fx.flames([this.board.at(pos)], this.board.at(pos));
            play(ev.killed ? 'kill' : 'flame');
          }
          break;
        }
        case 'overwatch': {
          const sentinel = getUnit(before, ev.unitId)!;
          const target = getUnit(before, ev.targetId)!;
          await this.board.attackFx(sentinel.id, sentinel.pos!, target.pos!, 'bullet', COLORS.watch);
          this.board.impact(target.id, target.pos!, ev);
          this.board.floatText(target.pos!, ev.hit ? `-${ev.damage}` : 'MISS', ev.hit ? COLORS.fxDamage : COLORS.fxMiss);
          this.ui.message = overwatchText(before, ev);
          this.render();
          await sleep(700);
          break;
        }
        case 'roundScored':
          if (ev.scorer !== null) play('score');
          // Shown on the next handoff screen.
          break;
        case 'siteClaimed': {
          this.render();
          const site = this.state.map.sites![ev.site];
          this.board.floatText(site[0], 'CLAIMED', PLAYER_COLORS[ev.player]);
          this.board.fx.ring(this.board.at(site[0]), PLAYER_COLORS[ev.player], HEX_SIZE * 2.6, 700);
          play('claim');
          this.ui.message = `${this.ui.message ?? ''} ${claimText(before, this.state, ev)}`.trim();
          break;
        }
        case 'sitesScored':
          if (ev.points[0] || ev.points[1]) play('score');
          // Shown on the next handoff screen.
          break;
        case 'flagPickedUp':
        case 'flagDropped':
        case 'flagShifted':
        case 'flagCaptured': {
          this.render();
          const at = ev.type === 'flagPickedUp' || ev.type === 'flagDropped' ? ev.hex : ev.type === 'flagShifted' ? ev.to : null;
          if (ev.type === 'flagCaptured') {
            const pos = getUnit(this.state, ev.unitId)?.pos;
            if (pos) this.board.floatText(pos, 'CAPTURED!', COLORS.fxGold);
            haptics.kill();
          } else if (at) {
            play(ev.type === 'flagPickedUp' ? 'claim' : 'place');
            this.board.fx.ring(this.board.at(at), COLORS.flag, 26);
            this.board.floatText(at, ev.type === 'flagPickedUp' ? 'FLAG!' : ev.type === 'flagDropped' ? 'DROPPED' : 'FLAG', COLORS.flag);
          }
          const line = flagText(before, this.state, ev);
          this.ui.message = `${this.ui.message ?? ''} ${line}`.trim();
          break;
        }
        case 'turnStart':
          this.ui = this.freshUi();
          this.render();
          play('turn');
          await this.turnHandoff(ev.player, ev.round, events, before);
          await this.board.rollDice(ev.dice, this.state.config.dieSides);
          break;
        case 'gameOver':
          this.render();
          play('win');
          if (ev.winner !== null) this.board.celebrate(ev.winner);
          await this.gameOverScreen(ev.winner, ev.reason);
          break;
      }
    }
  }

  private async playSpecial(before: GameState, ev: Extract<GameEvent, { type: 'special' }>): Promise<void> {
    const unit = getUnit(before, ev.unitId)!;
    const target = ev.targetId ? getUnit(before, ev.targetId) : undefined;
    const sp = SPECIALS[ev.special];
    const labels: Partial<Record<string, string>> = {
      brace: 'BRACED',
      prep: 'PREPPED',
      dash: `DASH +${ev.amount}`,
      heal: `+${ev.amount}`,
      spot: 'SPOTTED',
      shove: 'SHOVED',
      vault: 'VAULT',
      hack: 'HACKED',
      smash: 'SMASH',
    };
    const label = labels[ev.special];
    const fx = this.board.fx;
    const from = this.board.at(unit.pos!);
    const there = target?.pos ? this.board.at(target.pos) : null;

    // The special's own effect, before its results show.
    switch (ev.special) {
      case 'grenade':
        if (ev.hex) {
          play('whoosh');
          await fx.shell(from, this.board.at(ev.hex), COLORS.miniOlive);
          play('explosion');
          fx.explosion(this.board.at(ev.hex));
          this.board.flash([ev.hex], 'flash-impact');
          this.board.flash(neighbors(ev.hex), 'flash-splash');
        }
        break;
      case 'secondShot':
        if (target?.pos) await this.board.attackFx(unit.id, unit.pos!, target.pos, 'bullet', COLORS.fxGold);
        break;
      case 'premiumShot':
        if (target?.pos) await this.board.attackFx(unit.id, unit.pos!, target.pos, 'heavy', COLORS.fxGold);
        break;
      case 'hack':
        play('hack');
        if (there) await fx.beam(from, there, COLORS.hack);
        break;
      case 'spot':
        play('buff');
        if (there) {
          await fx.beam(from, there, COLORS.target);
          fx.ring(there, COLORS.target, 22);
        }
        break;
      case 'torch':
      case 'breath':
        if (ev.dir !== undefined) {
          const preview = previewSpecial(before, unit, { dir: ev.dir });
          if (preview) {
            play('flame');
            fx.flames(preview.area.map((a) => this.board.at(a.hex)), from);
            this.board.flash(preview.area.map((a) => a.hex), 'flash-splash');
            await sleep(getSettings().animations ? 380 : 0);
          }
        }
        break;
      case 'heal':
        play('heal');
        if (there) {
          fx.ring(there, COLORS.good, 26);
          fx.sparks(there, COLORS.good, 6, 18);
        }
        break;
      case 'eat':
        if (target?.pos) await this.board.attackFx(unit.id, unit.pos!, target.pos, 'melee', COLORS.white);
        if (ev.amount) fx.ring(from, COLORS.good, 24);
        break;
      case 'sweep':
        play('slash');
        fx.ring(from, COLORS.white, HEX_SIZE * 1.7, 320);
        await sleep(getSettings().animations ? 160 : 0);
        break;
      case 'hook':
        play('hook');
        if (there) await fx.rope(from, there);
        break;
      case 'hurl':
        if (ev.hex) {
          play('rumble');
          fx.smoke(this.board.at(ev.hex), 5);
          this.board.drawTerrain(this.state.map); // the chunk is ripped out
          if (there) await fx.shell(this.board.at(ev.hex), there, COLORS.fxBoulder);
          this.board.drawTerrain(this.state.map);
        }
        break;
      case 'smash':
        if (ev.hex) {
          await this.board.lunge(unit.id, from, this.board.at(ev.hex));
          play('rumble');
          fx.smoke(this.board.at(ev.hex), 9);
          fx.sparks(this.board.at(ev.hex), COLORS.miniRock, 10, 30);
          fx.shake(8);
          this.board.drawTerrain(this.state.map);
        }
        break;
      case 'brace':
      case 'prep':
      case 'load':
      case 'overwatch':
        play('buff');
        fx.ring(from, ev.special === 'overwatch' ? COLORS.watch : COLORS.accent, 24);
        break;
      case 'dash':
      case 'pounce':
      case 'vault':
        play('whoosh');
        fx.sparks(from, COLORS.tileEdge, 5, 16);
        break;
      case 'swap':
        play('whoosh');
        fx.ring(from, COLORS.special, 28);
        if (there) fx.ring(there, COLORS.special, 28);
        break;
    }
    if (label) this.board.floatText((target ?? unit).pos!, label, COLORS.fxInfo);

    for (const e of ev.effects ?? []) {
      const pos = getUnit(before, e.unitId)?.pos;
      if (!pos) continue;
      this.board.impact(e.unitId, pos, { hit: e.hit !== false, killed: e.killed });
      if (e.hit === false) this.board.floatText(pos, 'MISS', COLORS.fxMiss);
      else this.board.floatText(pos, `-${e.damage}`, COLORS.fxDamage);
    }

    if (ev.special === 'swap') {
      // The twins teleport: they just flip places.
      this.render();
    } else if (ev.movedId && ev.to) {
      // Hook pulls, Shove, Vault: glide along the forced path.
      const moved = getUnit(before, ev.movedId);
      this.render();
      const from = ev.from ?? moved?.pos;
      if (from) await this.board.animateMove(ev.movedId, from, ev.path ?? [ev.to]);
    }

    const kills = (ev.effects ?? []).filter((e) => e.killed).length;
    let message = `${unitDef(before, unit).name} used ${sp.name}.`;
    if (ev.special === 'hook' && target) {
      // "Grappler hooks Artillery (ally), 1 damage, pulled 2 hexes."
      const ally = target.owner === unit.owner ? ' (ally)' : '';
      const dmg = ev.effects?.[0]?.damage ?? 0;
      const outcome = kills ? 'destroyed!' : `pulled ${ev.amount} hex${ev.amount === 1 ? '' : 'es'}.`;
      message = `${unitDef(before, unit).name} hooks ${unitDef(before, target).name}${ally}, ${dmg} damage, ${outcome}`;
    } else {
      if (ev.effects) message += ` ${this.effectsText(before, unit.owner, ev.effects, false)}`;
      if (kills) message += ` ${kills} destroyed!`;
      if (ev.special === 'eat' && ev.amount) message += ` ${unitDef(before, unit).name} heals ${ev.amount}.`;
    }
    if (ev.special === 'vault' && getUnit(this.state, unit.id)?.movesLeft) message += ' It can keep moving.';
    this.ui.message = message;
  }

  // ---------- Overlays ----------

  private async buildArmies(): Promise<void> {
    const limit = this.state.config.armyPointLimit;
    for (const p of [0, 1] as const) {
      await showOverlay({
        eyebrow: 'Army building',
        title: `${PLAYER_NAMES[p]}: build your army`,
        lines: [`Spend up to ${limit} points.`, `${PLAYER_NAMES[other(p)]}, look away!`],
        art: crest(p),
        color: HANDOFF_BG[p],
        tapText: 'Tap to start',
      });
      const units = await showBuilder(this.state.config, p);
      await this.dispatch({ type: 'chooseArmy', units });
    }
  }

  /** After both armies are built: this game's mission, with its one-line rule. */
  /**
   * The briefing: after both armies are built (and again from the corner icons), three
   * picture-first cards: the mission, the deployment (a mini-map of this board) and the
   * battlefield Condition. Reopened during play, it also offers the mission's full rules.
   */
  private async showBriefing(reopened = false): Promise<void> {
    if (reopened && this.busy) return;
    const s = this.state;
    const m = MISSIONS[s.mission];
    const shape = DEPLOY_SHAPES[s.map.deployShape];
    const cond = CONDITIONS[s.condition];
    const card = (label: string, art: Element, name: string, line: string) => {
      const div = document.createElement('div');
      div.className = 'brief-card';
      const pic = document.createElement('div');
      pic.className = 'brief-art';
      pic.append(art);
      const text = document.createElement('div');
      text.className = 'brief-text';
      const l = document.createElement('div');
      l.className = 'brief-label';
      l.textContent = label;
      const n = document.createElement('div');
      n.className = 'brief-name';
      n.textContent = name;
      const p = document.createElement('div');
      p.className = 'brief-line';
      p.textContent = line;
      text.append(l, n, p);
      div.append(pic, text);
      return div;
    };
    const cards = document.createElement('div');
    cards.className = 'briefing';
    cards.append(
      card('Mission', icon(m.icon, 72), m.name, m.brief(s.config)),
      card('Deployment', zoneMap(s), shape.name, `${PLAYER_NAMES[0]} blue · ${PLAYER_NAMES[1]} red`),
      card('Condition', icon(cond.icon, 72), cond.name, cond.summary),
    );
    await showOverlay({
      title: 'Briefing',
      art: cards,
      artBelowTitle: true,
      className: 'wide',
      ...(reopened
        ? {
            buttons: [
              { label: 'Back to the game', className: 'primary', onClick: () => this.render() },
              { label: 'Full mission rules', onClick: () => void this.showMissionRules() },
            ],
          }
        : { tapText: 'Tap to start placing' }),
    });
  }

  /** The mission's full rules (from the briefing during play). */
  private async showMissionRules(): Promise<void> {
    const m = MISSIONS[this.state.mission];
    await showOverlay({ title: m.name, lines: m.rules(this.state.config), tapText: 'Tap to close' });
    this.render();
  }

  /** The Condition's weather over the board (fog, sand, wind streaks, a red moon tint...). */
  private renderWeather(): void {
    let box = document.getElementById('weather');
    if (!box) {
      box = document.createElement('div');
      box.id = 'weather';
      box.append(document.createElement('i'), document.createElement('i'));
      document.getElementById('stage')!.append(box);
    }
    const s = this.state;
    const show = s.phase === 'deploy' || s.phase === 'play' || s.phase === 'over';
    box.className = show ? `w-${s.condition}` : '';
  }

  /** Small mission and Condition icons in the board's top-left corner; tapping reopens the briefing. */
  private renderBriefTools(): void {
    let box = document.getElementById('brief-tools');
    if (!box) {
      box = document.createElement('div');
      box.id = 'brief-tools';
      document.getElementById('stage')!.append(box);
    }
    const s = this.state;
    const show = s.phase === 'deploy' || s.phase === 'play' || s.phase === 'over';
    box.hidden = !show;
    if (!show) return;
    const key = `${s.mission}/${s.condition}`;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const button = (name: string, label: string) => {
      const b = document.createElement('button');
      b.className = 'tool brief-tool';
      b.setAttribute('aria-label', `${label} (open the briefing)`);
      b.title = label;
      b.append(icon(name, 30));
      b.onclick = () => void this.showBriefing(true);
      return b;
    };
    box.replaceChildren(
      button(MISSIONS[s.mission].icon, MISSIONS[s.mission].name),
      button(CONDITIONS[s.condition].icon, CONDITIONS[s.condition].name),
    );
  }

  private async deployHandoff(p: PlayerId): Promise<void> {
    const mine = unplacedUnits(this.state, p).length;
    const theirs = unplacedUnits(this.state, other(p)).length;
    const shape = DEPLOY_SHAPES[this.state.map.deployShape];
    await showOverlay({
      eyebrow: 'Deployment',
      art: crest(p),
      title: `${PLAYER_NAMES[p]}: place a model`,
      lines: [
        `Deployment: ${shape.name}. Place one model in your highlighted zone.`,
        `You have ${mine} left to place; ${PLAYER_NAMES[other(p)]} has ${theirs}.`,
      ],
      color: HANDOFF_BG[p],
      tapText: 'Tap to continue',
    });
  }

  private async turnHandoff(player: PlayerId, round: number, events: GameEvent[], before: GameState): Promise<void> {
    const lines: string[] = [];
    for (const e of events) {
      if (e.type === 'overwatch') lines.push(overwatchText(before, e));
      if (e.type === 'burn') lines.push(burnText(before, this.state, e));
      if (e.type === 'transformed') lines.push(`${PLAYER_NAMES[player]}'s Werewolf transforms into a beast (+${e.healed} HP)!`);
      if (e.type === 'raised') lines.push('A Skeleton rose from the fallen.');
      if (e.type === 'cracked') lines.push(crackText(this.state, e));
      if (e.type === 'flagDropped' || e.type === 'flagShifted' || e.type === 'flagCaptured') lines.push(flagText(before, this.state, e));
      if (e.type === 'sitesScored') {
        const [a, b] = e.points;
        lines.push(
          a || b
            ? `Round ${e.round}: sites held ${e.owned[0]}–${e.owned[1]}, so ${PLAYER_NAMES[0]} +${a}, ${PLAYER_NAMES[1]} +${b}${this.siteBonusNote(e)}.`
            : `Round ${e.round}: nobody holds a site yet.`,
        );
        lines.push(`Score: ${e.scores[0]} – ${e.scores[1]} (first to ${missionPointsToWin(this.state.config, this.state.mission)})`);
      }
    }
    if (before.phase === 'play' && before.current === player) {
      lines.push(`${PLAYER_NAMES[player]} goes again: turn order flips this round.`);
    }
    const scored = events.find((e) => e.type === 'roundScored');
    if (scored && scored.type === 'roundScored') {
      const [a, b] = scored.counts;
      lines.push(
        scored.scorer === null
          ? `Round ${scored.round}: no points (${a}–${b} on the control point).`
          : `Round ${scored.round}: ${PLAYER_NAMES[scored.scorer]} holds the point: +${scored.points}${this.holdSource(scored.scorer, scored.points)} (${a}–${b} on the control point)`,
      );
      lines.push(`Score: ${this.state.scores[0]} – ${this.state.scores[1]}`);
    }
    await showOverlay({
      eyebrow: `Round ${round} · Turn ${this.state.turnInRound + 1} of 2`,
      art: crest(player),
      title: `${PLAYER_NAMES[player]}'s turn`,
      lines,
      color: HANDOFF_BG[player],
      tapText: 'Tap to roll dice',
    });
  }

  private async gameOverScreen(winner: PlayerId | null, reason: WinReason): Promise<void> {
    const reasons: Record<WinReason, string> = {
      points: `Reached ${missionPointsToWin(this.state.config, this.state.mission)} points (${this.state.scores[0]} – ${this.state.scores[1]}).`,
      capture: 'Carried the flag home to their own deployment zone.',
      elimination: 'Every enemy model was eliminated.',
      draw: 'Both armies were wiped out at the same time.',
    };
    await showOverlay({
      eyebrow: winner === null ? 'Game over' : 'Victory',
      art: winner === null ? undefined : trophy(),
      className: 'victory',
      title: winner === null ? 'Draw!' : `${PLAYER_NAMES[winner]} wins!`,
      lines: [reasons[reason], `${this.state.round} round${this.state.round === 1 ? '' : 's'} played · ${survivors(this.state)}`],
      color: winner === null ? NEUTRAL_BG : HANDOFF_BG[winner],
      buttons: [
        { label: 'New game', className: 'primary', onClick: () => void this.start(randomSeed()) },
        { label: 'View board', onClick: () => this.render() },
      ],
    });
  }

  private openMenu(): void {
    if (this.busy) return;
    const settings = getSettings();
    void showOverlay({
      eyebrow: 'Paused',
      title: 'HexHunters',
      lines: [`Map seed: ${this.state.seed}`],
      buttons: [
        { label: 'Resume', className: 'primary', onClick: () => {} },
        { label: 'New game (new map)', className: 'danger', onClick: () => void this.start(randomSeed()) },
        { label: 'Restart (same map)', onClick: () => void this.start(this.state.seed) },
        {
          label: `Animations: ${settings.animations ? 'On' : 'Off'}`,
          className: 'toggle',
          onClick: () => {
            applySettingsClasses(updateSettings({ animations: !settings.animations }));
            this.openMenu();
          },
        },
        {
          label: `Sound: ${settings.sound ? 'On' : 'Off'}`,
          className: 'toggle',
          onClick: () => {
            const next = updateSettings({ sound: !settings.sound });
            if (next.sound) play('select');
            this.openMenu();
          },
        },
        {
          label: `Haptics: ${settings.haptics ? 'On' : 'Off'}`,
          className: 'toggle',
          onClick: () => {
            const next = updateSettings({ haptics: !settings.haptics });
            if (next.haptics) haptics.tap();
            this.openMenu();
          },
        },
      ],
    });
  }

  /** " (+1 Standard Bearer)" when a hero aura added a point to a scoring round of Domination. */
  private siteBonusNote(e: Extract<GameEvent, { type: 'sitesScored' }>): string {
    const notes = ([0, 1] as PlayerId[])
      .filter((p) => e.points[p] > e.owned[p])
      .map((p) => `${PLAYER_NAMES[p]} +${e.points[p] - e.owned[p]} ${this.holdSource(p, 2).trim().replace(/^\(|\)$/g, '') || 'bonus'}`);
    return notes.length ? ` (${notes.join(', ')})` : '';
  }

  /** " (Standard Bearer)" when a hero aura made a held point worth more than 1. */
  private holdSource(player: PlayerId, points: number): string {
    if (points <= 1) return '';
    const aura = this.state.auras[player].find((id) => AURAS[id].holdPoints);
    return aura ? ` (${heroName(this.state.config, aura)})` : '';
  }

  // ---------- Input ----------

  private onTap(world: Point): void {
    if (this.busy) return;
    const hex = pixelToHex(world, HEX_SIZE);
    if (!onBoard(this.state, hex)) {
      this.clearSelection();
      return;
    }
    if (this.state.phase === 'deploy') this.onDeployTap(hex);
    else if (this.state.phase === 'play') void this.onPlayTap(hex);
    else this.selectUnit(unitAt(this.state, hex)?.id ?? null);
  }

  private onChip(id: string): void {
    if (this.busy) return;
    this.selectUnit(id);
  }

  private clearSelection(): void {
    this.selectUnit(null);
  }

  private selectUnit(id: string | null): void {
    const unit = id ? getUnit(this.state, id) : undefined;
    if (unit && id !== this.ui.selectedId && unit.owner === this.state.current) haptics.tap();
    if (unit && id !== this.ui.selectedId) play('select');
    this.ui.selectedId = id;
    this.ui.pendingTwin = null;
    this.ui.pendingTargetId = null;
    this.ui.specialMode = false;
    this.ui.pendingChoice = null;
    this.ui.message = null;
    this.render();
  }

  private selected(): Unit | undefined {
    return this.ui.selectedId ? getUnit(this.state, this.ui.selectedId) : undefined;
  }

  private onDeployTap(hex: Hex): void {
    const s = this.state;
    if (unitAt(s, hex)) {
      this.selectUnit(unitAt(s, hex)!.id);
      return;
    }
    if (!isInDeployZone(s, s.current, hex)) {
      this.ui.message = 'Place your model in your highlighted zone.';
      this.render();
      return;
    }
    // Second tap for the Twins: the partner's hex, next to the first.
    const twin = this.ui.pendingTwin;
    if (twin) {
      this.ui.pendingTwin = null;
      if (freePartnerHexes(s, twin.hex).some((h) => hexEquals(h, hex))) {
        void this.dispatch({ type: 'place', unitId: twin.unitId, hex: twin.hex, partnerHex: hex });
      } else {
        this.ui.message = 'Cancelled: the other twin must go on a highlighted hex next to the first.';
        this.render();
      }
      return;
    }
    const sel = this.selected();
    const unit = sel && sel.owner === s.current && !sel.pos ? sel : unplacedUnits(s, s.current)[0];
    if (!unit) return;
    const partner = unit.partnerId ? getUnit(s, unit.partnerId) : undefined;
    if (partner && !partner.pos) {
      if (!freePartnerHexes(s, hex).length) {
        this.ui.message = 'No free hex next to it for the other twin. Pick another hex.';
      } else {
        this.ui.pendingTwin = { unitId: unit.id, hex };
        this.ui.message = `Now place ${unitDef(s, partner).name} on a highlighted hex next to it.`;
      }
      this.render();
      return;
    }
    void this.dispatch({ type: 'place', unitId: unit.id, hex });
  }

  private async onPlayTap(hex: Hex): Promise<void> {
    const s = this.state;
    const occupant = unitAt(s, hex);
    const sel = this.selected();
    const mine = sel && sel.owner === s.current ? sel : undefined;

    if (this.ui.specialMode && mine) {
      const choice = this.choiceAt(mine, hex);
      if (choice) {
        this.ui.pendingChoice = choice;
        this.ui.message = null;
        this.render();
        return;
      }
      if (occupant && occupant.owner === s.current) {
        this.selectUnit(occupant.id);
        return;
      }
      // Tapped elsewhere: leave targeting mode but keep the model selected.
      this.ui.specialMode = false;
      this.ui.pendingChoice = null;
      this.render();
      return;
    }

    if (mine && occupant && occupant.owner !== s.current && canAct(s, mine)) {
      const p = previewAttack(s, mine, occupant);
      if (!p.blockedReason) {
        this.ui.pendingTargetId = occupant.id;
        this.ui.message = null;
        this.render();
        return;
      }
    }

    if (occupant) {
      this.selectUnit(occupant.id);
      return;
    }

    if (mine && moveReach(s, mine).costs.has(hexKey(hex))) {
      this.ui.pendingTargetId = null;
      await this.dispatch({ type: 'move', unitId: mine.id, to: hex });
      return;
    }
    this.clearSelection();
  }

  /** The valid special choice a tap on `hex` selects, if any. */
  private choiceAt(unit: Unit, hex: Hex): SpecialChoice | undefined {
    const s = this.state;
    const choices = specialChoices(s, unit);
    switch (specialOf(s, unit)?.targeting) {
      case 'ally':
      case 'enemy':
      case 'model': {
        const occupant = unitAt(s, hex);
        return occupant && choices.find((c) => c.targetId === occupant.id);
      }
      case 'hex':
        return choices.find((c) => hexEquals(c.hex!, hex));
      case 'hexAndEnemy': {
        // Hurl: first tap the terrain chunk, then the enemy.
        const chunk = this.ui.pendingChoice?.hex;
        const occupant = unitAt(s, hex);
        if (chunk && occupant) return choices.find((c) => hexEquals(c.hex!, chunk) && c.targetId === occupant.id);
        return choices.some((c) => hexEquals(c.hex!, hex)) ? { hex } : undefined;
      }
      case 'direction':
        // Any hex the flame would reach picks that direction.
        return choices.find((c) => previewSpecial(s, unit, c)?.area.some((a) => hexEquals(a.hex, hex)));
      default:
        return undefined;
    }
  }

  // ---------- Rendering ----------

  private render(): void {
    renderTopBar(this.state);
    this.renderBriefTools();
    this.renderWeather();
    this.board.render(this.state, this.boardOverlay());
    renderPanel(this.panelModel(), (id) => this.onChip(id));
  }

  private boardOverlay(): BoardOverlay {
    const s = this.state;
    const o: BoardOverlay = {
      shade: new Map(),
      dots: new Set(),
      selectedId: this.ui.selectedId,
      targetIds: new Set(),
      specialTargetIds: new Set(),
      pendingTargetId: this.ui.pendingTargetId ?? this.ui.pendingChoice?.targetId ?? null,
      partnerId: this.selected()?.partnerId ?? null,
      watch: new Map(),
      scoreZone: null,
      auraArea: new Set(),
      auraUnits: new Set(),
    };
    // Capture the Flag: while one of your models has the flag, your scoring zone is outlined.
    const carrier = flagCarrier(s);
    if (s.phase === 'play' && carrier?.owner === s.current) {
      o.scoreZone = { player: s.current, hexes: new Set(s.map.deployZones[s.current].map(hexKey)) };
    }
    // Overwatch areas are always shown, to both players.
    for (const u of s.units) for (const h of u.overwatch?.hexes ?? []) o.watch.set(hexKey(h), u.owner);

    if (s.phase === 'deploy') {
      const twin = this.ui.pendingTwin;
      if (twin) {
        // Placing the Twins: the first twin's hex, then where the partner can go.
        o.shade.set(hexKey(twin.hex), 'landing');
        for (const h of freePartnerHexes(s, twin.hex)) o.shade.set(hexKey(h), 'option');
        return o;
      }
      // The enemy's zone faintly, then yours (where you can place).
      for (const h of s.map.deployZones[other(s.current)]) o.shade.set(hexKey(h), `deploy-${other(s.current)} faint`);
      for (const h of s.map.deployZones[s.current]) {
        if (!unitAt(s, h)) o.shade.set(hexKey(h), `deploy-${s.current}`);
      }
      return o;
    }

    const sel = this.selected();
    if (!sel?.pos) return o;
    // A hero whose aura has a reach (Field Marshal): show the area and who's inside getting it.
    const reachAura = unitDef(s, sel).hero?.aura;
    const reach = reachAura ? AURAS[reachAura].reach?.(s.config.specials) : 0;
    if (s.phase === 'play' && reachAura && reach) {
      for (const h of hexagon(s.map.radius)) if (hexDistance(h, sel.pos) <= reach) o.auraArea.add(hexKey(h));
      for (const u of livingUnits(s, sel.owner)) if (aurasOn(s, u).includes(reachAura)) o.auraUnits.add(u.id);
    }

    if (s.phase === 'play' && sel.owner === s.current && this.ui.specialMode) {
      this.specialOverlay(sel, o);
      return o;
    }

    // Shade by visibility: darker means even bigger models would be hidden there.
    // Indirect fire ignores line of sight, so just show its range.
    const def = unitDef(s, sel);
    for (const h of hexagon(s.map.radius)) {
      if (terrainHeight(s, h) > 0 || hexDistance(h, sel.pos) === 0) continue;
      const key = hexKey(h);
      if (def.indirectFire) {
        if (hexDistance(h, sel.pos) <= effectiveRange(s, sel)) o.shade.set(key, 'range');
        continue;
      }
      let hiddenFor = 0;
      for (const size of [1, 2, 3]) {
        if (canSeeHex(s, sel, h, size)) break;
        hiddenFor = size;
      }
      if (hiddenFor > 0) o.shade.set(key, `hide-${hiddenFor}`);
      else if (hexDistance(h, sel.pos) <= effectiveRange(s, sel)) o.shade.set(key, 'range');
    }

    if (s.phase !== 'play' || sel.owner !== s.current) return o;

    for (const key of moveReach(s, sel).costs.keys()) o.dots.add(key);
    if (canAct(s, sel)) {
      for (const enemy of livingUnits(s, other(sel.owner))) {
        if (!previewAttack(s, sel, enemy).blockedReason) o.targetIds.add(enemy.id);
      }
    }
    return o;
  }

  /** While choosing a special's target: highlight the options, then preview the chosen one's area. */
  private specialOverlay(unit: Unit, o: BoardOverlay): void {
    const s = this.state;
    const sp = specialOf(s, unit);
    if (!sp) return;
    // Swap: ring the partner twin.
    const partner = specialIdOf(s, unit) === 'swap' ? partnerOf(s, unit) : undefined;
    if (partner) o.specialTargetIds.add(partner.id);
    const choices = specialChoices(s, unit);
    if (targetsUnit(sp.targeting)) {
      for (const t of specialTargets(s, unit)) o.specialTargetIds.add(t.id);
      // Specials that move their target (Hook, Shove): mark where each one would land.
      for (const c of choices) {
        for (const a of previewSpecial(s, unit, c)?.area ?? []) if (a.kind === 'landing') o.shade.set(hexKey(a.hex), 'option');
      }
    } else if (sp.targeting === 'hex') {
      for (const c of choices) o.shade.set(hexKey(c.hex!), 'option');
    } else if (sp.targeting === 'hexAndEnemy') {
      const chunk = this.ui.pendingChoice?.hex;
      for (const c of choices) o.shade.set(hexKey(c.hex!), 'option');
      if (chunk) {
        o.shade.set(hexKey(chunk), 'path');
        for (const c of choices) if (hexEquals(c.hex!, chunk)) o.specialTargetIds.add(c.targetId!);
      }
    } else if (sp.targeting === 'direction') {
      for (const c of choices) {
        for (const a of previewSpecial(s, unit, c)?.area ?? []) o.shade.set(hexKey(a.hex), 'option');
      }
    }
    if (this.ui.pendingChoice) {
      for (const a of previewSpecial(s, unit, this.ui.pendingChoice)?.area ?? []) o.shade.set(hexKey(a.hex), a.kind);
    }
  }

  private panelModel(): PanelModel {
    const s = this.state;
    const sel = this.selected();
    const model: PanelModel = { roster: [], hint: '', actions: [] };

    // Roster: the active player's models still to place (deploy) or on the board (play).
    if (s.phase === 'deploy' || s.phase === 'play') {
      const mine = s.units.filter((u) => u.owner === s.current && (s.phase === 'deploy' ? !u.pos : !!u.pos));
      for (const u of mine) {
        const def = unitDef(s, u);
        model.roster.push({
          id: u.id,
          label: def.label,
          type: u.type,
          owner: u.owner,
          // The Behemoth has no die: its chip shows its armor instead.
          die:
            armorLabel(s, u) ??
            ((u.gambling ? '?' : u.die) === null ? null : `${u.gambling ? '?' : u.die}${u.hackPenalty ? ` (-${u.hackPenalty})` : ''}`),
          hp: u.hp,
          maxHp: maxHealth(s, u),
          spent: s.phase === 'play' && u.acted && u.movesLeft === 0,
          selected: u.id === this.ui.selectedId,
          note: s.phase === 'deploy' ? def.name : undefined,
        });
      }
    }

    if (sel) {
      const def = unitDef(s, sel);
      const sp = specialOf(s, sel);
      const defense = effectiveDefense(s, sel);
      const ownTurn = s.phase === 'play' && sel.owner === s.current;
      const defNotes = [
        ...(baseDefense(s, sel) > naturalDefense(s, sel) ? [`+${baseDefense(s, sel) - naturalDefense(s, sel)} aura`] : []),
        ...(sel.armorCracks ? [`-${sel.armorCracks} cracked`] : []),
        ...(sel.braced ? ['braced'] : []),
      ];
      const damage = attackDamage(s, sel);
      const stats: [string, string][] = [
        ['HP', `${sel.hp}/${maxHealth(s, sel)}`],
        ['Def', defNotes.length ? `${defense} (${defNotes.join(', ')})` : `${defense}`],
        ['Range', (def.range === 1 ? '1 (melee)' : def.indirectFire ? `${def.range} (indirect)` : `${def.range}`) + (effectiveRange(s, sel) < def.range ? ` (${effectiveRange(s, sel)} in ${CONDITIONS[s.condition].name})` : '')],
        ['Dmg', damage > def.damage ? `${damage} (+${damage - def.damage} aura)` : `${damage}`],
        ['Move', `${ownTurn ? `${sel.movesLeft}/` : ''}${unitSpeed(s, sel)} ${moveNote(s, sel)}`.trim()],
      ];
      if (def.hitBonus) stats.push(['Hit', `+${def.hitBonus}`]);
      if (def.needsLoading) stats.push(['Shell', needsLoading(s, sel) ? (sel.loaded ? 'LOADED' : 'empty') : 'no Load needed']);
      for (const aura of aurasOn(s, sel)) {
        stats.push(['Aura', `${heroName(s.config, aura)} ${AURAS[aura].short(s.config.specials, def)}`]);
      }
      if (sel.overwatch) stats.push(['Overwatch', `die ${sel.overwatch.die}, ${sel.overwatch.hexes.length} hexes`]);
      const hackNote = sel.hackPenalty ? ` (-${sel.hackPenalty} hacked)` : '';
      if (sel.gambling) stats.unshift(['Die', `? (rolls on action)${hackNote}`]);
      if (def.noDie) stats.unshift(['Die', 'none: melee always hits, Smash needs no roll']);
      if (sel.die !== null) {
        const point = sel.acted ? 0 : actionBonus(s, sel);
        const prep =
          (sel.dieBonus ? ` (${sel.die - sel.dieBonus}${sel.dieBonus > 0 ? '+' : '−'}${Math.abs(sel.dieBonus)} ${dieBonusSource(s, sel)})` : '') + (point ? ` (+${point} on point)` : '');
        stats.unshift(['Die', `${sel.die}${prep}${hackNote}${sel.acted ? ' used' : ''}`]);
      }
      // Dual Gunner: its attack, then Second Shot.
      if (ownTurn && sp?.afterAttack) {
        stats.push(['Actions', `${attackName(s, sel)} ${sel.attacked ? '✓' : '○'} · ${sp.name} ${sel.specialUsed ? '✓' : '○'}`]);
      }
      // Master Ninja: show which of the two actions have been used this turn.
      else if (ownTurn && sp && hasDoubleAction(s, sel)) {
        const attacked = sel.acted;
        stats.push(['Actions', `${sp.name} ${sel.specialUsed ? '✓' : '○'} · ${attackName(s, sel)} ${attacked ? '✓' : '○'}`]);
      }
      if (sel.prepped) stats.push(['Prepped', `+${s.config.specials.prepRollBonus} next roll`]);
      if (sel.spottedBy !== null) stats.push(['', 'Spotted']);
      if (sel.burning) stats.push(['', `Burning: -${s.config.specials.burnDamage} at its next turn`]);
      if (sel.hacked) stats.push(['', `Hacked: -${s.config.specials.hackPenalty} on its next die`]);
      if (def.flying) stats.push(['', 'Flying: moves over terrain and models']);
      if (sel.usesLeft !== null && sp) stats.push([`${sp.name}s`, `${sel.usesLeft} left`]);
      if (def.crackingArmor) {
        stats.push(['', `Cracking Armor: -1 def per damaging hit (not Burn), min ${def.crackingArmor.minDefense}`]);
      }
      if (sel.crawling) stats.push(['', 'Crawling (small, speed 1)']);
      if (sel.resting && ownTurn) stats.push(['', 'Resting (back-to-back turn)']);
      const transformsIn = turnsUntilTransform(s, sel);
      if (transformsIn !== null) {
        stats.push(['', transformsIn <= 1 ? 'Transforms at the start of its next turn!' : `Transforms in ${transformsIn} turns`]);
      }
      model.info = {
        title: `${PLAYER_NAMES[sel.owner]} ${def.hero ? 'HERO ' : ''}${def.name} (${SIZE_NAMES[unitSize(s, sel)]})`,
        owner: sel.owner,
        stats,
        special: def.hero?.aura
          ? `Hero aura (${AURAS[def.hero.aura].outlivesHero?.(s.config.specials) === false ? 'while it lives' : 'lasts all game'}): ${AURAS[def.hero.aura].describe(s.config.specials)}`
          : sp
            ? `${sp.name}: ${sp.describe(s.config.specials)}`
            : '',
      };
    }

    if (s.phase === 'deploy') this.deployPanel(model);
    else if (s.phase === 'play') this.playPanel(model);
    else if (s.phase === 'over') {
      model.hint = `${s.winner === null ? 'Draw' : `${PLAYER_NAMES[s.winner]} won`}. Tap models to inspect.`;
      model.actions.push({ label: 'New game', className: 'primary end-turn', onClick: () => void this.start(randomSeed()) });
    }

    if (this.ui.message) {
      model.hint = this.ui.message;
      model.hintWarn = false;
    }
    return model;
  }

  private deployPanel(model: PanelModel): void {
    const s = this.state;
    const mine = unplacedUnits(s, s.current).length;
    const theirs = unplacedUnits(s, other(s.current)).length;
    const sel = this.selected();
    const next = sel && sel.owner === s.current && !sel.pos ? sel : unplacedUnits(s, s.current)[0];
    const pairNote = next?.partnerId ? ' The Twins are placed together: pick a hex, then one next to it.' : '';
    model.hint =
      `${DEPLOY_SHAPES[s.map.deployShape].name} deployment. Tap a highlighted hex to place your ${next ? unitDef(s, next).name : 'model'} (or pick a different model above).${pairNote} ` +
      `You have ${mine} left; ${PLAYER_NAMES[other(s.current)]} has ${theirs}.`;
    if (!sel && next) {
      const chip = model.roster.find((c) => c.id === next.id);
      if (chip) chip.selected = true;
    }
  }

  private playPanel(model: PanelModel): void {
    const s = this.state;
    const sel = this.selected();
    const mine = sel && sel.owner === s.current ? sel : undefined;

    if (!sel) {
      model.hint = 'Tap one of your models (or a chip above) to select it.';
    } else if (!mine) {
      model.hint = 'Enemy model. Shading shows what it can see; darker = hides bigger models.';
    } else {
      this.unitActions(mine, model);
    }

    const unused = livingUnits(s, s.current).filter((u) => !u.acted).length;
    model.actions.push({
      label: this.ui.confirmEndTurn ? `Tap again: ${unused} model${unused === 1 ? '' : 's'} unused` : 'End turn',
      className: `end-turn ${this.ui.confirmEndTurn ? 'danger' : 'primary'}`,
      onClick: () => {
        if (unused > 0 && !this.ui.confirmEndTurn) {
          this.ui.confirmEndTurn = true;
          this.render();
          return;
        }
        void this.dispatch({ type: 'endTurn' });
      },
    });
  }

  /** "Heavy −2, your Medic −1 (friendly!)" or, for Torch, "Infantry: HIT −3 (7 vs 6)". */
  private effectsText(state: GameState, owner: PlayerId, effects: Effect[], predicted: boolean): string {
    if (!effects.length) return 'No models affected.';
    return effects
      .map((e) => {
        const u = getUnit(state, e.unitId);
        const name = u ? `${u.owner === owner ? 'your ' : ''}${unitDef(state, u).name}` : 'model';
        const friendly = u?.owner === owner ? ' (friendly!)' : '';
        const dies = e.killed ? (predicted ? ', destroyed' : '') : '';
        if (e.hit === undefined) return `${name} −${e.damage}${dies}${friendly}`;
        const vs = `${e.roll} vs ${e.defense}`;
        const burn = e.burned ? ', burns' : '';
        return e.hit ? `${name}: HIT −${e.damage} (${vs})${dies}${burn}${friendly}` : `${name}: miss (${vs})${friendly}`;
      })
      .join(' · ');
  }

  /** Gambler: percent of d12 rolls (with +2, Prep etc., capped) for which `ok` holds. */
  private gambleOdds(unit: Unit, ok: (state: GameState, unit: Unit) => boolean): number {
    const r = this.state.config.specials;
    let good = 0;
    for (let d = 1; d <= this.state.config.dieSides; d++) {
      const trial = structuredClone(this.state);
      const u = getUnit(trial, unit.id)!;
      u.gambling = false;
      u.die = Math.max(1, Math.min(r.gamblerMaxDie, d + r.gamblerRollBonus + u.dieBonus) - u.hackPenalty);
      if (ok(trial, u)) good++;
    }
    return Math.round((good / this.state.config.dieSides) * 100);
  }

  private unitActions(unit: Unit, model: PanelModel): void {
    const s = this.state;
    const sp = specialOf(s, unit);
    const id = specialIdOf(s, unit);
    const actions: PanelAction[] = [];
    const cancel = { label: 'Cancel', onClick: () => this.selectUnit(unit.id) };

    if (this.ui.specialMode && sp) {
      const choice = this.ui.pendingChoice;
      if (choice && sp.targeting === 'hexAndEnemy' && !choice.targetId) {
        const height = terrainHeight(s, choice.hex!);
        model.hint = `Height-${height} chunk picked (${s.config.specials.hurlBaseDamage + height} damage). Now tap a purple-ringed enemy to throw it at.`;
        model.actions.push(cancel);
        return;
      }
      if (choice) {
        const preview = previewSpecial(s, unit, choice);
        const effects = preview?.effects ?? [];
        let detail = '';
        if (id === 'heal') {
          const t = getUnit(s, choice.targetId!)!;
          detail = ` +${Math.min(healAmount(s, actionDie(s, unit)), maxHealth(s, t) - t.hp)} HP`;
        }
        if (targetsUnit(sp.targeting)) {
          detail = ` ${unitDef(s, getUnit(s, choice.targetId!)!).name}${detail}`;
        }
        if (id === 'grenade' || id === 'torch' || id === 'sweep' || id === 'breath') {
          const friendlyHit = effects.some((e) => getUnit(s, e.unitId)?.owner === unit.owner && e.damage > 0);
          model.preview = { text: this.effectsText(s, unit.owner, effects, true), good: !friendlyHit };
        } else if (id === 'secondShot') {
          const e = effects[0];
          const t = getUnit(s, choice.targetId!)!;
          model.preview = {
            text: e.hit
              ? `Same die: ${unitDef(s, t).name} HIT −${e.damage} (${e.roll} vs ${e.defense})${e.killed ? ', destroyed' : ''}`
              : `Same die: ${unitDef(s, t).name} miss (${e.roll} vs ${e.defense})`,
            good: !!e.hit,
          };
        } else if (id === 'premiumShot') {
          const e = effects[0];
          const t = getUnit(s, choice.targetId!)!;
          const after = (unit.usesLeft ?? 1) - 1;
          model.preview = {
            text: `Always hits: ${unitDef(s, t).name} −${e.damage}${e.killed ? ', destroyed' : ''}. ${after} shot${after === 1 ? '' : 's'} left after this.`,
            good: true,
          };
        } else if (id === 'hack') {
          const t = getUnit(s, choice.targetId!)!;
          model.preview = {
            text: `No roll. ${unitDef(s, t).name}'s die gets −${s.config.specials.hackPenalty} (min 1) on its next turn.`,
            good: true,
          };
        } else if (id === 'smash') {
          model.preview = {
            text: `Destroy this height-${terrainHeight(s, choice.hex!)} terrain hex for good. No roll.`,
            good: true,
          };
        } else if (id === 'swap') {
          const partner = partnerOf(s, unit);
          model.preview = {
            text: partner ? `Swap places with ${unitDef(s, partner).name}, across the map. It keeps its action.` : '',
            good: true,
          };
        } else if (id === 'eat') {
          const e = effects[0];
          const t = getUnit(s, choice.targetId!)!;
          const heal = eatHeal(s, unit, t);
          model.preview = {
            text: e.hit
              ? `${unitDef(s, t).name}: HIT −${e.damage} (${e.roll} vs ${e.defense})${e.killed ? ', destroyed' : ''}` +
                (heal ? `, Zombie +${heal} HP` : ', Zombie already at full health')
              : `${unitDef(s, t).name}: miss (${e.roll} vs ${e.defense})`,
            good: !!e.hit,
          };
        } else if (id === 'hook') {
          const t = getUnit(s, choice.targetId!)!;
          const e = effects[0];
          const hexes = hookPath(s, unit, t).length;
          const pulled = e?.killed ? 'destroyed' : `pulled ${hexes} hex${hexes === 1 ? '' : 'es'}`;
          const ally = t.owner === unit.owner;
          model.preview = {
            text: `${unitDef(s, t).name}${ally ? ' (ally)' : ''}: −${e?.damage ?? 0}, ${pulled}`,
            good: !ally,
          };
        } else if (id === 'hurl') {
          const t = getUnit(s, choice.targetId!)!;
          const e = effects[0];
          model.preview = {
            text: e.hit
              ? `${unitDef(s, t).name}: HIT −${e.damage} (${e.roll} vs ${e.defense})${e.killed ? ', destroyed: a boulder lands there' : ''}. The terrain is gone.`
              : `${unitDef(s, t).name}: miss (${e.roll} vs ${e.defense}). The terrain is gone either way.`,
            good: !!e.hit,
          };
        } else if (id === 'vault') {
          model.preview = { text: `Land here, then keep moving (${unit.movesLeft} left).`, good: true };
        } else if (id === 'overwatch') {
          const n = preview?.area.length ?? 0;
          model.preview = {
            text: `Watch ${n} hexes with a locked ${actionDie(s, unit)}. At the end of the opponent's turn, fire at an enemy still in the area.`,
            good: true,
          };
        }
        if (unit.gambling) {
          // Gambler: the die isn't known yet, so show the odds instead of the outcome.
          // Succeeds = the threshold is met and (for specials with a hit roll) the first target is hit.
          const odds = this.gambleOdds(
            unit,
            (st, u) => !specialBlockedReason(st, u, choice) && (previewSpecial(st, u, choice)?.effects[0]?.hit ?? true),
          );
          model.preview = {
            text: `Rolls d12+${s.config.specials.gamblerRollBonus} when you confirm: ${odds}% chance to succeed (best case shown on the board).`,
            good: odds >= 50,
          };
        }
        actions.push({
          label: `${sp.name}${detail}`,
          className: 'primary',
          onClick: () => void this.dispatch({ type: 'special', unitId: unit.id, ...choice }),
        });
        // The preview line already explains the outcome; skip the hint to keep the panel compact.
        if (!model.preview) model.hint = 'Confirm, or tap another target to compare.';
      } else {
        const n = specialChoices(s, unit).length;
        const how: Record<string, string> = {
          ally: `Tap a purple-ringed model to ${sp.name}.`,
          enemy: `Tap a purple-ringed model to ${sp.name}.`,
          model: `Tap a purple-ringed model to ${sp.name}. Purple hexes show where each would land.`,
          hex: `Tap a purple hex to choose where to ${sp.name}.`,
          hexAndEnemy: `Tap a purple terrain hex to rip out, then the enemy to ${sp.name} it at.`,
          direction: `Tap a purple hex to choose the ${sp.name} direction.`,
        };
        model.hint = n ? how[sp.targeting] : `No valid ${sp.name} targets.`;
        model.hintWarn = n === 0;
      }
      model.actions.push(...actions, cancel);
      return;
    }

    const pending = this.ui.pendingTargetId ? getUnit(s, this.ui.pendingTargetId) : undefined;
    if (pending) {
      const p = previewAttack(s, unit, pending);
      const mods =
        `${p.hitBonus ? ` +${p.hitBonus}` : ''}${p.spotBonus ? ` +${p.spotBonus} spot` : ''}` +
        `${p.pointBonus ? ` +${p.pointBonus} point` : ''}`;
      model.preview = {
        text: unitDef(s, unit).noDie
          ? `Always hits (no die): ${unitDef(s, pending).name} −${p.damage}${pending.hp <= p.damage ? ', destroyed' : ''}`
          : `Roll ${p.roll}${mods} vs defense ${p.defense}: ${p.hit ? `HIT for ${p.damage}` : 'MISS'}`,
        good: p.hit,
      };
      if (unit.gambling) {
        const odds = this.gambleOdds(unit, (st, u) => previewAttack(st, u, getUnit(st, pending.id)!).hit);
        model.preview = {
          text: `Rolls d12+${s.config.specials.gamblerRollBonus} when you confirm${mods} vs defense ${p.defense}: ${odds}% to hit for ${p.damage}`,
          good: odds >= 50,
        };
      }
      actions.push({
        label: `${attackName(s, unit)} ${unitDef(s, pending).name}`,
        className: 'primary',
        onClick: () => void this.dispatch({ type: 'attack', unitId: unit.id, targetId: pending.id }),
      });
      model.actions.push(...actions, cancel);
      return;
    }

    const hints: string[] = [];
    if (unit.movesLeft > 0) hints.push('Tap a green dot to move');
    if (canAct(s, unit) && unit.attacked) {
      // Dual Gunner after its attack: only Second Shot is left.
      hints.push(`tap ${sp?.name ?? 'the special'} to fire again with the same die`);
    } else if (canAct(s, unit)) {
      if (needsLoading(s, unit) && !unit.loaded) {
        actions.push({ label: `${attackName(s, unit)} (load first)`, disabled: true, onClick: () => {} });
      } else if (hasDoubleAction(s, unit)) {
        // Master Ninja: the attack gets its own button so both actions stay visible.
        hints.push(`tap a red-ringed enemy to ${attackName(s, unit).toLowerCase()} (ends this model's turn)`);
        actions.push({
          label: attackName(s, unit),
          onClick: () => {
            this.ui.message = `Tap a red-ringed enemy to ${attackName(s, unit).toLowerCase()}. Attacking ends this model's turn.`;
            this.render();
          },
        });
      } else {
        hints.push(`tap a red-ringed enemy to ${attackName(s, unit).toLowerCase()}`);
      }
    }
    // Capture the Flag: standing on the flag, it can spend its action to pick it up.
    if (s.flag && !pickUpBlockedReason(s, unit)) {
      hints.unshift('standing on the flag: pick it up (uses its action)');
      actions.push({ label: 'Pick up flag', className: 'primary', onClick: () => void this.dispatch({ type: 'pickUp', unitId: unit.id }) });
    }
    // Domination: standing in a site it can claim.
    if (s.map.sites) {
      const why = claimBlockedReason(s, unit);
      if (!why) {
        hints.unshift(`in the ${siteName(s, siteIndexAt(s, unit.pos!))}: claim it (uses its action)`);
        actions.push({ label: 'Claim site', className: 'primary', onClick: () => void this.dispatch({ type: 'claim', unitId: unit.id }) });
      } else if (why === 'Enemy inside') {
        hints.unshift(`enemy inside the ${siteName(s, siteIndexAt(s, unit.pos!))}: can't claim`);
      }
    }
        if (isCarrier(s, unit)) {
      const free = unitSpeed({ ...s, flag: null }, unit);
      hints.push(`carrying the flag (move ${unitSpeed(s, unit)} instead of ${free}): end your turn inside your zone to win`);
    }
    // Heroes have no special: their die is only for attacking.
    if (canAct(s, unit) && sp) {
      const reason = specialBlockedReason(s, unit);
      const noTargets = sp.targeting !== 'none' && !reason && specialChoices(s, unit).length === 0;
      let label = sp.name;
      if (unit.specialUsed) label += ' ✓';
      else if (reason) label += ` (${reason})`;
      else if (noTargets) label += ' (no targets)';
      else if (id === 'dash') label += ` (+${dashAmount(s, actionDie(s, unit))})`;
      if (unit.usesLeft !== null && !reason && !unit.specialUsed) label += ` (${unit.usesLeft} left)`;
      else if (id === 'heal') label += ` (+${healAmount(s, actionDie(s, unit))})`;
      actions.push({
        label,
        disabled: !!reason || noTargets,
        onClick: () => {
          if (sp.targeting === 'none' && !sp.preview) {
            void this.dispatch({ type: 'special', unitId: unit.id });
          } else {
            // Targeted specials pick a target first; untargeted ones with an area (Sweep,
            // Overwatch) go straight to their preview and wait for Confirm.
            this.ui.specialMode = true;
            this.ui.pendingChoice = sp.targeting === 'none' ? {} : null;
            this.ui.pendingTargetId = null;
            this.render();
          }
        },
      });
    }
    if (!canAct(s, unit) && unit.acted) {
      hints.push(unit.movesLeft > 0 ? 'die used' : 'This model is done for the turn');
    }
    if (canUndoMove(s, unit)) {
      actions.push({ label: 'Undo move', onClick: () => void this.dispatch({ type: 'undoMove', unitId: unit.id }) });
    }
    const reachAura = unitDef(s, unit).hero?.aura;
    const reach = reachAura ? AURAS[reachAura].reach?.(s.config.specials) : 0;
    if (reachAura && reach) {
      const inside = livingUnits(s, unit.owner).filter((u) => aurasOn(s, u).includes(reachAura)).length;
      hints.push(`green area: your Infantry inside it when your turn starts get +${s.config.specials.marshalRollBonus} (${inside} inside now)`);
    }
    model.hint = hints.length ? `${hints.join(', ')}.` : '';
    model.hint = model.hint.charAt(0).toUpperCase() + model.hint.slice(1);
    model.actions.push(...actions);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "5 – 2 models left" for the win screen. */
const survivors = (state: GameState): string =>
  `${livingUnits(state, 0).length} – ${livingUnits(state, 1).length} models left`;

/** How a unit's basic attack looks and sounds. */
export function attackStyle(state: GameState, unit: Unit): AttackStyle {
  const def = unitDef(state, unit);
  if (def.range <= 1) return 'melee';
  if (def.indirectFire) return 'shell';
  if (def.flying || def.hero?.aura === 'pyro' || def.special === 'torch') return 'fire';
  return def.damage >= 4 || def.special === 'spot' ? 'heavy' : 'bullet';
}

/** "Player 2's Behemoth's armor cracks: DEF 9 (-1)." */
function crackText(state: GameState, ev: Extract<GameEvent, { type: 'cracked' }>): string {
  const u = getUnit(state, ev.unitId);
  const who = u ? `${PLAYER_NAMES[u.owner]}'s ${unitDef(state, u).name}` : 'The Behemoth';
  const floor = u && unitDef(state, u).crackingArmor?.minDefense === ev.defense ? ' It can crack no further.' : '';
  return `${who}'s armor cracks: DEF ${ev.defense} (-${ev.cracks}).${floor}`;
}

const attackName = (state: GameState, unit: Unit): string => unitDef(state, unit).attackName ?? 'Attack';

/** "Sentinel overwatch: 9 vs def 5, hit for 2". */
function overwatchText(state: GameState, ev: Extract<GameEvent, { type: 'overwatch' }>): string {
  const target = getUnit(state, ev.targetId);
  const name = target ? unitDef(state, target).name : 'target';
  const roll = `${ev.roll}${ev.bonus ? `+${ev.bonus}` : ''} vs def ${ev.defense}`;
  const result = ev.hit ? `hit ${name} for ${ev.damage}${ev.killed ? ' (destroyed!)' : ''}` : `missed ${name}`;
  return `Sentinel overwatch: ${roll}, ${result}.`;
}

/** "normal", or "(slow +1)" when an aura adds movement. */
/** What a die bonus came from: "bonus", or the Condition's name when that's all of it (Blood Moon, Sandstorm). */
function dieBonusSource(state: GameState, unit: Unit): string {
  const cond = CONDITIONS[state.condition];
  return cond.dieDelta && unit.dieBonus === cond.dieDelta ? cond.name : 'bonus';
}

function moveNote(state: GameState, unit: Unit): string {
  const def = unitDef(state, unit);
  const name = speedName(def.speed);
  const own = unit.crawling && def.woundedForm ? def.woundedForm.speed : def.speed;
  const free = unitSpeed({ ...state, flag: null }, unit); // with aura bonuses, no flag
  const bonus = free - own;
  if (!isCarrier(state, unit)) return bonus ? `(${name} +${bonus})` : name;
  // Capture the Flag: the carrier ignores speed bonuses and is slowed (unless Standard Bearer).
  const cut = own - unitSpeed(state, unit);
  const notes = [...(bonus ? [`+${bonus} ignored`] : []), ...(cut ? [`flag −${cut}`] : [])];
  return notes.length ? `(${name}, ${notes.join(', ')})` : name;
}

/** "Infantry burns for 1." / "... destroyed!" / "... now crawling!" */
function burnText(before: GameState, after: GameState, ev: Extract<GameEvent, { type: 'burn' }>): string {
  const unit = getUnit(before, ev.unitId);
  const name = unit ? `${PLAYER_NAMES[unit.owner]} ${unitDef(before, unit).name}` : 'A model';
  if (ev.killed) return `${name} burns for ${ev.damage}: destroyed!`;
  const crawls = unit && !unit.crawling && getUnit(after, ev.unitId)?.crawling;
  return `${name} burns for ${ev.damage}${crawls ? ' and is now crawling!' : '.'}`;
}

/** "Zombie is crawling!" for Zombies that started crawling during an action. */
function crawlText(before: GameState, after: GameState): string {
  const names = after.units
    .filter((u) => u.crawling && getUnit(before, u.id)?.crawling === false)
    .map((u) => unitDef(after, u).name);
  return names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} now crawling!` : '';
}

/** Domination: "center site", or a flank site by where it sits on screen ("north-west site"). */
export function siteName(state: GameState, i: number): string {
  if (i === 0) return 'center site';
  const p = hexToPixel(state.map.sites![i][0], 1);
  const angle = (Math.atan2(-p.y, p.x) * 180) / Math.PI; // 0 = east, 90 = north
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  return `${names[Math.round(((angle + 360) % 360) / 45) % 8]} site`;
}

/** "Player 1's Infantry claims the north-west site (from Player 2)." */
function claimText(before: GameState, after: GameState, ev: Extract<GameEvent, { type: 'siteClaimed' }>): string {
  const u = getUnit(after, ev.unitId) ?? getUnit(before, ev.unitId);
  const who = u ? `${PLAYER_NAMES[u.owner]}'s ${unitDef(after, u).name}` : PLAYER_NAMES[ev.player];
  const from = ev.from === null ? '' : ` from ${PLAYER_NAMES[ev.from]}`;
  return `${who} claims the ${siteName(after, ev.site)}${from}!`;
}

/** "Player 1's Infantry picks up the flag." and the other flag log lines. */
export function flagText(
  before: GameState,
  after: GameState,
  ev: Extract<GameEvent, { type: 'flagPickedUp' | 'flagDropped' | 'flagShifted' | 'flagCaptured' }>,
): string {
  const name = (id: string) => {
    const u = getUnit(after, id) ?? getUnit(before, id);
    return u ? `${PLAYER_NAMES[u.owner]}'s ${unitDef(after, u).name}` : 'A model';
  };
  switch (ev.type) {
    case 'flagPickedUp':
      return `${name(ev.unitId)} picks up the flag!`;
    case 'flagDropped': {
      const by = ev.by && ev.by !== ev.unitId ? getUnit(after, ev.by) ?? getUnit(before, ev.by) : undefined;
      const byName = by ? unitDef(after, by).name : '';
      const why =
        ev.reason === 'killed'
          ? 'falls'
          : ev.reason === 'hacked'
            ? `is hacked${byName ? ` by the ${byName}` : ''}`
            : by
              ? `is moved by the ${byName}`
              : 'moves without walking';
      return `${name(ev.unitId)} ${why} and drops the flag.`;
    }
    case 'flagShifted':
      return 'The flag rolls off the boulder to the nearest open hex.';
    case 'flagCaptured':
      return `${PLAYER_NAMES[ev.player]} captures the flag and wins!`;
  }
}

/** A small picture of the board for the deployment reveal: both zones, the control point and terrain. */
function zoneMap(state: GameState): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 10;
  const svg = document.createElementNS(NS, 'svg');
  const extent = size * Math.sqrt(3) * (state.map.radius + 1);
  svg.setAttribute('viewBox', `${-extent} ${-extent} ${extent * 2} ${extent * 2}`);
  svg.setAttribute('class', 'zone-map');
  const zone = (h: Hex, p: PlayerId) => state.map.deployZones[p].some((z) => hexEquals(z, h));
  const mission = MISSIONS[state.mission];
  const cp = (h: Hex) => mission.usesControlPoint && state.map.controlPoint.some((c) => hexEquals(c, h));
  const flag = (h: Hex) => !!state.flag?.pos && hexEquals(state.flag.pos, h);
  const site = (h: Hex) => (state.map.sites ?? []).some((st) => st.some((x) => hexEquals(x, h)));
  for (const h of hexagon(state.map.radius)) {
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', hexCorners(h, size).map((p) => `${p.x},${p.y}`).join(' '));
    const kind = zone(h, 0) ? 'z0' : zone(h, 1) ? 'z1' : cp(h) ? 'cp' : site(h) ? 'site' : flag(h) ? 'flag' : state.map.heights[hexKey(h)] ? 'wall' : 'open';
    poly.setAttribute('class', kind);
    svg.append(poly);
  }
  const wrap = document.createElement('div');
  wrap.append(svg);
  return wrap;
}

/** Haptic feedback for an event: a kill beats a hit; misses and non-damage events are silent. */
export function eventFeel(ev: GameEvent): 'kill' | 'hit' | null {
  switch (ev.type) {
    case 'attack':
    case 'overwatch':
      return ev.killed ? 'kill' : ev.hit ? 'hit' : null;
    case 'special': {
      const fx = ev.effects ?? [];
      if (fx.some((e) => e.killed)) return 'kill';
      return fx.some((e) => e.damage > 0) ? 'hit' : null;
    }
    case 'burn':
      return ev.killed ? 'kill' : null;
    default:
      return null;
  }
}
