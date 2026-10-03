// Song library (port of Views/LibraryView + ViewModels/LibraryViewModel.cs).

import { h, formatTime, formatDate } from '../dom.js';
import { listSongs, deleteSong } from '../storage.js';
import { openImportDialog } from './importDialog.js';

export async function renderLibrary(root, { navigate }) {
  const list = h('div.song-list');
  const count = h('div.muted.song-count');

  root.replaceChildren(
    h('header.topbar',
      h('div.brand', h('h1', '🥁 Drum Hero'), h('div.muted', 'Select a song to start practicing')),
      h('div.topbar-actions',
        h('button.btn', { on: { click: () => navigate('#/settings') } }, '⚙ Settings'),
        h('button.btn.primary', { on: { click: () => openImportDialog({ onImported: refresh }) } }, '+ Add Song'))),
    h('main.library', count, list));

  async function refresh() {
    const songs = await listSongs();
    count.textContent = `${songs.length} song${songs.length === 1 ? '' : 's'} in library`;
    if (!songs.length) {
      list.replaceChildren(h('div.empty',
        h('div.empty-icon', '🥁'),
        h('h2', 'No songs yet'),
        h('p.muted', "Click “Add Song” to import a drum MIDI file (from Songsterr or elsewhere), optionally with the song's audio."),
        h('button.btn.primary', { on: { click: () => openImportDialog({ onImported: refresh }) } }, '+ Add Song')));
      return;
    }
    list.replaceChildren(...songs.map((song) => songCard(song)));
  }

  function songCard(song) {
    const del = h('button.btn.icon.danger', { title: 'Delete song', 'aria-label': 'Delete song' }, '✕');
    let armed = false;
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        del.textContent = 'Delete?';
        del.classList.add('armed');
        setTimeout(() => { armed = false; del.textContent = '✕'; del.classList.remove('armed'); }, 3000);
        return;
      }
      await deleteSong(song.id);
      refresh();
    });

    const audioTag = song.hasStem ? `drumless (${song.separation})` : song.hasBacking ? 'full mix' : 'no audio';
    return h('div.song-card', { on: { click: () => navigate(`#/practice/${song.id}`) } },
      h('div.song-main',
        h('div.song-title', song.title),
        h('div.muted', song.artist)),
      h('div.song-meta',
        h('span', `${Math.round(song.bpm)} BPM`),
        h('span', formatTime(song.duration)),
        h('span', `${song.notes.length} notes`),
        h('span.tag', audioTag),
        song.lastPracticed && h('span.muted', `Last: ${formatDate(song.lastPracticed)}`)),
      h('div.song-actions',
        h('button.btn.primary', { on: { click: (e) => { e.stopPropagation(); navigate(`#/practice/${song.id}`); } } }, '▶ Practice'),
        del));
  }

  await refresh();
  return () => {};
}
