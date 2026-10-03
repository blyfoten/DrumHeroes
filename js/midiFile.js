// Standard MIDI File parser and drum transcription (port of Analysis/MidiTranscriptionService.cs).

import { mapGmNoteToKit, laneForNote, LANE_PRIORITY } from './drumMap.js';

const MAX_SIMULTANEOUS_NOTES = 3;
const SIMULTANEOUS_THRESHOLD_SECONDS = 0.005;

function readVarLen(view, pos) {
  let value = 0;
  let byte;
  do {
    byte = view.getUint8(pos++);
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return [value, pos];
}

function readChunkId(view, pos) {
  return String.fromCharCode(
    view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
}

/**
 * Parses an SMF into { division, tracks: [[{tick, type, ...}]] }.
 * Only the events DrumHero needs are kept: note-on, tempo and time signature.
 */
export function parseMidi(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (readChunkId(view, 0) !== 'MThd') throw new Error('Not a MIDI file (missing MThd header).');

  const headerLen = view.getUint32(4);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  let pos = 8 + headerLen;
  const tracks = [];

  for (let t = 0; t < trackCount && pos + 8 <= view.byteLength; t++) {
    const id = readChunkId(view, pos);
    const len = view.getUint32(pos + 4);
    pos += 8;
    const end = Math.min(pos + len, view.byteLength);
    if (id !== 'MTrk') { pos = end; t--; continue; }

    const events = [];
    let tick = 0;
    let runningStatus = 0;

    while (pos < end) {
      let delta;
      [delta, pos] = readVarLen(view, pos);
      tick += delta;

      let status = view.getUint8(pos);
      if (status & 0x80) {
        pos++;
      } else if (runningStatus) {
        status = runningStatus; // running status: reuse previous, data byte not consumed
      } else {
        throw new Error(`Corrupt MIDI file: unexpected data byte in track ${tracks.length + 1} at offset ${pos}.`);
      }

      if (status === 0xff) {
        const type = view.getUint8(pos++);
        let metaLen;
        [metaLen, pos] = readVarLen(view, pos);
        if (type === 0x51 && metaLen === 3) {
          const usPerQuarter = (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2);
          events.push({ tick, type: 'tempo', usPerQuarter });
        } else if (type === 0x58 && metaLen >= 2) {
          events.push({ tick, type: 'timesig', numerator: view.getUint8(pos), denominator: 2 ** view.getUint8(pos + 1) });
        }
        pos += metaLen;
        if (type === 0x2f) break; // end of track
      } else if (status === 0xf0 || status === 0xf7) {
        let sysLen;
        [sysLen, pos] = readVarLen(view, pos);
        pos += sysLen;
      } else {
        runningStatus = status;
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        const dataLen = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        const d1 = view.getUint8(pos);
        const d2 = dataLen === 2 ? view.getUint8(pos + 1) : 0;
        pos += dataLen;
        if (kind === 0x90 && d2 > 0) {
          events.push({ tick, type: 'noteOn', channel, note: d1, velocity: d2 });
        }
      }
    }
    tracks.push(events);
    pos = end;
  }

  return { division, tracks };
}

function buildTempoMap(midi) {
  const entries = [];
  for (const track of midi.tracks) {
    for (const e of track) if (e.type === 'tempo') entries.push({ tick: e.tick, usPerQuarter: e.usPerQuarter });
  }
  entries.sort((a, b) => a.tick - b.tick);
  if (entries.length === 0) entries.push({ tick: 0, usPerQuarter: 500000 });
  return entries;
}

function makeTickToSeconds(midi, tempoMap) {
  if (midi.division & 0x8000) {
    // SMPTE timing: ticks per second = frames/sec * ticks/frame
    const fps = 256 - (midi.division >> 8);
    const ticksPerFrame = midi.division & 0xff;
    return (tick) => tick / (fps * ticksPerFrame);
  }
  const tpq = midi.division;
  return (tick) => {
    let seconds = 0;
    let lastTick = 0;
    let usPerTick = tempoMap[0].usPerQuarter / tpq;
    for (let i = 1; i < tempoMap.length; i++) {
      if (tempoMap[i].tick >= tick) break;
      seconds += ((tempoMap[i].tick - lastTick) * usPerTick) / 1e6;
      lastTick = tempoMap[i].tick;
      usPerTick = tempoMap[i].usPerQuarter / tpq;
    }
    return seconds + ((tick - lastTick) * usPerTick) / 1e6;
  };
}

function limitSimultaneous(sorted, maxNotes) {
  const result = [];
  let group = [];
  const flush = () => {
    if (group.length <= maxNotes) result.push(...group);
    else result.push(...[...group].sort((a, b) => LANE_PRIORITY[a.lane] - LANE_PRIORITY[b.lane]).slice(0, maxNotes));
  };
  for (const note of sorted) {
    if (group.length && note.time - group[0].time > SIMULTANEOUS_THRESHOLD_SECONDS) {
      flush();
      group = [];
    }
    group.push(note);
  }
  if (group.length) flush();
  return result.sort((a, b) => a.time - b.time);
}

/**
 * Turns a MIDI file into a highway transcription:
 * { bpm, timeSignature: {numerator, denominator}, durationSeconds, notes: [{time, lane, midiNote, velocity}] }
 */
export function transcribeMidi(arrayBuffer, audioDurationSeconds = 0) {
  const midi = parseMidi(arrayBuffer);
  const tempoMap = buildTempoMap(midi);
  const tickToSeconds = makeTickToSeconds(midi, tempoMap);

  let timeSignature = { numerator: 4, denominator: 4 };
  outer: for (const track of midi.tracks) {
    for (const e of track) {
      if (e.type === 'timesig') { timeSignature = { numerator: e.numerator, denominator: e.denominator }; break outer; }
    }
  }

  const notes = [];
  for (const track of midi.tracks) {
    for (const e of track) {
      if (e.type !== 'noteOn' || e.channel !== 9) continue; // GM percussion = channel 10
      const midiNote = mapGmNoteToKit(e.note);
      const lane = laneForNote(midiNote);
      if (!lane) continue;
      notes.push({
        time: Math.round(tickToSeconds(e.tick) * 1e6) / 1e6,
        lane,
        midiNote,
        velocity: Math.min(1, Math.max(0.1, e.velocity / 127)),
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  const limited = limitSimultaneous(notes, MAX_SIMULTANEOUS_NOTES);

  const bpm = Math.round((60e6 / tempoMap[0].usPerQuarter) * 100) / 100;
  const midiDuration = limited.length ? limited[limited.length - 1].time + 1 : 0;

  return {
    bpm,
    timeSignature,
    durationSeconds: audioDurationSeconds > 0 ? audioDurationSeconds : midiDuration,
    notes: limited,
  };
}
