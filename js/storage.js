// IndexedDB persistence (replaces the SQLite repositories and FileStorageService).
// Stores: songs (metadata + transcription), files (audio blobs keyed by song), runs (practice history).

const DB_NAME = 'drumhero';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('files', { keyPath: 'key' });
      const runs = db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
      runs.createIndex('songId', 'songId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function listSongs() {
  const songs = await promisify((await store('songs')).getAll());
  return songs.sort((a, b) => (b.lastPracticed || b.created).localeCompare(a.lastPracticed || a.created));
}

export async function getSong(id) {
  return promisify((await store('songs')).get(id));
}

export async function putSong(song) {
  return promisify((await store('songs', 'readwrite')).put(song));
}

/**
 * Adds a song together with its audio files in one transaction.
 * @param {object} song   metadata without id
 * @param {Object<string, Blob>} files  e.g. { backing, stem }
 */
export async function addSong(song, files) {
  const db = await open();
  const tx = db.transaction(['songs', 'files'], 'readwrite');
  const id = await promisify(tx.objectStore('songs').add(song));
  for (const [kind, blob] of Object.entries(files)) {
    if (blob) tx.objectStore('files').put({ key: `${id}:${kind}`, blob });
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Saving the song was aborted (storage full?)'));
  });
  return id;
}

export async function getFile(songId, kind) {
  const rec = await promisify((await store('files')).get(`${songId}:${kind}`));
  return rec?.blob ?? null;
}

export async function deleteSong(id) {
  const db = await open();
  const tx = db.transaction(['songs', 'files', 'runs'], 'readwrite');
  tx.objectStore('songs').delete(id);
  tx.objectStore('files').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
  const runIndex = tx.objectStore('runs').index('songId');
  runIndex.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      tx.objectStore('runs').delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function addRun(run) {
  return promisify((await store('runs', 'readwrite')).add(run));
}

export async function listRuns(songId) {
  const runs = await promisify((await store('runs')).index('songId').getAll(IDBKeyRange.only(songId)));
  return runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// Settings are small and per-browser, so localStorage is enough.
const SETTINGS_KEY = 'drumhero.settings';
export const DEFAULT_SETTINGS = {
  midiInput: '',
  audioOutput: '',
  difficulty: 'normal', // a DIFFICULTY key, or 'custom'
  customWindowMs: 80, // hit window for the 'custom' difficulty
  inputOffsetMs: 45,
  countInBars: 1,
  metronomeEnabled: false,
  masterVolume: 0.8,
  metronomeVolume: 0.5,
  backingVolume: 0.8,
  stemVolume: 0,
  feedbackVolume: 1,
  keyboardInput: true,
  kitProfile: 'alesis-nitro-max',
  noteOverrides: {}, // MIDI note → lane ('' = ignore), applied on top of the kit profile
  drumSound: 'samples', // 'samples' | 'linein' | 'off'
  lineInDevice: '',
};

let cached = null;

export function loadSettings() {
  if (!cached) {
    try {
      cached = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      cached = { ...DEFAULT_SETTINGS };
    }
  }
  return { ...cached };
}

export function saveSettings(settings) {
  cached = { ...settings };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private mode etc. */ }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* not critical */ }
}
