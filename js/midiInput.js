// Web MIDI input (replaces Audio/MidiInputEngine.cs). On Linux, Chrome reaches ALSA/PipeWire MIDI ports directly.

const listeners = new Set();
const deviceListeners = new Set();
let access = null;
let selectedId = ''; // '' = listen to all inputs
let accessError = null;

function handleMessage(event) {
  const [status, note, velocity] = event.data;
  if ((status & 0xf0) === 0x90 && velocity > 0) {
    for (const fn of listeners) fn({ note, velocity, timeStamp: event.timeStamp, input: event.currentTarget });
  }
}

function attach() {
  if (!access) return;
  for (const input of access.inputs.values()) {
    const wanted = !selectedId || input.id === selectedId || input.name === selectedId;
    input.onmidimessage = wanted ? handleMessage : null;
  }
}

export async function initMidi() {
  if (access || accessError) return access;
  if (!navigator.requestMIDIAccess) {
    accessError = 'This browser does not support Web MIDI. Use Chrome, Chromium, Edge or Firefox.';
    return null;
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => {
      attach();
      for (const fn of deviceListeners) fn(listInputs());
    };
    attach();
  } catch (err) {
    accessError = `MIDI access was denied: ${err.message || err}`;
  }
  return access;
}

export function midiError() {
  return accessError;
}

export function listInputs() {
  if (!access) return [];
  return [...access.inputs.values()].map((i) => ({ id: i.id, name: i.name, state: i.state }));
}

/** Selects an input by id or name; '' listens to every connected input. */
export function selectInput(idOrName) {
  selectedId = idOrName || '';
  attach();
}

export function onNoteOn(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onDevicesChanged(fn) {
  deviceListeners.add(fn);
  return () => deviceListeners.delete(fn);
}
