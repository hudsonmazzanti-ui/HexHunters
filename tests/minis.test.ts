import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/data/config';
import { MINI_ICONS, miniIcon, miniIconScale } from '../src/ui/minis';

describe('tabletop miniatures', () => {
  it('every unit type (forms and Twins included) has a figure icon', () => {
    const missing = Object.keys(DEFAULT_CONFIG.units).filter((id) => !miniIcon(id));
    expect(missing).toEqual([]);
    for (const id of Object.keys(MINI_ICONS)) expect(DEFAULT_CONFIG.units[id]).toBeDefined(); // no stray icons
  });

  it('icons are plain SVG markup built from theme colors (no scripts or external images)', () => {
    for (const markup of Object.values(MINI_ICONS)) {
      expect(markup).not.toMatch(/<script|href=|url\(/i);
      expect(markup).toMatch(/<(path|circle|rect|g)\b/);
    }
  });

  it('small models get a slightly larger figure so it still reads', () => {
    expect(miniIconScale(12, 1) / 12).toBeGreaterThan(miniIconScale(16, 2) / 16);
  });
});

describe('sound and attack styles', () => {
  it('playing a sound without audio support (tests, old browsers) does nothing and never throws', async () => {
    const { SOUND_NAMES, play } = await import('../src/ui/sound');
    expect(SOUND_NAMES.length).toBeGreaterThan(15);
    for (const name of SOUND_NAMES) expect(() => play(name)).not.toThrow();
  });

  it('each unit attacks in a fitting style', async () => {
    const { attackStyle } = await import('../src/ui/controller');
    const { makeState, addUnit } = await import('./helpers');
    const { hex } = await import('../src/core/hex');
    const s = makeState();
    const style = (type: string) => attackStyle(s, addUnit(s, type, 0, hex(0, 0)));
    expect(style('monster')).toBe('melee');
    expect(style('artillery')).toBe('shell');
    expect(style('dragon')).toBe('fire');
    expect(style('sniper')).toBe('heavy');
    expect(style('infantry')).toBe('bullet');
  });
});
