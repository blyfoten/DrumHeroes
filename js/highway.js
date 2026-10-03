// Canvas drum highway (port of Views/Controls/DrumHighwayControl.xaml.cs).

import { LANES } from './drumMap.js';

const HIT_LINE_Y = 0.85;
const HEADER_HEIGHT = 40;
const NOTE_HEIGHT = 14;
const LOOK_AHEAD_REAL = 3.0;
const MAX_LANE_WIDTH = 150;
const FLASH_MS = 200;
const HIT_COLOR = '#00E676';
const MISS_COLOR = '#E94560';

export class Highway {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.notes = [];
    this.setLanes(LANES);
    this.flashes = new Map(); // lane -> {hit, at}
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Sets the notes and narrows the highway to the lanes they use (kit order is kept). */
  setNotes(notes) {
    this.notes = notes;
    const used = new Set(notes.map((n) => n.lane));
    this.setLanes(used.size ? LANES.filter((l) => used.has(l.lane)) : LANES);
  }

  setLanes(lanes) {
    this.lanes = lanes;
    this.laneIndex = Object.fromEntries(lanes.map((l, i) => [l.lane, i]));
  }

  flash(lane, hit) {
    if (lane in this.laneIndex) this.flashes.set(lane, { hit, at: performance.now() });
  }

  draw(time, rate = 1) {
    const { ctx, height } = this;
    const fullWidth = this.width;
    if (fullWidth <= 0 || height <= 0) return;

    // Few lanes stay a playable width and centred instead of stretching across the screen.
    const laneCount = this.lanes.length;
    const laneWidth = Math.min(fullWidth / laneCount, MAX_LANE_WIDTH);
    const width = laneWidth * laneCount;
    const offsetX = (fullWidth - width) / 2;
    const hitLineY = height * HIT_LINE_Y;
    const highwayHeight = hitLineY - HEADER_HEIGHT;
    const lookAhead = LOOK_AHEAD_REAL * rate;

    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, fullWidth, height);
    ctx.save();
    ctx.translate(offsetX, 0);

    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(i * laneWidth, HEADER_HEIGHT, laneWidth, height - HEADER_HEIGHT);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 1; i < laneCount; i++) ctx.fillRect(Math.round(i * laneWidth), HEADER_HEIGHT, 1, height - HEADER_HEIGHT);

    // Beat lines help with reading rhythm.
    if (this.beatSeconds > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      const first = Math.ceil((time - 0.5 * rate) / this.beatSeconds);
      for (let b = first; b * this.beatSeconds <= time + lookAhead; b++) {
        const y = hitLineY - ((b * this.beatSeconds - time) / lookAhead) * highwayHeight;
        if (y < HEADER_HEIGHT || y > height) continue;
        const isBar = this.beatsPerBar && b % this.beatsPerBar === 0;
        ctx.fillStyle = isBar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, y, width, isBar ? 2 : 1);
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, hitLineY - 1.5, width, 3);

    const receptor = Math.min(16, laneWidth * 0.45);
    for (let i = 0; i < laneCount; i++) {
      const x = i * laneWidth + (laneWidth - receptor) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.27)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x, hitLineY - receptor / 2, receptor, receptor, 3);
      ctx.fill();
      ctx.stroke();
    }

    const now = performance.now();
    for (const [lane, { hit, at }] of this.flashes) {
      const elapsed = now - at;
      if (elapsed >= FLASH_MS) { this.flashes.delete(lane); continue; }
      const alpha = 0.78 * (1 - elapsed / FLASH_MS);
      ctx.fillStyle = hit ? `rgba(0,230,118,${alpha})` : `rgba(233,69,96,${alpha})`;
      ctx.fillRect(this.laneIndex[lane] * laneWidth, hitLineY - 30, laneWidth, 60);
    }

    const windowStart = time - 0.5 * rate;
    const windowEnd = time + lookAhead;
    // Notes are sorted: binary-search the first visible one.
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].time < windowStart) lo = mid + 1; else hi = mid;
    }
    // Long intros without drums: say when the first note arrives instead of showing an empty highway.
    const upcoming = this.notes[lo];
    if (upcoming && upcoming.time > windowEnd) {
      const seconds = Math.ceil((upcoming.time - time) / rate);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 16px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Drums start in ${seconds}s`, width / 2, HEADER_HEIGHT + highwayHeight / 3);
    }

    for (let i = lo; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time > windowEnd) break;
      const idx = this.laneIndex[note.lane];
      const y = hitLineY - ((note.time - time) / lookAhead) * highwayHeight;
      if (y < HEADER_HEIGHT - NOTE_HEIGHT) continue;
      ctx.fillStyle = note.state === 'hit' ? HIT_COLOR : note.state === 'missed' ? MISS_COLOR : this.lanes[idx].color;
      roundRect(ctx, idx * laneWidth + 4, y - NOTE_HEIGHT / 2, laneWidth - 8, NOTE_HEIGHT, 4);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(22,33,62,0.95)';
    ctx.fillRect(-offsetX, 0, fullWidth, HEADER_HEIGHT); // keep scrolled-up notes under the header
    ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = this.lanes[i].color;
      ctx.fillText(this.lanes[i].label, i * laneWidth + laneWidth / 2, HEADER_HEIGHT / 2);
    }
    ctx.restore();
  }

  dispose() {
    this.observer.disconnect();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
