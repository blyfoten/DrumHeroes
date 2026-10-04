// Run review: what you played against what the song asked for, timing analysis and offset advice.

import { h, formatDate, toast } from '../dom.js';
import { LANES, LANE_INFO, difficultyLabel } from '../drumMap.js';
import { analyzeRecording, timingAdvice, recordingToMidi, signedMs } from '../analysis.js';

const EARLY_COLOR = '#45B7D1';
const LATE_COLOR = '#FFD700';
const HIT_COLOR = '#00E676';
const PERFECT_COLOR = '#FFE66D';
const MISS_COLOR = '#E94560';
const INK = '#FFFFFF';
const INK_MUTED = '#8A8AA0';
const GRID = 'rgba(255,255,255,0.08)';
const SURFACE = '#16213E';
const FONT = '12px system-ui, "Segoe UI", sans-serif';

export function openRunReview({ song, run, onApplyOffset }) {
  const rec = run.recording;
  const analysis = analyzeRecording(rec);
  const advice = timingAdvice(analysis, rec.offsetMs);
  const played = run.hits + (run.extra ?? 0);

  // ---------- stat tiles ----------
  const tile = (label, value, sub, cls = '') => h('div.stat-tile',
    h('div.muted', label), h(`div.tile-value${cls}`, value), h('div.muted.hint', sub));
  const tiles = h('div.stat-tiles',
    tile('Hit', `${run.accuracy.toFixed(1)}%`, `${run.hits} of ${run.total} notes`, '.good'),
    tile('Perfect', `${(run.perfectRate ?? 0).toFixed(1)}%`, `${run.perfect ?? 0} of ${run.total} notes`),
    tile('Missed', `${pct(run.misses, run.total).toFixed(1)}%`, `${run.misses} of ${run.total} notes`, '.bad'),
    tile('Wrong hits', `${(run.wrongRate ?? 0).toFixed(1)}%`, `${run.extra ?? 0} of ${played} hits matched no note`));

  // ---------- timing advice ----------
  const applyBtn = advice.kind === 'suggest' && h('button.btn.primary', {
    on: {
      click: () => {
        onApplyOffset(advice.newOffset);
        applyBtn.disabled = true;
        applyBtn.textContent = `Offset set to ${advice.newOffset} ms ✓`;
        toast(`Hit timing offset set to ${advice.newOffset} ms. Play the song again to check.`, 'success');
      },
    },
  }, `Set offset to ${advice.newOffset} ms`);
  const adviceBox = h(`div.advice.${advice.kind}`, h('div', advice.text), applyBtn);

  // ---------- histogram ----------
  const histCanvas = h('canvas.chart');
  const histTip = h('div.chart-tip.hidden');
  const histWrap = h('div.chart-wrap', histCanvas, histTip);

  // ---------- per-lane table ----------
  const laneRows = LANES.filter((l) => analysis.perLane[l.lane]).map((l) => {
    const s = analysis.perLane[l.lane];
    return h('tr',
      h('td', h('span.swatch', { style: { background: l.color } }), l.name),
      h('td', s.notes), h('td', s.hit), h('td', s.perfect), h('td', s.missed), h('td', s.wrong),
      h('td', s.median === null ? '–' : signedMs(s.median)));
  });
  const laneTable = h('table.lane-table',
    h('thead', h('tr', ['Lane', 'Notes', 'Hit', 'Perfect', 'Missed', 'Wrong hits', 'Timing (median)'].map((t) => h('th', t)))),
    h('tbody', laneRows));

  // ---------- timeline ----------
  const tlCanvas = h('canvas.chart.timeline', { tabindex: 0 });
  const tlTip = h('div.chart-tip.hidden');
  const tlWrap = h('div.chart-wrap', tlCanvas, tlTip);
  const zoomOut = h('button.btn.small', { title: 'Zoom out' }, '−');
  const zoomIn = h('button.btn.small', { title: 'Zoom in' }, '+');
  const fitBtn = h('button.btn.small', { title: 'Show the whole run' }, 'Fit');
  const legend = h('div.legend',
    legendItem('dot', PERFECT_COLOR, 'Perfect'),
    legendItem('dot', HIT_COLOR, 'Hit'),
    legendItem('ring', MISS_COLOR, 'Missed note'),
    legendItem('tick', INK, 'Your hit'),
    legendItem('cross', MISS_COLOR, 'Wrong hit'));

  const download = () => {
    const bytes = recordingToMidi(rec, { bpm: song.bpm, title: song.title });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    const a = h('a', { href: url, download: `${song.title} - run ${formatDate(run.timestamp).replace(/:/g, '-')}.mid` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Escape closes. Space closes too and lets the practice screen start the song over;
  // R mustn't restart the song behind the review.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
    else if (e.code === 'Space') close();
    else if (e.key === 'r') e.stopImmediatePropagation();
  };
  const close = () => {
    window.removeEventListener('resize', redraw);
    window.removeEventListener('keydown', onKey, true);
    modal.remove();
  };
  window.addEventListener('keydown', onKey, true);
  const modal = h('div.modal',
    h('div.modal-card.review',
      h('div.history-head',
        h('div', h('h2', 'Run review'),
          h('div.muted', `${song.title} · ${formatDate(run.timestamp)} · ${difficultyLabel(run.difficulty, run.windowMs)}`
            + ` · ${Math.round(run.tempoPercent)}% tempo${run.completed ? '' : ' · stopped early'}`)),
        h('button.btn.icon', { 'aria-label': 'Close', on: { click: close } }, '✕')),
      tiles,
      h('section.review-section',
        h('div.setting-title', 'TIMING'),
        adviceBox,
        h('div.muted.hint', 'How early or late your hits landed (ms, after the current offset). Dashed lines mark the hit window.'),
        histWrap),
      h('section.review-section',
        h('div.setting-title', 'PER LANE'),
        h('div.table-scroll', laneTable)),
      h('section.review-section',
        h('div.row.timeline-head', h('div.setting-title', 'TIMELINE: SONG VS. YOUR HITS'), h('div.row', zoomOut, zoomIn, fitBtn)),
        legend,
        tlWrap,
        h('div.muted.hint', 'Drag to scroll, mouse wheel to zoom. Lines join each hit to the note it matched.')),
      h('div.dialog-actions',
        h('button.btn', { on: { click: download } }, '⬇ Download MIDI (song + your hits)'),
        h('button.btn.primary', { on: { click: close } }, 'Close'))));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.body.append(modal);

  // ---------- drawing ----------
  const hist = histogram(histCanvas, histTip, analysis, rec.windowMs);
  const timeline = timelineChart(tlCanvas, tlTip, rec, song);
  zoomIn.addEventListener('click', () => timeline.zoom(0.5));
  zoomOut.addEventListener('click', () => timeline.zoom(2));
  fitBtn.addEventListener('click', () => timeline.fit());
  function redraw() {
    hist.draw();
    timeline.draw();
  }
  window.addEventListener('resize', redraw);
  redraw();
}

function legendItem(kind, color, label) {
  const c = h('canvas', { width: 28, height: 28, style: { width: '14px', height: '14px' } });
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  drawMark(ctx, kind, 7, 7, color);
  return h('span.legend-item', c, label);
}

function drawMark(ctx, kind, x, y, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  if (kind === 'dot') {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'ring') {
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'tick') {
    ctx.fillRect(x - 1, y - 7, 2, 14);
  } else if (kind === 'cross') {
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
  }
  ctx.restore();
}

function setupCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.parentElement.clientWidth;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height: cssHeight };
}

function showTip(tip, canvas, x, y, html) {
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const maxX = canvas.clientWidth - tip.offsetWidth - 4;
  tip.style.left = `${Math.max(4, Math.min(maxX, x + 12))}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
}

// ---------- timing histogram ----------

function histogram(canvas, tip, analysis, windowMs) {
  const values = analysis.samples.map((s) => s.ms);
  const maxAbs = Math.max(windowMs, ...values.map(Math.abs));
  const range = Math.min(250, Math.ceil((maxAbs + 1) / 25) * 25);
  const binMs = range <= 100 ? 5 : 10;
  const bins = [];
  for (let lo = -range; lo < range; lo += binMs) bins.push({ lo, hi: lo + binMs, count: 0 });
  for (const v of values) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((v + range) / binMs)));
    bins[i].count++;
  }
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  let geo = null;

  function draw() {
    const { ctx, width, height } = setupCanvas(canvas, 170);
    const pad = { l: 34, r: 12, t: 22, b: 26 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const x = (ms) => pad.l + ((ms + range) / (2 * range)) * plotW;
    const y = (count) => pad.t + plotH - (count / maxCount) * plotH;
    geo = { x, pad, plotW, plotH };
    ctx.clearRect(0, 0, width, height);
    ctx.font = FONT;

    // Recessive grid + y labels.
    ctx.fillStyle = INK_MUTED;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const c of [0, Math.round(maxCount / 2), maxCount]) {
      ctx.fillStyle = GRID;
      ctx.fillRect(pad.l, Math.round(y(c)), plotW, 1);
      ctx.fillStyle = INK_MUTED;
      ctx.fillText(String(c), pad.l - 6, y(c));
    }

    // Bars: early (cool) / late (warm), with a 2px gap between bars. 0 is always a bin edge.
    const barW = Math.max(1, plotW / bins.length - 2);
    for (const b of bins) {
      if (!b.count) continue;
      const bx = x(b.lo) + 1;
      const by = y(b.count);
      ctx.fillStyle = b.hi <= 0 ? EARLY_COLOR : LATE_COLOR;
      roundTop(ctx, bx, by, barW, pad.t + plotH - by, Math.min(4, barW / 2));
    }

    // Hit window and zero line.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([4, 4]);
    for (const w of [-windowMs, windowMs]) {
      if (Math.abs(w) > range) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(w)) + 0.5, pad.t);
      ctx.lineTo(Math.round(x(w)) + 0.5, pad.t + plotH);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(Math.round(x(0)), pad.t, 1, plotH);

    // Median marker with a direct label.
    if (analysis.median !== null) {
      const mx = Math.round(x(analysis.median));
      ctx.fillStyle = INK;
      ctx.fillRect(mx - 1, pad.t - 4, 2, plotH + 4);
      ctx.textAlign = mx > width - 90 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`median ${signedMs(analysis.median)}`, mx + (ctx.textAlign === 'left' ? 5 : -5), pad.t - 4);
    }

    // X axis labels.
    ctx.fillStyle = INK_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = range <= 100 ? 25 : 50;
    for (let ms = -range; ms <= range; ms += step) {
      ctx.fillText(ms === 0 ? '0' : ms > 0 ? `+${ms}` : `−${-ms}`, x(ms), pad.t + plotH + 6);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('← early', pad.l + 2, pad.t + 2);
    ctx.textAlign = 'right';
    ctx.fillText('late →', pad.l + plotW - 2, pad.t + 2);
    if (!values.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No hits recorded', pad.l + plotW / 2, pad.t + plotH / 2);
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!geo) return;
    const mx = e.offsetX;
    const i = Math.floor(((mx - geo.pad.l) / geo.plotW) * bins.length);
    const b = bins[i];
    if (!b) { tip.classList.add('hidden'); return; }
    const fmt = (ms) => (ms > 0 ? `+${ms}` : ms < 0 ? `−${-ms}` : '0');
    showTip(tip, canvas, mx, e.offsetY,
      `<b>${fmt(b.lo)} to ${fmt(b.hi)} ms</b><br>${b.count} hit${b.count === 1 ? '' : 's'}`);
  });
  canvas.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  return { draw };
}

function roundTop(ctx, x, y, w, hgt, r) {
  if (hgt <= 0) return;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, hgt, [r, r, 0, 0]);
  else ctx.rect(x, y, w, hgt);
  ctx.fill();
}

// ---------- timeline ----------

function timelineChart(canvas, tip, rec, song) {
  const lanes = LANES.filter((l) => rec.notes.some((n) => n.lane === l.lane) || rec.hits.some((x) => x.lane === l.lane));
  const row = Object.fromEntries(lanes.map((l, i) => [l.lane, i]));
  const ROW_H = 30;
  const pad = { l: 70, r: 12, t: 8, b: 24 };
  const lastTime = Math.max(rec.endTime, ...rec.hits.map((x) => x.time), 1);
  const firstTime = Math.min(rec.notes[0]?.time ?? 0, rec.hits[0]?.time ?? 0);
  const beat = 60 / song.bpm;
  const beatsPerBar = song.timeSignature?.numerator || 4;
  let start = firstTime - beat / 2;
  let span = Math.min(Math.max(4 * beatsPerBar * beat, 4), lastTime - start + beat); // ~4 bars to start with
  let geo = null;
  let marks = []; // for hover: {x, y, html}

  const clampView = () => {
    const total = lastTime + beat;
    span = Math.min(Math.max(span, 1), Math.max(total, 1));
    start = Math.min(Math.max(start, -beat), total - span);
  };

  function draw() {
    const height = pad.t + lanes.length * ROW_H + pad.b;
    const { ctx, width } = setupCanvas(canvas, height);
    const plotW = width - pad.l - pad.r;
    const x = (t) => pad.l + ((t - start) / span) * plotW;
    const y = (lane) => pad.t + row[lane] * ROW_H + ROW_H / 2;
    geo = { x, plotW };
    marks = [];
    ctx.clearRect(0, 0, width, height);
    ctx.font = FONT;

    // Lane rows and labels (identity is the row, not the colour).
    lanes.forEach((l, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(pad.l, pad.t + i * ROW_H, plotW, ROW_H);
      }
      ctx.fillStyle = l.color;
      ctx.fillRect(6, pad.t + i * ROW_H + ROW_H / 2 - 4, 8, 8);
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.label, 20, pad.t + i * ROW_H + ROW_H / 2);
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, 0, plotW, height);
    ctx.clip();

    // Beat / bar grid and time labels.
    const plotBottom = pad.t + lanes.length * ROW_H;
    const firstBeat = Math.ceil(start / beat);
    const pxPerBeat = (beat / span) * plotW;
    for (let b = firstBeat; b * beat <= start + span; b++) {
      const isBar = b % beatsPerBar === 0;
      if (!isBar && pxPerBeat < 8) continue;
      ctx.fillStyle = isBar ? 'rgba(255,255,255,0.14)' : GRID;
      ctx.fillRect(Math.round(x(b * beat)), pad.t, 1, plotBottom - pad.t);
      const labelEvery = Math.max(1, Math.ceil(60 / (pxPerBeat * beatsPerBar)));
      if (isBar && (b / beatsPerBar) % labelEvery === 0) {
        const label = `bar ${b / beatsPerBar + 1}`;
        const half = ctx.measureText(label).width / 2;
        const lx = x(b * beat);
        if (lx - half >= pad.l && lx + half <= pad.l + plotW) { // skip labels the edges would cut
          ctx.fillStyle = INK_MUTED;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, lx, plotBottom + 6);
        }
      }
    }

    // Part of the song that wasn't played (run stopped early).
    if (rec.endTime < start + span) {
      const ex = Math.max(pad.l, x(rec.endTime));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(ex, pad.t, pad.l + plotW - ex, plotBottom - pad.t);
    }

    const visible = (t) => t >= start - 0.2 && t <= start + span + 0.2;
    const hitsByNote = new Map(rec.hits.filter((x) => x.noteIndex >= 0).map((x) => [x.noteIndex, x]));
    const toMs = (s) => (s / rec.rate) * 1000;

    // Connectors from each matched note to the hit that matched it.
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    for (const [i, hit] of hitsByNote) {
      const n = rec.notes[i];
      if (!visible(n.time) && !visible(hit.time)) continue;
      ctx.beginPath();
      ctx.moveTo(x(n.time), y(n.lane));
      ctx.lineTo(x(hit.time), y(hit.lane));
      ctx.stroke();
    }

    // Song notes: perfect / hit = filled, missed = hollow ring.
    rec.notes.forEach((n, i) => {
      if (!visible(n.time) || row[n.lane] === undefined) return;
      const nx = x(n.time);
      const ny = y(n.lane);
      const hit = hitsByNote.get(i);
      if (n.state === 'hit') {
        ctx.fillStyle = SURFACE; // 2px surface ring so overlapping marks stay distinct
        ctx.beginPath();
        ctx.arc(nx, ny, 7, 0, Math.PI * 2);
        ctx.fill();
        drawMark(ctx, 'dot', nx, ny, hit?.perfect ? PERFECT_COLOR : HIT_COLOR);
      } else if (n.state === 'missed') {
        drawMark(ctx, 'ring', nx, ny, MISS_COLOR);
      } else {
        drawMark(ctx, 'ring', nx, ny, INK_MUTED);
      }
      const outcome = n.state === 'hit'
        ? `${hit?.perfect ? 'Perfect' : 'Hit'}, ${signedMs(toMs(hit.time - n.time))}`
        : n.state === 'missed' ? 'Missed' : 'Not played';
      marks.push({ x: nx, y: ny, html: `<b>${LANE_INFO[n.lane].name} note</b><br>${fmtTime(n.time)} · ${outcome}` });
    });

    // Your hits: tick = matched, cross = wrong hit.
    for (const hit of rec.hits) {
      if (!visible(hit.time) || row[hit.lane] === undefined) continue;
      const hx = x(hit.time);
      const hy = y(hit.lane);
      const matched = hit.noteIndex >= 0;
      drawMark(ctx, matched ? 'tick' : 'cross', hx, hy, matched ? INK : MISS_COLOR);
      const what = matched
        ? `matched a note ${signedMs(toMs(hit.time - rec.notes[hit.noteIndex].time))}${hit.perfect ? ' (perfect)' : ''}`
        : 'wrong hit: no note in the window';
      const src = hit.note !== null && hit.note !== undefined ? `MIDI note ${hit.note}` : 'keyboard';
      marks.push({ x: hx, y: hy, html: `<b>Your hit · ${LANE_INFO[hit.lane].name}</b><br>${fmtTime(hit.time)} · ${what}<br><span class="muted">${src}${hit.velocity ? `, velocity ${hit.velocity}` : ''}</span>` });
    }
    ctx.restore();
  }

  function fit() {
    start = Math.max(-beat, firstTime - beat);
    span = lastTime - start + beat;
    clampView();
    draw();
  }

  function zoom(factor, anchorX = null) {
    const anchorT = anchorX === null ? start + span / 2 : start + ((anchorX - pad.l) / geo.plotW) * span;
    span *= factor;
    start = anchorT - (anchorX === null ? span / 2 : ((anchorX - pad.l) / geo.plotW) * span);
    clampView();
    draw();
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, start };
    canvas.setPointerCapture(e.pointerId);
    tip.classList.add('hidden');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      start = drag.start - ((e.clientX - drag.x) / geo.plotW) * span;
      clampView();
      draw();
      return;
    }
    let best = null;
    let bestD = 10;
    for (const m of marks) {
      const d = Math.hypot(m.x - e.offsetX, m.y - e.offsetY);
      if (d < bestD) { best = m; bestD = d; }
    }
    if (best) showTip(tip, canvas, best.x, best.y, best.html);
    else tip.classList.add('hidden');
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.25 : 0.8, e.offsetX);
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { start -= span * 0.2; clampView(); draw(); }
    else if (e.key === 'ArrowRight') { start += span * 0.2; clampView(); draw(); }
    else if (e.key === '+' || e.key === '=') zoom(0.8);
    else if (e.key === '-') zoom(1.25);
  });

  clampView();
  return { draw, zoom, fit };
}

function fmtTime(t) {
  const sign = t < 0 ? '−' : '';
  const a = Math.abs(t);
  return `${sign}${Math.floor(a / 60)}:${(a % 60).toFixed(3).padStart(6, '0')}`;
}

function pct(part, whole) {
  return whole ? (part / whole) * 100 : 0;
}
