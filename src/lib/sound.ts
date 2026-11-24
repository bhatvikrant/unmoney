import { useSyncExternalStore } from "react";

/**
 * UI sounds, generated with the Web Audio API: no audio files to download or cache.
 *
 * Rules: a sound only ever follows something the person just did (a tap, a swipe), never a page
 * load or a sync. Everything plays quietly, and ticks are rate-limited so a fast scrub stays a
 * patter rather than a buzz. One switch turns all of it off (Preferences › Sounds); it is kept per
 * device, since whether a phone should make noise is a property of the phone. On iPhone the ringer
 * switch also silences Web Audio. Where the browser supports it, each sound also gives a short
 * vibration (Android; iOS Safari has no vibration API).
 */

export type SoundName = "tick" | "pop" | "tock" | "thunk" | "flutter" | "ding" | "bell";

const KEY = "sounds";
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = typeof window === "undefined" ? false : readEnabled();

export function setSoundsEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // private mode: the choice lasts for this visit
  }
  listeners.forEach((l) => l());
}

/** Whether UI sounds are on, for the settings switch. */
export function useSoundsEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
    () => false,
  );
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastTick = 0;

function audio(): { c: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    master = ctx.createGain();
    // about 24 dB under full scale with the per-sound peaks below
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return { c: ctx, out: master! };
}

function envelope(g: GainNode, t: number, attack: number, peak: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(f0: number, f1: number, dur: number, peak: number, type: OscillatorType = "sine", at = 0) {
  const a = audio();
  if (!a) return;
  const t = a.c.currentTime + at;
  const o = a.c.createOscillator();
  const g = a.c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  envelope(g, t, 0.004, peak, dur);
  o.connect(g).connect(a.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(dur: number, peak: number, freq: number, q = 1, type: BiquadFilterType = "bandpass", at = 0) {
  const a = audio();
  if (!a) return;
  if (!noiseBuffer || noiseBuffer.sampleRate !== a.c.sampleRate) {
    const n = Math.ceil(a.c.sampleRate * 0.25);
    noiseBuffer = a.c.createBuffer(1, n, a.c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.c.currentTime + at;
  const s = a.c.createBufferSource();
  const f = a.c.createBiquadFilter();
  const g = a.c.createGain();
  s.buffer = noiseBuffer;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  envelope(g, t, 0.002, peak, dur);
  s.connect(f).connect(g).connect(a.out);
  s.start(t);
  s.stop(t + dur + 0.05);
}

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not allowed here
  }
}

const SOUNDS: Record<SoundName, (at: number) => void> = {
  tick: (at) => noise(0.012, 0.35, 4200, 2, "bandpass", at),
  pop: (at) => {
    tone(480, 920, 0.08, 0.5, "sine", at);
    noise(0.01, 0.2, 3000, 1, "bandpass", at);
  },
  tock: (at) => tone(950, 620, 0.05, 0.35, "triangle", at),
  thunk: (at) => {
    tone(210, 95, 0.12, 0.7, "sine", at);
    noise(0.05, 0.25, 600, 1, "lowpass", at);
  },
  // paper bills, then a soft landing. The caller follows it with "ding" or "bell".
  flutter: (at) => {
    for (let i = 0; i < 7; i++) noise(0.03, 0.28, 2600 + Math.random() * 1800, 3, "bandpass", at + i * 0.05 + Math.random() * 0.015);
    tone(160, 70, 0.16, 0.8, "sine", at + 0.38);
  },
  ding: (at) => {
    tone(1760, 1760, 0.55, 0.22, "sine", at);
    tone(2640, 2640, 0.35, 0.08, "sine", at);
  },
  bell: (at) => {
    const f = 2093;
    tone(f, f, 0.9, 0.25, "sine", at);
    tone(f * 2.76, f * 2.76, 0.45, 0.08, "sine", at);
    tone(f * 5.4, f * 5.4, 0.2, 0.04, "sine", at);
    tone(f * 0.5, f * 0.5, 0.3, 0.06, "sine", at);
  },
};

const HAPTIC: Partial<Record<SoundName, number>> = { tick: 4, pop: 6, thunk: 15, flutter: 8, bell: 12 };

/**
 * Plays a UI sound, `delay` seconds from now. Ticks closer together than 35ms are dropped.
 * Does nothing when sounds are off or the browser has no Web Audio.
 */
export function play(name: SoundName, delay = 0) {
  if (!enabled) return;
  if (name === "tick" && delay === 0) {
    const now = performance.now();
    if (now - lastTick < 35) return;
    lastTick = now;
  }
  try {
    SOUNDS[name](delay);
  } catch {
    // an audio graph error must never break the action that triggered it
  }
  const ms = HAPTIC[name];
  if (ms && delay === 0) vibrate(ms);
}

/** A run of quiet ticks, one per changed digit, as a rolling number settles. */
export function playTicks(count: number, start = 0.06, gap = 0.045) {
  for (let i = 0; i < Math.min(count, 6); i++) play("tick", start + i * gap);
}

// iOS starts (and resumes) audio only inside a tap. Make sure the context exists and is running on
// every tap, so a sound that plays after an awaited step (a confirmation, a save) can still be heard.
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      if (enabled && (!ctx || ctx.state === "suspended")) audio();
    },
    { capture: true, passive: true },
  );
}
