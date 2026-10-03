// Synthesized drum one-shots modeled on the "...And Justice for All" kit
// (port of Audio/DrumSoundGenerator.cs). Rendered once into AudioBuffers.

import { Lane } from './drumMap.js';

function seededRandom(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function render(ctx, duration, seed, fn) {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * duration);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  const rng = seededRandom(seed);
  const noise = () => rng() * 2 - 1;
  const state = {};
  for (let i = 0; i < length; i++) data[i] = fn(i / sr, noise, state, sr);
  return buffer;
}

const TAU = 2 * Math.PI;

function kick(ctx) {
  return render(ctx, 0.5, 88, (t, noise, s, sr) => {
    const freq = 40 + 35 * Math.exp(-t * 18);
    s.p1 = (s.p1 ?? 0) + (TAU * freq) / sr;
    s.p2 = (s.p2 ?? 0) + (TAU * freq * 0.5) / sr;
    s.p3 = (s.p3 ?? 0) + (TAU * freq * 2) / sr;
    const body = Math.sin(s.p1) * Math.exp(-t * 5);
    const sub = Math.sin(s.p2) * Math.exp(-t * 6) * 0.6;
    const harmonic = Math.sin(s.p3) * Math.exp(-t * 12) * 0.25;
    let click = 0;
    if (t < 0.008) {
      click = Math.sin(TAU * 3000 * t) * 0.15 * Math.exp(-t * 450) + noise() * 0.08 * Math.exp(-t * 600);
    }
    return Math.tanh((body + sub + harmonic + click) * 1.8) * 1.4;
  });
}

function snare(ctx) {
  return render(ctx, 0.18, 42, (t, noise, s, sr) => {
    const toneFreq = 240 + 40 * Math.exp(-t * 50);
    s.p = (s.p ?? 0) + (TAU * toneFreq) / sr;
    const tone = Math.sin(s.p) * Math.exp(-t * 25) * 0.3;
    const wires = noise() * Math.exp(-t * 14) * 0.55;
    let crack = 0;
    if (t < 0.003) {
      crack = noise() * 0.75 * Math.exp(-t * 1200) + Math.sin(TAU * 4500 * t) * 0.4 * Math.exp(-t * 800);
    }
    return Math.tanh((tone + wires + crack) * 1.3);
  });
}

function closedHiHat(ctx) {
  return render(ctx, 0.06, 123, (t, noise) => {
    const ring1 = Math.sin(TAU * 7500 * t) * 0.18 * Math.exp(-t * 100);
    const ring2 = Math.sin(TAU * 9500 * t) * 0.1 * Math.exp(-t * 110);
    const n = noise();
    const stick = t < 0.002 ? noise() * 0.5 * Math.exp(-t * 1500) : 0;
    return (n * Math.exp(-t * 80) * 0.5 + ring1 + ring2 + stick) * 0.85;
  });
}

function openHiHat(ctx) {
  return render(ctx, 0.35, 456, (t, noise) => {
    const ring = Math.sin(TAU * 6500 * t) * 0.14 + Math.sin(TAU * 8500 * t) * 0.1 + Math.sin(TAU * 11000 * t) * 0.05;
    return (noise() * 0.4 + ring) * Math.exp(-t * 8) * 0.8;
  });
}

function tom(ctx, baseFreq, duration) {
  return render(ctx, duration, Math.round(baseFreq * 7), (t, noise, s, sr) => {
    const freq = baseFreq + 100 * Math.exp(-t * 35);
    s.p = (s.p ?? 0) + (TAU * freq) / sr;
    const env = Math.exp(-t * 12) * 0.7 + Math.exp(-t * 30) * 0.3;
    let attack = 0;
    if (t < 0.005) attack = Math.exp(-t * 600) * 0.4 + noise() * 0.15 * Math.exp(-t * 800);
    const skin = noise() * Math.exp(-t * 40) * 0.08;
    return Math.tanh((Math.sin(s.p) * env * 0.75 + attack + skin) * 1.2) * 0.95;
  });
}

function crash(ctx, duration, baseRing) {
  const partials = [[1, 0.14], [1.31, 0.11], [1.73, 0.08], [2.19, 0.06], [2.87, 0.04], [3.51, 0.025]];
  return render(ctx, duration, baseRing, (t, noise) => {
    const n = noise();
    let ring = 0;
    for (const [mult, amp] of partials) ring += Math.sin(TAU * baseRing * mult * t) * amp;
    const sizzle = noise() * 0.12 * Math.exp(-t * 2.5);
    const sample = n * Math.exp(-t * 18) * 0.5 + n * Math.exp(-t * 1.8) * 0.38 + ring * Math.exp(-t * 2) + sizzle;
    return sample * 0.78;
  });
}

function ride(ctx) {
  return render(ctx, 0.5, 321, (t, noise) => {
    const bell = Math.sin(TAU * 3200 * t) * 0.28 * Math.exp(-t * 5);
    const ping = Math.sin(TAU * 4200 * t) * Math.exp(-t * 35) * 0.25;
    const wash = noise() * 0.1 * Math.exp(-t * 7);
    const shimmer = Math.sin(TAU * 6800 * t) * 0.05 * Math.exp(-t * 8);
    return (bell + ping + wash + shimmer) * 0.8;
  });
}

export function generateDrumBuffers(ctx) {
  return {
    [Lane.Kick]: kick(ctx),
    [Lane.Snare]: snare(ctx),
    [Lane.ClosedHiHat]: closedHiHat(ctx),
    [Lane.OpenHiHat]: openHiHat(ctx),
    [Lane.RackTom1]: tom(ctx, 170, 0.22),
    [Lane.RackTom2]: tom(ctx, 120, 0.26),
    [Lane.FloorTom]: tom(ctx, 75, 0.32),
    [Lane.Crash1]: crash(ctx, 1.0, 4800),
    [Lane.Crash2]: crash(ctx, 0.9, 4400),
    [Lane.Crash3]: crash(ctx, 0.8, 5200),
    [Lane.Ride]: ride(ctx),
  };
}

/**
 * A woodblock-style click: two inharmonic partials up where drums are thin, plus a short noise
 * transient, so it stays audible on top of a loud kit (e.g. a drum module on the line-in).
 */
export function generateClick(ctx, frequency, duration, amplitude) {
  const buffer = render(ctx, duration, 1, (t, noise) => {
    const body = Math.sin(TAU * frequency * t) + 0.6 * Math.sin(TAU * frequency * 1.48 * t);
    const tick = t < 0.002 ? noise() * 0.5 : 0;
    return body * Math.exp(-t * 55) + tick;
  });
  // Normalize so `amplitude` is the true peak.
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < data.length; i++) data[i] *= amplitude / peak;
  return buffer;
}
