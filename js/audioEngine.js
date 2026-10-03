// Web Audio replacement for Audio/AudioPlaybackEngine.cs, DrumFeedbackProvider.cs and MetronomeProvider.cs.

import { generateDrumBuffers, generateClick } from './drumSynth.js';

const MAX_VOICES = 16;
const METRONOME_BOOST = 2; // the metronome slider's full scale, so the click can sit on top of a loud line-in

class AudioEngine {
  constructor() {
    this.ctx = null;
  }

  /** Creates the AudioContext lazily; browsers only allow it to start after a user gesture. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    // Song + line-in drums + click can sum past full scale; a fast limiter keeps that from clipping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.feedbackGain = ctx.createGain();
    this.metronomeGain = ctx.createGain();
    this.backingGain = ctx.createGain();
    this.stemGain = ctx.createGain();
    for (const g of [this.feedbackGain, this.metronomeGain, this.backingGain, this.stemGain]) g.connect(this.master);

    this.drumBuffers = generateDrumBuffers(ctx);
    this.accentClick = generateClick(ctx, 2200, 0.06, 0.9);
    this.normalClick = generateClick(ctx, 1650, 0.05, 0.65);
    this.voices = [];
    return ctx;
  }

  get outputLatency() {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  /** Plays a drum one-shot. Velocity 1–127 maps to gain 0.3–1.0, as in the desktop app. */
  trigger(lane, velocity = 100) {
    const ctx = this.ensure();
    const buffer = this.drumBuffers[lane];
    if (!buffer) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, Math.max(0.3, velocity / 127));
    src.connect(gain).connect(this.feedbackGain);
    src.start();

    // Round-robin voice stealing keeps polyphony bounded.
    this.voices.push(src);
    src.onended = () => {
      const i = this.voices.indexOf(src);
      if (i >= 0) this.voices.splice(i, 1);
    };
    if (this.voices.length > MAX_VOICES) {
      const oldest = this.voices.shift();
      try { oldest.stop(); } catch { /* already stopped */ }
    }
  }

  /** Schedules a metronome click at an AudioContext time. Returns the source so it can be cancelled. */
  scheduleClick(when, accent) {
    const ctx = this.ensure();
    const src = ctx.createBufferSource();
    src.buffer = accent ? this.accentClick : this.normalClick;
    src.connect(this.metronomeGain);
    src.start(Math.max(when, ctx.currentTime));
    return src;
  }

  setVolume(which, value) {
    this.ensure();
    const node = {
      master: this.master,
      feedback: this.feedbackGain,
      metronome: this.metronomeGain,
      backing: this.backingGain,
      stem: this.stemGain,
    }[which];
    if (node) node.gain.value = which === 'metronome' ? value * METRONOME_BOOST : value;
  }

  /** Routes an <audio> element through the given gain bus. */
  connectMedia(element, bus) {
    const ctx = this.ensure();
    const src = ctx.createMediaElementSource(element);
    src.connect(bus === 'stem' ? this.stemGain : this.backingGain);
    return src;
  }

  /**
   * Monitors a line-in (e.g. the drum module's output) through the drum-sound bus, so it is mixed
   * with the song and follows the drum volume slider. Browser processing (echo cancellation etc.)
   * is disabled — it would mangle drums and add latency.
   */
  async startLineIn(deviceId) {
    const ctx = this.ensure();
    this.stopLineIn();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        latency: { ideal: 0 },
      },
    });
    this.lineInStream = stream;
    this.lineInSource = ctx.createMediaStreamSource(stream);
    this.lineInAnalyser = ctx.createAnalyser();
    this.lineInAnalyser.fftSize = 1024;
    this.lineInSource.connect(this.feedbackGain);
    this.lineInSource.connect(this.lineInAnalyser);
    return stream.getAudioTracks()[0]?.label || 'Line in';
  }

  stopLineIn() {
    this.lineInSource?.disconnect();
    for (const track of this.lineInStream?.getTracks() ?? []) track.stop();
    this.lineInStream = null;
    this.lineInSource = null;
    this.lineInAnalyser = null;
  }

  get lineInActive() {
    return !!this.lineInStream;
  }

  /** Peak level 0..1 of the line-in, for a meter. */
  lineInLevel() {
    if (!this.lineInAnalyser) return 0;
    const data = new Float32Array(this.lineInAnalyser.fftSize);
    this.lineInAnalyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    return Math.min(1, peak);
  }

  async setOutputDevice(deviceId) {
    const ctx = this.ensure();
    if (typeof ctx.setSinkId !== 'function') return false;
    await ctx.setSinkId(deviceId || '');
    return true;
  }

  static supportsOutputSelection() {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }
}

export const audio = new AudioEngine();
export { AudioEngine };
