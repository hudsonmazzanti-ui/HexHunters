/**
 * Player preferences (animations, haptics, sound), remembered in this browser.
 * Storage can be missing or blocked (private mode, tests): then the defaults are used.
 */
export interface Settings {
  /** Slide models along their path, spin dice, etc. Off = everything snaps. */
  animations: boolean;
  /** Vibrate on select / hit / kill where the browser supports it. */
  haptics: boolean;
  /** Sound effects (synthesized; see sound.ts). */
  sound: boolean;
  /** Background music (generated; see sound.ts). */
  music: boolean;
}

const KEY = 'hexhunters.settings';

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return { animations: !prefersReducedMotion(), haptics: true, sound: true, music: true };
}

function load(): Settings {
  const defaults = defaultSettings();
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      animations: typeof saved.animations === 'boolean' ? saved.animations : defaults.animations,
      haptics: typeof saved.haptics === 'boolean' ? saved.haptics : defaults.haptics,
      sound: typeof saved.sound === 'boolean' ? saved.sound : defaults.sound,
      music: typeof saved.music === 'boolean' ? saved.music : defaults.music,
    };
  } catch {
    return defaults;
  }
}

let current: Settings | null = null;

export function getSettings(): Settings {
  current ??= load();
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not saved; still applies for this session.
  }
  return current;
}

/** Forget the cached settings (tests). */
export function resetSettingsCache(): void {
  current = null;
}

/** Reflects settings as classes on <html> (e.g. "no-anim" turns off decorative CSS animations). */
export function applySettingsClasses(settings: Settings = getSettings()): void {
  globalThis.document?.documentElement.classList.toggle('no-anim', !settings.animations);
}
