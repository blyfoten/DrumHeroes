// Practice screen (port of Views/PracticeView, ViewModels/PracticeViewModel.cs and Services/PracticeSessionService.cs).

import { h, formatTime, formatDate, toast } from '../dom.js';
import { getSong, getFile, putSong, addRun, listRuns, loadSettings, saveSettings } from '../storage.js';
import { SPEED_PRESETS, LANE_INFO, kitProfile, hitWindowMs, difficultyLabel } from '../drumMap.js';
import { makeRecording, analyzeRecording, signedMs } from '../analysis.js';
import { toleranceControl } from './tolerance.js';
import { openRunReview } from './review.js';
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
  const windowMs = () => hitWindowMs(settings.difficulty, settings);
  const detection = new HitDetection();
  detection.init(notes, windowMs(), 1);

  for (const [bus, key] of [['backing', 'backingVolume'], ['stem', 'stemVolume'], ['feedback', 'feedbackVolume'],
    ['metronome', 'metronomeVolume'], ['master', 'masterVolume']]) {
    audio.setVolume(bus, settings[key]);
  }
  player.setMetronome(settings.metronomeEnabled);

  // ---------- DOM ----------
  const accuracyEl = h('span.stat-value.good', '0.0%');
  const perfectEl = h('span.stat-value', '0.0%');
  const missPctEl = h('span.stat-value', '0.0%');
  const wrongEl = h('span.stat-value', '0.0%');
  const hitsEl = h('span.good', '✓ 0');
  const missEl = h('span.bad', '✗ 0');
  const bpmEl = h('span');
  const midiDebugEl = h('div.pill.midi-debug.hidden', '—');
  const timeEl = h('span.time', '0:00 / 0:00');
  const progressFill = h('div.progress-fill');
  const progressBar = h('div.progress-track.seek', { title: 'Click to seek' }, progressFill);
  const playBtn = h('button.btn.primary.transport', { title: 'Play / Pause (Space starts over from the top)', on: { click: togglePlay } }, '▶');
  const canvas = h('canvas.highway');
  const countInEl = h('div.count-in.hidden');
  const timingEl = h('div.timing-feedback');

  const speedButtons = SPEED_PRESETS.map((p) => h('button.btn.small', { on: { click: () => setSpeed(p) } }, `${p}%`));
  const metroBtn = h('button.btn.toggle', { title: 'Metronome', on: { click: toggleMetronome } }, '🕒 Click');
  const midiBtn = h('button.btn.toggle', { title: 'Show incoming MIDI notes', on: { click: toggleMidiDebug } }, '🔌 MIDI');
  const tolerance = toleranceControl(settings, () => {
    saveSettings(settings);
    detection.setWindow(windowMs(), rate());
  });

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
          h('div.pill', { title: 'Notes hit, out of the notes that have passed so far' }, h('span.muted', 'Hit '), accuracyEl),
          h('div.pill', { title: 'Perfect hits, out of the notes that have passed so far' }, h('span.muted', 'Perfect '), perfectEl),
          h('div.pill', { title: 'Notes missed, out of the notes that have passed so far' }, h('span.muted', 'Missed '), missPctEl),
          h('div.pill', { title: 'Your hits that matched no note: goes up if you just hammer every drum' }, h('span.muted', 'Wrong hits '), wrongEl),
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
          tolerance,
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
    accuracyEl.textContent = `${detection.liveAccuracy.toFixed(1)}%`;
    perfectEl.textContent = `${detection.livePerfectRate.toFixed(1)}%`;
    missPctEl.textContent = `${detection.liveMissRate.toFixed(1)}%`;
    wrongEl.textContent = `${detection.wrongRate.toFixed(1)}%`;
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
    detection.setWindow(windowMs(), rate());
    updateSpeedUi();
  }

  function adjustBpm(delta) {
    const bpm = song.bpm * rate() + delta;
    if (bpm < 20 || bpm > 300) return;
    setSpeed((bpm / song.bpm) * 100);
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
    const result = detection.processHit(lane, t, { note, velocity });
    for (const n of result.missed) highway.flash(n.lane, false);
    if (result.type === 'hit') {
      const early = result.note.time > t;
      const ms = Math.round(result.diffMs / rate());
      const { perfect } = result;
      highway.flash(lane, true, perfect);
      timingEl.textContent = perfect ? 'PERFECT!' : `${ms} ms ${early ? 'early' : 'late'}`;
      timingEl.className = 'timing-feedback';
      void timingEl.offsetWidth; // restart the animation on back-to-back hits
      timingEl.className = `timing-feedback show ${perfect ? 'perfect' : early ? 'early' : 'late'}`;
    } else {
      highway.flash(lane, true);
    }
    updateStats();
  });

  /** Space: start the song over from the top right away, whatever state the screen is in. */
  function startOver() {
    restart();
    history.classList.add('hidden');
    togglePlay();
  }

  function onKey(e) {
    // Only text fields keep Space; sliders, dropdowns and buttons shouldn't swallow it.
    if (e.target.closest('input[type=text], input[type=number], textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault(); // don't also "click" a focused button or open a focused dropdown
      if (!e.repeat) {
        document.activeElement?.blur?.();
        startOver();
      }
    } else if (e.target.closest('input, select')) {
      // leave R / Escape to the focused control
    } else if (e.key === 'r' && !e.repeat && !e.ctrlKey && !e.metaKey) restart();
    else if (e.key === 'Escape') { summary.classList.add('hidden'); history.classList.add('hidden'); }
  }
  window.addEventListener('keydown', onKey);

  player.onEnded = () => {
    playBtn.textContent = '▶';
    if (active) finish(true);
    active = false;
  };

  async function finish(completed) {
    const endTime = Math.max(0, player.currentTime);
    detection.finalize();
    updateStats();
    // Final percentages are relative to every note in the song, not just the ones that passed.
    const run = {
      songId: song.id,
      timestamp: new Date().toISOString(),
      accuracy: detection.accuracy,
      perfectRate: detection.perfectRate,
      wrongRate: detection.wrongRate,
      total: detection.total,
      hits: detection.hitCount,
      perfect: detection.perfectCount,
      misses: detection.missCount,
      extra: detection.extraCount,
      difficulty: settings.difficulty,
      windowMs: windowMs(),
      tempoPercent: speed,
      bpm: song.bpm * rate(),
      completed,
      recording: makeRecording(notes, detection.hits, {
        rate: rate(), offsetMs: settings.inputOffsetMs, windowMs: windowMs(), endTime,
      }),
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
    const analysis = analyzeRecording(run.recording);
    const timing = analysis.count
      ? `${signedMs(analysis.median)} median (${analysis.early} early, ${analysis.late} late)`
      : '–';
    summary.replaceChildren(h('div.modal-card.summary',
      h('h2', run.completed ? 'Performance Summary' : 'Run Stopped'),
      h('div.big-accuracy', run.accuracy.toFixed(1), h('small', '%')),
      h('div.muted', 'of all notes in the song hit'),
      h('div.summary-stats',
        h('div', h('div.good.n', run.hits), h('div.muted', 'Hits')),
        h('div', h('div.n.perfect', run.perfect), h('div.muted', `Perfect (${run.perfectRate.toFixed(1)}%)`)),
        h('div', h('div.bad.n', run.misses), h('div.muted', `Missed (${pctOf(run.misses, run.total)}%)`)),
        h('div', h('div.n', run.extra), h('div.muted', `Wrong hits (${run.wrongRate.toFixed(1)}%)`)),
        h('div', h('div.n', run.total), h('div.muted', 'Total'))),
      h('div.summary-details',
        h('div', 'Song: ', h('b', song.title)),
        h('div', 'Difficulty: ', h('b', difficultyLabel(run.difficulty, run.windowMs))),
        h('div', 'Tempo: ', h('b', `${Math.round(run.tempoPercent)}% (${Math.round(run.bpm)} BPM)`)),
        h('div', 'Timing: ', h('b', timing))),
      h('div.dialog-actions',
        h('button.btn', { on: { click: () => navigate('#/library') } }, 'Back to Library'),
        h('button.btn', { on: { click: () => review(run) } }, '🔍 Review run'),
        h('button.btn.primary', { on: { click: restart } }, 'Try Again'))));
    summary.classList.remove('hidden');
  }

  function review(run) {
    openRunReview({
      song,
      run,
      onApplyOffset: (ms) => {
        settings.inputOffsetMs = ms;
        saveSettings(settings);
      },
    });
  }

  async function showHistory() {
    const runs = await listRuns(song.id);
    history.replaceChildren(h('div.modal-card.history',
      h('div.history-head', h('h2', 'Practice History'),
        h('button.btn.icon', { on: { click: () => history.classList.add('hidden') } }, '✕')),
      runs.length
        ? h('div.history-list',
          h('div.history-row.history-cols',
            ['Date', 'Hit', 'Perfect', 'Wrong', 'Level', 'Tempo', 'Notes', '', ''].map((t) => h('span.muted', t))),
          runs.map((r) => h('div.history-row',
            h('span.muted', formatDate(r.timestamp)),
            h('b.good', `${r.accuracy.toFixed(1)}%`),
            h('span', r.perfectRate === undefined ? '–' : `${r.perfectRate.toFixed(1)}%`),
            h('span', r.wrongRate === undefined ? '–' : `${r.wrongRate.toFixed(1)}%`),
            h('span.muted', r.difficulty === 'custom' ? `±${r.windowMs}ms` : difficultyLabel(r.difficulty).split(' ')[0]),
            h('span.muted', `${Math.round(r.tempoPercent)}%`),
            h('span.muted', `${r.hits}/${r.total}`),
            h('span', { title: r.completed ? 'Completed' : 'Stopped early' }, r.completed ? '✓' : '⏹'),
            r.recording
              ? h('button.btn.small', { title: 'Review this run', on: { click: () => review(r) } }, '🔍')
              : h('span'))))
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

function pctOf(part, whole) {
  return (whole ? (part / whole) * 100 : 0).toFixed(1);
}
