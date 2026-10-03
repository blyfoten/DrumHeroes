// Canvas drum highway (port of Views/Controls/DrumHighwayControl.xaml.cs), drawn as a Guitar Hero-style
// track that recedes toward a horizon: notes start small in the distance and grow as they come at you.

import { LANES } from './drumMap.js';

const HIT_LINE_Y = 0.82;
const TOP_MARGIN = 24; // the far end of the track
const NOTE_HEIGHT = 16; // at the hit line; shrinks with distance
const LOOK_AHEAD_REAL = 3.0;
const MAX_LANE_WIDTH = 170; // at the hit line
const MAX_TRACK_FRACTION = 0.9; // of the canvas width, at the hit line
const DEPTH = 3; // the far end is 1 / (1 + DEPTH) as wide as the near end
const FLASH_MS = 200;
const HIT_COLOR = '#00E676';
const MISS_COLOR = '#E94560';
const PERFECT_COLOR = '#FFE66D';
const WAVE_MS = 450;
const BEAM_MS = 350;
const GRAVITY = 1400; // px/s² pulling sparks back down

export class Highway {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.notes = [];
    this.setLanes(LANES);
    this.flashes = new Map(); // lane -> {hit, perfect, at}
    this.pendingBursts = []; // {lane, perfect}: turned into effects on the next draw, where ring positions are known
    this.particles = [];
    this.waves = [];
    this.beams = [];
    this.lastDraw = 0;
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

  /** Flashes a lane's target; a judged hit also bursts into sparks, much bigger when perfect. */
  flash(lane, hit, perfect = null) {
    if (!(lane in this.laneIndex)) return;
    this.flashes.set(lane, { hit, perfect: !!perfect, at: performance.now() });
    if (hit && perfect !== null) this.pendingBursts.push({ lane, perfect });
  }

  spawnBurst(x, y, ringW, color, perfect, now) {
    const count = perfect ? 46 : 12;
    const speed = perfect ? 620 : 300;
    const palette = perfect ? [color, PERFECT_COLOR, '#FFFFFF'] : [color, '#FFFFFF'];
    for (let i = 0; i < count; i++) {
      // Mostly upward, fanning out sideways.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * (perfect ? Math.PI * 1.5 : Math.PI);
      const v = speed * (0.35 + Math.random() * 0.65);
      const life = (perfect ? 550 : 320) * (0.6 + Math.random() * 0.4);
      this.particles.push({
        x: x + (Math.random() - 0.5) * ringW,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        size: (perfect ? 3.5 : 2.5) * (0.6 + Math.random() * 0.8),
        color: palette[i % palette.length],
        born: now,
        life,
      });
    }
    if (perfect) {
      this.waves.push({ x, y, ringW, color: PERFECT_COLOR, born: now });
      this.waves.push({ x, y, ringW, color, born: now + 90 });
    }
  }

  drawEffects(ctx, now, dt, ringW, ringH, laneTopX) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Beams of light up the lane.
    this.beams = this.beams.filter((b) => now - b.born < BEAM_MS);
    for (const b of this.beams) {
      const idx = this.laneIndex[b.lane];
      if (idx === undefined) continue;
      const k = 1 - (now - b.born) / BEAM_MS;
      const { x0, x1, y0, top } = laneTopX(idx);
      const grad = ctx.createLinearGradient(0, y0, 0, top.y);
      grad.addColorStop(0, `rgba(255,230,109,${0.55 * k})`);
      grad.addColorStop(1, 'rgba(255,230,109,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(top.x1, top.y);
      ctx.lineTo(top.x0, top.y);
      ctx.closePath();
      ctx.fill();
    }

    // Shockwave rings.
    this.waves = this.waves.filter((w) => now - w.born < WAVE_MS);
    for (const w of this.waves) {
      const age = now - w.born;
      if (age < 0) continue;
      const k = age / WAVE_MS;
      const grow = 1 + 2.2 * easeOut(k);
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.strokeStyle = w.color;
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, w.ringW * grow, ringH * grow, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sparks.
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - (now - p.born) / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  draw(time, rate = 1) {
    const { ctx, height } = this;
    const fullWidth = this.width;
    if (fullWidth <= 0 || height <= 0) return;

    const laneCount = this.lanes.length;
    const laneWidth = Math.min((fullWidth * MAX_TRACK_FRACTION) / laneCount, MAX_LANE_WIDTH);
    const halfWidth = (laneWidth * laneCount) / 2;
    const cx = fullWidth / 2;
    const hitY = height * HIT_LINE_Y;
    const lookAhead = LOOK_AHEAD_REAL * rate;

    // Perspective: depth d runs from 0 at the hit line to 1 at the far end (negative = past you).
    // scale(d) = 1 / (1 + DEPTH·d), and screen y moves toward a vanishing point at the same rate.
    const vanishY = (TOP_MARGIN * (1 + DEPTH) - hitY) / DEPTH;
    const scaleAt = (d) => 1 / (1 + DEPTH * Math.max(d, -0.8 / DEPTH));
    const yAt = (s) => vanishY + (hitY - vanishY) * s;
    const xAt = (laneEdge, s) => cx + (laneEdge * laneWidth - halfWidth) * s; // laneEdge in lanes from the left
    const depthOf = (t) => (t - time) / lookAhead;
    const sFar = scaleAt(1);
    const sNear = (height - vanishY) / (hitY - vanishY); // where the track leaves the canvas bottom

    // Backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#0B0B1A');
    sky.addColorStop(1, '#1A1A2E');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, fullWidth, height);

    const quad = (left, right, s0, s1) => {
      ctx.beginPath();
      ctx.moveTo(xAt(left, s0), yAt(s0));
      ctx.lineTo(xAt(right, s0), yAt(s0));
      ctx.lineTo(xAt(right, s1), yAt(s1));
      ctx.lineTo(xAt(left, s1), yAt(s1));
      ctx.closePath();
    };

    // Track surface, darker in the distance.
    const surface = ctx.createLinearGradient(0, yAt(sFar), 0, height);
    surface.addColorStop(0, '#10101F');
    surface.addColorStop(1, '#2A2A48');
    quad(0, laneCount, sNear, sFar);
    ctx.fillStyle = surface;
    ctx.fill();
    for (let i = 0; i < laneCount; i += 2) {
      quad(i, i + 1, sNear, sFar);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fill();
    }

    // Lane dividers and glowing side rails.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let i = 1; i < laneCount; i++) {
      ctx.beginPath();
      ctx.moveTo(xAt(i, sNear), yAt(sNear));
      ctx.lineTo(xAt(i, sFar), yAt(sFar));
      ctx.stroke();
    }
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(78,205,196,0.8)';
    ctx.shadowColor = '#4ECDC4';
    ctx.shadowBlur = 12;
    for (const edge of [0, laneCount]) {
      ctx.beginPath();
      ctx.moveTo(xAt(edge, sNear), yAt(sNear));
      ctx.lineTo(xAt(edge, sFar), yAt(sFar));
      ctx.stroke();
    }
    ctx.restore();

    // Beat and bar lines help with reading rhythm.
    if (this.beatSeconds > 0) {
      const first = Math.ceil((time - 0.5 * rate) / this.beatSeconds);
      for (let b = first; b * this.beatSeconds <= time + lookAhead; b++) {
        const d = depthOf(b * this.beatSeconds);
        if (d > 1) break;
        const s = scaleAt(d);
        const isBar = this.beatsPerBar && b % this.beatsPerBar === 0;
        ctx.fillStyle = `rgba(255,255,255,${(isBar ? 0.22 : 0.08) * fog(d)})`;
        ctx.fillRect(xAt(0, s), yAt(s), halfWidth * 2 * s, Math.max(1, (isBar ? 3 : 1.5) * s));
      }
    }

    // Hit line and ring targets.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(xAt(0, 1), hitY - 1.5, halfWidth * 2, 3);
    const ringW = laneWidth * 0.36;
    const ringH = Math.max(NOTE_HEIGHT * 0.9, ringW * 0.42);
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this.lastDraw || now)) / 1000);
    this.lastDraw = now;
    for (const { lane, perfect } of this.pendingBursts) {
      const idx = this.laneIndex[lane];
      if (idx === undefined) continue;
      this.spawnBurst(xAt(idx + 0.5, 1), hitY, ringW, this.lanes[idx].color, perfect, now);
      if (perfect) this.beams.push({ lane, born: now });
    }
    this.pendingBursts.length = 0;
    for (let i = 0; i < laneCount; i++) {
      const x = xAt(i + 0.5, 1);
      const flash = this.flashes.get(this.lanes[i].lane);
      const elapsed = flash ? now - flash.at : FLASH_MS;
      if (elapsed >= FLASH_MS) this.flashes.delete(this.lanes[i].lane);
      ctx.beginPath();
      ctx.ellipse(x, hitY, ringW, ringH, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = this.lanes[i].color;
      ctx.stroke();
      if (elapsed < FLASH_MS) {
        const k = 1 - elapsed / FLASH_MS;
        const grow = 1 + (flash.perfect ? 0.6 : 0.3) * (1 - k);
        ctx.save();
        ctx.globalAlpha = 0.85 * k;
        ctx.fillStyle = flash.perfect ? PERFECT_COLOR : flash.hit ? HIT_COLOR : MISS_COLOR;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = flash.perfect ? 50 : 25;
        ctx.beginPath();
        ctx.ellipse(x, hitY, ringW * grow, ringH * grow, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
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
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '600 18px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Drums start in ${seconds}s`, cx, yAt(scaleAt(0.55)));
    }

    // Draw far notes first so nearer ones overlap them.
    let last = lo;
    while (last < this.notes.length && this.notes[last].time <= windowEnd) last++;
    for (let i = last - 1; i >= lo; i--) {
      const note = this.notes[i];
      const d = depthOf(note.time);
      const s = scaleAt(d);
      const y = yAt(s);
      if (y > height + NOTE_HEIGHT) continue;
      const idx = this.laneIndex[note.lane];
      const color = note.state === 'hit' ? HIT_COLOR : note.state === 'missed' ? MISS_COLOR : this.lanes[idx].color;
      const alpha = fog(d) * (note.state === 'hit' && d < 0 ? Math.max(0, 1 + d * 6) : 1);
      if (alpha <= 0) continue;
      drawGem(ctx, xAt(idx + 0.5, s), y, laneWidth * 0.4 * s, NOTE_HEIGHT * 0.75 * s, color, alpha);
    }

    const beamTop = scaleAt(0.45);
    this.drawEffects(ctx, now, dt, ringW, ringH, (idx) => ({
      x0: xAt(idx, 1),
      x1: xAt(idx + 1, 1),
      y0: hitY,
      top: { x0: xAt(idx, beamTop), x1: xAt(idx + 1, beamTop), y: yAt(beamTop) },
    }));

    // Lane labels under the targets.
    ctx.font = '700 12px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelY = Math.min(height - 10, hitY + ringH + 16);
    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = this.lanes[i].color;
      ctx.fillText(this.lanes[i].label, xAt(i + 0.5, 1), labelY);
    }
  }

  dispose() {
    this.observer.disconnect();
  }
}

function easeOut(k) {
  return 1 - (1 - k) ** 3;
}

/** Notes fade in out of the distance. */
function fog(depth) {
  return depth > 0.75 ? Math.max(0, (1 - depth) / 0.25) : 1;
}

/** A rounded gem with a darker base and a highlight, so it reads as a 3D puck lying on the track. */
function drawGem(ctx, x, y, rx, ry, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const thickness = ry * 0.6;
  ctx.fillStyle = shade(color, -0.45);
  pill(ctx, x, y + thickness / 2, rx, ry);
  ctx.fill();
  ctx.fillStyle = color;
  pill(ctx, x, y - thickness / 2, rx, ry);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  pill(ctx, x, y - thickness / 2 - ry * 0.3, rx * 0.6, ry * 0.35);
  ctx.fill();
  ctx.restore();
}

function pill(ctx, x, y, rx, ry) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - rx, y - ry, rx * 2, ry * 2, ry);
  else ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

/** Darkens (amount < 0) or lightens a #RRGGBB colour. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
