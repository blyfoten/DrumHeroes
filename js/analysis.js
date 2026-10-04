// Run recordings: what gets saved with a practice run, timing analysis of it, and MIDI export.

import { LANE_GM_NOTE } from './drumMap.js';

const ATTEMPT_RANGE_MS = 250; // a wrong hit this close to a missed note counts as a (badly timed) attempt at it
const MIN_SAMPLES = 8;
const MIN_SUGGEST_MS = 8;
export const OFFSET_RANGE = { min: 0, max: 250 };

/** Compact, storable snapshot of a run: the song's notes with their outcome and every hit played. */
export function makeRecording(notes, hits, { rate, offsetMs, windowMs, endTime }) {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    rate,
    offsetMs,
    windowMs,
    endTime: r3(endTime),
    notes: notes.map((n) => ({ time: r3(n.time), lane: n.lane, midiNote: n.midiNote, state: n.state })),
    hits: hits.map((h) => ({
      time: r3(h.time), lane: h.lane, note: h.note, velocity: h.velocity, noteIndex: h.noteIndex, perfect: h.perfect,
    })),
  };
}

/**
 * Timing analysis. Offsets are in real milliseconds (tempo-independent), positive = late.
 * Besides matched hits, a wrong hit just outside the window of a note that was then missed counts
 * as an attempt at that note, so a large latency (bigger than the hit window) still shows up.
 */
export function analyzeRecording(rec) {
  const { notes, hits, rate } = rec;
  const toMs = (seconds) => (seconds / rate) * 1000;
  const samples = []; // {ms, lane, matched}

  for (const h of hits) {
    if (h.noteIndex >= 0) {
      samples.push({ ms: toMs(h.time - notes[h.noteIndex].time), lane: h.lane, matched: true });
      continue;
    }
    let best = null;
    for (const n of notes) {
      if (n.lane !== h.lane || n.state !== 'missed') continue;
      const ms = toMs(h.time - n.time);
      if (Math.abs(ms) <= ATTEMPT_RANGE_MS && (!best || Math.abs(ms) < Math.abs(best))) best = ms;
    }
    if (best !== null) samples.push({ ms: best, lane: h.lane, matched: false });
  }

  const perLane = {};
  for (const n of notes) {
    const l = (perLane[n.lane] ??= { notes: 0, hit: 0, perfect: 0, missed: 0, wrong: 0, offsets: [] });
    l.notes++;
    if (n.state === 'hit') l.hit++;
    if (n.state === 'missed') l.missed++;
  }
  for (const h of hits) {
    const l = (perLane[h.lane] ??= { notes: 0, hit: 0, perfect: 0, missed: 0, wrong: 0, offsets: [] });
    if (h.noteIndex < 0) l.wrong++;
    if (h.perfect) l.perfect++;
  }
  for (const s of samples) perLane[s.lane].offsets.push(s.ms);
  for (const l of Object.values(perLane)) l.median = median(l.offsets);

  const all = samples.map((s) => s.ms);
  const sorted = [...all].sort((a, b) => a - b);
  return {
    samples,
    count: all.length,
    median: median(all),
    mean: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null,
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    early: all.filter((ms) => ms < 0).length,
    late: all.filter((ms) => ms > 0).length,
    perLane,
  };
}

/** Advice on the hit timing offset, or on consistency when the offset is already right. */
export function timingAdvice(analysis, offsetMs) {
  const { count, median: med, p25, p75 } = analysis;
  if (count < MIN_SAMPLES) {
    return { kind: 'info', text: `Not enough hits to judge your timing yet (${count} of ${MIN_SAMPLES} needed).` };
  }
  const spread = p75 - p25;
  if (Math.abs(med) >= MIN_SUGGEST_MS) {
    const target = Math.round(offsetMs + med);
    const newOffset = Math.min(OFFSET_RANGE.max, Math.max(OFFSET_RANGE.min, target));
    const dir = med > 0 ? 'late' : 'early';
    const clamped = newOffset !== target ? ` (the offset can't go ${target < 0 ? 'below' : 'above'} ${newOffset} ms)` : '';
    const steady = spread < Math.abs(med) * 2
      ? 'That is a steady lag, which usually means audio/MIDI latency rather than your playing.'
      : 'Your timing also varies quite a bit, so part of this may be your playing rather than latency.';
    return {
      kind: 'suggest',
      newOffset,
      text: `Your hits land ${Math.abs(Math.round(med))} ms ${dir} on average (median). ${steady} `
        + `Suggested hit timing offset: ${newOffset} ms (now ${offsetMs} ms)${clamped}.`,
    };
  }
  return {
    kind: 'ok',
    text: `Your timing is centred (median ${signedMs(med)}), so the offset of ${offsetMs} ms looks right. `
      + `Half your hits fall between ${signedMs(p25)} and ${signedMs(p75)}.`,
  };
}

/** "+12 ms" / "−8 ms" / "0 ms" */
export function signedMs(ms) {
  const r = Math.round(ms);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} ms`;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values) {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

// ---------- MIDI export ----------

const TPQ = 480;

function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

function text(type, str) {
  const bytes = [...new TextEncoder().encode(str)];
  return [0xff, type, ...vlq(bytes.length), ...bytes];
}

function chunk(id, bytes) {
  const len = bytes.length;
  return [...new TextEncoder().encode(id), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes];
}

function track(name, events) {
  // events: {tick, data}
  const sorted = [{ tick: 0, data: text(0x03, name) }, ...events].sort((a, b) => a.tick - b.tick);
  const bytes = [];
  let last = 0;
  for (const e of sorted) {
    bytes.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  bytes.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', bytes);
}

/**
 * A type-1 MIDI file with the song's drum notes and your hits on separate tracks (both on the
 * drum channel), at the song's tempo, so the two can be compared in any DAW or MIDI editor.
 */
export function recordingToMidi(rec, { bpm, title }) {
  const ticksPerSecond = (bpm / 60) * TPQ;
  const tick = (seconds) => Math.max(0, Math.round(seconds * ticksPerSecond));
  const len = Math.round(TPQ / 8);
  const noteEvents = (items) => items.flatMap(({ time, note, velocity }) => [
    { tick: tick(time), data: [0x99, note, velocity] },
    { tick: tick(time) + len, data: [0x89, note, 0] },
  ]);

  const usPerQuarter = Math.round(60e6 / bpm);
  const tempo = track(title, [{ tick: 0, data: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] }]);
  const song = track('Song', noteEvents(rec.notes.map((n) => ({ time: n.time, note: n.midiNote ?? LANE_GM_NOTE[n.lane], velocity: 100 }))));
  const hits = track('Your hits', noteEvents(rec.hits.map((h) => ({
    time: h.time,
    note: LANE_GM_NOTE[h.lane] ?? h.note ?? 38,
    velocity: Math.min(127, Math.max(1, h.velocity ?? 100)),
  }))));
  const header = chunk('MThd', [0, 1, 0, 3, (TPQ >> 8) & 255, TPQ & 255]);
  return new Uint8Array([...header, ...tempo, ...song, ...hits]);
}
