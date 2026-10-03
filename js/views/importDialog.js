// Import dialog (port of Views/ImportSongDialog + Services/SongImportService.cs).

import { h, toast } from '../dom.js';
import { transcribeMidi } from '../midiFile.js';
import { addSong } from '../storage.js';
import { separate, serverStatus } from '../separation.js';

const AUDIO_EXT = /\.(flac|mp3|wav|ogg|oga|opus|m4a|aac|webm)$/i;
const MIDI_EXT = /\.(mid|midi)$/i;

/** Reads TITLE/ARTIST from a FLAC file's Vorbis comment block. */
async function readFlacTags(file) {
  try {
    const buf = await file.slice(0, 1 << 20).arrayBuffer();
    const view = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'fLaC') return {};
    let pos = 4;
    while (pos + 4 <= view.byteLength) {
      const header = view.getUint8(pos);
      const len = (view.getUint8(pos + 1) << 16) | (view.getUint8(pos + 2) << 8) | view.getUint8(pos + 3);
      pos += 4;
      if ((header & 0x7f) === 4 && pos + len <= view.byteLength) {
        const dec = new TextDecoder();
        let p = pos;
        const vendorLen = view.getUint32(p, true);
        p += 4 + vendorLen;
        const count = view.getUint32(p, true);
        p += 4;
        const tags = {};
        for (let i = 0; i < count; i++) {
          const l = view.getUint32(p, true);
          p += 4;
          const entry = dec.decode(new Uint8Array(buf, p, l));
          p += l;
          const eq = entry.indexOf('=');
          if (eq > 0) tags[entry.slice(0, eq).toUpperCase()] ??= entry.slice(eq + 1);
        }
        return { title: tags.TITLE, artist: tags.ARTIST || tags.ALBUMARTIST };
      }
      if (header & 0x80) break; // last metadata block
      pos += len;
    }
  } catch { /* fall back to file name */ }
  return {};
}

function audioDuration(blob) {
  return new Promise((resolve) => {
    const el = new Audio();
    const url = URL.createObjectURL(blob);
    const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    el.addEventListener('loadedmetadata', () => done(el.duration), { once: true });
    el.addEventListener('error', () => done(0), { once: true });
    el.preload = 'metadata';
    el.src = url;
  });
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function openImportDialog({ onImported }) {
  let audioFile = null;
  let midiFile = null;
  let busy = false;
  let cancel = null;

  const titleInput = h('input', { type: 'text', placeholder: 'Song title' });
  const artistInput = h('input', { type: 'text', placeholder: 'Artist' });
  const separateBox = h('input', { type: 'checkbox', id: 'sep', checked: true, disabled: true });
  const separateNote = h('span.muted', 'Checking for Demucs…');
  const progressBar = h('div.progress-fill');
  const progressText = h('div.muted.progress-text');
  const progress = h('div.import-progress.hidden', h('div.progress-track', progressBar), progressText);
  const importBtn = h('button.btn.primary', { disabled: true, on: { click: run } }, 'Import Song');
  const cancelBtn = h('button.btn', { on: { click: close } }, 'Cancel');

  let separationAvailable = false;
  serverStatus().then((status) => {
    separationAvailable = !!status?.separation;
    separateBox.disabled = !separationAvailable;
    separateBox.checked = separationAvailable;
    separateNote.textContent = !status
      ? 'Server not reachable — the audio will be used as-is.'
      : status.demucs
        ? 'Demucs is installed — the drums will be removed from the backing track.'
        : status.separation
          ? 'Demucs not found; a lower-quality librosa HPSS split will be used.'
          : 'Demucs not installed (pip install demucs) — the audio will be used as-is.';
  });

  const audioZone = dropZone({
    step: 'STEP 1', icon: '🎵', title: 'Backing Track', subtitle: 'FLAC / MP3 / WAV / OGG (optional)',
    color: '#4ECDC4', accept: 'audio/*,.flac', test: (f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'),
    onFile: async (f) => {
      audioFile = f;
      const tags = /\.flac$/i.test(f.name) ? await readFlacTags(f) : {};
      if (!titleInput.value || titleInput.dataset.auto) {
        titleInput.value = tags.title || stripExt(f.name);
        titleInput.dataset.auto = '1';
      }
      if (tags.artist && (!artistInput.value || artistInput.dataset.auto)) {
        artistInput.value = tags.artist;
        artistInput.dataset.auto = '1';
      }
      update();
    },
  });
  const midiZone = dropZone({
    step: 'STEP 2', icon: '🥁', title: 'Drum MIDI', subtitle: '.MID file (e.g. from Songsterr)',
    color: '#FF6B35', accept: '.mid,.midi,audio/midi', test: (f) => MIDI_EXT.test(f.name),
    onFile: (f) => {
      midiFile = f;
      if (!titleInput.value) {
        titleInput.value = stripExt(f.name);
        titleInput.dataset.auto = '1';
      }
      update();
    },
  });
  for (const input of [titleInput, artistInput]) input.addEventListener('input', () => delete input.dataset.auto);

  const dialog = h('div.modal',
    h('div.modal-card.import-card',
      h('h2', 'Import Song'),
      h('p.muted', 'Pick a drum MIDI file and, optionally, the song audio to play along with.'),
      h('div.drop-row', audioZone.el, midiZone.el),
      h('div.form-grid',
        h('label', 'Title', titleInput),
        h('label', 'Artist', artistInput)),
      h('label.check', separateBox, h('span', 'Remove drums from the audio'), separateNote),
      progress,
      h('div.dialog-actions', cancelBtn, importBtn)));

  document.body.append(dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog && !busy) close(); });

  function update() {
    importBtn.disabled = busy || !midiFile;
  }

  function setProgress(fraction, message) {
    progress.classList.remove('hidden');
    progressBar.style.width = `${Math.round(fraction * 100)}%`;
    progressText.textContent = message;
  }

  function close() {
    cancel?.();
    dialog.remove();
  }

  async function run() {
    busy = true;
    update();
    cancelBtn.textContent = 'Cancel';
    try {
      setProgress(0.02, 'Reading MIDI…');
      const duration = audioFile ? await audioDuration(audioFile) : 0;
      const transcription = transcribeMidi(await midiFile.arrayBuffer(), duration);
      if (!transcription.notes.length) {
        throw new Error('No drum notes found on MIDI channel 10. Is this a drum track export?');
      }

      let backing = audioFile;
      let stem = null;
      let separation = 'none';
      if (audioFile && separateBox.checked && separationAvailable) {
        const job = separate(audioFile, (p, msg) => setProgress(0.05 + p * 0.9, msg));
        cancel = job.cancel;
        const result = await job.promise;
        cancel = null;
        backing = result.noDrums;
        stem = result.drums;
        separation = result.method;
      }

      setProgress(0.97, 'Saving to library…');
      const song = {
        title: titleInput.value.trim() || stripExt(midiFile.name),
        artist: artistInput.value.trim() || 'Unknown Artist',
        bpm: transcription.bpm,
        timeSignature: transcription.timeSignature,
        duration: transcription.durationSeconds,
        notes: transcription.notes,
        hasBacking: !!backing,
        hasStem: !!stem,
        separation,
        audioName: audioFile?.name ?? null,
        midiName: midiFile.name,
        created: new Date().toISOString(),
        lastPracticed: null,
      };
      const id = await addSong(song, { backing, stem });
      setProgress(1, 'Done!');
      toast(`Imported “${song.title}” — ${song.notes.length} notes at ${Math.round(song.bpm)} BPM`, 'success');
      dialog.remove();
      onImported?.(id);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setProgress(0, '');
      progress.classList.add('hidden');
      toast(err.message || String(err), 'error');
      console.error(err);
      busy = false;
      update();
    }
  }
}

function dropZone({ step, icon, title, subtitle, color, accept, test, onFile }) {
  const fileLabel = h('div.drop-file', 'Click to browse or drag & drop');
  const input = h('input', { type: 'file', accept, hidden: true });
  const el = h('div.drop-zone', { style: { '--zone': color }, tabindex: '0' },
    h('div.drop-step', step), h('div.drop-icon', icon), h('div.drop-title', title),
    h('div.drop-sub', subtitle), fileLabel, input);

  const take = (file) => {
    if (!file) return;
    if (!test(file)) {
      toast(`“${file.name}” isn't a supported file for ${title}.`, 'error');
      return;
    }
    el.classList.add('has-file');
    fileLabel.textContent = file.name;
    onFile(file);
  };
  el.addEventListener('click', () => input.click());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => take(input.files[0]));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag');
    take(e.dataTransfer.files[0]);
  });
  return { el };
}
