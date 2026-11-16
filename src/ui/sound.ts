/**
 * Sound effects, synthesized with the Web Audio API (no audio files). Does nothing where
 * audio isn't available (tests, old browsers) or when the player turned sound off.
 *
 * Browsers only allow audio after a tap, so the context starts on the first pointer or
 * key press (see unlockSound, called once at startup).
 */
import { getSettings } from './settings';

/** Mix levels, set from offline measurements: effects sit clearly above the music. */
const SFX_LEVEL = 1.0;
const MUSIC_LEVEL = 0.3;

type Ctx = BaseAudioContext;
let ctx: AudioContext | null = null;
let master: AudioNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // Effects and music share a limiter so stacked sounds never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      limiter.connect(ctx.destination);
      const sfx = ctx.createGain();
      sfx.gain.value = SFX_LEVEL;
      sfx.connect(limiter);
      master = sfx;
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(limiter);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx.state === 'running' ? ctx : null;
  } catch {
    return null;
  }
}

/** Start audio on the first interaction (browser autoplay rules). */
export function unlockSound(): void {
  const start = () => {
    void audio();
    syncMusic();
  };
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
  tap: (c: Ctx) => tone(c, { f: [880, 660], d: 0.05, type: 'triangle', v: 0.18 }),
  select: (c: Ctx) => tone(c, { f: [520, 780], d: 0.07, type: 'triangle', v: 0.14 }),
  step: (c: Ctx) => {
    burst(c, { d: 0.06, f: [900, 300], v: 0.5, kind: 'lowpass' });
    tone(c, { f: [150, 80], d: 0.05, v: 0.12 });
  },
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
  whoosh: (c: Ctx) => burst(c, { d: 0.35, f: [300, 1800], v: 0.7 }),
  slash: (c: Ctx) => {
    burst(c, { d: 0.12, f: [5000, 1200], v: 0.16, kind: 'highpass' });
    tone(c, { f: [220, 90], d: 0.1, v: 0.25, at: 0.05 });
  },
  hit: (c: Ctx) => {
    burst(c, { d: 0.1, f: [1400, 200], v: 0.4, kind: 'lowpass' });
    tone(c, { f: [200, 60], d: 0.12, type: 'square', v: 0.16 });
  },
  miss: (c: Ctx) => burst(c, { d: 0.16, f: [2600, 5200], v: 0.35 }),
  explosion: (c: Ctx) => {
    burst(c, { d: 0.6, f: [900, 40], v: 0.7, kind: 'lowpass' });
    tone(c, { f: [110, 28], d: 0.5, type: 'sawtooth', v: 0.35 });
  },
  flame: (c: Ctx) => burst(c, { d: 0.55, f: [500, 2400], v: 0.7 }),
  kill: (c: Ctx) => {
    burst(c, { d: 0.3, f: [700, 60], v: 0.5, kind: 'lowpass' });
    tone(c, { f: [260, 50], d: 0.35, type: 'sawtooth', v: 0.2 });
  },
  dice: (c: Ctx) => {
    for (let i = 0; i < 7; i++) burst(c, { d: 0.03, f: [2600 + Math.random() * 1500, 1200], v: 0.4, at: i * 0.085 + Math.random() * 0.02 });
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
    for (let i = 0; i < 5; i++) tone(c, { f: [400 + Math.random() * 1600, 300 + Math.random() * 900], d: 0.04, type: 'square', v: 0.12, at: i * 0.045 });
  },
  hook: (c: Ctx) => {
    burst(c, { d: 0.14, f: [2000, 6000], v: 0.4 });
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
    burst(c, { d: 0.3, f: [400, 2400], v: 0.3 });
    tone(c, { f: [220, 440], d: 0.3, type: 'triangle', v: 0.12 });
  },
  error: (c: Ctx) => tone(c, { f: [160, 110], d: 0.14, type: 'square', v: 0.1 }),
} as const;

export type SoundName = keyof typeof SOUNDS;
export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

/** Play a sound (silently does nothing if audio is off or unavailable). */
export function play(name: SoundName): void {
  if (!getSettings().sound) return;
  const c = audio();
  if (!c) return;
  try {
    SOUNDS[name](c);
  } catch {
    // Audio hiccup: never break the game for a sound.
  }
}

/**
 * Renders one sound into an offline context and returns its samples, so tests in a real
 * browser can measure it (not silent, not clipping) without speakers.
 */
export async function renderSound(name: SoundName, seconds = 1.2): Promise<Float32Array> {
  const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
  const savedMaster = master;
  const savedNoise = noiseBuffer;
  const gain = off.createGain();
  gain.gain.value = SFX_LEVEL;
  gain.connect(off.destination);
  master = gain;
  noiseBuffer = null;
  try {
    SOUNDS[name](off);
  } finally {
    master = savedMaster;
    noiseBuffer = savedNoise;
  }
  return (await off.startRendering()).getChannelData(0);
}

// ---------------------------------------------------------------------------
// Music: a quiet generated score (no audio files). A slow chord progression on soft
// pads with a bass note and a sparse melody; in battle a soft pulse joins in.
// ---------------------------------------------------------------------------

export type MusicMood = 'menu' | 'battle' | 'off';
let mood: MusicMood = 'menu';
let timer: ReturnType<typeof setInterval> | null = null;
let nextBar = 0;
let bar = 0;

const BAR = 3.2; // seconds
// D minor: Dm, Bb, F, C (then Dm, Gm, Bb, A for the second half).
const CHORDS: number[][] = [
  [146.83, 174.61, 220.0],
  [116.54, 146.83, 174.61],
  [174.61, 220.0, 261.63],
  [130.81, 164.81, 196.0],
  [146.83, 174.61, 220.0],
  [98.0, 116.54, 146.83],
  [116.54, 146.83, 174.61],
  [110.0, 138.59, 164.81],
];
const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33]; // D minor pentatonic

/** Schedules one bar of music starting at time `t` into `out`. */
export function scheduleBar(c: Ctx, out: AudioNode, t: number, index: number, battle: boolean): void {
  const chord = CHORDS[index % CHORDS.length];
  // Pad: each chord note as two detuned saws through a slow low-pass swell.
  for (const f of chord) {
    for (const detune of [-6, 6]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, t);
      filter.frequency.linearRampToValueAtTime(battle ? 1100 : 800, t + BAR * 0.5);
      filter.frequency.linearRampToValueAtTime(300, t + BAR);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + BAR * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, t + BAR * 1.05);
      osc.connect(filter).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + BAR * 1.1);
    }
  }
  // Bass: the chord's root an octave down.
  const bass = c.createOscillator();
  bass.type = 'sine';
  bass.frequency.value = chord[0] / 2;
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.linearRampToValueAtTime(0.16, t + 0.08);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + BAR * 0.9);
  bass.connect(bg).connect(out);
  bass.start(t);
  bass.stop(t + BAR);
  // Melody: a few soft plucks, chosen by the bar number (so it repeats musically).
  const steps = battle ? 8 : 4;
  for (let i = 0; i < steps; i++) {
    const pick = (index * 7 + i * 5 + (i * i) % 3) % 11;
    if (pick > 6 && !(battle && i % 2 === 0)) continue; // rests
    const at = t + (i * BAR) / steps;
    const note = c.createOscillator();
    note.type = 'triangle';
    note.frequency.value = SCALE[pick % SCALE.length];
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, at);
    ng.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    note.connect(ng).connect(out);
    note.start(at);
    note.stop(at + 0.75);
  }
  // Battle: a soft heartbeat drum on each beat.
  if (battle) {
    for (let i = 0; i < 4; i++) {
      const at = t + (i * BAR) / 4;
      const drum = c.createOscillator();
      drum.frequency.setValueAtTime(110, at);
      drum.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      const dg = c.createGain();
      dg.gain.setValueAtTime(i % 2 ? 0.1 : 0.2, at);
      dg.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      drum.connect(dg).connect(out);
      drum.start(at);
      drum.stop(at + 0.22);
    }
  }
}

/** Starts, stops or fades the music to match the setting and the current mood. */
function syncMusic(): void {
  const want = getSettings().music && mood !== 'off';
  const c = ctx && ctx.state === 'running' ? ctx : null;
  if (!c || !musicBus) return;
  musicBus.gain.cancelScheduledValues(c.currentTime);
  musicBus.gain.linearRampToValueAtTime(want ? MUSIC_LEVEL : 0, c.currentTime + 0.8);
  if (want && !timer) {
    nextBar = c.currentTime + 0.1;
    timer = setInterval(() => {
      if (!ctx || !musicBus) return;
      while (nextBar < ctx.currentTime + 0.6) {
        scheduleBar(ctx, musicBus, nextBar, bar++, mood === 'battle');
        nextBar += BAR;
      }
    }, 200);
  } else if (!want && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Sets the music's mood (menus and setup: calm; in play: a pulse joins). */
export function setMusic(next: MusicMood): void {
  mood = next;
  if (getSettings().music) void audio();
  syncMusic();
}

/** Renders a few bars of music offline (for measuring it in tests). */
export async function renderMusic(bars: number, battle: boolean): Promise<Float32Array> {
  const off = new OfflineAudioContext(1, Math.ceil(44100 * BAR * bars), 44100);
  const bus = off.createGain();
  bus.gain.value = MUSIC_LEVEL;
  bus.connect(off.destination);
  for (let i = 0; i < bars; i++) scheduleBar(off, bus, i * BAR, i, battle);
  return (await off.startRendering()).getChannelData(0);
}
