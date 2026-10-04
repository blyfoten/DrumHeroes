// Matches pad hits against highway notes (port of Audio/HitDetectionEngine.cs).
// Times are song seconds; the hit window is given in real milliseconds and scaled by tempo,
// so slowing a song down doesn't make the timing window harsher.
// Every judged hit is also recorded (this.hits) so a run can be reviewed afterwards.

import { perfectMs } from './drumMap.js';

export class HitDetection {
  constructor() {
    this.notes = [];
    this.windowSeconds = 0.065;
    this.perfectSeconds = 0.013;
    this.reset();
  }

  init(notes, windowMs, rate = 1) {
    this.notes = notes;
    this.setWindow(windowMs, rate);
    this.reset();
  }

  setWindow(windowMs, rate) {
    this.windowSeconds = (windowMs / 1000) * rate;
    this.perfectSeconds = (perfectMs(windowMs) / 1000) * rate;
  }

  reset() {
    this.nextIndex = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.perfectCount = 0;
    this.extraCount = 0;
    this.hits = []; // {time, lane, note, velocity, noteIndex (-1 = wrong hit), diff (s, + = late), perfect}
    for (const n of this.notes) {
      n.state = 'pending';
      n.hitTime = null;
    }
  }

  /** Re-arms notes at or after `time` (used when seeking). */
  resetFrom(time) {
    this.reset();
    for (const n of this.notes) {
      if (n.time + this.windowSeconds >= time) break;
      this.nextIndex++;
    }
    // Notes skipped by a seek don't count either way.
  }

  get total() {
    return this.notes.length;
  }

  /** Notes judged so far (hit or missed). */
  get judged() {
    return this.hitCount + this.missCount;
  }

  /** Final percentages: relative to every note in the song. */
  get accuracy() {
    return pct(this.hitCount, this.total);
  }

  get perfectRate() {
    return pct(this.perfectCount, this.total);
  }

  /** Live percentages: relative to the notes that have passed so far. */
  get liveAccuracy() {
    return pct(this.hitCount, this.judged);
  }

  get livePerfectRate() {
    return pct(this.perfectCount, this.judged);
  }

  get liveMissRate() {
    return pct(this.missCount, this.judged);
  }

  /** Share of your hits that matched no note: high when you just hammer every drum. */
  get wrongRate() {
    return pct(this.extraCount, this.hitCount + this.extraCount);
  }

  /** Returns {type:'hit', note, diffMs, perfect} or {type:'extra'}; marks notes missed as a side effect. */
  processHit(lane, time, { note: midiNote = null, velocity = null } = {}) {
    const missed = this.updateMissed(time);
    let best = -1;
    let bestDiff = Infinity;

    for (let i = Math.max(0, this.nextIndex - 5); i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time > time + this.windowSeconds + 0.5) break;
      if (note.state !== 'pending' || note.lane !== lane) continue;
      const diff = Math.abs(note.time - time);
      if (diff <= this.windowSeconds && diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }

    const record = { time, lane, note: midiNote, velocity, noteIndex: best, diff: null, perfect: false };
    this.hits.push(record);
    if (best >= 0) {
      const note = this.notes[best];
      note.state = 'hit';
      note.hitTime = time;
      this.hitCount++;
      record.diff = time - note.time;
      record.perfect = bestDiff <= this.perfectSeconds;
      if (record.perfect) this.perfectCount++;
      return { type: 'hit', note, diffMs: bestDiff * 1000, perfect: record.perfect, missed };
    }
    this.extraCount++;
    return { type: 'extra', missed };
  }

  /** Marks notes whose window has passed as missed; returns them. */
  updateMissed(time) {
    const missed = [];
    while (this.nextIndex < this.notes.length) {
      const note = this.notes[this.nextIndex];
      if (note.time + this.windowSeconds >= time) break;
      if (note.state === 'pending') {
        note.state = 'missed';
        this.missCount++;
        missed.push(note);
      }
      this.nextIndex++;
    }
    return missed;
  }

  finalize() {
    for (const n of this.notes) {
      if (n.state === 'pending') {
        n.state = 'missed';
        this.missCount++;
      }
    }
  }
}

function pct(part, whole) {
  return whole ? (part / whole) * 100 : 0;
}
