// Matches pad hits against highway notes (port of Audio/HitDetectionEngine.cs).
// Times are song seconds; the hit window is given in real milliseconds and scaled by tempo,
// so slowing a song down doesn't make the timing window harsher.

export class HitDetection {
  constructor() {
    this.notes = [];
    this.windowSeconds = 0.065;
    this.reset();
  }

  init(notes, windowMs, rate = 1) {
    this.notes = notes;
    this.setWindow(windowMs, rate);
    this.reset();
  }

  setWindow(windowMs, rate) {
    this.windowSeconds = (windowMs / 1000) * rate;
  }

  reset() {
    this.nextIndex = 0;
    this.hitCount = 0;
    this.missCount = 0;
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

  get accuracy() {
    return this.total ? (this.hitCount / this.total) * 100 : 0;
  }

  /** Returns {type:'hit', note, diffMs} or {type:'extra'}; marks notes missed as a side effect. */
  processHit(lane, time) {
    const missed = this.updateMissed(time);
    let best = null;
    let bestDiff = Infinity;

    for (let i = Math.max(0, this.nextIndex - 5); i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time > time + this.windowSeconds + 0.5) break;
      if (note.state !== 'pending' || note.lane !== lane) continue;
      const diff = Math.abs(note.time - time);
      if (diff <= this.windowSeconds && diff < bestDiff) {
        best = note;
        bestDiff = diff;
      }
    }

    if (best) {
      best.state = 'hit';
      best.hitTime = time;
      this.hitCount++;
      return { type: 'hit', note: best, diffMs: bestDiff * 1000, missed };
    }
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
