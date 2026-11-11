/**
 * Sound effects, synthesized with the Web Audio API (no audio files). Does nothing where
 * audio isn't available (tests, old browsers) or when the player turned sound off.
 *
 * Browsers only allow audio after a tap, so the context starts on the first pointer or
 * key press (see unlockSound, called once at startup).
 */
import { getSettings } from './settings';

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): Ctx | null {
  if (!getSettings().sound) return null;
  try {
    if (!ctx) {
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx.state === 'running' ? ctx : null;
  } catch {
    return null;
  }
}

/** Start audio on the first interaction (browser autoplay rules). */
export function unlockSound(): void {
  const start = () => void audio();
  globalThis.addEventListener?.('pointerdown', start, { passive: true });
  globalThis.addEventListener?.('keydown', start, { passive: true });
}

function noise(c: Ctx): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface Tone {
  /** Start and end frequency (Hz): a slide between them. */
  f: [number, number];
  /** Seconds. */
  d: number;
  type?: OscillatorType;
  /** Peak volume 0–1. */
  v?: number;
  /** Delay before it starts (seconds). */
  at?: number;
}
interface Burst {
  /** Seconds. */
  d: number;
  /** Filter center frequency: start and end (Hz). */
  f: [number, number];
  v?: number;
  at?: number;
  /** Filter type (default bandpass). */
  kind?: BiquadFilterType;
}

function tone(c: Ctx, t: Tone): void {
  const start = c.currentTime + (t.at ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = t.type ?? 'sine';
  osc.frequency.setValueAtTime(t.f[0], start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, t.f[1]), start + t.d);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(t.v ?? 0.3, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + t.d);
  osc.connect(gain).connect(master!);
  osc.start(start);
  osc.stop(start + t.d + 0.02);
}

function burst(c: Ctx, b: Burst): void {
  const start = c.currentTime + (b.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const filter = c.createBiquadFilter();
  filter.type = b.kind ?? 'bandpass';
  filter.frequency.setValueAtTime(b.f[0], start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, b.f[1]), start + b.d);
  const gain = c.createGain();
  gain.gain.setValueAtTime(b.v ?? 0.3, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + b.d);
  src.connect(filter).connect(gain).connect(master!);
  src.start(start, Math.random() * 0.5);
  src.stop(start + b.d + 0.02);
}

/** Every sound in the game: a few tones and noise bursts each. */
const SOUNDS = {
  tap: (c: Ctx) => tone(c, { f: [880, 660], d: 0.05, type: 'triangle', v: 0.12 }),
  select: (c: Ctx) => tone(c, { f: [520, 780], d: 0.07, type: 'triangle', v: 0.14 }),
  step: (c: Ctx) => burst(c, { d: 0.05, f: [900, 300], v: 0.12, kind: 'lowpass' }),
  place: (c: Ctx) => {
    burst(c, { d: 0.09, f: [500, 120], v: 0.3, kind: 'lowpass' });
    tone(c, { f: [180, 90], d: 0.09, v: 0.25 });
  },
  shot: (c: Ctx) => {
    burst(c, { d: 0.11, f: [3200, 500], v: 0.4 });
    tone(c, { f: [320, 70], d: 0.09, type: 'square', v: 0.12 });
  },
  heavyShot: (c: Ctx) => {
    burst(c, { d: 0.22, f: [1400, 120], v: 0.5, kind: 'lowpass' });
    tone(c, { f: [140, 40], d: 0.25, type: 'sawtooth', v: 0.25 });
  },
  whoosh: (c: Ctx) => burst(c, { d: 0.35, f: [300, 1800], v: 0.16 }),
  slash: (c: Ctx) => {
    burst(c, { d: 0.12, f: [5000, 1200], v: 0.3, kind: 'highpass' });
    tone(c, { f: [220, 90], d: 0.1, v: 0.25, at: 0.05 });
  },
  hit: (c: Ctx) => {
    burst(c, { d: 0.1, f: [1400, 200], v: 0.4, kind: 'lowpass' });
    tone(c, { f: [200, 60], d: 0.12, type: 'square', v: 0.16 });
  },
  miss: (c: Ctx) => burst(c, { d: 0.16, f: [2600, 5200], v: 0.1 }),
  explosion: (c: Ctx) => {
    burst(c, { d: 0.6, f: [900, 40], v: 0.7, kind: 'lowpass' });
    tone(c, { f: [110, 28], d: 0.5, type: 'sawtooth', v: 0.35 });
  },
  flame: (c: Ctx) => burst(c, { d: 0.55, f: [500, 2400], v: 0.3 }),
  kill: (c: Ctx) => {
    burst(c, { d: 0.3, f: [700, 60], v: 0.5, kind: 'lowpass' });
    tone(c, { f: [260, 50], d: 0.35, type: 'sawtooth', v: 0.2 });
  },
  dice: (c: Ctx) => {
    for (let i = 0; i < 7; i++) burst(c, { d: 0.03, f: [2600 + Math.random() * 1500, 1200], v: 0.14, at: i * 0.085 + Math.random() * 0.02 });
  },
  diceLand: (c: Ctx) => {
    burst(c, { d: 0.05, f: [1800, 700], v: 0.22 });
    tone(c, { f: [660, 990], d: 0.09, type: 'triangle', v: 0.12, at: 0.02 });
  },
  heal: (c: Ctx) => {
    tone(c, { f: [520, 520], d: 0.1, type: 'triangle', v: 0.16 });
    tone(c, { f: [780, 780], d: 0.16, type: 'triangle', v: 0.16, at: 0.09 });
  },
  buff: (c: Ctx) => tone(c, { f: [330, 660], d: 0.2, type: 'triangle', v: 0.16 }),
  hack: (c: Ctx) => {
    for (let i = 0; i < 5; i++) tone(c, { f: [400 + Math.random() * 1600, 300 + Math.random() * 900], d: 0.04, type: 'square', v: 0.08, at: i * 0.045 });
  },
  hook: (c: Ctx) => {
    burst(c, { d: 0.14, f: [2000, 6000], v: 0.14 });
    tone(c, { f: [900, 300], d: 0.12, type: 'square', v: 0.08, at: 0.12 });
  },
  rumble: (c: Ctx) => {
    burst(c, { d: 0.45, f: [300, 50], v: 0.6, kind: 'lowpass' });
    tone(c, { f: [80, 30], d: 0.4, type: 'sawtooth', v: 0.3 });
  },
  claim: (c: Ctx) => {
    tone(c, { f: [392, 392], d: 0.12, type: 'triangle', v: 0.18 });
    tone(c, { f: [523, 523], d: 0.12, type: 'triangle', v: 0.18, at: 0.1 });
    tone(c, { f: [784, 784], d: 0.25, type: 'triangle', v: 0.2, at: 0.2 });
  },
  turn: (c: Ctx) => {
    tone(c, { f: [294, 294], d: 0.14, type: 'triangle', v: 0.16 });
    tone(c, { f: [440, 440], d: 0.22, type: 'triangle', v: 0.16, at: 0.12 });
  },
  score: (c: Ctx) => {
    tone(c, { f: [660, 660], d: 0.1, type: 'triangle', v: 0.16 });
    tone(c, { f: [880, 880], d: 0.2, type: 'triangle', v: 0.16, at: 0.09 });
  },
  win: (c: Ctx) => {
    [392, 523, 659, 784, 1047].forEach((f, i) => tone(c, { f: [f, f], d: i === 4 ? 0.7 : 0.16, type: 'triangle', v: 0.2, at: i * 0.13 }));
    burst(c, { d: 0.8, f: [4000, 9000], v: 0.05, at: 0.5, kind: 'highpass' });
  },
  reveal: (c: Ctx) => {
    burst(c, { d: 0.3, f: [400, 2400], v: 0.1 });
    tone(c, { f: [220, 440], d: 0.3, type: 'triangle', v: 0.12 });
  },
  error: (c: Ctx) => tone(c, { f: [160, 110], d: 0.14, type: 'square', v: 0.1 }),
} as const;

export type SoundName = keyof typeof SOUNDS;
export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

/** Play a sound (silently does nothing if audio is off or unavailable). */
export function play(name: SoundName): void {
  const c = audio();
  if (!c) return;
  try {
    SOUNDS[name](c);
  } catch {
    // Audio hiccup: never break the game for a sound.
  }
}
