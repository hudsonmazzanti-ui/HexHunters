/**
 * DOM HUD: the top bar (scores, whose turn) and the bottom panel (roster of
 * models with dice and health, selected-model info, hint text, action buttons).
 * The controller builds a plain PanelModel; this module only draws it.
 */
import type { GameState } from '../core/types';

export const PLAYER_COLORS = ['#3b82f6', '#ef4444'] as const;
export const PLAYER_NAMES = ['Player 1', 'Player 2'] as const;

export interface RosterChip {
  id: string;
  label: string;
  owner: 0 | 1;
  die: number | null;
  hp: number;
  maxHp: number;
  spent: boolean;
  selected: boolean;
  /** Extra text, e.g. "not placed". */
  note?: string;
}

export interface PanelAction {
  label: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface PanelModel {
  roster: RosterChip[];
  info?: { title: string; owner: 0 | 1; stats: [string, string][]; special: string };
  hint: string;
  hintWarn?: boolean;
  /** HTML for an extra line under the hint (e.g. attack preview). */
  preview?: { text: string; good: boolean };
  actions: PanelAction[];
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function renderTopBar(state: GameState): void {
  const bar = document.getElementById('topbar')!;
  const score = (p: 0 | 1) => {
    const div = h('div', `score${p === 1 ? ' right' : ''}`);
    const dot = h('span', 'dot');
    dot.style.background = PLAYER_COLORS[p];
    const pts = h('span', 'pts', String(state.scores[p]));
    const of = h('span', 'of', `/${state.config.pointsToWin}`);
    if (p === 0) div.append(dot, pts, of);
    else div.append(pts, of, dot);
    return div;
  };

  const label = h('div', 'turn-label');
  const who = h('div', 'who');
  const sub = h('div', 'round');
  if (state.phase === 'deploy') {
    who.textContent = `${PLAYER_NAMES[state.current]} deploys`;
    sub.textContent = 'Setup';
  } else if (state.phase === 'over') {
    who.textContent = `${PLAYER_NAMES[state.winner!]} wins!`;
    sub.textContent = `Round ${state.round}`;
  } else {
    who.textContent = `${PLAYER_NAMES[state.current]}'s turn`;
    sub.textContent = `Round ${state.round} · turn ${state.turnInRound + 1}/2`;
  }
  who.style.color = PLAYER_COLORS[state.phase === 'over' ? state.winner! : state.current];
  label.append(who, sub);

  bar.style.setProperty('--turn-color', PLAYER_COLORS[state.phase === 'over' ? state.winner! : state.current]);
  bar.replaceChildren(score(0), label, score(1));
}

export function renderPanel(model: PanelModel, onChip: (id: string) => void): void {
  const panel = document.getElementById('panel')!;
  const parts: HTMLElement[] = [];

  if (model.roster.length) {
    const roster = h('div', 'roster');
    for (const c of model.roster) {
      const chip = h('button', `chip${c.selected ? ' selected' : ''}${c.spent ? ' spent' : ''}`);
      const tag = h('span', 'tag', c.label);
      tag.style.background = PLAYER_COLORS[c.owner];
      chip.append(tag);
      if (c.die !== null) chip.append(h('span', 'd', String(c.die)));
      chip.append(h('span', 'h', c.note ?? `♥${c.hp}`));
      chip.onclick = () => onChip(c.id);
      roster.append(chip);
    }
    parts.push(roster);
  }

  if (model.info) {
    const info = h('div', 'info');
    const title = h('div', 'title', model.info.title);
    title.style.color = PLAYER_COLORS[model.info.owner];
    const stats = h('div', 'stats');
    for (const [k, v] of model.info.stats) {
      const s = h('span', '', `${k} `);
      s.append(h('b', '', v));
      stats.append(s);
    }
    info.append(title, stats, h('div', '', model.info.special));
    parts.push(info);
  }

  if (model.preview) {
    parts.push(h('div', model.preview.good ? 'result-hit' : 'result-miss', model.preview.text));
  }
  if (model.hint) parts.push(h('div', `hint${model.hintWarn ? ' warn' : ''}`, model.hint));

  const actions = h('div', 'actions');
  for (const a of model.actions) {
    const btn = h('button', a.className ?? '', a.label);
    btn.disabled = !!a.disabled;
    btn.onclick = a.onClick;
    actions.append(btn);
  }
  parts.push(actions);

  panel.replaceChildren(...parts);
}
