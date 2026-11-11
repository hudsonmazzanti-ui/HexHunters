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
