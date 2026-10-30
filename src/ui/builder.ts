/**
 * Army builder: a full-screen list of every unit in the roster with its cost,
 * stats and special. Tap + / − to add or remove; Confirm is blocked while the
 * army is empty or over the point limit. Resolves with the chosen unit type ids.
 */
import { armyCost, validateArmy } from '../core/army';
import { SPECIALS } from '../core/specials';
import type { GameConfig, PlayerId } from '../core/types';
import { speedName } from '../data/config';
import { PLAYER_COLORS, PLAYER_NAMES } from './hud';

const SIZE_NAMES = ['', 'small', 'medium', 'large'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function showBuilder(config: GameConfig, player: PlayerId): Promise<string[]> {
  const army: string[] = [];
  const types = Object.keys(config.units).sort(
    (a, b) => config.units[a].cost - config.units[b].cost || config.units[a].name.localeCompare(config.units[b].name),
  );

  const root = h('div', 'builder');
  root.style.setProperty('--player', PLAYER_COLORS[player]);
  document.body.append(root);

  return new Promise((resolve) => {
    const render = () => {
      const cost = armyCost(config, army);
      const limit = config.armyPointLimit;
      const over = cost > limit;
      const reason = validateArmy(config, army);

      const header = h('div', 'builder-header');
      const title = h('div', 'builder-title', `${PLAYER_NAMES[player]}: build your army`);
      const points = h('div', `builder-points${over ? ' over' : ''}`, `${cost} / ${limit} pts`);
      const bar = h('div', 'builder-bar');
      const fill = h('div', 'builder-bar-fill');
      fill.style.width = `${Math.min(100, (cost / limit) * 100)}%`;
      bar.append(fill);
      const summary = h('div', 'builder-summary');
      if (!army.length) summary.append(h('span', 'builder-empty', 'No units yet: tap + to add.'));
      army.forEach((t, i) => {
        const chip = h('button', 'builder-chip', `${config.units[t].name} ✕`);
        chip.onclick = () => {
          army.splice(i, 1);
          render();
        };
        summary.append(chip);
      });
      header.append(title, points, bar, summary);

      const list = h('div', 'builder-list');
      for (const t of types) {
        const def = config.units[t];
        const sp = SPECIALS[def.special];
        const count = army.filter((x) => x === t).length;
        const card = h('div', `unit-card${count ? ' picked' : ''}`);

        const top = h('div', 'unit-card-top');
        const tag = h('span', 'unit-tag', def.label);
        const name = h('span', 'unit-name', def.name);
        const costBadge = h('span', 'unit-cost', `${def.cost} pt${def.cost === 1 ? '' : 's'}`);
        top.append(tag, name, costBadge);

        const stats = h('div', 'unit-stats');
        const statList: [string, string][] = [
          ['Size', SIZE_NAMES[def.size]],
          ['Move', `${def.speed} ${speedName(def.speed)}`.trim()],
          ['Def', `${def.defense}`],
          ['HP', `${def.health}`],
          ['Range', def.range === 1 ? '1 (melee)' : `${def.range}`],
          ['Dmg', `${def.damage}`],
        ];
        if (def.hitBonus) statList.push(['Hit', `+${def.hitBonus}`]);
        for (const [k, v] of statList) {
          const s = h('span', '', `${k} `);
          s.append(h('b', '', v));
          stats.append(s);
        }

        const special = h('div', 'unit-special');
        special.append(h('b', '', `${sp.name}: `), document.createTextNode(sp.describe(config.specials)));
        // Callouts: the unit's attack quirks, then the special's.
        const callouts = [
          ...(def.indirectFire ? ['Indirect fire: ignores line of sight'] : []),
          ...(def.needsLoading ? [`Must Load to ${(def.attackName ?? 'attack').toLowerCase()}`] : []),
          ...(sp.tags ?? []),
        ];
        const tags = h('div', 'unit-tags');
        for (const t of callouts) tags.append(h('span', 'unit-pill', t));

        const controls = h('div', 'unit-controls');
        const minus = h('button', 'step', '−');
        minus.disabled = count === 0;
        minus.onclick = () => {
          army.splice(army.lastIndexOf(t), 1);
          render();
        };
        const plus = h('button', 'step', '+');
        plus.onclick = () => {
          army.push(t);
          render();
        };
        controls.append(minus, h('span', 'unit-count', String(count)), plus);

        card.append(top, stats, special);
        if (callouts.length) card.append(tags);
        card.append(controls);
        list.append(card);
      }

      const footer = h('div', 'builder-footer');
      const msg = h('div', `builder-msg${over ? ' over' : ''}`, reason ?? `${army.length} model${army.length === 1 ? '' : 's'} ready.`);
      const clear = h('button', '', 'Clear');
      clear.disabled = army.length === 0;
      clear.onclick = () => {
        army.length = 0;
        render();
      };
      const confirm = h('button', 'primary', 'Confirm army');
      confirm.disabled = reason !== null;
      confirm.onclick = () => {
        root.remove();
        resolve([...army]);
      };
      footer.append(msg, clear, confirm);

      // Keep the scroll position of the unit list across re-renders.
      const scroll = root.querySelector('.builder-list')?.scrollTop ?? 0;
      root.replaceChildren(header, list, footer);
      list.scrollTop = scroll;
    };
    render();
  });
}
