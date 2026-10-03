// Song transport: backing/stem playback with pitch-preserving tempo change, a smooth song clock,
// count-in and metronome. All times are in song (media) seconds unless named "real".

import { audio } from './audioEngine.js';

const RESYNC_THRESHOLD = 0.04; // seconds of drift before the clock snaps to the media element
const STEM_SYNC_THRESHOLD = 0.05;
const METRONOME_LOOKAHEAD_REAL = 0.2;

function createMedia(url) {
  if (!url) return null;
  const el = new Audio();
  el.src = url;
  el.preload = 'auto';
  el.preservesPitch = true;
  el.mozPreservesPitch = true;
  el.webkitPreservesPitch = true;
  return el;
}

export class SongPlayer {
  /**
   * @param {object} opts
   * @param {string|null} opts.backingUrl
   * @param {string|null} opts.stemUrl
   * @param {number} opts.duration       fallback duration (used when there is no audio)
   * @param {number} opts.bpm
   * @param {number} opts.beatsPerBar
   */
  constructor({ backingUrl, stemUrl, duration, bpm, beatsPerBar }) {
    audio.ensure();
    this.backing = createMedia(backingUrl);
    this.stem = createMedia(stemUrl);
    if (this.backing) audio.connectMedia(this.backing, 'backing');
    if (this.stem) audio.connectMedia(this.stem, 'stem');

    this.fallbackDuration = duration;
    this.bpm = bpm || 120;
    this.beatsPerBar = beatsPerBar || 4;
    this.rate = 1;
    this.metronomeEnabled = false;

    this.playing = false; // transport running (includes count-in)
    this.anchorTime = 0; // song time at anchorPerf
    this.anchorPerf = performance.now();
    this.mediaStartTimer = null;
    this.scheduledClicks = [];
    this.nextBeatIndex = 0;
    this.onEnded = null;

    this.ready = Promise.all([this.backing, this.stem].filter(Boolean).map(
      (el) => new Promise((resolve) => {
        if (el.readyState >= 1) return resolve();
        el.addEventListener('loadedmetadata', resolve, { once: true });
        el.addEventListener('error', resolve, { once: true });
      }),
    ));
  }

  get duration() {
    const d = this.backing?.duration;
    return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
  }

  /** Song time at a performance.now() timestamp (lets MIDI event timestamps be judged precisely). */
  timeAt(perfNow = performance.now()) {
    if (!this.playing) return this.anchorTime;
    return this.anchorTime + ((perfNow - this.anchorPerf) / 1000) * this.rate;
  }

  get currentTime() {
    return this.timeAt();
  }

  setAnchor(time, perf = performance.now()) {
    this.anchorTime = time;
    this.anchorPerf = perf;
  }

  setRate(rate) {
    const now = this.currentTime;
    this.rate = rate;
    for (const el of [this.backing, this.stem]) if (el) el.playbackRate = rate;
    this.setAnchor(now);
    if (this.playing) this.rescheduleMetronome();
  }

  /** Starts playback from the current position, optionally preceded by a count-in. */
  play(countInBars = 0) {
    if (this.playing) return;
    audio.ensure();
    const start = Math.max(0, this.anchorTime);
    const secondsPerBeatReal = 60 / (this.bpm * this.rate);
    const countInBeats = countInBars * this.beatsPerBar;
    const countInReal = countInBeats * secondsPerBeatReal;

    this.playing = true;
    this.setAnchor(start - countInReal * this.rate);

    // Count-in clicks are always audible, independent of the metronome toggle.
    const ctxNow = audio.ctx.currentTime + 0.02;
    for (let i = 0; i < countInBeats; i++) {
      this.scheduledClicks.push(audio.scheduleClick(ctxNow + i * secondsPerBeatReal, i % this.beatsPerBar === 0));
    }
    this.nextBeatIndex = Math.ceil(start / (60 / this.bpm) - 1e-6);

    const startMedia = () => {
      this.mediaStartTimer = null;
      if (!this.playing) return;
      for (const el of [this.backing, this.stem]) {
        if (!el) continue;
        el.playbackRate = this.rate;
        el.currentTime = start;
        el.play().catch(() => {});
      }
    };
    if (countInReal > 0) this.mediaStartTimer = setTimeout(startMedia, countInReal * 1000);
    else startMedia();
  }

  pause() {
    if (!this.playing) return;
    const now = this.currentTime;
    this.playing = false;
    this.setAnchor(Math.max(0, now));
    clearTimeout(this.mediaStartTimer);
    this.mediaStartTimer = null;
    for (const el of [this.backing, this.stem]) el?.pause();
    this.cancelClicks();
  }

  seek(time) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.setAnchor(Math.max(0, time));
    for (const el of [this.backing, this.stem]) if (el) el.currentTime = this.anchorTime;
    if (wasPlaying) this.play(0);
  }

  cancelClicks() {
    for (const src of this.scheduledClicks) {
      try { src.stop(); } catch { /* not started */ }
    }
    this.scheduledClicks = [];
  }

  rescheduleMetronome() {
    this.cancelClicks();
    this.nextBeatIndex = Math.ceil(Math.max(0, this.currentTime) / (60 / this.bpm) - 1e-6);
  }

  setMetronome(enabled) {
    this.metronomeEnabled = enabled;
    if (this.playing) this.rescheduleMetronome();
  }

  /** Call once per animation frame. */
  tick() {
    if (!this.playing) return;

    const backing = this.backing;
    if (backing && !backing.paused && !backing.seeking && backing.readyState >= 2) {
      const clock = this.currentTime;
      const media = backing.currentTime;
      if (Math.abs(clock - media) > RESYNC_THRESHOLD) this.setAnchor(media);
      if (this.stem && Math.abs(this.stem.currentTime - media) > STEM_SYNC_THRESHOLD) {
        this.stem.currentTime = media;
      }
    }

    const now = this.currentTime;

    if (this.metronomeEnabled && now >= 0) {
      const secondsPerBeat = 60 / this.bpm;
      const horizon = now + METRONOME_LOOKAHEAD_REAL * this.rate;
      while (this.nextBeatIndex * secondsPerBeat <= horizon) {
        const beatTime = this.nextBeatIndex * secondsPerBeat;
        const when = audio.ctx.currentTime + (beatTime - now) / this.rate;
        this.scheduledClicks.push(audio.scheduleClick(when, this.nextBeatIndex % this.beatsPerBar === 0));
        this.nextBeatIndex++;
      }
      if (this.scheduledClicks.length > 64) this.scheduledClicks.splice(0, this.scheduledClicks.length - 64);
    }

    const ended = backing ? backing.ended || now >= this.duration : now >= this.duration;
    if (ended && now > 0) {
      this.pause();
      this.setAnchor(this.duration);
      this.onEnded?.();
    }
  }

  dispose() {
    this.pause();
    for (const el of [this.backing, this.stem]) {
      if (!el) continue;
      el.removeAttribute('src');
      el.load();
    }
  }
}
