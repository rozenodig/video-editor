# TT_EDITOR

A programmatic short-form video editor. You give it one long source video and a
music track; it analyses both, decides where to cut, and emits a JSON edit
config that [Remotion](https://remotion.dev) renders into a 1080×1920 / 30fps
vertical video.

The point is **repeatability**. An edit is a plain JSON file, so you can
regenerate it, diff it, tweak one number, and re-render — instead of dragging
clips around a timeline and hoping you can reproduce it later.

```
source video ──► analyze-video ──┐
                                 ├──► generate-edit ──► config.json ──► render ──► out/*.mp4
music track  ──► analyze-audio ──┘                            ▲
                                                              │
lyrics (.srt) ─► srt-parser ────► captions.json ──────────────┘
       or  ────► transcribe (Whisper)
```

---

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The pipeline](#the-pipeline)
- [Edit modes and feel flags](#edit-modes-and-feel-flags)
- [Config format](#config-format)
- [Caption presets](#caption-presets)
- [Color grades](#color-grades)
- [Transitions and beat effects](#transitions-and-beat-effects)
- [Rendering](#rendering)
- [Registering compositions in the Studio](#registering-compositions-in-the-studio)
- [Project structure](#project-structure)
- [Command reference](#command-reference)
- [Known limitations](#known-limitations)
- [Media, assets and licensing](#media-assets-and-licensing)

---

## How it works

There are three stages, and each one writes a file the next stage reads. Nothing
is hidden in memory — you can inspect and hand-edit every intermediate artefact.

**1. Analysis.** Two independent analysers run over your inputs.

- `analyze-video` walks the source video's frames via `ffprobe` and infers scene
  boundaries from compression data — large I-frame size jumps and shifts in
  average packet size across a sliding window mark a cut. Each detected scene
  gets a `visualEnergy` score from 0–1. This runs once per source video and is
  cached in `public/analysis/<name>.analysis.json`.
- `analyze-audio` extracts a section of the track to 16-bit PCM WAV, then runs a
  pure-TypeScript beat detector over the samples: RMS energy in 10 ms windows →
  spectral flux (energy derivative) → peak-picking against a dynamic threshold →
  BPM estimated from inter-beat intervals. Output is a list of beat timestamps,
  a subset flagged as *strong* beats, and an energy envelope over time.

**2. Generation.** `generate-edit` is the actual editor. It reads both analyses
and decides:

- **Cut rhythm** — cut points are placed at a multiple of the beat interval
  (`60 / bpm`), then snapped to the nearest real detected beat. How many beats
  per cut is driven by the local energy at that moment in the track, so loud
  sections cut faster than quiet ones.
- **Shot selection** — for each cut, a scene is scored on how well its visual
  energy matches the audio energy there, whether it contains a high-energy
  moment, and whether it has been used already (repeats are penalised). Once all
  scenes have been used, the pool resets.
- **Speed ramping** — playback rate per clip, derived from local energy and
  proximity to a strong beat.
- **Framing** — a small random zoom (`scale`) and off-centre anchor per clip so
  no two cuts sit in exactly the same frame.
- **Beat effects** — shake / pulse / flash events with per-beat intensity.

One hard constraint runs through the clip logic: **a clip must always fill its
slot in the output timeline.** If the chosen scene doesn't contain enough source
footage at the requested playback rate, the rate is slowed down until it does.
This is what prevents black gaps between cuts.

**3. Render.** `VideoComposition` renders the config as four stacked layers —
clips, overlays (color grade, vignette, film grain), captions, audio — and
Remotion encodes it to MP4.

---

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 18+ | Needed for Remotion 4.x and `tsx` |
| `ffmpeg` / `ffprobe` on `PATH` | `brew install ffmpeg` on macOS. `convert-clip` falls back to Remotion's bundled ffmpeg binary if the system one is missing, but the analysis scripts need `ffprobe`. |
| ~2 GB disk | For `node_modules`, plus Whisper models if you use transcription |

Whisper is **not** required unless you run `npm run transcribe` — the model is
downloaded on first use.

No API keys, accounts, or network services are involved. Everything runs locally.

## Install

```bash
git clone <this-repo>
cd TT_EDITOR
npm install --prefix my-video
```

All commands can be run from the repository root — the root `package.json` just
forwards to `my-video/`.

Then drop your media in place:

```
my-video/public/clips/    your source video(s), .mp4
my-video/public/audio/    your music track(s), if separate from the video
my-video/public/lyrics/   .srt lyric files, optional
```

Media files are **not** tracked in git (see
[Media, assets and licensing](#media-assets-and-licensing)), so a fresh clone
has empty media folders. Bring your own.

If your source video isn't browser-decodable, normalise it first:

```bash
npm run convert-clip -- /path/to/raw-footage.mov
# → my-video/public/clips/raw-footage.mp4  (H.264 / AAC, faststart, yuv420p)
```

## Quick start

A fresh clone ships with one runnable demo. `public/demo/demo-source.mp4` is a
15-second clip generated procedurally with ffmpeg — gradient and test-pattern
scenes over a synthesised 120 BPM beat — so there is no third-party media in
this repository and nothing to download:

```bash
npm run dev                                                  # Studio → "Demo" folder
npm run render -- configs/auto-generated/demo-source-edit-0s-15s.json
```

To regenerate that config from scratch and watch the whole pipeline run:

```bash
npm run create-edit -- \
  --video public/demo/demo-source.mp4 \
  --audio public/demo/demo-source.mp4 \
  --from 0 --to 15 --mode edit --style cinematic
```

Beat detection recovers 120 BPM from the demo track, which doubles as a sanity
check that the analyser is working.

### On your own footage

The one command that does everything:

```bash
npm run create-edit -- \
  --video public/clips/my-source.mp4 \
  --audio public/clips/my-source.mp4 \
  --from 16 --to 45 \
  --mode edit --style highContrast
```

That runs video analysis, audio analysis, and config generation in sequence,
skipping any analysis step whose output already exists. It prints the config
path when done:

```
=== DONE ===
Config: configs/auto-generated/my-source-edit-16s-45s.json
```

Preview it:

```bash
npm run dev          # opens Remotion Studio
```

Render it:

```bash
npm run render -- configs/auto-generated/my-source-edit-16s-45s.json
# → my-video/out/my-source-edit-16s-45s.mp4
```

> **Note on paths:** all `--video` / `--audio` / `--lyrics` paths are resolved
> relative to `my-video/`, not the repository root.

### With lyrics

```bash
npm run create-edit -- \
  --video public/clips/my-source.mp4 \
  --audio public/clips/my-source.mp4 \
  --from 0 --to 30 \
  --mode lyric \
  --lyrics public/lyrics/my-song.srt \
  --caption-preset neon
```

The `.srt` is parsed and time-shifted to the `--from`/`--to` window, written to
`public/captions/`, and wired into the config automatically.

---

## The pipeline

Each stage can also be run on its own. Useful when you want to re-generate an
edit with different settings without redoing the (slow) analysis.

### `analyze-video` — scene and energy detection

```bash
npm run analyze-video -- public/clips/my-source.mp4
```

Writes `public/analysis/my-source.analysis.json`:

```jsonc
{
  "sourceVideo": "clips/my-source.mp4",
  "duration": 187.4,
  "fps": 30, "width": 1080, "height": 1920,
  "scenes": [
    { "startTime": 0, "endTime": 3.2, "duration": 3.2, "visualEnergy": 0.71 }
  ],
  "sceneChanges": [0, 3.2, 7.9],
  "highEnergyMoments": [{ "timestamp": 12.4, "energy": 0.93 }]
}
```

Run once per source video. `create-edit` reuses this file if it exists.

### `analyze-audio` — beats, BPM, energy envelope

```bash
npm run analyze-audio -- public/clips/my-source.mp4 --from 16 --to 45
```

Writes `public/analysis/my-source_16s-45s.beats.json`. Omit `--from`/`--to` to
analyse the whole track — that produces a `_full.beats.json`, which
`create-edit` will also accept.

```jsonc
{
  "estimatedBPM": 142,
  "beats": [16.42, 16.84, 17.26],
  "strongBeats": [16.42, 18.11],
  "energyEnvelope": [{ "time": 16.0, "energy": 0.62 }]
}
```

### `generate-edit` — the editor

```bash
npm run generate-edit -- \
  --video public/analysis/my-source.analysis.json \
  --audio public/clips/my-source.mp4 \
  --from 16 --to 45 \
  --mode edit --style moody --vibe
```

Writes `configs/auto-generated/<audio-name>-<mode>-<from>s-<to>s.json`.

Because generation is fast and deterministic-ish, this is the command you'll
re-run most: same analysis, different `--style` / `--mode` / feel flag, several
variants in a row.

### `transcribe` — word-level captions via Whisper

```bash
npm run transcribe -- public/audio/my-song.wav --model medium
```

Installs `whisper.cpp` v1.5.5 into `my-video/.whisper/`, downloads the model,
and transcribes with token-level timestamps into a Remotion `Caption[]` JSON at
`public/captions/<name>.json`.

Two things to know:

- The language is **hardcoded to Swedish** in `scripts/transcribe.ts`. Change
  the `language` field there for other languages.
- The model must be a non-`.en` variant (`medium` or `large-v3`) — the
  English-only models can't do Swedish.

Input is converted to 16 kHz mono WAV automatically if it isn't already.

If Whisper's output is wrong for a track, hand-edit the caption JSON. It's
faster than re-running with different parameters.

### `extract-audio` / `convert-clip` — helpers

```bash
npm run extract-audio -- public/clips/my-source.mp4 --format wav
# → public/audio/my-source.wav  (16 kHz mono, Whisper-ready)

npm run convert-clip -- /path/to/anything.mkv --output my-clip
# → public/clips/my-clip.mp4  (H.264/AAC, browser-compatible)
```

---

## Edit modes and feel flags

`--mode` sets what kind of video this is:

| Mode | Behaviour |
|---|---|
| `edit` | Hype edit. Fast cuts (2 beats), speed ramping on, glitch transitions, film grain overlay. |
| `lyric` | Lyric video. Slower cuts (4 beats), no speed ramping, clean cuts, captions front and centre. |

On top of that, one optional **feel flag** overrides the cut rhythm, transition
choice, and effect density:

| Flag | Cut length | Transitions | Speed ramp | Beat effects |
|---|---|---|---|---|
| *(none)* | 2 beats (edit) / 4 (lyric) | mode default | edit mode only | shake / pulse / flash |
| `--vibe` | alternates burst (rapid) and breath (3–4 beat holds) | varied per beat strength | yes | layered, high variety |
| `--smooth` | 3–5 beats by energy | ~85% zoom, occasional cut | gentle (0.9–1.05) | pulse on strong beats only |
| `--chill` | 4–8 beats by energy | zoom / cut only, no glitch | minimal (0.92–1.02) | soft pulse every 2nd strong beat |

`--vibe` is the interesting one: it alternates between *burst* phases of rapid
one-beat cuts and *breath* phases that hold a good shot for several beats. That
push-pull is what makes a cut sequence feel edited rather than metronomic.

---

## Config format

The generated JSON is the whole edit. It's readable and hand-editable — if the
generator picks a bad shot, change `startFrom` and re-render.

```typescript
interface VideoConfig {
  id: string;                  // composition id, also the output filename
  title: string;
  mode: "lyric" | "edit";
  audioSrc: string;            // path relative to public/
  audioStartFrom?: number;     // trim offset into the audio file, seconds
  captionsPath?: string;       // path relative to public/
  clips: ClipConfig[];
  captionStyle?: CaptionStyleConfig;
  effects: EffectsConfig;
  output: OutputConfig;
}

interface ClipConfig {
  src: string;                 // path relative to public/
  startFrom: number;           // start time in the SOURCE video, seconds
  endAt: number;               // end time in the SOURCE video, seconds
  showAt: number;              // when it appears in the OUTPUT timeline, seconds
  playbackRate?: number;       // 0.3 = slowmo, 1.0 = normal, 1.5 = speedup
  scale?: number;              // 1.0 = normal, 1.2 = 20% zoom in
  scaleAnchor?: { x: number; y: number };   // 0.5, 0.5 = centre
  transition?: "cut" | "zoom" | "glitch" | "flash";  // per-clip override
}

interface EffectsConfig {
  beatSync: boolean;
  beats?: { timeInSeconds: number; effect: "shake" | "pulse" | "flash"; intensity?: number }[];
  transitions: "cut" | "zoom" | "glitch" | "flash";  // global default
  colorGrade?: string;
  vignette: boolean;
}

interface OutputConfig {
  width: 1080; height: 1920; fps: 30;   // fixed — 9:16 vertical
  durationInSeconds: number;
}
```

The distinction that matters most: **`startFrom`/`endAt` are source-video time,
`showAt` is output time.** They are unrelated clocks. A clip can pull footage
from 02:14 of the source and show it at 00:03 of the output.

`configs/sample-edit.json` and `configs/sample-lyric.json` are minimal
hand-written examples of each mode.

## Caption presets

Twelve presets are defined in `src/presets/caption-styles.ts` and implemented in
`src/components/CaptionRenderer.tsx`:

`bounce` · `glow` · `slide` · `typewriter` · `explosion` · `neon` · `3d` ·
`glitch` · `kinetic` · `wave` · `highlight` · `vfx`

Pass one with `--caption-preset <name>`, or edit `captionStyle` in the config
directly to override font size, colors, glow color, and position
(`top` / `center` / `bottom`).

`combineTokensWithinMs` controls how many words group onto one on-screen page —
lower means fewer words at a time, faster pacing.

All caption animation uses Remotion's `spring()` with low damping and low mass,
so text snaps rather than floats. Text carries drop shadows and outlines for
readability over arbitrary footage.

## Color grades

Applied as CSS filters over the clip layer. Pass with `--style <name>`.

| Name | Filter |
|---|---|
| `cinematic` | `contrast(1.1) saturate(0.85) brightness(0.95)` |
| `warmVintage` | `sepia(0.15) contrast(1.05) saturate(1.1) brightness(1.02)` |
| `coldBlue` | `saturate(0.8) brightness(1.05) hue-rotate(-10deg)` |
| `highContrast` | `contrast(1.3) saturate(1.2) brightness(0.9)` *(default)* |
| `moody` | `contrast(1.15) saturate(0.7) brightness(0.85)` |
| `vibrant` | `contrast(1.05) saturate(1.4) brightness(1.05)` |

Defined in `src/components/VideoOverlays.tsx` — add your own there.

## Transitions and beat effects

**Transitions** run at the head of each clip, over a preset number of frames:

- `cut` — hard cut, zero transition frames
- `zoom` — scale push into the new shot
- `glitch` — RGB-split / displacement stutter
- `flash` — brightness spike that decays

Set globally via `effects.transitions`, overridden per clip via
`clip.transition`.

**Beat effects** are applied to the entire frame when `effects.beatSync` is
true, wrapping all other layers:

- `shake` — sinusoidal X/Y displacement, decaying
- `pulse` — scale bump
- `flash` — full-frame brightness spike

Each has an `intensity` the generator derives from the local audio energy.

---

## Rendering

Single config:

```bash
npm run render -- configs/auto-generated/my-edit.json
npm run render -- configs/auto-generated/my-edit.json --output /tmp/custom.mp4
```

Every config in a directory:

```bash
npm run batch-render -- configs/auto-generated
```

Batch render continues past failures and prints a pass/fail summary at the end.
Output lands in `my-video/out/`, named after each config's `id`.

Both renderers pass the config through Remotion's `--props`, so the composition
renders from the JSON on disk rather than from whatever is registered in
`Root.tsx`.

## Registering compositions in the Studio

Remotion Studio needs compositions registered at build time, so
`src/Root.tsx` statically imports each config JSON and lists it in
`autoConfigs`. To preview a new edit in the Studio, add two lines:

```typescript
import myNewEdit from "../configs/auto-generated/my-new-edit.json";

const autoConfigs = [myNewEdit, /* ...existing */] as VideoConfig[];
```

This is only needed for **Studio preview**. `npm run render` works on any config
file without registration.

## Project structure

```
TT_EDITOR/
├── package.json                 # forwards every script to my-video/
├── Claude.md/claude.md          # working notes / house rules for the project
└── my-video/
    ├── configs/
    │   ├── sample-edit.json         # hand-written examples
    │   ├── sample-lyric.json
    │   └── auto-generated/          # output of generate-edit
    ├── public/                      # served by Remotion via staticFile()
    │   ├── demo/                    # synthetic ffmpeg demo clip (committed)
    │   ├── clips/                   # source video (gitignored)
    │   ├── audio/                   # music tracks (gitignored)
    │   ├── lyrics/                  # .srt files (gitignored)
    │   ├── captions/                # caption JSON (gitignored)
    │   └── analysis/                # cached scene + beat analysis
    ├── scripts/
    │   ├── create-edit.ts           # master CLI, runs the whole pipeline
    │   ├── generate-edit.ts         # the editing algorithm
    │   ├── analyze-video.ts         # scene detection via ffprobe
    │   ├── analyze-audio.ts         # beat detection
    │   ├── transcribe.ts            # Whisper captions
    │   ├── render-video.ts          # single render
    │   ├── batch-render.ts          # directory render
    │   ├── extract-audio.ts         # ffmpeg audio extraction
    │   ├── convert-clip.ts          # ffmpeg normalisation to H.264/AAC
    │   └── utils/
    │       ├── beat-detection.ts    # WAV reader + onset detection, no deps
    │       ├── ffmpeg-helpers.ts    # ffprobe/ffmpeg wrappers
    │       └── srt-parser.ts        # .srt → Remotion Caption[]
    ├── src/
    │   ├── Root.tsx                 # composition registry
    │   ├── VideoComposition.tsx     # 4-layer composition
    │   ├── components/
    │   │   ├── ClipSequence.tsx     # clip timeline + transitions
    │   │   ├── CaptionRenderer.tsx  # all 12 caption presets
    │   │   ├── BeatEffects.tsx      # shake / pulse / flash
    │   │   └── VideoOverlays.tsx    # color grade, vignette, film grain
    │   ├── presets/caption-styles.ts
    │   └── types/VideoConfig.ts     # the config contract
    └── .agents/skills/              # vendored Remotion best-practice docs
```

## Command reference

Run from the repository root. Everything after `--` is forwarded to the script.

| Command | Purpose |
|---|---|
| `npm run dev` | Remotion Studio |
| `npm run build` | Bundle the Remotion project |
| `npm run lint` | ESLint + `tsc` |
| `npm run create-edit -- …` | Full pipeline: analyse → generate |
| `npm run analyze-video -- <file>` | Scene detection |
| `npm run analyze-audio -- <file> [--from N --to N]` | Beat detection |
| `npm run generate-edit -- …` | Generate a config from existing analyses |
| `npm run transcribe -- <audio> [--model medium\|large-v3]` | Whisper captions |
| `npm run extract-audio -- <video> [--format wav\|mp3]` | Pull audio out |
| `npm run convert-clip -- <video> [--output name]` | Normalise to H.264/AAC |
| `npm run render -- <config.json> [--output path]` | Render one |
| `npm run batch-render -- [dir]` | Render a directory |

### `create-edit` flags

| Flag | Default | Meaning |
|---|---|---|
| `--video <path>` | *required* | Source video |
| `--audio <path>` | *required* | Audio source (can be the same video) |
| `--from <seconds>` | `0` | Start of the section to edit |
| `--to <seconds>` | full duration | End of the section |
| `--mode edit\|lyric` | `edit` | Edit type |
| `--style <grade>` | `highContrast` | Color grade |
| `--lyrics <file.srt>` | — | Lyric file for caption generation |
| `--caption-preset <name>` | `bounce` | Caption animation style |
| `--vibe` / `--smooth` / `--chill` | — | Feel flag (see above) |

Flag parsing joins all tokens up to the next `--flag`, so unquoted paths
containing spaces still work.

## Known limitations

- **Output is fixed at 1080×1920 / 30fps.** The `OutputConfig` type literally
  types these as constants. Other aspect ratios need type and layout changes.
- **Scene detection is compression-based, not visual.** It reads I-frame sizes
  and packet sizes from `ffprobe` rather than comparing pixels, because
  Remotion's bundled ffmpeg lacks the `select` / `showinfo` / `mestimate`
  filters. It's fast and good enough for music-video footage; it will miss cuts
  between visually similar shots.
- **Clip framing is randomised.** `scale` and `scaleAnchor` use `Math.random()`,
  so two runs of `generate-edit` with identical inputs produce slightly
  different framing. Feature when you're generating variants, annoyance when
  you want reproducibility.
- **Transcription is hardcoded to Swedish.** One-line change in
  `scripts/transcribe.ts`.
- **`convert-clip`'s ffmpeg fallback is macOS-only.** It looks for
  `@remotion/compositor-darwin-{arm64,x64}`. On Linux/Windows, install system
  ffmpeg.
- **All `@remotion/*` packages must stay on the exact same version** — no `^`
  ranges. Use `npx remotion upgrade` rather than bumping them individually.

## Media, assets and licensing

**No third-party media ships with this repository.** `public/clips/`,
`public/audio/`, `public/lyrics/` and `public/captions/` are gitignored, as is
`out/`. A clone gives you the tooling, the demo clip, and nothing else.

The single committed media file, `public/demo/demo-source.mp4`, is generated
procedurally by ffmpeg from `gradients`, `smptebars`, `rgbtestsrc` and
`testsrc2` sources with a synthesised 120 BPM beat. Nobody holds rights in it.

That's deliberate: the source video and music you feed this thing are almost
certainly someone's copyrighted work, and they don't belong in a public git
repository. Supply your own, and make sure you have the rights to whatever you
render and publish.

The `public/analysis/` JSON files are kept — they're derived numeric data (beat
timestamps, scene boundaries, energy curves) with no media in them, and they let
the sample configs be inspected without the originals.

`my-video/.agents/skills/remotion-best-practices/` contains Remotion's own
agent-skill documentation, vendored for offline use. It is the property of the
Remotion authors and carries their license.

Remotion itself is **not** fully free software: some companies need a paid
license. Read the terms at
[remotion.dev/license](https://remotion.dev/license) before using this
commercially.

This repository's own code is unlicensed — all rights reserved unless a LICENSE
file says otherwise.
