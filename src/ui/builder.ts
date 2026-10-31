/**
 * Army builder: a full-screen list of every unit in the roster with its cost,
 * stats and special. Tap + / − to add or remove; Confirm is blocked while the
 * army is empty or over the point limit. Resolves with the chosen unit type ids.
 */
import { armyCost, entryModels, entryName, validateArmy } from '../core/army';
import { AURAS } from '../core/auras';
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
  // Heroes first (their own section), then regular units; each by cost, then name.
  const types = Object.keys(config.units)
    .filter((t) => !config.units[t].squadOnly && !config.units[t].formOnly) // squad members / alternate forms
    .sort(
    (a, b) =>
      Number(!!config.units[b].hero) - Number(!!config.units[a].hero) ||
      config.units[a].cost - config.units[b].cost ||
      config.units[a].name.localeCompare(config.units[b].name),
  );

  const root = h('div', 'builder');
  root.style.setProperty('--player', PLAYER_COLORS[player]);
  document.body.append(root);

  return new Promise((resolve) => {
    /** One card for a squad (the Twins): both models' stats and their shared special. */
    const squadCard = (id: string): HTMLElement => {
      const squad = config.squads[id];
      const count = army.filter((x) => x === id).length;
      const card = h('div', `unit-card hero${count ? ' picked' : ''}`);
      const top = h('div', 'unit-card-top');
      top.append(
        h('span', 'unit-tag', 'TT'),
        h('span', 'unit-name', squad.name),
        ...(squad.hero ? [h('span', 'hero-badge', 'HERO')] : []),
        h('span', 'unit-cost', `${squad.cost} pts`),
      );
      card.append(top, h('div', 'unit-special', `Adds ${squad.members.length} linked models. They can't be bought separately.`));
      const specials = new Set<string>();
      for (const m of squad.members) {
        const def = config.units[m];
        const stats = h('div', 'unit-stats');
        stats.append(h('b', '', `${def.name}: `));
        const list: [string, string][] = [
          ['Size', SIZE_NAMES[def.size]],
          ['Move', `${def.speed}`],
          ['Def', `${def.defense}`],
          ['HP', `${def.health}`],
          ['Range', def.range === 1 ? '1 (melee)' : `${def.range}`],
          ['Dmg', `${def.damage}`],
        ];
        for (const [k, v] of list) {
          const sEl = h('span', '', `${k} `);
          sEl.append(h('b', '', v));
          stats.append(sEl);
        }
        card.append(stats);
        if (def.special) specials.add(def.special);
      }
      for (const sid of specials) {
        const sp = SPECIALS[sid as keyof typeof SPECIALS];
        const special = h('div', 'unit-special');
        special.append(h('b', '', `${sp.name}: `), document.createTextNode(sp.describe(config.specials)));
        card.append(special);
        const tags = h('div', 'unit-tags');
        for (const t of ['No passive rule', ...(sp.tags ?? [])]) tags.append(h('span', 'unit-pill', t));
        card.append(tags);
      }
      const controls = h('div', 'unit-controls');
      const minus = h('button', 'step', '−');
      minus.disabled = count === 0;
      minus.onclick = () => {
        army.splice(army.lastIndexOf(id), 1);
        render();
      };
      const plus = h('button', 'step', '+');
      plus.onclick = () => {
        army.push(id);
        render();
      };
      controls.append(minus, h('span', 'unit-count', String(count)), plus);
      card.append(controls);
      return card;
    };

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
        const chip = h('button', 'builder-chip', `${entryName(config, t)} ✕`);
        chip.onclick = () => {
          army.splice(i, 1);
          render();
        };
        summary.append(chip);
      });
      header.append(title, points, bar, summary);

      const list = h('div', 'builder-list');
      let section: 'hero' | 'unit' | null = null;
      for (const t of types) {
        const def = config.units[t];
        const sp = def.special ? SPECIALS[def.special] : undefined;
        const count = army.filter((x) => x === t).length;

        const kind = def.hero ? 'hero' : 'unit';
        if (kind !== section) {
          section = kind;
          const max = config.maxHeroesPerArmy;
          list.append(h('div', 'builder-section', kind === 'hero' ? `Heroes (max ${max} per army, optional)` : 'Units'));
          // Squads that count as a hero (the Twins) go first in the Heroes section.
          if (kind === 'hero') {
            for (const id of Object.keys(config.squads)) if (config.squads[id].hero) list.append(squadCard(id));
          }
        }

        const card = h('div', `unit-card${count ? ' picked' : ''}${def.hero ? ' hero' : ''}`);
        const top = h('div', 'unit-card-top');
        const tag = h('span', 'unit-tag', def.label);
        const name = h('span', 'unit-name', def.name);
        const costBadge = h('span', 'unit-cost', `${def.cost} pt${def.cost === 1 ? '' : 's'}`);
        top.append(tag, name);
        if (def.hero) top.append(h('span', 'hero-badge', 'HERO'));
        top.append(costBadge);

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
        if (def.hero?.aura) {
          const aura = AURAS[def.hero.aura].describe(config.specials);
          special.append(h('b', '', 'Passive (whole army): '), document.createTextNode(aura));
        } else if (sp) {
          special.append(h('b', '', `${sp.name}: `), document.createTextNode(sp.describe(config.specials)));
        } else if (def.transformsInto) {
          // No special until it transforms; show the beast form's special.
          const beastSp = config.units[def.transformsInto.type].special;
          if (beastSp) {
            const bsp = SPECIALS[beastSp];
            special.append(h('b', '', `${bsp.name} (after transforming): `), document.createTextNode(bsp.describe(config.specials)));
          }
        }
        // Callouts: hero rules, the unit's attack quirks, then the special's.
        const callouts = [
          ...(def.hero ? ['Lasts all game, even if the hero dies', 'No special: die is for attacking'] : []),
          ...(def.indirectFire ? ['Indirect fire: ignores line of sight'] : []),
          ...(def.needsLoading ? [`Must Load to ${(def.attackName ?? 'attack').toLowerCase()}`] : []),
          ...(def.woundedForm ? ['Crawls when first hurt: small, speed 1, for good'] : []),
          ...(def.restsOnDoubleTurn ? ['Rests on back-to-back turns'] : []),
          ...(def.transformsInto ? [transformText(config, def.transformsInto)] : []),
          ...(!def.hero && !sp && !def.transformsInto ? ['No special'] : []),
          ...(sp?.tags ?? []),
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
      const models = army.reduce((n, t) => n + entryModels(config, t).length, 0);
      const msg = h('div', `builder-msg${over ? ' over' : ''}`, reason ?? `${models} model${models === 1 ? '' : 's'} ready.`);
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

/** "On your 3rd turn becomes Werewolf (Beast): large, move 4, def 6, HP 12, melee 5, Pounce (+5 HP)". */
function transformText(config: GameConfig, t: { type: string; onOwnerTurn: number; heal: number }): string {
  const f = config.units[t.type];
  const special = f.special ? `, ${SPECIALS[f.special].name}` : '';
  const range = f.range === 1 ? 'melee' : `range ${f.range},`;
  return (
    `On your turn ${t.onOwnerTurn} becomes ${f.name}: ${SIZE_NAMES[f.size]}, move ${f.speed}, def ${f.defense}, ` +
    `HP ${f.health}, ${range} ${f.damage}${special} (heals ${t.heal})`
  );
}
