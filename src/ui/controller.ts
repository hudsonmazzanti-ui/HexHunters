/**
 * Glue between the pure game logic and the screen. Holds the current GameState
 * plus UI-only state (what's selected), turns taps into Actions, plays the
 * resulting events as animations, and re-renders.
 */
import { previewAttack } from '../core/combat';
import { type Action, type GameEvent, RuleError, applyAction, canUndoMove, isInDeployZone, newGame } from '../core/game';
import { type Hex, type Point, hexDistance, hexKey, hexagon, pixelToHex } from '../core/hex';
import {
  canAct,
  canSeeHex,
  effectiveDefense,
  getUnit,
  livingUnits,
  moveReach,
  onBoard,
  terrainHeight,
  unitAt,
  unitDef,
} from '../core/queries';
import { SPECIAL_TARGET, dashAmount, healAmount, specialBlockedReason, specialOf, specialTargets } from '../core/specials';
import type { GameConfig, GameState, PlayerId, Unit } from '../core/types';
import { randomSeed } from '../core/rng';
import { SPECIAL_INFO } from '../data/config';
import { BoardView, type BoardOverlay, HEX_SIZE } from './board';
import { Camera } from './camera';
import { PLAYER_COLORS, PLAYER_NAMES, type PanelAction, type PanelModel, renderPanel, renderTopBar } from './hud';
import { showOverlay } from './overlay';

// Opaque, so the next player's freshly rolled dice aren't visible before the roll animation.
const HANDOFF_BG = ['#172e5c', '#5c1717'];

interface UiState {
  selectedId: string | null;
  /** Enemy/ally chosen as the target of an attack or special, awaiting confirmation. */
  pendingTargetId: string | null;
  /** True while choosing a target for the selected unit's special action. */
  specialMode: boolean;
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
    return { selectedId: null, pendingTargetId: null, specialMode: false, confirmEndTurn: false, message: null };
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
    await this.deployHandoff();
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
        case 'special': {
          const unit = getUnit(before, ev.unitId)!;
          const target = ev.targetId ? getUnit(before, ev.targetId) : undefined;
          const name = SPECIAL_INFO[ev.special].name;
          const texts: Record<string, string> = {
            brace: 'BRACED',
            prep: 'PREPPED',
            dash: `DASH +${ev.amount}`,
            heal: `+${ev.amount}`,
            spot: 'SPOTTED',
            shove: 'SHOVED',
          };
          this.board.floatText((target ?? unit).pos!, texts[ev.special], '#c4b5fd');
          if (ev.special === 'shove') {
            this.render();
            await this.board.animateMove(ev.targetId!, [ev.to!]);
          }
          this.ui.message = `${unitDef(before, unit).name} used ${name}.`;
          break;
        }
        case 'roundScored':
          // Shown on the next handoff screen.
          break;
        case 'turnStart':
          this.ui = this.freshUi();
          this.render();
          await this.turnHandoff(ev.player, ev.round, events);
          await this.board.rollDice(ev.dice, this.state.config.dieSides);
          break;
        case 'gameOver':
          this.render();
          await this.gameOverScreen(ev.winner, ev.reason);
          break;
      }
    }
  }

  // ---------- Overlays ----------

  private async deployHandoff(): Promise<void> {
    const p = this.state.current;
    const rows = this.state.config.deployRows;
    await showOverlay({
      title: `${PLAYER_NAMES[p]}: deploy`,
      lines: [
        `Place your models anywhere in the back ${rows} rows on your side (${p === 0 ? 'bottom' : 'top'}).`,
        p === 1 ? 'Player 1, look away!' : 'Hand the device to Player 1.',
      ],
      color: HANDOFF_BG[p],
      tapText: 'Tap to start',
    });
  }

  private async turnHandoff(player: PlayerId, round: number, events: GameEvent[]): Promise<void> {
    const lines: string[] = [];
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

  private async gameOverScreen(winner: PlayerId, reason: 'points' | 'elimination'): Promise<void> {
    await showOverlay({
      title: `${PLAYER_NAMES[winner]} wins!`,
      lines: [
        reason === 'points'
          ? `Reached ${this.state.config.pointsToWin} points (${this.state.scores[0]} – ${this.state.scores[1]}).`
          : 'Every enemy model was eliminated.',
      ],
      color: HANDOFF_BG[winner],
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
    this.ui.selectedId = null;
    this.ui.pendingTargetId = null;
    this.ui.specialMode = false;
    this.ui.message = null;
    this.render();
  }

  private selectUnit(id: string | null): void {
    this.ui.selectedId = id;
    this.ui.pendingTargetId = null;
    this.ui.specialMode = false;
    this.ui.message = null;
    this.render();
  }

  private selected(): Unit | undefined {
    return this.ui.selectedId ? getUnit(this.state, this.ui.selectedId) : undefined;
  }

  private onDeployTap(hex: Hex): void {
    const s = this.state;
    const occupant = unitAt(s, hex);
    if (occupant) {
      this.selectUnit(occupant.owner === s.current ? occupant.id : null);
      return;
    }
    if (!isInDeployZone(s, s.current, hex)) {
      this.ui.message = 'Place models in your highlighted zone.';
      this.render();
      return;
    }
    const unit = this.selected() ?? s.units.find((u) => u.owner === s.current && !u.pos);
    if (!unit || unit.owner !== s.current) return;
    void this.dispatch({ type: 'place', unitId: unit.id, hex }).then((ok) => {
      if (!ok) return;
      // Move on to the next model that still needs placing.
      const next = this.state.units.find((u) => u.owner === this.state.current && !u.pos);
      this.selectUnit(next?.id ?? null);
    });
  }

  private async onPlayTap(hex: Hex): Promise<void> {
    const s = this.state;
    const occupant = unitAt(s, hex);
    const sel = this.selected();
    const mine = sel && sel.owner === s.current ? sel : undefined;

    if (this.ui.specialMode && mine) {
      if (occupant && specialTargets(s, mine).some((t) => t.id === occupant.id)) {
        this.ui.pendingTargetId = occupant.id;
        this.render();
        return;
      }
      if (!occupant) {
        this.ui.specialMode = false;
        this.ui.pendingTargetId = null;
        this.render();
        return;
      }
    }

    if (mine && occupant && occupant.owner !== s.current && canAct(s, mine) && !this.ui.specialMode) {
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
      pendingTargetId: this.ui.pendingTargetId,
    };

    if (s.phase === 'deploy') {
      for (const h of s.map.deployZones[s.current]) {
        if (!unitAt(s, h)) o.shade.set(hexKey(h), `deploy-${s.current}`);
      }
      return o;
    }

    const sel = this.selected();
    if (!sel?.pos) return o;
    const def = unitDef(s, sel);

    // Shade by visibility: darker means even bigger models would be hidden there.
    for (const h of hexagon(s.map.radius)) {
      if (terrainHeight(s, h) > 0 || hexDistance(h, sel.pos) === 0) continue;
      const key = hexKey(h);
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
      if (this.ui.specialMode) {
        for (const t of specialTargets(s, sel)) o.specialTargetIds.add(t.id);
      } else {
        for (const enemy of livingUnits(s, sel.owner === 0 ? 1 : 0)) {
          if (!previewAttack(s, sel, enemy).blockedReason) o.targetIds.add(enemy.id);
        }
      }
    }
    return o;
  }

  private panelModel(): PanelModel {
    const s = this.state;
    const sel = this.selected();
    const model: PanelModel = { roster: [], hint: '', actions: [] };

    // Roster: the active player's models (during play/deploy).
    const rosterOwner = s.phase === 'over' ? null : s.current;
    if (rosterOwner !== null) {
      for (const u of s.units.filter((u) => u.owner === rosterOwner && (u.pos || s.phase === 'deploy'))) {
        const def = unitDef(s, u);
        model.roster.push({
          id: u.id,
          label: def.label,
          owner: u.owner,
          die: u.die,
          hp: u.hp,
          maxHp: def.health,
          spent: s.phase === 'deploy' ? !!u.pos : s.phase === 'play' && u.acted && u.movesLeft === 0,
          selected: u.id === this.ui.selectedId,
          note: s.phase === 'deploy' ? (u.pos ? `${def.name} ✓` : def.name) : undefined,
        });
      }
    }

    if (sel) {
      const def = unitDef(s, sel);
      const defense = effectiveDefense(s, sel);
      const stats: [string, string][] = [
        ['HP', `${sel.hp}/${def.health}`],
        ['Def', defense === def.defense ? `${defense}` : `${defense} (braced)`],
        ['Range', `${def.range}`],
        ['Dmg', `${def.damage}`],
        ['Move', s.phase === 'play' && sel.owner === s.current ? `${sel.movesLeft}/${def.speed}` : `${def.speed}`],
      ];
      if (sel.die !== null) {
        const prep = sel.dieBonus ? ` (${sel.die - sel.dieBonus}+${sel.dieBonus} prep)` : '';
        stats.unshift(['Die', `${sel.die}${prep}${sel.acted ? ' used' : ''}`]);
      }
      if (sel.prepped) stats.push(['Prepped', `+${s.config.specials.prepRollBonus} next roll`]);
      if (sel.spottedBy !== null) stats.push(['', 'Spotted']);
      const sp = SPECIAL_INFO[def.special];
      model.info = {
        title: `${PLAYER_NAMES[sel.owner]} ${def.name} (${['', 'small', 'medium', 'large'][def.size]})`,
        owner: sel.owner, stats, special: `${sp.name}: ${sp.text}` };
    }

    if (s.phase === 'deploy') this.deployPanel(model);
    else if (s.phase === 'play') this.playPanel(model);
    else {
      model.hint = `${PLAYER_NAMES[s.winner!]} won. Tap models to inspect.`;
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
    const remaining = s.units.filter((u) => u.owner === s.current && !u.pos).length;
    model.hint = remaining
      ? `Tap a highlighted hex to place the selected model (${remaining} left). Tap a placed model, then a hex, to move it.`
      : 'All models placed. Tap Done when ready.';
    model.actions.push({ label: 'Auto-place', onClick: () => void this.dispatch({ type: 'autoDeploy' }) });
    model.actions.push({
      label: 'Done',
      className: 'primary',
      disabled: remaining > 0,
      onClick: async () => {
        const wasFirst = s.current === 0;
        this.ui = this.freshUi();
        if (wasFirst) {
          if (await this.dispatch({ type: 'finishDeploy' })) await this.deployHandoff();
        } else {
          await this.dispatch({ type: 'finishDeploy' });
        }
      },
    });
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

  private unitActions(unit: Unit, model: PanelModel): void {
    const s = this.state;
    const special = specialOf(s, unit);
    const sp = SPECIAL_INFO[special];
    const targetKind = SPECIAL_TARGET[special];
    const pending = this.ui.pendingTargetId ? getUnit(s, this.ui.pendingTargetId) : undefined;
    const actions: PanelAction[] = [];

    if (this.ui.specialMode) {
      if (pending) {
        const reason = specialBlockedReason(s, unit, pending);
        const pDef = unitDef(s, pending);
        const detail =
          special === 'heal' ? ` (+${Math.min(healAmount(s, unit.die!), pDef.health - pending.hp)} HP)` : '';
        actions.push({
          label: `${sp.name} ${pDef.name}${detail}`,
          className: 'primary',
          disabled: !!reason,
          onClick: () => void this.dispatch({ type: 'special', unitId: unit.id, targetId: pending.id }),
        });
        model.hint = `Confirm ${sp.name} on ${pDef.name}, or tap another target.`;
      } else {
        const n = specialTargets(s, unit).length;
        model.hint = n ? `Tap a purple-ringed model to ${sp.name}.` : `No valid ${sp.name} targets.`;
        model.hintWarn = n === 0;
      }
      actions.push({ label: 'Cancel', onClick: () => this.selectUnit(unit.id) });
      model.actions.push(...actions);
      return;
    }

    if (pending) {
      const p = previewAttack(s, unit, pending);
      const pDef = unitDef(s, pending);
      model.preview = {
        text: `Roll ${p.roll}${p.bonus ? ` +${p.bonus} spot` : ''} vs defense ${p.defense}: ${p.hit ? `HIT for ${p.damage}` : 'MISS'}`,
        good: p.hit,
      };
      actions.push({
        label: `Attack ${pDef.name}`,
        className: 'primary',
        onClick: () => void this.dispatch({ type: 'attack', unitId: unit.id, targetId: pending.id }),
      });
      actions.push({ label: 'Cancel', onClick: () => this.selectUnit(unit.id) });
      model.actions.push(...actions);
      return;
    }

    const hints: string[] = [];
    if (unit.movesLeft > 0) hints.push('Tap a green dot to move');
    if (canAct(s, unit)) {
      hints.push('tap a red-ringed enemy to attack');
      const reason = targetKind === 'none' ? specialBlockedReason(s, unit) : null;
      let label = sp.name;
      if (special === 'dash') label += ` (+${dashAmount(s, unit.die!)})`;
      if (special === 'heal') label += ` (+${healAmount(s, unit.die!)})`;
      actions.push({
        label,
        disabled: !!reason || (targetKind !== 'none' && specialTargets(s, unit).length === 0),
        onClick: () => {
          if (targetKind === 'none') {
            void this.dispatch({ type: 'special', unitId: unit.id });
          } else {
            this.ui.specialMode = true;
            this.ui.pendingTargetId = null;
            this.render();
          }
        },
      });
    } else if (unit.acted) {
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
