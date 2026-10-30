/**
 * Glue between the pure game logic and the screen. Holds the current GameState
 * plus UI-only state (what's selected), turns taps into Actions, plays the
 * resulting events as animations, and re-renders.
 */
import { previewAttack } from '../core/combat';
import { type Action, type GameEvent, RuleError, applyAction, canUndoMove, isInDeployZone, newGame, unplacedUnits } from '../core/game';
import { type Hex, type Point, hexDistance, hexEquals, hexKey, hexagon, neighbors, pixelToHex } from '../core/hex';
import {
  canAct,
  canSeeHex,
  effectiveDefense,
  getUnit,
  livingUnits,
  moveReach,
  needsLoading,
  onBoard,
  other,
  terrainHeight,
  unitAt,
  unitDef,
  unitSpeed,
} from '../core/queries';
import { randomSeed } from '../core/rng';
import {
  type Effect,
  type SpecialChoice,
  SPECIALS,
  dashAmount,
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
import { BoardView, type BoardOverlay, HEX_SIZE } from './board';
import { showBuilder } from './builder';
import { Camera } from './camera';
import { PLAYER_COLORS, PLAYER_NAMES, type PanelAction, type PanelModel, renderPanel, renderTopBar } from './hud';
import { showOverlay } from './overlay';

// Opaque, so the next player's freshly rolled dice (or army) aren't visible during handoff.
const HANDOFF_BG = ['#172e5c', '#5c1717'];
const NEUTRAL_BG = '#2a2f3a';

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
}

export class Controller {
  private state!: GameState;
  private ui: UiState = this.freshUi();
  private board: BoardView;
  private camera!: Camera;
  private busy = false;

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
    };
  }

  async start(seed: number): Promise<void> {
    this.state = newGame(this.config, seed);
    this.ui = this.freshUi();
    const bounds = this.board.setMap(this.state.map);
    const svg = this.board.world.ownerSVGElement!;
    if (!this.camera) {
      this.camera = new Camera(svg, this.board.world, bounds, (p) => this.onTap(p));
    }
    this.camera.fit();
    this.render();
    await this.buildArmies();
  }

  // ---------- Dispatch & events ----------

  private async dispatch(action: Action): Promise<boolean> {
    let result;
    try {
      result = applyAction(this.state, action);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.ui.message = e.message;
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
    this.busy = true;
    try {
      await this.playEvents(before, result.events);
    } finally {
      this.busy = false;
    }
    this.render();
    return true;
  }

  private async playEvents(before: GameState, events: GameEvent[]): Promise<void> {
    for (const ev of events) {
      switch (ev.type) {
        case 'armyChosen':
          if (ev.next === null) await this.deployHandoff(this.state.current);
          break;
        case 'placed': {
          this.ui = this.freshUi();
          this.render();
          const placer = getUnit(this.state, ev.unitId)!.owner;
          if (ev.next !== null && ev.next !== placer) await this.deployHandoff(ev.next);
          break;
        }
        case 'move':
          await this.board.animateMove(ev.unitId, ev.path);
          break;
        case 'attack': {
          const attacker = getUnit(before, ev.unitId)!;
          const target = getUnit(before, ev.targetId)!;
          this.board.shot(attacker.pos!, target.pos!, PLAYER_COLORS[attacker.owner]);
          const roll = `${ev.roll}${ev.bonus ? `+${ev.bonus}` : ''} vs ${ev.defense}`;
          this.board.floatText(target.pos!, ev.hit ? `-${ev.damage}` : 'MISS', ev.hit ? '#fca5a5' : '#e5e7eb');
          this.ui.message = ev.hit
            ? `${unitDef(before, attacker).name} hits ${unitDef(before, target).name} (${roll}) for ${ev.damage}${ev.killed ? ' — destroyed!' : '.'}`
            : `${unitDef(before, attacker).name} misses ${unitDef(before, target).name} (${roll}).`;
          this.render();
          break;
        }
        case 'special':
          await this.playSpecial(before, ev);
          break;
        case 'overwatch': {
          const sentinel = getUnit(before, ev.unitId)!;
          const target = getUnit(before, ev.targetId)!;
          this.board.shot(sentinel.pos!, target.pos!, '#22d3ee');
          this.board.floatText(target.pos!, ev.hit ? `-${ev.damage}` : 'MISS', ev.hit ? '#fca5a5' : '#e5e7eb');
          this.ui.message = overwatchText(before, ev);
          this.render();
          await sleep(700);
          break;
        }
        case 'roundScored':
          // Shown on the next handoff screen.
          break;
        case 'turnStart':
          this.ui = this.freshUi();
          this.render();
          await this.turnHandoff(ev.player, ev.round, events, before);
          await this.board.rollDice(ev.dice, this.state.config.dieSides);
          break;
        case 'gameOver':
          this.render();
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
    };
    const label = labels[ev.special];
    if (label) this.board.floatText((target ?? unit).pos!, label, '#c4b5fd');

    if (ev.special === 'grenade' && ev.hex) {
      this.board.shot(unit.pos!, ev.hex, '#f97316');
      this.board.flash([ev.hex], 'flash-impact');
      this.board.flash(neighbors(ev.hex), 'flash-splash');
    }
    if (ev.special === 'torch' && ev.dir !== undefined) {
      const preview = previewSpecial(before, unit, { dir: ev.dir });
      if (preview) this.board.flash(preview.area.map((a) => a.hex), 'flash-impact');
    }
    for (const e of ev.effects ?? []) {
      const pos = getUnit(before, e.unitId)?.pos;
      if (!pos) continue;
      if (e.hit === false) this.board.floatText(pos, 'MISS', '#e5e7eb');
      else this.board.floatText(pos, `-${e.damage}`, '#fca5a5');
    }

    if (ev.movedId && ev.to) {
      this.render();
      await this.board.animateMove(ev.movedId, ev.path ?? [ev.to]);
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
    }
    if (ev.special === 'vault' && getUnit(this.state, unit.id)?.movesLeft) message += ' It can keep moving.';
    this.ui.message = message;
  }

  // ---------- Overlays ----------

  private async buildArmies(): Promise<void> {
    const limit = this.state.config.armyPointLimit;
    for (const p of [0, 1] as const) {
      await showOverlay({
        title: `${PLAYER_NAMES[p]}: build your army`,
        lines: [`Spend up to ${limit} points.`, `${PLAYER_NAMES[other(p)]}, look away!`],
        color: HANDOFF_BG[p],
        tapText: 'Tap to start',
      });
      const units = await showBuilder(this.state.config, p);
      await this.dispatch({ type: 'chooseArmy', units });
    }
  }

  private async deployHandoff(p: PlayerId): Promise<void> {
    const mine = unplacedUnits(this.state, p).length;
    const theirs = unplacedUnits(this.state, other(p)).length;
    const rows = this.state.config.deployRows;
    await showOverlay({
      title: `${PLAYER_NAMES[p]}: place a model`,
      lines: [
        `Place one model in the back ${rows} rows on your side (${p === 0 ? 'bottom' : 'top'}).`,
        `You have ${mine} left to place; ${PLAYER_NAMES[other(p)]} has ${theirs}.`,
      ],
      color: HANDOFF_BG[p],
      tapText: 'Tap to continue',
    });
  }

  private async turnHandoff(player: PlayerId, round: number, events: GameEvent[], before: GameState): Promise<void> {
    const lines: string[] = [];
    for (const e of events) if (e.type === 'overwatch') lines.push(overwatchText(before, e));
    if (before.phase === 'play' && before.current === player) {
      lines.push(`${PLAYER_NAMES[player]} goes again: turn order flips this round.`);
    }
    const scored = events.find((e) => e.type === 'roundScored');
    if (scored && scored.type === 'roundScored') {
      const [a, b] = scored.counts;
      lines.push(
        scored.scorer === null
          ? `Round ${scored.round}: no points (${a}–${b} on the control point).`
          : `Round ${scored.round}: ${PLAYER_NAMES[scored.scorer]} scores! (${a}–${b} on the control point)`,
      );
      lines.push(`Score: ${this.state.scores[0]} – ${this.state.scores[1]}`);
    }
    lines.push(`Round ${round}, turn ${this.state.turnInRound + 1} of 2.`);
    await showOverlay({
      title: `${PLAYER_NAMES[player]}'s turn`,
      lines,
      color: HANDOFF_BG[player],
      tapText: 'Tap to roll dice',
    });
  }

  private async gameOverScreen(winner: PlayerId | null, reason: WinReason): Promise<void> {
    const reasons: Record<WinReason, string> = {
      points: `Reached ${this.state.config.pointsToWin} points (${this.state.scores[0]} – ${this.state.scores[1]}).`,
      elimination: 'Every enemy model was eliminated.',
      draw: 'Both armies were wiped out at the same time.',
    };
    await showOverlay({
      title: winner === null ? 'Draw!' : `${PLAYER_NAMES[winner]} wins!`,
      lines: [reasons[reason]],
      color: winner === null ? NEUTRAL_BG : HANDOFF_BG[winner],
      buttons: [
        { label: 'New game', className: 'primary', onClick: () => void this.start(randomSeed()) },
        { label: 'View board', onClick: () => this.render() },
      ],
    });
  }

  private openMenu(): void {
    if (this.busy) return;
    void showOverlay({
      title: 'HexHunters',
      lines: [`Map seed: ${this.state.seed}`],
      buttons: [
        { label: 'Resume', className: 'primary', onClick: () => {} },
        { label: 'New game (new map)', className: 'danger', onClick: () => void this.start(randomSeed()) },
        { label: 'Restart (same map)', onClick: () => void this.start(this.state.seed) },
      ],
    });
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
    this.ui.selectedId = id;
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
    const sel = this.selected();
    const unit = sel && sel.owner === s.current && !sel.pos ? sel : unplacedUnits(s, s.current)[0];
    if (unit) void this.dispatch({ type: 'place', unitId: unit.id, hex });
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
      watch: new Map(),
    };
    // Overwatch areas are always shown, to both players.
    for (const u of s.units) for (const h of u.overwatch?.hexes ?? []) o.watch.set(hexKey(h), u.owner);

    if (s.phase === 'deploy') {
      for (const h of s.map.deployZones[s.current]) {
        if (!unitAt(s, h)) o.shade.set(hexKey(h), `deploy-${s.current}`);
      }
      return o;
    }

    const sel = this.selected();
    if (!sel?.pos) return o;

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
        if (hexDistance(h, sel.pos) <= def.range) o.shade.set(key, 'range');
        continue;
      }
      let hiddenFor = 0;
      for (const size of [1, 2, 3]) {
        if (canSeeHex(s, sel, h, size)) break;
        hiddenFor = size;
      }
      if (hiddenFor > 0) o.shade.set(key, `hide-${hiddenFor}`);
      else if (hexDistance(h, sel.pos) <= def.range) o.shade.set(key, 'range');
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
    const choices = specialChoices(s, unit);
    if (targetsUnit(sp.targeting)) {
      for (const t of specialTargets(s, unit)) o.specialTargetIds.add(t.id);
      // Specials that move their target (Hook, Shove): mark where each one would land.
      for (const c of choices) {
        for (const a of previewSpecial(s, unit, c)?.area ?? []) if (a.kind === 'landing') o.shade.set(hexKey(a.hex), 'option');
      }
    } else if (sp.targeting === 'hex') {
      for (const c of choices) o.shade.set(hexKey(c.hex!), 'option');
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
          owner: u.owner,
          die: u.die,
          hp: u.hp,
          maxHp: def.health,
          spent: s.phase === 'play' && u.acted && u.movesLeft === 0,
          selected: u.id === this.ui.selectedId,
          note: s.phase === 'deploy' ? def.name : undefined,
        });
      }
    }

    if (sel) {
      const def = unitDef(s, sel);
      const defense = effectiveDefense(s, sel);
      const ownTurn = s.phase === 'play' && sel.owner === s.current;
      const stats: [string, string][] = [
        ['HP', `${sel.hp}/${def.health}`],
        ['Def', defense === def.defense ? `${defense}` : `${defense} (braced)`],
        ['Range', def.range === 1 ? '1 (melee)' : def.indirectFire ? `${def.range} (indirect)` : `${def.range}`],
        ['Dmg', `${def.damage}`],
        ['Move', `${ownTurn ? `${sel.movesLeft}/` : ''}${unitSpeed(s, sel)} ${moveNote(s, sel)}`.trim()],
      ];
      if (def.hitBonus) stats.push(['Hit', `+${def.hitBonus}`]);
      if (def.needsLoading) stats.push(['Shell', needsLoading(s, sel) ? (sel.loaded ? 'LOADED' : 'empty') : 'no Load needed']);
      for (const aura of aurasOn(s, sel)) {
        stats.push(['Aura', `${heroName(s.config, aura)} ${AURAS[aura].short(s.config.specials)}`]);
      }
      if (sel.overwatch) stats.push(['Overwatch', `die ${sel.overwatch.die}, ${sel.overwatch.hexes.length} hexes`]);
      if (sel.die !== null) {
        const prep = sel.dieBonus ? ` (${sel.die - sel.dieBonus}+${sel.dieBonus} bonus)` : '';
        stats.unshift(['Die', `${sel.die}${prep}${sel.acted ? ' used' : ''}`]);
      }
      if (sel.prepped) stats.push(['Prepped', `+${s.config.specials.prepRollBonus} next roll`]);
      if (sel.spottedBy !== null) stats.push(['', 'Spotted']);
      const sp = specialOf(s, sel);
      model.info = {
        title: `${PLAYER_NAMES[sel.owner]} ${def.hero ? 'HERO ' : ''}${def.name} (${SIZE_NAMES[def.size]})`,
        owner: sel.owner,
        stats,
        special: def.hero
          ? `Hero aura (lasts all game): ${AURAS[def.hero.aura].describe(s.config.specials)}`
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
    model.hint =
      `Tap a highlighted hex to place your ${next ? unitDef(s, next).name : 'model'} (or pick a different model above). ` +
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
        return e.hit ? `${name}: HIT −${e.damage} (${vs})${dies}${friendly}` : `${name}: miss (${vs})${friendly}`;
      })
      .join(' · ');
  }

  private unitActions(unit: Unit, model: PanelModel): void {
    const s = this.state;
    const sp = specialOf(s, unit);
    const id = specialIdOf(s, unit);
    const actions: PanelAction[] = [];
    const cancel = { label: 'Cancel', onClick: () => this.selectUnit(unit.id) };

    if (this.ui.specialMode && sp) {
      const choice = this.ui.pendingChoice;
      if (choice) {
        const preview = previewSpecial(s, unit, choice);
        const effects = preview?.effects ?? [];
        let detail = '';
        if (id === 'heal') {
          const t = getUnit(s, choice.targetId!)!;
          detail = ` +${Math.min(healAmount(s, unit.die!), unitDef(s, t).health - t.hp)} HP`;
        }
        if (targetsUnit(sp.targeting)) {
          detail = ` ${unitDef(s, getUnit(s, choice.targetId!)!).name}${detail}`;
        }
        if (id === 'grenade' || id === 'torch' || id === 'sweep') {
          const friendlyHit = effects.some((e) => getUnit(s, e.unitId)?.owner === unit.owner && e.damage > 0);
          model.preview = { text: this.effectsText(s, unit.owner, effects, true), good: !friendlyHit };
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
        } else if (id === 'vault') {
          model.preview = { text: `Land here, then keep moving (${unit.movesLeft} left).`, good: true };
        } else if (id === 'overwatch') {
          const n = preview?.area.length ?? 0;
          model.preview = {
            text: `Watch ${n} hexes with a locked ${unit.die}. At the end of the opponent's turn, fire at an enemy still in the area.`,
            good: true,
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
      const mods = `${p.hitBonus ? ` +${p.hitBonus}` : ''}${p.spotBonus ? ` +${p.spotBonus} spot` : ''}`;
      model.preview = {
        text: `Roll ${p.roll}${mods} vs defense ${p.defense}: ${p.hit ? `HIT for ${p.damage}` : 'MISS'}`,
        good: p.hit,
      };
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
    if (canAct(s, unit)) {
      if (needsLoading(s, unit) && !unit.loaded) {
        actions.push({ label: `${attackName(s, unit)} (load first)`, disabled: true, onClick: () => {} });
      } else {
        hints.push(`tap a red-ringed enemy to ${attackName(s, unit).toLowerCase()}`);
      }
    }
    // Heroes have no special: their die is only for attacking.
    if (canAct(s, unit) && sp) {
      const reason = specialBlockedReason(s, unit);
      const noTargets = sp.targeting !== 'none' && !reason && specialChoices(s, unit).length === 0;
      let label = sp.name;
      if (reason) label += ` (${reason})`;
      else if (noTargets) label += ' (no targets)';
      else if (id === 'dash') label += ` (+${dashAmount(s, unit.die!)})`;
      else if (id === 'heal') label += ` (+${healAmount(s, unit.die!)})`;
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
    model.hint = hints.length ? `${hints.join(', ')}.` : '';
    model.hint = model.hint.charAt(0).toUpperCase() + model.hint.slice(1);
    model.actions.push(...actions);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
function moveNote(state: GameState, unit: Unit): string {
  const base = unitDef(state, unit).speed;
  const bonus = unitSpeed(state, unit) - base;
  return bonus ? `(${speedName(base)} +${bonus})` : speedName(base);
}
