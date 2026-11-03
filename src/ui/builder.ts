/**
 * Army builder: a full-screen list of every unit in the roster with its cost,
 * stats and special. Tap + / − to add or remove; Confirm is blocked while the
 * army is empty or over the point limit. Resolves with the chosen unit type ids.
 */
import { addBlockedReason, armyCost, entryModels, entryName, specialUsesFor, validateArmy } from '../core/army';
import { AURAS, typeStatChanges } from '../core/auras';
import { SPECIALS } from '../core/specials';
import type { AuraId, GameConfig, PlayerId } from '../core/types';
import { heroName, speedName } from '../data/config';
import { PLAYER_COLORS, PLAYER_NAMES } from './hud';

const SIZE_NAMES = ['', 'small', 'medium', 'large'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

type Tab = 'unit' | 'hero';

export function showBuilder(config: GameConfig, player: PlayerId): Promise<string[]> {
  const army: string[] = [];
  // Every buyable entry: unit types (not squad members or alternate forms) plus squads (the Twins).
  const unitTypes = Object.keys(config.units).filter((t) => !config.units[t].squadOnly && !config.units[t].formOnly);
  const entries: { id: string; tab: Tab; cost: number; name: string; squad: boolean }[] = [
    ...unitTypes.map((t) => {
      const def = config.units[t];
      return { id: t, tab: (def.hero ? 'hero' : 'unit') as Tab, cost: def.cost, name: def.name, squad: false };
    }),
    ...Object.keys(config.squads).map((id) => {
      const sq = config.squads[id];
      return { id, tab: (sq.hero ? 'hero' : 'unit') as Tab, cost: sq.cost, name: sq.name, squad: true };
    }),
  ];
  let tab: Tab = 'unit';
  // Each tab keeps its own scroll position.
  const scrollOf: Record<Tab, number> = { unit: 0, hero: 0 };

  const root = h('div', 'builder');
  root.style.setProperty('--player', PLAYER_COLORS[player]);
  document.body.append(root);

  return new Promise((resolve) => {
    /** − count + controls. `blocked`: why + is disabled (can't afford, hero limit). */
    const controls = (id: string, count: number, blocked: string | null): HTMLElement => {
      const box = h('div', 'unit-controls');
      if (blocked) box.append(h('span', 'unit-blocked', blocked));
      const minus = h('button', 'step', '−');
      minus.disabled = count === 0;
      minus.onclick = () => {
        army.splice(army.lastIndexOf(id), 1);
        render();
      };
      const plus = h('button', 'step', '+');
      plus.disabled = !!blocked;
      plus.onclick = () => {
        army.push(id);
        render();
      };
      box.append(minus, h('span', 'unit-count', String(count)), plus);
      return box;
    };

    /** One card for a squad (the Twins): both models' stats and their shared special. */
    const squadCard = (id: string, blocked: string | null): HTMLElement => {
      const squad = config.squads[id];
      const count = army.filter((x) => x === id).length;
      const card = h('div', `unit-card hero${count ? ' picked' : ''}${blocked ? ' blocked' : ''}`);
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
      card.append(controls(id, count, blocked));
      return card;
    };

    /**
     * "Premium Shots: 2": uses a limited special gets from the points left unspent. Updates
     * live; before the unit is added, shows what it would get if added now.
     */
    const usesLine = (t: string, count: number): HTMLElement => {
      const def = config.units[t];
      const withIt = count ? army : [...army, t];
      const uses = specialUsesFor(config, withIt, t) ?? 0;
      const name = SPECIALS[def.special!].name;
      const line = h('div', `unit-uses${uses === 0 ? ' none' : ''}`);
      line.append(h('b', '', `${name}s: ${uses}`));
      const left = config.armyPointLimit - armyCost(config, withIt);
      line.append(
        document.createTextNode(
          count ? ` (${Math.max(0, left)} pt${left === 1 ? '' : 's'} unspent, max ${def.specialUses!.max})`
            : ` if added now (1 per unspent point, max ${def.specialUses!.max})`,
        ),
      );
      return line;
    };

    /**
     * Stat changes from hero auras for a unit type: the auras of heroes already in the army,
     * plus the card's own aura when it is a hero (the Warlord is large, so its own -2 HP shows).
     */
    const auraStatChanges = (t: string) => {
      const ids: AuraId[] = army.flatMap((e) => (config.units[e]?.hero?.aura ? [config.units[e].hero!.aura!] : []));
      const own = config.units[t].hero?.aura;
      if (own) ids.push(own);
      return typeStatChanges(config, ids, t, (id) => heroName(config, id));
    };

    const unitCard = (t: string, blocked: string | null): HTMLElement => {
      const def = config.units[t];
      const sp = def.special ? SPECIALS[def.special] : undefined;
      const count = army.filter((x) => x === t).length;

      const card = h('div', `unit-card${count ? ' picked' : ''}${def.hero ? ' hero' : ''}${blocked ? ' blocked' : ''}`);
      const top = h('div', 'unit-card-top');
      top.append(h('span', 'unit-tag', def.label), h('span', 'unit-name', def.name));
      if (def.hero) top.append(h('span', 'hero-badge', 'HERO'));
      top.append(h('span', 'unit-cost', `${def.cost} pt${def.cost === 1 ? '' : 's'}`));

      const stats = h('div', 'unit-stats');
      // Hero auras in this army (and a hero's own aura on its card) change these numbers.
      const fx = auraStatChanges(t);
      /** "10 (12 −2 Warlord)" when an aura changes the stat, else just the number. */
      const withAura = (base: number, delta: { total: number; from: string }) =>
        delta.total ? `${base + delta.total} (${base} ${delta.total > 0 ? '+' : '−'}${Math.abs(delta.total)} ${delta.from})` : `${base}`;
      const statList: [string, string][] = [
        ['Size', SIZE_NAMES[def.size]],
        ['Move', fx.speed.total ? withAura(def.speed, fx.speed) : `${def.speed} ${speedName(def.speed)}`.trim()],
        ['Def', withAura(def.defense, fx.defense)],
        ['HP', withAura(def.health, fx.health)],
        ['Range', def.range === 1 ? '1 (melee)' : `${def.range}`],
        ['Dmg', `${def.damage}`],
      ];
      if (def.hitBonus) statList.push(['Hit', `+${def.hitBonus}`]);
      for (const [k, v] of statList) {
        const sEl = h('span', '', `${k} `);
        sEl.append(h('b', '', v));
        stats.append(sEl);
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
        ...(def.hero?.aura
          ? [
              AURAS[def.hero.aura].outlivesHero?.(config.specials) === false
                ? `Needs the ${def.name} alive: reaches ${AURAS[def.hero.aura].reach?.(config.specials)} hexes`
                : 'Lasts all game, even if the hero dies',
              'No special: die is for attacking',
            ]
          : []),
        ...(def.hero && !def.hero.aura ? ['No passive: its ability is its special'] : []),
        ...(def.crackingArmor
          ? [`Cracking Armor: -1 def each time it's hit for damage (not Burn), min ${def.crackingArmor.minDefense}`]
          : []),
        ...(def.noDie ? ['No die: melee always hits, no roll modifiers apply'] : []),
        ...(def.flying ? ['Flying: moves over terrain and models, lands on an open hex'] : []),
        ...(def.indirectFire ? ['Indirect fire: ignores line of sight'] : []),
        ...(def.needsLoading ? [`Must Load to ${(def.attackName ?? 'attack').toLowerCase()}`] : []),
        ...(def.woundedForm ? ['Crawls when first hurt: small, speed 1, for good'] : []),
        ...(def.restsOnDoubleTurn ? ['Rests on back-to-back turns'] : []),
        ...(def.transformsInto ? [transformText(config, def.transformsInto)] : []),
        ...(!def.hero && !sp && !def.transformsInto ? ['No special'] : []),
        ...(sp?.tags ?? []),
      ];
      const tags = h('div', 'unit-tags');
      for (const c of callouts) tags.append(h('span', 'unit-pill', c));

      card.append(top, stats, special);
      if (def.specialUses && sp) card.append(usesLine(t, count));
      if (callouts.length) card.append(tags);
      card.append(controls(t, count, blocked));
      return card;
    };

    const render = () => {
      // Remember where this tab was scrolled to before re-rendering.
      const oldList = root.querySelector<HTMLElement>('.builder-list');
      if (oldList) scrollOf[tab] = oldList.scrollTop;

      const cost = armyCost(config, army);
      const limit = config.armyPointLimit;
      const left = limit - cost;
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

      // Tabs: Units / Heroes, each with how many of them are in the army.
      const tabs = h('div', 'builder-tabs');
      const max = config.maxHeroesPerArmy;
      for (const [id, label] of [
        ['unit', 'Units'],
        ['hero', `Heroes (max ${max})`],
      ] as const) {
        const picked = army.filter((t) => entries.find((e) => e.id === t)?.tab === id).length;
        const btn = h('button', `builder-tab${tab === id ? ' active' : ''}`, label);
        if (picked) btn.append(h('span', 'tab-count', String(picked)));
        btn.onclick = () => {
          if (tab === id) return;
          scrollOf[tab] = root.querySelector<HTMLElement>('.builder-list')?.scrollTop ?? 0;
          tab = id;
          render();
        };
        tabs.append(btn);
      }

      // Affordable entries first (cheapest first), then the rest with why they can't be added.
      const shown = entries
        .filter((e) => e.tab === tab)
        .map((e) => ({ ...e, blocked: addBlockedReason(config, army, e.id) }))
        .sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || a.cost - b.cost || a.name.localeCompare(b.name));
      const list = h('div', 'builder-list');
      if (tab === 'hero') list.append(h('div', 'builder-note', `Optional. Max ${max} per army; their rules last all game.`));
      let dividerShown = false;
      for (const e of shown) {
        if (e.blocked && !dividerShown) {
          dividerShown = true;
          const allBlocked = shown.every((x) => x.blocked);
          list.append(
            h('div', 'builder-section', allBlocked ? `Nothing fits (${left} pt${left === 1 ? '' : 's'} left)` : `Too expensive or not allowed (${left} pt${left === 1 ? '' : 's'} left)`),
          );
        }
        list.append(e.squad ? squadCard(e.id, e.blocked) : unitCard(e.id, e.blocked));
      }

      const footer = h('div', 'builder-footer');
      const models = army.reduce((n, t) => n + entryModels(config, t).length, 0);
      // Limited specials in the army (Mercenary): show the trade-off right by Confirm.
      const limited = [...new Set(army)].filter((t) => config.units[t]?.specialUses);
      const usesNote = limited
        .map((t) => ` ${SPECIALS[config.units[t].special!].name}s: ${specialUsesFor(config, army, t)}.`)
        .join('');
      const msg = h('div', `builder-msg${over ? ' over' : ''}`, reason ?? `${models} model${models === 1 ? '' : 's'} ready.${usesNote}`);
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

      root.replaceChildren(header, tabs, list, footer);
      list.scrollTop = scrollOf[tab];
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
