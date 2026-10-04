# 🥁 DrumHeroes

A **Guitar Hero-style drum trainer that runs in the browser** on Linux, macOS, and Windows. Import a drum MIDI file (for example from Songsterr), optionally with the song's audio. Notes scroll down a highway and you play along on an electronic drum kit, a MIDI keyboard, or the computer keyboard, and get scored as you go.

DrumHeroes is a web port of [**DrumHero** by Lucas Frazão](https://github.com/Lucas-Frazao/DrumHero), a Windows/WPF app. See [Credits](#credits).

---

## Quick start

```bash
git clone git@github.com:blyfoten/DrumHeroes.git
cd DrumHeroes
python3 server.py            # opens http://localhost:8765
```

The server only needs the Python standard library. Use **Chrome/Chromium** (or Edge) for the best Web MIDI support; Firefox works but asks for MIDI permission through an add-on prompt.

Try it out: pick one of the built-in **Demo songs** in the library (*Simple Kick & Snare* is the easiest) → **Space** to play.

### Optional: remove drums from the song audio

Install [Demucs](https://github.com/facebookresearch/demucs) for the interpreter that runs the server, or point the server at one that has it:

```bash
pip install demucs
python3 server.py --python ~/venvs/demucs/bin/python   # if Demucs lives in a venv
```

Demucs creates a drumless backing track and a drum stem, which you can fade back in. The first run downloads the `htdemucs` model (~80 MB). If Demucs isn't installed but `librosa` and `soundfile` are, a lower-quality HPSS split is used. With neither, you can still import MIDI on its own or MIDI plus the full mix.

---

## Setups

Pick one under **Settings → Quick setup**:

| | Electronic kit | No drums |
|---|---|---|
| **Note input** | Kit over USB or 5-pin MIDI | Computer keyboard, or a MIDI keyboard |
| **Drum sound** | **Line-in**: the module's audio goes to the computer's line-in and is mixed with the song.<br>**Off**: listen on the module, optionally feeding the computer's output into the module's MIX IN for zero-latency monitoring | Built-in synthesized kit |
| **Scoring** | From MIDI | From key or MIDI notes |

**Kit profiles** (Settings → Kit / note mapping):

- **Roland TD-6 / TD-6V**: includes the hi-hat edge notes 22 and 26. Notes for a third crash are moved to crash 2.
- **Alesis Nitro Max**: the kit the original app was built for.
- **General MIDI / MIDI keyboard**: C2 kick, D2 snare, F#2 closed hi-hat, A#2 open hi-hat, C#3 crash, D#3 ride, and the toms in between.

**Computer keyboard:** `A` HH-C · `S` HH-O · `D` CR1 · `F` snare · `G` kick · `H` tom 1 · `J` tom 2 · `K` floor · `L` CR2 · `;` ride · `'` CR3. On the practice screen, **Space** plays and pauses, and **R** restarts.

Use **Settings → Pad test** to see which MIDI note each pad sends and which lane it maps to. **Settings → Note remapping** sends any note to a different lane (or ignores it), on top of the kit profile. For example, with a broken hi-hat pedal, map open hi-hat (46) to Closed Hi-Hat.

---

## Features

- **Highway with only the lanes the song uses**, in kit order: HH-C, HH-O, CR1, snare, kick, tom 1, tom 2, floor, CR2, ride, CR3.
- **3D highway**: the track recedes toward a horizon and notes come at you, Guitar Hero style. Perfect hits explode into sparks.
- **Hit detection**: Easy ±95 ms, Normal ±65 ms, Hard ±40 ms, or any custom window from ±20 to ±200 ms. Hits are judged against the MIDI event's own timestamp, with an adjustable **hit timing offset** to compensate for audio latency.
- **Built-in demo songs**: play them from the library without importing anything.
- **Tempo control**: 25–125% presets plus ±5 BPM steps. Pitch is preserved, and the timing window stays the same in real time at any speed.
- **Metronome and count-in** (none, 1 or 2 bars), and a "drums start in N s" hint for songs with long intros.
- **Feedback while playing**: green or red lane flashes, early/late timing readout, and accuracy, hits and misses live.
- **Stats**: a summary at the end of every run, practice history per song, and click-to-seek.
- **Separate volumes** for the backing track, drum stem, your drums (samples or line-in) and metronome. Audio output device selection works where the browser supports it.
- **Local storage**: the library, audio and history live in the browser's IndexedDB. Nothing is uploaded anywhere; stem separation runs on your own machine.

---

## Project layout

```
server.py            static server + local Demucs/HPSS separation API (stdlib only)
index.html
css/style.css
demo/                built-in demo drum MIDI files
js/
  main.js            router, audio unlock, input setup
  midiFile.js        Standard MIDI File parser → highway transcription
  drumMap.js         lanes, GM mapping, kit profiles, keyboard map
  drumSynth.js       synthesized drum kit and metronome clicks
  audioEngine.js     Web Audio buses, drum voices, line-in monitor
  songPlayer.js      transport, song clock, count-in, metronome
  hitDetection.js    hit and miss judging
  highway.js         canvas highway renderer
  midiInput.js       Web MIDI input
  input.js           MIDI and keyboard → hits; drum sound routing
  separation.js      client for the separation API
  storage.js         IndexedDB library and settings
  demos.js           built-in demo songs
  views/             library, import dialog, practice, settings
```

No build step and no dependencies: plain ES modules served as-is.

---

## Credits

DrumHeroes is based on **[DrumHero](https://github.com/Lucas-Frazao/DrumHero) by [Lucas Frazão](https://github.com/Lucas-Frazao)**. These parts of this project are ported from that codebase:

- the Alesis Nitro Max MIDI mapping and the General MIDI fallback table
- the MIDI-to-highway transcription (tempo map, channel-10 extraction, the three-simultaneous-notes priority rule)
- the hit detection engine and difficulty windows
- the synthesized drum kit inspired by *…And Justice for All*
- the highway lane layout and colors
- the Demucs and HPSS separation pipeline

Thanks, Lucas, for the original design and implementation. 🥁

The browser port, the Roland TD-6 and General MIDI profiles, line-in monitoring and the keyboard mode are new in this repository.
