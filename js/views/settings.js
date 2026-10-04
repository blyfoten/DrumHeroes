// Settings (port of Views/SettingsView + ViewModels/SettingsViewModel.cs). Changes save immediately.

import { h, toast } from '../dom.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../storage.js';
import { LANES, LANE_INFO, KEYBOARD_MAP, KIT_PROFILES, kitProfile, noteName } from '../drumMap.js';
import { toleranceControl } from './tolerance.js';
import { initMidi, listInputs, selectInput, midiError, onDevicesChanged } from '../midiInput.js';
import { audio, AudioEngine } from '../audioEngine.js';
import { hitBus, applyDrumSound } from '../input.js';
import { serverStatus } from '../separation.js';

export async function renderSettings(root, { navigate }) {
  const settings = loadSettings();
  const save = () => saveSettings(settings);

  // MIDI input
  const midiSelect = h('select', {
    on: {
      change: () => {
        settings.midiInput = midiSelect.value;
        selectInput(settings.midiInput);
        save();
      },
    },
  });
  const midiStatus = h('div.muted');
  const fillMidi = () => {
    const inputs = listInputs();
    midiSelect.replaceChildren(
      h('option', { value: '' }, 'All MIDI inputs'),
      inputs.map((i) => h('option', { value: i.name }, i.name)));
    if (settings.midiInput && !inputs.some((i) => i.name === settings.midiInput)) {
      midiSelect.append(h('option', { value: settings.midiInput }, `${settings.midiInput} (not connected)`));
    }
    midiSelect.value = settings.midiInput;
    midiStatus.textContent = midiError()
      || (inputs.length ? `${inputs.length} input${inputs.length > 1 ? 's' : ''} found.` : 'No MIDI inputs found. Connect your kit via USB and power it on.');
  };
  await initMidi();
  fillMidi();
  const offDevices = onDevicesChanged(fillMidi);

  // Note remapping: per-note overrides on top of the kit profile.
  const laneOptions = () => [
    LANES.map((l) => h('option', { value: l.lane }, l.name)),
    h('option', { value: '' }, 'Ignore'),
  ];
  const setOverrides = (overrides) => {
    settings.noteOverrides = overrides; // always replace: the default object is shared
    save();
    fillOverrides();
  };
  const overrideList = h('div.choice-list');
  const fillOverrides = () => {
    const profileNotes = kitProfile(settings.kitProfile).notes;
    const entries = Object.entries(settings.noteOverrides).sort(([a], [b]) => a - b);
    overrideList.replaceChildren(...entries.map(([note, lane]) => {
      const select = h('select', laneOptions());
      select.value = lane;
      select.addEventListener('change', () => setOverrides({ ...settings.noteOverrides, [note]: select.value }));
      const remove = () => {
        const { [note]: _, ...rest } = settings.noteOverrides;
        setOverrides(rest);
      };
      const kitLane = profileNotes.get(Number(note));
      return h('div.row',
        h('span', `Note ${note} (${noteName(Number(note))})`),
        h('span.muted', `kit: ${kitLane ? LANE_INFO[kitLane].name : 'unmapped'} →`),
        select,
        h('button.btn.small', { title: 'Remove', on: { click: remove } }, '✕'));
    }));
    if (!entries.length) overrideList.append(h('div.muted.hint', 'No overrides. Your kit profile is used as-is.'));
  };
  const addNote = h('input', { type: 'number', min: 0, max: 127, placeholder: 'Note', style: { width: '90px' } });
  const addLane = h('select', laneOptions());
  addLane.value = LANES[0].lane;
  const addOverride = () => {
    const note = Number(addNote.value);
    if (addNote.value === '' || !Number.isInteger(note) || note < 0 || note > 127) {
      toast('Enter a MIDI note number 0–127, or hit the pad to fill it in.', 'error');
      return;
    }
    setOverrides({ ...settings.noteOverrides, [note]: addLane.value });
    toast(`Note ${note} now plays ${addLane.value ? LANE_INFO[addLane.value].name : 'nothing (ignored)'}.`);
  };
  fillOverrides();

  // Live monitor
  const monitor = h('div.monitor', 'Hit a pad to test…');
  const offHit = hitBus.on(({ source, note, lane, velocity }) => {
    monitor.textContent = source === 'midi'
      ? `MIDI note ${note} (velocity ${velocity}) → ${lane ? LANE_INFO[lane].name : 'unmapped'}`
      : `Key → ${LANE_INFO[lane].name}`;
    monitor.classList.remove('pulse');
    void monitor.offsetWidth;
    monitor.classList.add('pulse');
    if (source === 'midi') addNote.value = note;
  });

  // Kit profile
  const kitSelect = h('select', { on: { change: () => { settings.kitProfile = kitSelect.value; save(); fillOverrides(); } } },
    Object.entries(KIT_PROFILES).map(([id, p]) => h('option', { value: id }, p.name)));
  kitSelect.value = settings.kitProfile;

  // Drum sound source
  const lineInSelect = h('select');
  const lineInRow = h('div.lineins');
  const meterFill = h('div.meter-fill');
  const lineInStatus = h('div.muted');
  const fillLineIns = async () => {
    const devices = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter((d) => d.kind === 'audioinput');
    lineInSelect.replaceChildren(
      h('option', { value: '' }, 'System default input'),
      devices.filter((d) => d.deviceId && d.deviceId !== 'default')
        .map((d, i) => h('option', { value: d.deviceId }, d.label || `Input device ${i + 1}`)));
    lineInSelect.value = settings.lineInDevice;
    if (lineInSelect.value !== settings.lineInDevice) lineInSelect.value = '';
  };
  const restartLineIn = async () => {
    audio.stopLineIn();
    try {
      const label = await applyDrumSound(settings);
      lineInStatus.textContent = settings.drumSound === 'linein' ? `Listening to: ${label || 'line in'}` : '';
      await fillLineIns(); // labels become available once permission is granted
    } catch (err) {
      lineInStatus.textContent = `Couldn't open the input: ${err.message}`;
    }
  };
  lineInSelect.addEventListener('change', () => { settings.lineInDevice = lineInSelect.value; save(); restartLineIn(); });
  lineInRow.append(h('div.row', lineInSelect, h('button.btn', { on: { click: fillLineIns } }, '↻ Refresh')),
    h('div.meter', meterFill), lineInStatus);
  const soundOptions = [
    ['samples', 'Built-in drum sounds', 'Synthesized kit triggered by MIDI or the keyboard.'],
    ['linein', 'Line-in from the drum module', 'Your module’s own sound is mixed with the song through the computer. MIDI is used only for scoring.'],
    ['off', 'Off — I listen on the module', 'Silent here. Tip: feed the computer’s output into the module’s MIX IN for zero-latency monitoring.'],
  ];
  const soundRadios = h('div.choice-list', soundOptions.map(([value, label, hint]) => {
    const input = h('input', { type: 'radio', name: 'drumsound', value, checked: settings.drumSound === value });
    input.addEventListener('change', () => {
      settings.drumSound = value;
      save();
      lineInRow.classList.toggle('hidden', value !== 'linein');
      restartLineIn();
    });
    return h('label.choice', input, h('div', h('div', label), h('div.muted.hint', hint)));
  }));
  lineInRow.classList.toggle('hidden', settings.drumSound !== 'linein');
  if (settings.drumSound === 'linein') {
    fillLineIns();
    lineInStatus.textContent = audio.lineInActive ? 'Listening.' : 'Click anywhere to start listening.';
  }
  let meterRaf = requestAnimationFrame(function meter() {
    meterFill.style.width = `${Math.round(audio.lineInLevel() * 100)}%`;
    meterRaf = requestAnimationFrame(meter);
  });

  // Quick setup presets
  const preset = (changes, message) => () => {
    Object.assign(settings, changes);
    save();
    selectInput(settings.midiInput);
    applyDrumSound(settings).catch(() => {});
    navigate('#/settings');
    toast(message);
  };
  const quickSetup = h('div.row',
    h('button.btn', {
      on: {
        click: preset({ drumSound: 'linein', keyboardInput: false, kitProfile: settings.kitProfile === 'general-midi' ? 'roland-td6' : settings.kitProfile },
          'Electronic kit setup: MIDI for scoring, module sound via line-in. Pick your kit and input below.'),
      },
    }, '🥁 I have an electronic kit'),
    h('button.btn', {
      on: {
        click: preset({ drumSound: 'samples', keyboardInput: true, kitProfile: 'general-midi' },
          'Keyboard setup: built-in drum sounds, play with the computer keyboard or a MIDI keyboard.'),
      },
    }, '⌨ No drums — keyboard / MIDI keyboard'));

  // Audio output
  let outputSection = null;
  if (AudioEngine.supportsOutputSelection()) {
    const outSelect = h('select');
    const fillOutputs = async () => {
      const devices = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter((d) => d.kind === 'audiooutput');
      outSelect.replaceChildren(
        h('option', { value: '' }, 'System default'),
        devices.filter((d) => d.deviceId !== 'default' && d.deviceId)
          .map((d, i) => h('option', { value: d.deviceId }, d.label || `Output device ${i + 1}`)));
      outSelect.value = settings.audioOutput;
      if (outSelect.value !== settings.audioOutput) outSelect.value = '';
    };
    outSelect.addEventListener('change', async () => {
      settings.audioOutput = outSelect.value;
      save();
      try {
        await audio.setOutputDevice(settings.audioOutput);
        audio.trigger('snare', 110);
      } catch (err) {
        toast(`Couldn't switch output: ${err.message}`, 'error');
      }
    });
    await fillOutputs();
    outputSection = section('AUDIO OUTPUT', h('div.row', outSelect,
      h('button.btn', { on: { click: fillOutputs } }, '↻ Refresh')),
    'Device names appear after the browser has been granted media permission; otherwise they are numbered.');
  }

  // Difficulty / hit tolerance
  const tolerance = toleranceControl(settings, save);

  // Offset
  const offsetValue = h('span.value');
  const offsetInput = h('input', { type: 'range', min: 0, max: 250, step: 1 });
  offsetInput.value = settings.inputOffsetMs;
  const showOffset = () => { offsetValue.textContent = `${settings.inputOffsetMs} ms`; };
  offsetInput.addEventListener('input', () => { settings.inputOffsetMs = Number(offsetInput.value); showOffset(); save(); });
  showOffset();

  // Count-in
  const countIn = h('div.radio-row', [0, 1, 2].map((n) => {
    const input = h('input', { type: 'radio', name: 'countin', value: n, checked: settings.countInBars === n });
    input.addEventListener('change', () => { settings.countInBars = n; save(); });
    return h('label', input, n === 0 ? 'None' : `${n} Bar${n > 1 ? 's' : ''}`);
  }));

  // Keyboard
  const kbBox = h('input', { type: 'checkbox', checked: settings.keyboardInput });
  kbBox.addEventListener('change', () => { settings.keyboardInput = kbBox.checked; save(); });
  const keyList = h('div.keymap', Object.entries(KEYBOARD_MAP).map(([key, lane]) =>
    h('span', h('kbd', key.toUpperCase()), LANE_INFO[lane].label)));

  // Server
  const serverInfo = h('div.muted', 'Checking…');
  serverStatus(true).then((s) => {
    serverInfo.textContent = !s
      ? 'Not served by server.py — stem separation is unavailable. Start the app with: python3 server.py'
      : s.demucs
        ? `Demucs available (python: ${s.python}).`
        : s.separation
          ? `Demucs not installed; falling back to librosa HPSS. Install with: ${s.python} -m pip install demucs`
          : `No separation backend. Install with: ${s.python} -m pip install demucs`;
  });

  const storageInfo = h('div.muted');
  navigator.storage?.estimate?.().then(({ usage, quota }) => {
    storageInfo.textContent = `Library uses ${(usage / 1e6).toFixed(0)} MB of ${(quota / 1e9).toFixed(1)} GB available to this browser.`;
  });

  root.replaceChildren(
    h('header.topbar',
      h('button.btn', { on: { click: () => navigate('#/library') } }, '← Back'),
      h('h1', 'Settings'),
      h('div')),
    h('main.settings',
      section('QUICK SETUP', quickSetup),
      section('MIDI INPUT DEVICE', midiSelect, midiStatus),
      section('KIT / NOTE MAPPING', kitSelect,
        'How notes from your instrument map to lanes. A MIDI keyboard uses General MIDI drum notes (C2 kick, D2 snare, F#2 hi-hat, C#3 crash, D#3 ride…).'),
      section('DRUM SOUND', soundRadios, lineInRow),
      section('PAD TEST', monitor, 'Shows which MIDI note each pad sends and which lane it maps to.'),
      section('NOTE REMAPPING', overrideList,
        h('div.row', addNote, h('span', '→'), addLane,
          h('button.btn', { on: { click: addOverride } }, '+ Add override')),
        'Send a note to a different lane, e.g. open hi-hat (46) → Closed Hi-Hat if your pedal is broken. Hit a pad to fill in its note number.'),
      outputSection,
      section('DIFFICULTY / HIT TOLERANCE', tolerance,
        'How far from the note a hit still counts. Pick a preset or drag the slider for a custom window.'),
      section('HIT TIMING OFFSET', h('div.row', offsetInput, offsetValue),
        'Increase if your hits register late. Start around 45 ms; Bluetooth headphones need much more.'),
      section('COUNT-IN BARS', countIn),
      section('COMPUTER KEYBOARD', h('label.check', kbBox, h('span', 'Use the keyboard as a drum kit')), keyList,
        'On the practice screen, Space starts the song over from the top (with count-in) and R rewinds without playing.'),
      section('STEM SEPARATION', serverInfo),
      section('STORAGE', storageInfo),
      h('div.row',
        h('button.btn', {
          on: {
            click: () => {
              Object.assign(settings, DEFAULT_SETTINGS);
              save();
              selectInput('');
              navigate('#/settings');
              toast('Settings reset to defaults.');
            },
          },
        }, 'Reset to defaults'))));

  return () => {
    cancelAnimationFrame(meterRaf);
    offDevices();
    offHit();
  };
}

function section(title, ...content) {
  return h('section.setting',
    h('div.setting-title', title),
    content.map((c) => (typeof c === 'string' ? h('div.muted.hint', c) : c)));
}
