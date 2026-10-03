// Built-in demo songs from demo/, playable from the library without importing anything.
// A demo is added to the library the first time it's opened, so practice history works as usual.

import { transcribeMidi } from './midiFile.js';
import { addSong, listSongs } from './storage.js';

export const DEMOS = [
  {
    id: 'simple-kick-snare',
    title: 'Simple Kick & Snare',
    description: 'Kick and snare taking turns on every beat. The easiest place to start.',
    file: 'demo/simple-kick-snare.mid',
  },
  {
    id: 'basic-rock-beat',
    title: 'Basic Rock Beat',
    description: 'Eighth-note hi-hat with kick and snare: the classic rock groove.',
    file: 'demo/basic-rock-beat.mid',
  },
];

/** Returns the library song id for a demo, importing it on first use. */
export async function openDemo(demo) {
  const existing = (await listSongs()).find((s) => s.demo === demo.id);
  if (existing) return existing.id;

  const res = await fetch(demo.file);
  if (!res.ok) throw new Error(`Couldn't load the demo (${res.status}).`);
  const transcription = transcribeMidi(await res.arrayBuffer());
  return addSong({
    title: demo.title,
    artist: 'Demo',
    demo: demo.id,
    bpm: transcription.bpm,
    timeSignature: transcription.timeSignature,
    duration: transcription.durationSeconds,
    notes: transcription.notes,
    hasBacking: false,
    hasStem: false,
    separation: 'none',
    audioName: null,
    midiName: demo.file.split('/').pop(),
    created: new Date().toISOString(),
    lastPracticed: null,
  }, {});
}
