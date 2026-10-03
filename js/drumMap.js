// Lane definitions and Alesis Nitro Max MIDI mapping (port of Models/MidiDrumMap.cs + DrumLane.cs).

export const Lane = Object.freeze({
  Kick: 'kick',
  Snare: 'snare',
  RackTom1: 'rack_tom_1',
  RackTom2: 'rack_tom_2',
  FloorTom: 'floor_tom',
  ClosedHiHat: 'hihat_closed',
  OpenHiHat: 'hihat_open',
  Crash1: 'crash_1',
  Crash2: 'crash_2',
  Crash3: 'crash_3',
  Ride: 'ride',
});

// Highway order mirrors the physical kit from the drummer's perspective (left to right).
export const LANES = [
  { lane: Lane.ClosedHiHat, label: 'HH-C', color: '#4ECDC4', name: 'Closed Hi-Hat' },
  { lane: Lane.OpenHiHat, label: 'HH-O', color: '#45B7D1', name: 'Open Hi-Hat' },
  { lane: Lane.Crash1, label: 'CR1', color: '#DDA0DD', name: 'Crash 1' },
  { lane: Lane.Snare, label: 'SNARE', color: '#FFD700', name: 'Snare' },
  { lane: Lane.Kick, label: 'KICK', color: '#FF6B35', name: 'Kick' },
  { lane: Lane.RackTom1, label: 'TOM1', color: '#96CEB4', name: 'Rack Tom 1' },
  { lane: Lane.RackTom2, label: 'TOM2', color: '#88D8B0', name: 'Rack Tom 2' },
  { lane: Lane.FloorTom, label: 'FLOOR', color: '#FFEAA7', name: 'Floor Tom' },
  { lane: Lane.Crash2, label: 'CR2', color: '#DA70D6', name: 'Crash 2' },
  { lane: Lane.Ride, label: 'RIDE', color: '#87CEEB', name: 'Ride' },
  { lane: Lane.Crash3, label: 'CR3', color: '#BA55D3', name: 'Crash 3' },
];

export const LANE_INDEX = Object.fromEntries(LANES.map((l, i) => [l.lane, i]));
export const LANE_INFO = Object.fromEntries(LANES.map((l) => [l.lane, l]));

const NOTE_TO_LANE = new Map([
  // Kick
  [36, Lane.Kick], [35, Lane.Kick],
  // Snare (head, rim, side stick, clap)
  [38, Lane.Snare], [40, Lane.Snare], [37, Lane.Snare], [39, Lane.Snare],
  // Toms
  [48, Lane.RackTom1], [50, Lane.RackTom1], [47, Lane.RackTom1],
  [45, Lane.RackTom2], [43, Lane.RackTom2],
  [58, Lane.FloorTom], [41, Lane.FloorTom],
  // Hi-hat
  [42, Lane.ClosedHiHat], [44, Lane.ClosedHiHat],
  [46, Lane.OpenHiHat], [23, Lane.OpenHiHat], [21, Lane.OpenHiHat],
  // Cymbals
  [49, Lane.Crash1], [57, Lane.Crash2], [55, Lane.Crash3], [52, Lane.Crash3],
  [51, Lane.Ride], [53, Lane.Ride], [59, Lane.Ride],
]);

// GM percussion notes not on the kit, mapped to the closest kit note.
const GM_TO_KIT_FALLBACK = new Map([
  [54, 42], [56, 42],
  [60, 48], [61, 45], [62, 48], [63, 48], [64, 43], [65, 48], [66, 45],
  [67, 42], [68, 42], [69, 42], [70, 42], [71, 42], [72, 42], [73, 42], [74, 42],
  [75, 37], [76, 48], [77, 45], [78, 38], [79, 38], [80, 42], [81, 46],
]);

export function mapGmNoteToKit(note) {
  if (NOTE_TO_LANE.has(note)) return note;
  return GM_TO_KIT_FALLBACK.get(note) ?? note;
}

export function laneForNote(note) {
  return NOTE_TO_LANE.get(note) ?? null;
}

// Priority when more than 3 notes land together: kick > snare > hi-hat > toms > crashes > ride.
export const LANE_PRIORITY = {
  [Lane.Kick]: 0,
  [Lane.Snare]: 1,
  [Lane.ClosedHiHat]: 2,
  [Lane.OpenHiHat]: 2,
  [Lane.FloorTom]: 3,
  [Lane.RackTom1]: 4,
  [Lane.RackTom2]: 5,
  [Lane.Crash1]: 6,
  [Lane.Crash2]: 7,
  [Lane.Crash3]: 8,
  [Lane.Ride]: 9,
};

// ---------- Input kit profiles ----------
// Song MIDI files are always read with the GM-based map above; these profiles only decide how
// notes coming *from your instrument* map to lanes. `fold` moves song lanes the kit can't play
// onto a lane it can (e.g. a 2-crash kit gets CR3 notes on CR2).

const ROLAND_TD6 = new Map([
  [36, Lane.Kick],
  [38, Lane.Snare], [40, Lane.Snare], [37, Lane.Snare], // head, rim, cross-stick
  [48, Lane.RackTom1], [50, Lane.RackTom1], // tom 1 head / rim
  [45, Lane.RackTom2], [47, Lane.RackTom2], // tom 2 head / rim
  [43, Lane.FloorTom], [58, Lane.FloorTom], // tom 3 head / rim
  [41, Lane.FloorTom], [39, Lane.FloorTom], // tom 4 head / rim (if fitted)
  [42, Lane.ClosedHiHat], [22, Lane.ClosedHiHat], [44, Lane.ClosedHiHat], // closed bow / edge, pedal
  [46, Lane.OpenHiHat], [26, Lane.OpenHiHat], // open bow / edge
  [49, Lane.Crash1], [55, Lane.Crash1], // crash 1 bow / edge
  [57, Lane.Crash2], [52, Lane.Crash2], // crash 2 bow / edge
  [51, Lane.Ride], [59, Lane.Ride], [53, Lane.Ride], // ride bow / edge / bell
]);

// General MIDI drum notes — what a MIDI keyboard on channel 10 (or most drum pads) sends.
const GENERAL_MIDI = new Map(NOTE_TO_LANE);
for (const [gm, kit] of GM_TO_KIT_FALLBACK) GENERAL_MIDI.set(gm, NOTE_TO_LANE.get(kit));

export const KIT_PROFILES = {
  'alesis-nitro-max': { name: 'Alesis Nitro Max', notes: NOTE_TO_LANE, fold: {} },
  'roland-td6': { name: 'Roland TD-6 / TD-6V', notes: ROLAND_TD6, fold: { [Lane.Crash3]: Lane.Crash2 } },
  'general-midi': { name: 'General MIDI / MIDI keyboard', notes: GENERAL_MIDI, fold: {} },
};

export function kitProfile(id) {
  return KIT_PROFILES[id] ?? KIT_PROFILES['alesis-nitro-max'];
}

/**
 * Lane for a note from your instrument: a custom override (settings.noteOverrides, note → lane,
 * '' = ignore the note) wins over the kit profile. Handy for e.g. a broken hi-hat pedal.
 */
export function laneForInputNote(note, settings) {
  const override = settings.noteOverrides?.[note];
  if (override !== undefined) return override || null;
  return kitProfile(settings.kitProfile).notes.get(note) ?? null;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note number → name using the C2 = 36 convention (matches the GM drum chart). */
export function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

// Computer-keyboard fallback so the app can be tried without a kit (home row, left to right like the highway).
export const KEYBOARD_MAP = {
  a: Lane.ClosedHiHat,
  s: Lane.OpenHiHat,
  d: Lane.Crash1,
  f: Lane.Snare,
  g: Lane.Kick,
  h: Lane.RackTom1,
  j: Lane.RackTom2,
  k: Lane.FloorTom,
  l: Lane.Crash2,
  ';': Lane.Ride,
  "'": Lane.Crash3,
};

export const DIFFICULTY = {
  easy: { label: 'Easy (±95ms)', windowMs: 95 },
  normal: { label: 'Normal (±65ms)', windowMs: 65 },
  hard: { label: 'Hard (±40ms)', windowMs: 40 },
};

export const CUSTOM_WINDOW_RANGE = { min: 20, max: 200 };

/** Hit window (± ms) for a difficulty; 'custom' uses settings.customWindowMs. */
export function hitWindowMs(difficulty, settings) {
  if (difficulty === 'custom') return settings.customWindowMs;
  return (DIFFICULTY[difficulty] ?? DIFFICULTY.normal).windowMs;
}

export function difficultyLabel(difficulty, windowMs) {
  return difficulty === 'custom' ? `Custom (±${windowMs}ms)` : DIFFICULTY[difficulty]?.label ?? difficulty;
}

/** Hits this close to the note count as perfect: a fifth of the window, but at least 10 ms. */
export function perfectMs(windowMs) {
  return Math.max(10, windowMs * 0.2);
}

export const SPEED_PRESETS = [25, 50, 75, 100, 125];
