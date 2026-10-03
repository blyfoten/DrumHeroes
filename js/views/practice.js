// Practice screen (port of Views/PracticeView, ViewModels/PracticeViewModel.cs and Services/PracticeSessionService.cs).

import { h, formatTime, formatDate, toast } from '../dom.js';
import { getSong, getFile, putSong, addRun, listRuns, loadSettings, saveSettings } from '../storage.js';
import { DIFFICULTY, SPEED_PRESETS, LANE_INFO, kitProfile } from '../drumMap.js';
import { audio } from '../audioEngine.js';
import { SongPlayer } from '../songPlayer.js';
import { HitDetection } from '../hitDetection.js';
import { Highway } from '../highway.js';
import { hitBus } from '../input.js';

export async function renderPractice(root, { navigate, songId }) {
  const song = await getSong(songId);
  if (!song) {
    toast('Song not found.', 'error');
    navigate('#/library');
    return () => {};
  }

  const settings = loadSettings();
  const urls = [];
  const blobUrl = async (kind) => {
    const blob = await getFile(song.id, kind);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };

  const fold = kitProfile(settings.kitProfile).fold;
  const notes = song.notes.map((n) => ({ ...n, lane: fold[n.lane] ?? n.lane, state: 'pending', hitTime: null }));
  const player = new SongPlayer({
    backingUrl: song.hasBacking ? await blobUrl('backing') : null,
    stemUrl: song.hasStem ? await blobUrl('stem') : null,
    duration: song.duration,
    bpm: song.bpm,
    beatsPerBar: song.timeSignature?.numerator || 4,
  });
  await player.ready;

  let speed = 100;
  let difficulty = settings.difficulty;
  const detection = new HitDetection();
  detection.init(notes, DIFFICULTY[difficulty].windowMs, 1);

  for (const [bus, key] of [['backing', 'backingVolume'], ['stem', 'stemVolume'], ['feedback', 'feedbackVolume'],
    ['metronome', 'metronomeVolume'], ['master', 'masterVolume']]) {
    audio.setVolume(bus, settings[key]);
  }
  player.setMetronome(settings.metronomeEnabled);

  // ---------- DOM ----------
  const accuracyEl = h('span.stat-value.good', '0.0%');
  const hitsEl = h('span.good', '✓ 0');
  const missEl = h('span.bad', '✗ 0');
  const bpmEl = h('span');
  const midiDebugEl = h('div.pill.midi-debug.hidden', '—');
  const timeEl = h('span.time', '0:00 / 0:00');
  const progressFill = h('div.progress-fill');
  const progressBar = h('div.progress-track.seek', { title: 'Click to seek' }, progressFill);
  const playBtn = h('button.btn.primary.transport', { title: 'Play / Pause (Space)', on: { click: togglePlay } }, '▶');
  const canvas = h('canvas.highway');
  const countInEl = h('div.count-in.hidden');
  const timingEl = h('div.timing-feedback');

  const speedButtons = SPEED_PRESETS.map((p) => h('button.btn.small', { on: { click: () => setSpeed(p) } }, `${p}%`));
  const metroBtn = h('button.btn.toggle', { title: 'Metronome', on: { click: toggleMetronome } }, '🕒 Click');
  const midiBtn = h('button.btn.toggle', { title: 'Show incoming MIDI notes', on: { click: toggleMidiDebug } }, '🔌 MIDI');
  const diffSelect = h('select', { title: 'Difficulty', on: { change: (e) => setDifficulty(e.target.value) } },
    Object.entries(DIFFICULTY).map(([k, d]) => h('option', { value: k }, d.label)));
  diffSelect.value = difficulty;

  const slider = (label, key, bus, title) => {
    const input = h('input', { type: 'range', min: 0, max: 1, step: 0.01, title });
    input.value = settings[key];
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      audio.setVolume(bus, settings[key]);
      saveSettings(settings);
    });
    return h('label.vol', { title }, h('span', label), input);
  };

  const summary = h('div.modal.hidden');
  const history = h('div.modal.hidden');

  root.replaceChildren(
    h('div.practice',
      h('header.topbar.practice-top',
        h('button.btn', { on: { click: () => navigate('#/library') } }, '← Back'),
        h('div.song-heading', h('div.song-title', song.title), h('div.muted', song.artist)),
        h('div.stats',
          h('div.pill', h('span.muted', 'Accuracy '), accuracyEl),
          h('div.pill', hitsEl, ' ', missEl),
          midiDebugEl,
          h('div.pill', bpmEl))),
      h('div.highway-wrap', canvas, countInEl, timingEl),
      progressBar,
      h('footer.controls',
        h('div.group',
          playBtn,
          h('button.btn.transport', { title: 'Stop', on: { click: stop } }, '⏹'),
          h('button.btn.transport', { title: 'Restart (R)', on: { click: restart } }, '↺'),
          timeEl),
        h('div.group',
          h('span.muted', 'Speed'),
          speedButtons,
          h('button.btn.small', { title: 'BPM −5', on: { click: () => adjustBpm(-5) } }, '−'),
          h('button.btn.small', { title: 'BPM +5', on: { click: () => adjustBpm(5) } }, '+')),
        h('div.group',
          slider('🎸', 'backingVolume', 'backing', 'Backing track volume'),
          song.hasStem && slider('🥁 stem', 'stemVolume', 'stem', 'Original drum stem volume'),
          settings.drumSound !== 'off' && slider(settings.drumSound === 'linein' ? '🥁 line-in' : '🥁', 'feedbackVolume', 'feedback',
            settings.drumSound === 'linein' ? 'Drum module line-in volume' : 'Your drum sounds volume'),
          slider('🕒', 'metronomeVolume', 'metronome', 'Metronome volume')),
        h('div.group',
          diffSelect,
          metroBtn,
          midiBtn,
          h('button.btn', { on: { click: showHistory } }, '📊 History')))),
    summary,
    history);

  const highway = new Highway(canvas);
  highway.setNotes(notes);
  highway.beatSeconds = 60 / song.bpm;
  highway.beatsPerBar = song.timeSignature?.numerator || 4;

  // ---------- state & actions ----------
  let active = false; // a run is in progress (hits count)
  let showMidi = false;
  let raf = 0;

  function rate() { return speed / 100; }

  function updateStats() {
    accuracyEl.textContent = `${detection.accuracy.toFixed(1)}%`;
    hitsEl.textContent = `✓ ${detection.hitCount}`;
    missEl.textContent = `✗ ${detection.missCount}`;
  }

  function updateSpeedUi() {
    bpmEl.textContent = `${Math.round(song.bpm * rate())} BPM (${Math.round(speed)}%)`;
    speedButtons.forEach((b, i) => b.classList.toggle('active', Math.abs(SPEED_PRESETS[i] - speed) < 0.01));
  }

  function togglePlay() {
    audio.ensure();
    if (player.playing) {
      player.pause();
    } else {
      if (player.currentTime >= player.duration - 0.05) restart();
      summary.classList.add('hidden');
      active = true;
      const atStart = player.currentTime < 0.05;
      player.play(atStart ? settings.countInBars : 0);
    }
    playBtn.textContent = player.playing ? '⏸' : '▶';
  }

  async function stop() {
    const hadProgress = detection.hitCount + detection.missCount > 0;
    player.pause();
    playBtn.textContent = '▶';
    if (active && hadProgress) await finish(false);
    active = false;
    player.seek(0);
    detection.reset();
    updateStats();
  }

  function restart() {
    player.seek(0);
    if (player.playing) player.pause();
    playBtn.textContent = '▶';
    detection.reset();
    active = false;
    summary.classList.add('hidden');
    updateStats();
  }

  function setSpeed(pct) {
    speed = Math.min(300, Math.max(10, pct));
    player.setRate(rate());
    detection.setWindow(DIFFICULTY[difficulty].windowMs, rate());
    updateSpeedUi();
  }

  function adjustBpm(delta) {
    const bpm = song.bpm * rate() + delta;
    if (bpm < 20 || bpm > 300) return;
    setSpeed((bpm / song.bpm) * 100);
  }

  function setDifficulty(value) {
    difficulty = value;
    settings.difficulty = value;
    saveSettings(settings);
    detection.setWindow(DIFFICULTY[difficulty].windowMs, rate());
  }

  function toggleMetronome() {
    settings.metronomeEnabled = !settings.metronomeEnabled;
    saveSettings(settings);
    player.setMetronome(settings.metronomeEnabled);
    metroBtn.classList.toggle('on', settings.metronomeEnabled);
  }

  function toggleMidiDebug() {
    showMidi = !showMidi;
    midiBtn.classList.toggle('on', showMidi);
    midiDebugEl.classList.toggle('hidden', !showMidi);
  }

  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * player.duration;
    player.seek(t);
    detection.resetFrom(t);
    active = false; // a seeked run isn't a fair score
    updateStats();
  });

  // Every pad hit is audible; it's judged only while a run is playing.
  const offHit = hitBus.on(({ lane, note, velocity, timeStamp, source }) => {
    if (showMidi) {
      midiDebugEl.textContent = source === 'midi'
        ? `MIDI ${note} → ${lane ? LANE_INFO[lane].label : 'unmapped'} (vel ${velocity})`
        : `Key → ${LANE_INFO[lane].label}`;
    }
    if (!lane || !player.playing || !active) return;
    const offset = (settings.inputOffsetMs / 1000) * rate();
    const t = Math.max(0, player.timeAt(timeStamp) - offset);
    const result = detection.processHit(lane, t);
    for (const n of result.missed) highway.flash(n.lane, false);
    highway.flash(lane, true);
    if (result.type === 'hit') {
      const early = result.note.time > t;
      const ms = Math.round(result.diffMs / rate());
      timingEl.textContent = ms <= 10 ? 'Perfect!' : `${ms} ms ${early ? 'early' : 'late'}`;
      timingEl.className = `timing-feedback show ${ms <= 10 ? 'perfect' : early ? 'early' : 'late'}`;
    }
    updateStats();
  });

  function onKey(e) {
    if (e.target.closest('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' && !e.repeat && !e.ctrlKey && !e.metaKey) restart();
    else if (e.key === 'Escape') { summary.classList.add('hidden'); history.classList.add('hidden'); }
  }
  window.addEventListener('keydown', onKey);

  player.onEnded = () => {
    playBtn.textContent = '▶';
    if (active) finish(true);
    active = false;
  };

  async function finish(completed) {
    detection.finalize();
    updateStats();
    const run = {
      songId: song.id,
      timestamp: new Date().toISOString(),
      accuracy: detection.accuracy,
      total: detection.total,
      hits: detection.hitCount,
      misses: detection.missCount,
      difficulty,
      tempoPercent: speed,
      bpm: song.bpm * rate(),
      completed,
    };
    try {
      await addRun(run);
      song.lastPracticed = run.timestamp;
      await putSong(song);
    } catch (err) {
      toast(`Failed to save performance: ${err.message}`, 'error');
    }
    showSummary(run);
  }

  function showSummary(run) {
    summary.replaceChildren(h('div.modal-card.summary',
      h('h2', run.completed ? 'Performance Summary' : 'Run Stopped'),
      h('div.big-accuracy', run.accuracy.toFixed(1), h('small', '%')),
      h('div.summary-stats',
        h('div', h('div.good.n', run.hits), h('div.muted', 'Hits')),
        h('div', h('div.bad.n', run.misses), h('div.muted', 'Missed')),
        h('div', h('div.n', run.total), h('div.muted', 'Total'))),
      h('div.summary-details',
        h('div', 'Song: ', h('b', song.title)),
        h('div', 'Difficulty: ', h('b', DIFFICULTY[run.difficulty].label)),
        h('div', 'Tempo: ', h('b', `${Math.round(run.tempoPercent)}% (${Math.round(run.bpm)} BPM)`))),
      h('div.dialog-actions',
        h('button.btn', { on: { click: () => navigate('#/library') } }, 'Back to Library'),
        h('button.btn.primary', { on: { click: restart } }, 'Try Again'))));
    summary.classList.remove('hidden');
  }

  async function showHistory() {
    const runs = await listRuns(song.id);
    history.replaceChildren(h('div.modal-card.history',
      h('div.history-head', h('h2', 'Practice History'),
        h('button.btn.icon', { on: { click: () => history.classList.add('hidden') } }, '✕')),
      runs.length
        ? h('div.history-list', runs.map((r) => h('div.history-row',
          h('span.muted', formatDate(r.timestamp)),
          h('b.good', `${r.accuracy.toFixed(1)}%`),
          h('span.muted', DIFFICULTY[r.difficulty]?.label.split(' ')[0] ?? r.difficulty),
          h('span.muted', `${Math.round(r.tempoPercent)}%`),
          h('span.muted', `${r.hits}/${r.total}`),
          h('span', r.completed ? '✓' : '⏹'))))
        : h('p.muted', 'No runs yet — play the song to record one.')));
    history.classList.remove('hidden');
  }
  for (const modal of [summary, history]) {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  }

  // ---------- frame loop ----------
  let lastCountIn = '';
  function frame() {
    player.tick();
    const t = player.currentTime;
    if (player.playing && active) {
      const missed = detection.updateMissed(Math.max(0, t - (settings.inputOffsetMs / 1000) * rate()));
      if (missed.length) {
        for (const n of missed) highway.flash(n.lane, false);
        updateStats();
      }
    }
    highway.draw(t, rate());

    const countIn = t < 0 && player.playing ? String(Math.ceil(-t / ((60 / song.bpm)))) : '';
    if (countIn !== lastCountIn) {
      lastCountIn = countIn;
      countInEl.textContent = countIn;
      countInEl.classList.toggle('hidden', !countIn);
    }
    const shown = Math.max(0, Math.min(t, player.duration));
    timeEl.textContent = `${formatTime(shown)} / ${formatTime(player.duration)}`;
    progressFill.style.width = `${(shown / (player.duration || 1)) * 100}%`;
    raf = requestAnimationFrame(frame);
  }

  metroBtn.classList.toggle('on', settings.metronomeEnabled);
  updateSpeedUi();
  updateStats();
  raf = requestAnimationFrame(frame);

  if (!song.hasBacking) toast('This song has no audio — practicing against the highway and metronome only.');

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    offHit();
    player.dispose();
    highway.dispose();
    for (const url of urls) URL.revokeObjectURL(url);
  };
}
