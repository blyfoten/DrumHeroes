// Single source of pad hits: Web MIDI notes and (optionally) the computer keyboard.
// With drumSound = 'samples' every mapped hit plays a built-in drum sound immediately;
// with a line-in (or monitoring on the module) the kit makes its own sound and MIDI is used only for scoring.

import { kitProfile, KEYBOARD_MAP } from './drumMap.js';
import { audio } from './audioEngine.js';
import { onNoteOn } from './midiInput.js';
import { loadSettings } from './storage.js';

const subscribers = new Set();

function emit(hit, settings) {
  if (hit.lane && (settings.drumSound === 'samples' || hit.source === 'keyboard')) {
    audio.trigger(hit.lane, hit.velocity);
  }
  for (const fn of subscribers) fn(hit);
}

export const hitBus = {
  on(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};

export function initInput() {
  onNoteOn(({ note, velocity, timeStamp }) => {
    const settings = loadSettings();
    const lane = kitProfile(settings.kitProfile).notes.get(note) ?? null;
    emit({ source: 'midi', note, lane, velocity, timeStamp }, settings);
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    const settings = loadSettings();
    const lane = KEYBOARD_MAP[e.key.toLowerCase()];
    if (!lane || !settings.keyboardInput) return;
    emit({ source: 'keyboard', note: null, lane, velocity: 110, timeStamp: e.timeStamp }, settings);
  });
}

/** Starts or stops the line-in monitor to match settings. Must follow a user gesture the first time. */
export async function applyDrumSound(settings = loadSettings()) {
  if (settings.drumSound === 'linein') {
    if (!audio.lineInActive) return audio.startLineIn(settings.lineInDevice);
  } else {
    audio.stopLineIn();
  }
  return null;
}
