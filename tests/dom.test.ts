import { describe, expect, it } from 'vitest';
import { pickCondition } from '../src/core/conditions';
import { type Action, type GameEvent, applyAction, newGame } from '../src/core/game';
import { type Hex, ORIGIN, hex, hexDistance, hexKey, hexToPixel, mirror } from '../src/core/hex';
import { dominationSites, shapeZones, zonesConnected } from '../src/core/mapgen';
import { MISSIONS, missionPointsToWin } from '../src/core/missions';
import { actionBonus, claimBlockedReason, getUnit } from '../src/core/queries';
import type { GameConfig, GameState, PlayerId } from '../src/core/types';
import { DEFAULT_CONFIG } from '../src/data/config';
import { addUnit, makeState } from './helpers';

function run(state: GameState, ...actions: Action[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const END: Action = { type: 'endTurn' };

/** A Domination test board (Standard deployment): sites placed, nobody owns any. */
function dom(): GameState {
  const s = makeState();
  s.mission = 'dom';
  s.map.sites = dominationSites(s.map.radius, s.map.deployZones);
  s.siteOwners = [null, null, null];
  return s;
}
/** Center hex of site i. */
const at = (s: GameState, i: number): Hex => s.map.sites![i][0];
const dz = (h: Hex, z: Hex[]) => Math.min(...z.map((x) => hexDistance(h, x)));

describe('Domination: claiming', () => {
  it('a model inside a site spends its action to claim it: no attack afterwards, movement ends', () => {
    const s = dom();
    const inf = addUnit(s, 'infantry', 0, at(s, 0));
    const enemy = addUnit(s, 'infantry', 1, hex(0, -4));
    const { state, events } = run(s, { type: 'claim', unitId: inf.id });
    expect(state.siteOwners).toEqual([0, null, null]);
    expect(events).toContainEqual({ type: 'siteClaimed', unitId: inf.id, player: 0, site: 0, from: null });
    expect(getUnit(state, inf.id)).toMatchObject({ acted: true, movesLeft: 0 });
    expect(() => applyAction(state, { type: 'attack', unitId: inf.id, targetId: enemy.id })).toThrow();
  });

  it('any hex of the site counts, and moving in first is fine', () => {
    const s = dom();
    const edge = s.map.sites![1][3];
    const inf = addUnit(s, 'infantry', 0, hex(edge.q, edge.r + 1 <= 7 ? edge.r + 1 : edge.r - 1));
    const t = run(s, { type: 'move', unitId: inf.id, to: edge }, { type: 'claim', unitId: inf.id }).state;
    expect(t.siteOwners[1]).toBe(0);
  });

  it('is blocked while an enemy model is inside the site', () => {
    const s = dom();
    const inf = addUnit(s, 'infantry', 0, at(s, 1));
    addUnit(s, 'scout', 1, s.map.sites![1][2]);
    expect(claimBlockedReason(s, inf)).toBe('Enemy inside');
    expect(() => applyAction(s, { type: 'claim', unitId: inf.id })).toThrow(/Enemy inside/);
  });

  it('can\'t claim outside a site, a site that is already yours, or after acting', () => {
    const s = dom();
    const out = addUnit(s, 'infantry', 0, hex(0, 4));
    expect(claimBlockedReason(s, out)).toBe('Not in a site');
    s.siteOwners[0] = 0;
    const mine = addUnit(s, 'infantry', 0, at(s, 0));
    expect(claimBlockedReason(s, mine)).toBe('Already yours');
    s.siteOwners[0] = null;
    const done = addUnit(s, 'infantry', 0, s.map.sites![0][1], { acted: true });
    expect(claimBlockedReason(s, done)).toBe('This model cannot act');
    // Not a Domination game: no sites at all.
    const koth = makeState();
    const inf = addUnit(koth, 'infantry', 0, ORIGIN);
    expect(() => applyAction(koth, { type: 'claim', unitId: inf.id })).toThrow(/Not in a site/);
  });

  it('ownership lasts after the model leaves, until the enemy claims it', () => {
    const s = dom();
    const inf = addUnit(s, 'infantry', 0, at(s, 0), { movesLeft: 3 });
    const enemy = addUnit(s, 'infantry', 1, hex(0, -4));
    let t = run(s, { type: 'claim', unitId: inf.id }).state;
    t.units.find((u) => u.id === inf.id)!.pos = hex(0, 4); // walks off
    t = run(t, END).state; // player 2's turn
    expect(t.siteOwners[0]).toBe(0);
    t.units.find((u) => u.id === enemy.id)!.pos = at(t, 0);
    const { state, events } = run(t, { type: 'claim', unitId: enemy.id });
    expect(state.siteOwners[0]).toBe(1);
    expect(events).toContainEqual({ type: 'siteClaimed', unitId: enemy.id, player: 1, site: 0, from: 0 });
  });
});

describe('Domination: scoring and winning', () => {
  it('1 point per site owned at the end of each round', () => {
    const s = dom();
    s.siteOwners = [0, 0, 1];
    addUnit(s, 'infantry', 0, hex(0, 6));
    addUnit(s, 'infantry', 1, hex(0, -6));
    const after1 = run(s, END);
    expect(after1.state.scores).toEqual([0, 0]); // only at the end of the round
    const { state, events } = run(after1.state, END);
    expect(state.scores).toEqual([2, 1]);
    expect(events).toContainEqual({ type: 'sitesScored', round: 1, owned: [2, 1], points: [2, 1], scores: [2, 1] });
    expect(events.some((e) => e.type === 'roundScored')).toBe(false); // no control point
  });

  it('first to 8 wins', () => {
    expect(missionPointsToWin(DEFAULT_CONFIG, 'dom')).toBe(8);
    expect(missionPointsToWin(DEFAULT_CONFIG, 'koth')).toBe(5);
    const s = dom();
    s.scores = [6, 3];
    s.siteOwners = [0, 0, null];
    addUnit(s, 'infantry', 0, hex(0, 6));
    addUnit(s, 'infantry', 1, hex(0, -6));
    const { state, events } = run(s, END, END);
    expect(state).toMatchObject({ phase: 'over', winner: 0, winReason: 'points', scores: [8, 3] });
    expect(events.at(-1)).toEqual({ type: 'gameOver', winner: 0, reason: 'points' });
  });

  it('both reach 8 in the same round: the higher score wins; an exact tie plays on', () => {
    const s = dom();
    s.scores = [7, 7];
    s.siteOwners = [0, 0, 1];
    addUnit(s, 'infantry', 0, hex(0, 6));
    addUnit(s, 'infantry', 1, hex(0, -6));
    expect(run(s, END, END).state).toMatchObject({ phase: 'over', winner: 0, scores: [9, 8] });

    const tie = dom();
    tie.scores = [7, 7];
    tie.siteOwners = [0, null, 1];
    addUnit(tie, 'infantry', 0, hex(0, 6));
    addUnit(tie, 'infantry', 1, hex(0, -6));
    const t = run(tie, END, END).state;
    expect(t).toMatchObject({ phase: 'play', scores: [8, 8] });
    t.siteOwners = [0, 0, 1];
    expect(run(t, END, END).state).toMatchObject({ phase: 'over', winner: 0, scores: [10, 9] });
  });

  it('eliminating the enemy still wins', () => {
    const s = dom();
    const shooter = addUnit(s, 'infantry', 0, hex(0, 2), { die: 12 });
    const last = addUnit(s, 'scout', 1, hex(0, -2), { hp: 1 });
    expect(run(s, { type: 'attack', unitId: shooter.id, targetId: last.id }).state).toMatchObject({ winReason: 'elimination' });
  });
});

describe('Domination: Standard Bearer', () => {
  it('your models inside any site get +2 on their rolls', () => {
    const s = dom();
    addUnit(s, 'standardbearer', 0, hex(-3, 6));
    const inFlank = addUnit(s, 'infantry', 0, at(s, 1));
    const inCenter = addUnit(s, 'infantry', 0, at(s, 0));
    const outside = addUnit(s, 'infantry', 0, hex(0, 4));
    expect(actionBonus(s, inFlank)).toBe(2);
    expect(actionBonus(s, inCenter)).toBe(2);
    expect(actionBonus(s, outside)).toBe(0);
  });

  it('a round in which you score site points scores 1 extra; none without sites', () => {
    const s = dom();
    addUnit(s, 'standardbearer', 0, hex(-3, 6));
    addUnit(s, 'infantry', 1, hex(0, -6));
    s.siteOwners = [0, 0, null];
    const { state, events } = run(s, END, END);
    expect(state.scores).toEqual([3, 0]); // 2 sites + 1
    expect(events).toContainEqual(expect.objectContaining({ type: 'sitesScored', owned: [2, 0], points: [3, 0] }));

    const none = dom();
    addUnit(none, 'standardbearer', 0, hex(-3, 6));
    addUnit(none, 'infantry', 1, hex(0, -6));
    none.siteOwners = [null, null, 1];
    expect(run(none, END, END).state.scores).toEqual([0, 1]);
  });
});

describe('Domination: site placement', () => {
  const only = (extra: Partial<GameConfig>): GameConfig => ({ ...DEFAULT_CONFIG, missions: ['dom'], ...extra });

  for (const [cond, radius] of [['clear', 7], ['smallmap', 5], ['bigmap', 9]] as const) {
    it(`${cond}: 3 sites, mirrored flanks across the zone axis, about ${radius - 2} out, equidistant, clear and connected`, () => {
      const shapes = new Set<string>();
      for (let seed = 1; seed <= 120; seed++) {
        const g = newGame(only({ conditions: { [cond]: 1 } }), seed);
        const { sites, deployZones: [z0, z1] } = g.map;
        shapes.add(g.map.deployShape);
        expect(sites).toHaveLength(3);
        expect(sites![0].map(hexKey).sort()).toEqual(g.map.controlPoint.map(hexKey).sort()); // the center site
        const [a, b] = [sites![1][0], sites![2][0]];
        expect(hexKey(mirror(a))).toBe(hexKey(b)); // point-symmetric
        expect(hexDistance(a, ORIGIN)).toBe(radius - 2);
        // Perpendicular to the line between the zones (it turns with the shape).
        const zc = z0.map((h) => hexToPixel(h, 1)).reduce((p, q) => ({ x: p.x + q.x, y: p.y + q.y }), { x: 0, y: 0 });
        const ap = hexToPixel(a, 1);
        const cos = Math.abs(ap.x * zc.x + ap.y * zc.y) / (Math.hypot(ap.x, ap.y) * Math.hypot(zc.x, zc.y));
        expect(cos).toBeLessThan(0.35);
        // Same distance from both armies (within the 1 hex the grid forces on Flanks/Corners).
        const diff = Math.abs(dz(a, z0) - dz(a, z1));
        if (['standard', 'close', 'spearhead', 'split'].includes(g.map.deployShape)) expect(diff).toBe(0);
        else expect(diff).toBeLessThanOrEqual(1);
        // The pair is fair: each site is as close to one army as its mirror is to the other.
        expect(dz(a, z0)).toBe(dz(b, z1));
        // Never on a zone or terrain; every zone can reach every site.
        const zoneKeys = new Set([...z0, ...z1].map(hexKey));
        const blocked = new Set(Object.keys(g.map.heights));
        for (const site of sites!) {
          for (const h of site) {
            expect(zoneKeys.has(hexKey(h))).toBe(false);
            expect(blocked.has(hexKey(h))).toBe(false);
            expect(hexDistance(h, ORIGIN)).toBeLessThanOrEqual(radius);
          }
          expect(zonesConnected(g.map.radius, blocked, g.map.deployZones, site)).toBe(true);
        }
      }
      expect(shapes.size).toBeGreaterThanOrEqual(cond === 'smallmap' ? 4 : 5);
    });
  }

  it('works for every deployment shape (e.g. Flanks sites go top and bottom, Standard left and right)', () => {
    for (const id of DEFAULT_CONFIG.deployShapes) {
      const zones = shapeZones(DEFAULT_CONFIG, id);
      const sites = dominationSites(DEFAULT_CONFIG.boardRadius, zones);
      expect(sites).toHaveLength(3);
    }
    const flank = dominationSites(7, shapeZones(DEFAULT_CONFIG, 'flanks'))[1][0];
    expect(Math.abs(hexToPixel(flank, 1).y)).toBeGreaterThan(Math.abs(hexToPixel(flank, 1).x));
    const std = dominationSites(7, shapeZones(DEFAULT_CONFIG, 'standard'))[1][0];
    expect(std.r).toBe(0);
  });

  it('other missions get no sites (their maps don\'t change)', () => {
    for (const m of ['koth', 'ctf'] as const) {
      const g = newGame({ ...DEFAULT_CONFIG, missions: [m] }, 3);
      expect(g.map.sites).toBeUndefined();
      expect(g.siteOwners).toEqual([]);
    }
    expect(newGame({ ...DEFAULT_CONFIG, missions: ['dom'] }, 3).siteOwners).toEqual([null, null, null]);
  });
});

describe('Domination: mission and Condition picks', () => {
  it('never pairs with Hot Drop (rerolled)', () => {
    for (let seed = 1; seed <= 3000; seed++) expect(pickCondition(DEFAULT_CONFIG, seed, 'dom')).not.toBe('hotdrop');
    expect(newGame({ ...DEFAULT_CONFIG, missions: ['dom'], conditions: { hotdrop: 1 } }, 3).condition).toBe('clear');
  });

  it('has a name, icon, one-line rule and full rules', () => {
    expect(MISSIONS.dom).toMatchObject({ name: 'Domination', icon: 'sites', usesPoints: true, usesControlPoint: false });
    expect(MISSIONS.dom.brief(DEFAULT_CONFIG)).toMatch(/3 sites/);
    expect(MISSIONS.dom.rules(DEFAULT_CONFIG).length).toBeGreaterThan(3);
  });

  it('a full game starts and plays in Domination', () => {
    let g = newGame({ ...DEFAULT_CONFIG, missions: ['dom'], conditions: { clear: 1 } }, 11);
    g = run(g, { type: 'chooseArmy', units: ['infantry'] }, { type: 'chooseArmy', units: ['infantry'] }).state;
    g = run(
      g,
      { type: 'place', unitId: g.units[0].id, hex: g.map.deployZones[0][0] },
      { type: 'place', unitId: g.units[1].id, hex: g.map.deployZones[1][0] },
    ).state;
    expect(g.phase).toBe('play');
    const owners: (PlayerId | null)[] = g.siteOwners;
    expect(owners).toEqual([null, null, null]);
  });
});
