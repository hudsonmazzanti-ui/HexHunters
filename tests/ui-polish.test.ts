import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATTERNS, haptics } from '../src/ui/haptics';
import { defaultSettings, getSettings, resetSettingsCache, updateSettings } from '../src/ui/settings';
import { COLORS, themeVariables } from '../src/ui/theme';
import css from '../src/style.css?raw';

/** A minimal in-memory localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    data,
  };
}

beforeEach(() => resetSettingsCache());
afterEach(() => {
  vi.unstubAllGlobals();
  resetSettingsCache();
});

describe('settings', () => {
  it('uses defaults when storage is missing, and still applies changes for the session', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getSettings()).toEqual({ animations: true, haptics: true });
    expect(updateSettings({ haptics: false })).toEqual({ animations: true, haptics: false });
    expect(getSettings().haptics).toBe(false);
  });

  it('saves to and loads from localStorage', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    updateSettings({ animations: false });
    expect(JSON.parse(storage.data['hexhunters.settings'])).toEqual({ animations: false, haptics: true });
    resetSettingsCache();
    expect(getSettings()).toEqual({ animations: false, haptics: true });
  });

  it('ignores corrupted or blocked storage', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'hexhunters.settings': '{not json' }));
    expect(getSettings()).toEqual(defaultSettings());
    resetSettingsCache();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getSettings()).toEqual(defaultSettings());
    expect(() => updateSettings({ haptics: false })).not.toThrow();
  });

  it('animations default off when the phone asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    expect(defaultSettings().animations).toBe(false);
  });
});

describe('haptics', () => {
  it('vibrates with the agreed patterns', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('localStorage', undefined);
    haptics.tap();
    haptics.hit();
    haptics.kill();
    expect(vibrate.mock.calls).toEqual([[10], [30], [[40, 30, 80]]]);
    expect(PATTERNS.tap).toBeLessThan(PATTERNS.hit);
  });

  it('does nothing when turned off', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('localStorage', undefined);
    updateSettings({ haptics: false });
    haptics.kill();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('fails silently where vibration is unsupported (iOS Safari) or throws', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('navigator', {});
    expect(() => haptics.hit()).not.toThrow();
    vi.stubGlobal('navigator', undefined);
    expect(() => haptics.hit()).not.toThrow();
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => haptics.kill()).not.toThrow();
  });
});

describe('haptic events', () => {
  it('kill beats hit; misses and other events are silent', async () => {
    const { eventFeel } = await import('../src/ui/controller');
    const attack = { type: 'attack', unitId: 'a', targetId: 'b', roll: 9, bonus: 0, defense: 6, damage: 2 } as const;
    expect(eventFeel({ ...attack, hit: true, killed: false })).toBe('hit');
    expect(eventFeel({ ...attack, hit: true, killed: true })).toBe('kill');
    expect(eventFeel({ ...attack, hit: false, killed: false })).toBeNull();
    expect(eventFeel({ type: 'special', unitId: 'a', special: 'torch', effects: [{ unitId: 'x', damage: 3, killed: false }] })).toBe('hit');
    expect(eventFeel({ type: 'special', unitId: 'a', special: 'brace' })).toBeNull();
    expect(eventFeel({ type: 'burn', unitId: 'a', damage: 1, killed: true })).toBe('kill');
    expect(eventFeel({ type: 'move', unitId: 'a', path: [] })).toBeNull();
  });
});

describe('movement easing', () => {
  it('starts and ends smoothly', async () => {
    const { easeInOut, MOVE_MS } = await import('../src/ui/board');
    expect(easeInOut(0)).toBeCloseTo(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(1)).toBeCloseTo(1);
    expect(easeInOut(0.1)).toBeLessThan(0.1); // eases in
    expect(MOVE_MS).toBeGreaterThanOrEqual(120);
    expect(MOVE_MS).toBeLessThanOrEqual(150);
  });
});

describe('theme', () => {
  it('style.css has no raw colors: everything comes from theme.ts', () => {
    expect(css.length).toBeGreaterThan(5000); // the stylesheet really loaded
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(css.match(/rgba?\(/g)).toBeNull();
  });

  it('every theme variable the CSS uses is defined', () => {
    const defined = new Set(Object.keys(themeVariables()));
    const used = new Set([...css.matchAll(/var\((--(?:c|font|space|radius)-[a-z0-9-]+|--tap)\)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
    expect(themeVariables()['--c-p0-dark']).toBe(COLORS.p0Dark);
  });
});
