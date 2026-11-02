import { describe, expect, it } from 'vitest';
import { auraEffects } from '../src/core/auras';
import { previewAttack } from '../src/core/combat';
import { CONDITIONS, pickCondition } from '../src/core/conditions';
import { type Action, type GameEvent, applyAction, newGame } from '../src/core/game';
import { ORIGIN, hex, hexDistance, hexKey, mirror } from '../src/core/hex';
import { generateMap, isConnected, largestArmy, zonesConnected } from '../src/core/mapgen';
import { watchArea } from '../src/core/overwatch';
import { getUnit, unitSpeed } from '../src/core/queries';
import { previewSpecial, specialBlockedReason } from '../src/core/specials';
import type { ConditionId, GameConfig, GameState } from '../src/core/types';
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

/** A test board under a Condition. */
const under = (condition: ConditionId, opts: Parameters<typeof makeState>[0] = {}) => {
  const s = makeState(opts);
  s.condition = condition;
  return s;
};
/** Only this Condition can come up. */
const only = (id: ConditionId, extra: Partial<GameConfig> = {}): GameConfig => ({ ...DEFAULT_CONFIG, conditions: { [id]: 1 }, ...extra });
const END: Action = { type: 'endTurn' };

describe('picking a Condition', () => {
  it('Clear about half the time, the other nine about 1/18 each', () => {
    const n = 18000;
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= n; seed++) {
      const c = pickCondition(DEFAULT_CONFIG, seed, 'koth');
      counts[c] = (counts[c] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(Object.keys(CONDITIONS).sort());
    expect(counts.clear / n).toBeGreaterThan(0.48);
    expect(counts.clear / n).toBeLessThan(0.52);
    for (const id of Object.keys(CONDITIONS).filter((c) => c !== 'clear')) {
      expect(counts[id] / n).toBeGreaterThan(0.045);
      expect(counts[id] / n).toBeLessThan(0.067);
    }
  });

  it('weights come from the config: reweighting or removing is a config change', () => {
    const cfg = { ...DEFAULT_CONFIG, conditions: { clear: 0, fog: 3, mud: 1 } };
    const picks = Array.from({ length: 4000 }, (_, i) => pickCondition(cfg, i + 1, 'koth'));
    expect(new Set(picks)).toEqual(new Set(['fog', 'mud']));
    expect(picks.filter((p) => p === 'fog').length / picks.length).toBeCloseTo(0.75, 1);
  });

  it('Hot Drop is never paired with Capture the Flag (rerolled)', () => {
    for (let seed = 1; seed <= 3000; seed++) expect(pickCondition(DEFAULT_CONFIG, seed, 'ctf')).not.toBe('hotdrop');
    // With nothing else allowed, a Capture the Flag game is Clear; King of the Hill gets Hot Drop.
    expect(newGame(only('hotdrop', { missions: ['ctf'] }), 3).condition).toBe('clear');
    expect(newGame(only('hotdrop', { missions: ['koth'] }), 3).condition).toBe('hotdrop');
    for (let seed = 1; seed <= 400; seed++) {
      const g = newGame(DEFAULT_CONFIG, seed);
      expect(g.mission === 'ctf' && g.condition === 'hotdrop').toBe(false);
    }
  });

  it('is seeded, and a Clear game has exactly today\'s map', () => {
    for (let seed = 1; seed < 40; seed++) {
      expect(newGame(DEFAULT_CONFIG, seed).condition).toBe(newGame(DEFAULT_CONFIG, seed).condition);
      expect(newGame(only('clear'), seed).map).toEqual(generateMap(DEFAULT_CONFIG, seed));
    }
  });
});

describe('Mud and Tailwind', () => {
  it('Mud: every model 1 slower, after every other modifier, minimum 1', () => {
    const s = under('mud');
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    const zombie = addUnit(s, 'zombie', 0, hex(2, 3), { crawling: true });
    addUnit(s, 'warlord', 1, hex(0, -5));
    const monster = addUnit(s, 'monster', 1, hex(2, -5));
    expect(unitSpeed(s, inf)).toBe(2);
    expect(unitSpeed(s, zombie)).toBe(1); // crawl 1 stays 1
    expect(unitSpeed(s, monster)).toBe(2); // 2 + 1 Warlord - 1 Mud
    s.mission = 'ctf';
    s.flag = { pos: null, carrierId: inf.id };
    expect(unitSpeed(s, inf)).toBe(1); // 3 - 1 carrier - 1 Mud
  });

  it('Tailwind: every model 1 faster, after everything else (flag carrier included)', () => {
    const s = under('tailwind');
    const inf = addUnit(s, 'infantry', 0, hex(0, 3));
    const zombie = addUnit(s, 'zombie', 0, hex(2, 3), { crawling: true });
    expect(unitSpeed(s, inf)).toBe(4);
    expect(unitSpeed(s, zombie)).toBe(2);
    s.mission = 'ctf';
    s.flag = { pos: null, carrierId: inf.id };
    expect(unitSpeed(s, inf)).toBe(3); // 3 - 1 carrier + 1 Tailwind
  });

  it('the new speed is the movement a model gets at the start of its turn', () => {
    for (const [c, expected] of [['mud', 2], ['tailwind', 4], ['clear', 3]] as const) {
      const s = under(c);
      const inf = addUnit(s, 'infantry', 0, hex(0, 3));
      addUnit(s, 'infantry', 1, hex(0, -5));
      const { state } = run(s, END, END);
      expect(getUnit(state, inf.id)!.movesLeft).toBe(expected);
    }
  });
});

describe('Blood Moon and Sandstorm', () => {
  /** The die each model rolls at its next turn start under a Condition (same random stream). */
  const dice = (condition: ConditionId, setup: (s: GameState) => void = () => {}) => {
    const s = under(condition);
    for (let i = 0; i < 6; i++) addUnit(s, 'infantry', 1, hex(i - 3, -5));
    addUnit(s, 'behemoth', 1, hex(4, -6));
    addUnit(s, 'infantry', 0, hex(0, 5));
    setup(s);
    s.rngState = 1234;
    const { state } = run(s, END);
    return state.units.filter((u) => u.owner === 1).map((u) => u.die);
  };

  it('Blood Moon: +1 on every die result', () => {
    const clear = dice('clear');
    const moon = dice('bloodmoon');
    clear.forEach((d, i) => expect(moon[i]).toBe(d === null ? null : d + 1));
    expect(moon.at(-1)).toBeNull(); // the Behemoth has no die
  });

  it('Sandstorm: -1 on every die result, minimum 1', () => {
    const clear = dice('clear');
    const sand = dice('sandstorm');
    clear.forEach((d, i) => expect(sand[i]).toBe(d === null ? null : Math.max(1, d - 1)));
    expect(sand.at(-1)).toBeNull();
  });

  it('applies to the Gambler\'s delayed roll too, and shows as part of the die bonus', () => {
    const s = under('bloodmoon');
    addUnit(s, 'gambler', 1, hex(4, -6));
    const inf = addUnit(s, 'infantry', 1, hex(0, -5));
    addUnit(s, 'infantry', 0, hex(0, 5));
    const { state } = run(s, END);
    const me = getUnit(state, inf.id)!;
    expect(me.gambling).toBe(true);
    expect(me.dieBonus).toBe(1);
  });
});

describe('Fog', () => {
  it('attacks can\'t reach past 4, indirect fire included', () => {
    const s = under('fog');
    const inf = addUnit(s, 'infantry', 0, ORIGIN, { die: 12 }); // range 5
    const at4 = addUnit(s, 'infantry', 1, hex(0, -4));
    const at5 = addUnit(s, 'infantry', 1, hex(5, -5));
    expect(previewAttack(s, inf, at4).blockedReason).toBeNull();
    expect(previewAttack(s, inf, at5).blockedReason).toBe('Lost in the fog');
    const art = addUnit(s, 'artillery', 0, hex(-1, 1), { die: 12, loaded: true }); // indirect, range 7
    expect(previewAttack(s, art, at5).blockedReason).toBe('Lost in the fog');
    // Without fog the same shot is fine.
    s.condition = 'clear';
    expect(previewAttack(s, inf, at5).blockedReason).toBeNull();
  });

  it('specials can\'t target a model or hex past 4 (Spot, Hack, Premium Shot, Grenade)', () => {
    const s = under('fog');
    const sniper = addUnit(s, 'sniper', 0, ORIGIN, { die: 12 });
    const far = addUnit(s, 'infantry', 1, hex(0, -5));
    const near = addUnit(s, 'infantry', 1, hex(3, -3));
    expect(specialBlockedReason(s, sniper, { targetId: far.id })).toBe('Lost in the fog');
    expect(specialBlockedReason(s, sniper, { targetId: near.id })).toBeNull();
    const grenadier = addUnit(s, 'grenadier', 0, hex(-1, 0), { die: 12 });
    expect(specialBlockedReason(s, grenadier, { hex: hex(-1, -5) })).toBe('Lost in the fog');
  });

  it('Grenade splash doesn\'t hit a model more than 4 from the thrower', () => {
    const s = under('fog');
    const grenadier = addUnit(s, 'grenadier', 0, ORIGIN, { die: 12 });
    const inner = addUnit(s, 'infantry', 1, hex(1, -4)); // splash, 4 away (off the arc)
    const outer = addUnit(s, 'infantry', 1, hex(0, -5)); // splash, 5 away
    const fx = previewSpecial(s, grenadier, { hex: hex(0, -4) })!.effects.map((e) => e.unitId);
    expect(fx).toContain(inner.id);
    expect(fx).not.toContain(outer.id);
  });

  it('overwatch only watches hexes within 4', () => {
    const s = under('fog');
    // A long-range watcher (the Sentinel's own range is 3, inside the fog anyway).
    s.config = { ...s.config, units: { ...s.config.units, sentinel: { ...s.config.units.sentinel, range: 7 } } };
    const sentinel = addUnit(s, 'sentinel', 0, ORIGIN);
    expect(Math.max(...watchArea(s, sentinel).map((h) => hexDistance(h, ORIGIN)))).toBe(4);
    s.condition = 'clear';
    expect(Math.max(...watchArea(s, sentinel).map((h) => hexDistance(h, ORIGIN)))).toBe(7);
  });

  it('the Twins still swap at any distance', () => {
    const s = under('fog');
    const tank = addUnit(s, 'twintank', 0, hex(0, 6), { die: 8 });
    const shooter = addUnit(s, 'twinshooter', 0, hex(0, -6), { die: 8 });
    tank.partnerId = shooter.id;
    shooter.partnerId = tank.id;
    const { state } = run(s, { type: 'special', unitId: tank.id });
    expect(getUnit(state, tank.id)!.pos).toEqual(hex(0, -6));
  });
});

describe('Bonus Bones', () => {
  const cfg = only('bonusbones', { missions: ['koth'] });
  const build = (a: string[], b: string[]) =>
    run(newGame(cfg, 5), { type: 'chooseArmy', units: a }, { type: 'chooseArmy', units: b }).state;

  it('each army gets 2 free Skeletons on top of its own models', () => {
    const s = build(['infantry', 'heavy'], ['monster']);
    for (const p of [0, 1] as const) {
      const free = s.units.filter((u) => u.owner === p && u.free);
      expect(free.map((u) => u.type)).toEqual(['skeleton', 'skeleton']);
    }
    expect(s.units.filter((u) => u.owner === 0)).toHaveLength(4);
  });

  it('don\'t cost points or change unspent points (Mercenary\'s Premium Shots)', () => {
    const army = ['mercenary', 'infantry']; // points left unspent give the Mercenary its shots
    const plain = run(newGame(only('clear'), 5), { type: 'chooseArmy', units: army }, { type: 'chooseArmy', units: ['monster'] }).state;
    const bones = build(army, ['monster']);
    const shots = (s: GameState) => s.units.find((u) => u.type === 'mercenary')!.usesLeft;
    expect(shots(bones)).toBe(shots(plain));
    // A full 16-point army is still legal (the Skeletons aren't in the list).
    expect(() => build(Array(16).fill('skeleton'), ['monster'])).not.toThrow();
  });

  it('are placed after the rest of the army', () => {
    const s = build(['infantry'], ['infantry']);
    const free = s.units.find((u) => u.owner === 0 && u.free)!;
    const zone = s.map.deployZones[0];
    expect(() => applyAction(s, { type: 'place', unitId: free.id, hex: zone[0] })).toThrow(/other models first/);
    const inf = s.units.find((u) => u.owner === 0 && !u.free)!;
    let t = run(s, { type: 'place', unitId: inf.id, hex: zone[0] }).state;
    t = run(t, { type: 'place', unitId: t.units.find((u) => u.owner === 1 && !u.free)!.id, hex: t.map.deployZones[1][0] }).state;
    expect(() => applyAction(t, { type: 'place', unitId: free.id, hex: zone[1] })).not.toThrow();
  });

  it('count as Skeletons for every rule (the Necromancer\'s Skeletons don\'t rest)', () => {
    const s = build(['necromancer', 'zombie'], ['monster']);
    const free = s.units.find((u) => u.owner === 0 && u.free)!;
    free.pos = hex(0, 5);
    expect(auraEffects(s, free).noRest).toBe(true);
  });

  it('every zone fits the largest army plus the 2 free Skeletons (18 models)', () => {
    expect(largestArmy(DEFAULT_CONFIG)).toBe(16);
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(cfg, seed);
      expect(g.map.deployZones[0].length).toBeGreaterThanOrEqual(18);
    }
  });
});

describe('Hot Drop', () => {
  const zones = () => newGame(only('hotdrop', { missions: ['koth'] }), 9).map;

  it('both zones in the middle, back to back and touching, mirrored, off the objective', () => {
    const map = zones();
    expect(map.deployShape).toBe('hotdrop');
    const [z0, z1] = map.deployZones;
    const k1 = new Set(z1.map(hexKey));
    expect(new Set(z0.map((h) => hexKey(mirror(h))))).toEqual(k1);
    expect(z0.some((h) => k1.has(hexKey(h)))).toBe(false);
    expect(Math.min(...z0.flatMap((a) => z1.map((b) => hexDistance(a, b))))).toBe(1); // they touch
    for (const h of [...z0, ...z1]) {
      expect(hexDistance(h, ORIGIN)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(h.r)).toBeLessThanOrEqual(2); // the middle of the board
    }
    expect(z0.length).toBeGreaterThanOrEqual(16);
  });

  it('the map stays connected with terrain out of the zones', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const map = newGame(only('hotdrop', { missions: ['koth'] }), seed).map;
      const blocked = new Set(Object.keys(map.heights));
      expect(isConnected(map.radius, blocked)).toBe(true);
      for (const h of [...map.deployZones[0], ...map.deployZones[1]]) expect(blocked.has(hexKey(h))).toBe(false);
    }
  });
});

describe('Small and Big Map', () => {
  for (const [id, radius] of [['smallmap', 5], ['bigmap', 9]] as const) {
    it(`${id}: radius ${radius}, mirrored, connected, and every zone fits the largest army`, () => {
      const shapes = new Set<string>();
      let pieces = 0;
      for (let seed = 1; seed <= 80; seed++) {
        const map = newGame(only(id), seed).map;
        expect(map.radius).toBe(radius);
        shapes.add(map.deployShape);
        pieces += map.terrain.length;
        // Terrain mirrored through the center.
        for (const [k, height] of Object.entries(map.heights)) {
          const [q, r] = k.split(',').map(Number);
          expect(map.heights[hexKey(mirror({ q, r }))]).toBe(height);
        }
        const blocked = new Set(Object.keys(map.heights));
        expect(isConnected(map.radius, blocked)).toBe(true);
        expect(zonesConnected(map.radius, blocked, map.deployZones, map.controlPoint)).toBe(true);
        const [z0, z1] = map.deployZones;
        expect(z0.length).toBeGreaterThanOrEqual(16);
        expect(new Set(z1.map(hexKey))).toEqual(new Set(z0.map((h) => hexKey(mirror(h)))));
        for (const h of [...z0, ...z1]) {
          expect(hexDistance(h, ORIGIN)).toBeGreaterThanOrEqual(3);
          expect(hexDistance(h, ORIGIN)).toBeLessThanOrEqual(radius);
          expect(blocked.has(hexKey(h))).toBe(false);
        }
      }
      // Close Quarters is too cramped on the small board; all the others come up.
      if (id === 'smallmap') expect(shapes.has('close')).toBe(false);
      expect(shapes.size).toBeGreaterThanOrEqual(id === 'smallmap' ? 4 : 5);
      // Terrain scales with the board: about 3.2 pieces small, 6 today, 9.6 big.
      const avg = pieces / 80;
      if (id === 'smallmap') expect(avg).toBeLessThan(5);
      else expect(avg).toBeGreaterThan(8);
    });
  }

  it('a full game plays on both sizes', () => {
    for (const id of ['smallmap', 'bigmap'] as const) {
      const g = run(newGame(only(id, { missions: ['koth'] }), 4), { type: 'chooseArmy', units: ['infantry'] }, { type: 'chooseArmy', units: ['infantry'] }).state;
      expect(g.phase).toBe('deploy');
      const placed = run(g, { type: 'place', unitId: g.units[0].id, hex: g.map.deployZones[0][0] }, { type: 'place', unitId: g.units[1].id, hex: g.map.deployZones[1][0] }).state;
      expect(placed.phase).toBe('play');
    }
  });
});
