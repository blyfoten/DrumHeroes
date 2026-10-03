// App entry: hash router + global input/audio setup (replaces App.xaml.cs and NavigationService).

import { renderLibrary } from './views/library.js';
import { renderPractice } from './views/practice.js';
import { renderSettings } from './views/settings.js';
import { initMidi, selectInput } from './midiInput.js';
import { initInput, applyDrumSound } from './input.js';
import { audio } from './audioEngine.js';
import { loadSettings, requestPersistentStorage } from './storage.js';
import { toast } from './dom.js';

const root = document.getElementById('app');
let cleanup = null;
let renderToken = 0;

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const token = ++renderToken;
  cleanup?.();
  cleanup = null;

  const hash = location.hash || '#/library';
  const practice = hash.match(/^#\/practice\/(\d+)$/);
  const ctx = { navigate };
  try {
    let dispose;
    if (practice) dispose = await renderPractice(root, { ...ctx, songId: Number(practice[1]) });
    else if (hash === '#/settings') dispose = await renderSettings(root, ctx);
    else dispose = await renderLibrary(root, ctx);
    if (token !== renderToken) dispose?.(); // a newer navigation already happened
    else cleanup = dispose;
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 'error');
  }
}

// Browsers keep audio suspended until the first user gesture.
let unlocked = false;
function unlockAudio() {
  const ctx = audio.ensure();
  if (!unlocked) {
    unlocked = true;
    const { audioOutput } = loadSettings();
    if (audioOutput) audio.setOutputDevice(audioOutput).catch(() => {});
    applyDrumSound().catch((err) => toast(`Couldn't open the drum line-in: ${err.message}`, 'error'));
  }
  if (ctx.state === 'running') {
    window.removeEventListener('pointerdown', unlockAudio, true);
    window.removeEventListener('keydown', unlockAudio, true);
  }
}
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

initInput();
initMidi().then(() => selectInput(loadSettings().midiInput));
requestPersistentStorage();

window.addEventListener('hashchange', route);
route();
