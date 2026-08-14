/**
 * Auto-edit generator — the brain of the system.
 *
 * Takes video analysis + audio analysis and generates a VideoConfig JSON
 * for a professional-quality TikTok edit.
 *
 * Usage:
 *   npx tsx scripts/generate-edit.ts \
 *     --video <analysis.json> \
 *     --audio <audio-or-video-file> \
 *     --from <seconds> --to <seconds> \
 *     [--mode lyric|edit] \
 *     [--style <colorGrade preset>] \
 *     [--captions <captions.json>]
 *
 * Output: configs/auto-generated/<name>.json
 */

import path from "path";
import fs from "fs";
import type {
  VideoConfig,
  ClipConfig,
  BeatTimestamp,
  EffectsConfig,
} from "../src/types/VideoConfig.js";
import type { VideoAnalysis } from "./analyze-video.js";
import type { AudioAnalysis } from "./analyze-audio.js";
import { ensureDir } from "./utils/ffmpeg-helpers.js";

// ── CLI ────────────────────────────────────────────────────────────────

interface GenerateArgs {
  videoAnalysisPath: string;
  audioFile: string;
  from: number;
  to: number;
  mode: "lyric" | "edit";
  style: string;
  captionsPath?: string;
  captionPreset?: string;
  vibe?: boolean;
  chill?: boolean;
  smooth?: boolean;
}

function parseArgs(): GenerateArgs {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    const parts: string[] = [];
    for (let i = idx + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      parts.push(args[i]);
    }
    return parts.join(" ") || undefined;
  }

  const videoAnalysisPath = getArg("--video");
  const audioFile = getArg("--audio");
  const from = parseFloat(getArg("--from") ?? "0");
  const to = parseFloat(getArg("--to") ?? "0");

  if (!videoAnalysisPath || !audioFile || to <= from) {
    console.error(
      "Usage: npx tsx scripts/generate-edit.ts --video <analysis.json> --audio <file> --from <s> --to <s> [--mode edit|lyric] [--style <preset>] [--captions <path>]",
    );
    process.exit(1);
  }

  return {
    videoAnalysisPath,
    audioFile,
    from,
    to,
    mode: (getArg("--mode") as "lyric" | "edit") ?? "edit",
    style: getArg("--style") ?? "highContrast",
    captionsPath: getArg("--captions"),
    captionPreset: getArg("--caption-preset") ?? "bounce",
    vibe: args.includes("--vibe"),
    chill: args.includes("--chill"),
    smooth: args.includes("--smooth"),
  };
}

// ── Edit generation algorithm ──────────────────────────────────────────

function generateEdit(
  videoAnalysis: VideoAnalysis,
  audioAnalysis: AudioAnalysis,
  args: GenerateArgs,
): VideoConfig {
  const duration = args.to - args.from;
  const beats = audioAnalysis.beats;
  const strongBeats = new Set(audioAnalysis.strongBeats);
  const bpm = audioAnalysis.estimatedBPM;
  const isEditMode = args.mode === "edit";

  console.log(`  Mode: ${args.mode}`);
  console.log(`  BPM: ${bpm}, Beats: ${beats.length}, Strong: ${strongBeats.size}`);
  console.log(`  Duration: ${duration.toFixed(1)}s`);

  // ── Step 1: Determine cut rhythm ─────────────────────────────────

  const beatInterval = 60 / bpm; // seconds per beat
  const isVibeMode = args.vibe === true;
  const isChillMode = args.chill === true;
  const isSmoothMode = args.smooth === true;
  const baseCutBeats = isChillMode ? 6 : isSmoothMode ? 4 : isEditMode ? 2 : 4;
  const baseCutInterval = beatInterval * baseCutBeats;

  console.log(`  Base cut interval: ${baseCutInterval.toFixed(2)}s (${baseCutBeats} beats)`);
  if (isVibeMode) console.log(`  🎨 Vibe mode: creative rhythm with varied transitions`);
  if (isChillMode) console.log(`  🌊 Chill mode: calm holds, soft transitions, breathing edit`);
  if (isSmoothMode) console.log(`  ✨ Smooth mode: consistent rhythm, zoom transitions, gentle flow`);

  // Generate cut points snapped to nearest beat
  const cutPoints: number[] = [args.from]; // Always start at from
  let cursor = args.from;

  // Vibe mode: alternate between "burst" phases (rapid 1-beat cuts) and
  // "breath" phases (hold on a good shot for 3-4 beats). This creates the
  // push-pull feel of a professional music video edit.
  let vibePhase: "burst" | "breath" = "breath";
  let burstCount = 0;

  while (cursor < args.to - 0.5) {
    const localEnergy = getEnergyAt(audioAnalysis.energyEnvelope, cursor);
    let cutBeats: number;

    if (isChillMode) {
      // Long holds that let each shot breathe — cut on the musical phrase, not every beat
      cutBeats = localEnergy > 0.65 ? 4 : localEnergy > 0.4 ? 6 : 8;
    } else if (isSmoothMode) {
      // Consistent moderate rhythm — not too fast, not too slow
      cutBeats = localEnergy > 0.7 ? 3 : localEnergy > 0.4 ? 4 : 5;
    } else if (isVibeMode) {
      if (vibePhase === "burst") {
        // Rapid-fire cuts on beat
        cutBeats = 1;
        burstCount++;
        // After 2-4 rapid cuts, switch to breath
        if (burstCount >= 2 + Math.floor(Math.random() * 3)) {
          vibePhase = "breath";
          burstCount = 0;
        }
      } else {
        // Hold on a nice shot for 3-4 beats
        cutBeats = localEnergy > 0.6 ? 3 : 4;
        // Switch to burst on high energy or strong beat approach
        const nextStrong = [...strongBeats].find((b) => b > cursor && b - cursor < beatInterval * 2);
        if (localEnergy > 0.65 || nextStrong) {
          vibePhase = "burst";
          burstCount = 0;
        }
      }
    } else if (isEditMode) {
      cutBeats = localEnergy > 0.7 ? 1 : localEnergy > 0.4 ? 2 : 3;
    } else {
      cutBeats = localEnergy > 0.7 ? 2 : localEnergy > 0.4 ? 3 : 4;
    }

    const targetTime = cursor + beatInterval * cutBeats;
    const snappedTime = snapToBeat(targetTime, beats);

    if (snappedTime <= cursor + 0.3) {
      cursor += beatInterval;
      continue;
    }
    if (snappedTime >= args.to) break;

    cutPoints.push(snappedTime);
    cursor = snappedTime;
  }

  console.log(`  ${cutPoints.length} cut points generated`);

  // ── Step 2: Select clips from source video ───────────────────────

  const scenes = videoAnalysis.scenes;
  const highEnergyMoments = videoAnalysis.highEnergyMoments;
  const usedSceneIndices = new Set<number>();
  const clips: ClipConfig[] = [];

  // Track position in output timeline

  for (let i = 0; i < cutPoints.length; i++) {
    const cutStart = cutPoints[i];
    const cutEnd = i < cutPoints.length - 1 ? cutPoints[i + 1] : args.to;
    const cutDuration = cutEnd - cutStart;

    if (cutDuration < 0.2) continue;

    // Find the best matching scene
    const localEnergy = getEnergyAt(audioAnalysis.energyEnvelope, cutStart);
    const scene = pickScene(
      scenes,
      highEnergyMoments,
      localEnergy,
      usedSceneIndices,
      cutDuration,
    );

    // Speed ramping
    const playbackRate = getPlaybackRate(
      localEnergy,
      isEditMode,
      strongBeats.has(snapToBeat(cutStart, beats)),
      cutStart,
      beats,
      strongBeats,
      isVibeMode,
      isChillMode,
      isSmoothMode,
    );

    // Scale/pan for visual interest
    const scale = isChillMode
      ? 1.0 + Math.random() * 0.04 // barely-there zoom, cinematic feel
      : isSmoothMode
        ? 1.0 + Math.random() * 0.08 // gentle zoom
        : isEditMode ? 1.0 + Math.random() * 0.15 : 1.0 + Math.random() * 0.05;
    const scaleAnchor = {
      x: 0.4 + Math.random() * 0.2, // tighter center bias for chill
      y: 0.4 + Math.random() * 0.2,
    };

    // Per-clip transition (vibe mode: vary transitions for creative feel)
    let clipTransition: "cut" | "zoom" | "glitch" | "flash" | undefined;
    if (isChillMode && i > 0) {
      // Soft transitions only — zoom mostly, occasional clean cut. No glitch/flash.
      clipTransition = Math.random() > 0.25 ? "zoom" : "cut";
    } else if (isSmoothMode && i > 0) {
      // Almost exclusively zoom — the "smooth" signature. Rare cuts for rhythm breaks.
      clipTransition = Math.random() > 0.15 ? "zoom" : "cut";
    } else if (isVibeMode && i > 0) {
      const isOnStrong = strongBeats.has(snapToBeat(cutStart, beats));
      if (isOnStrong) {
        // Strong beats: punchy flash or glitch
        clipTransition = Math.random() > 0.5 ? "flash" : "glitch";
      } else if (localEnergy > 0.6) {
        // High energy: zoom or glitch
        clipTransition = Math.random() > 0.4 ? "zoom" : "glitch";
      } else {
        // Chill moments: clean cut or subtle zoom
        clipTransition = Math.random() > 0.6 ? "zoom" : "cut";
      }
    }

    // Compute source duration accounting for playback rate.
    // CRITICAL: the clip must fill the entire cutDuration in the output timeline.
    // If the scene has less source than we need at the requested rate, slow the
    // playback rate down so the available source stretches across cutDuration.
    // This prevents black gaps between cuts (the user's hard constraint).
    const rawSourceNeeded = cutDuration * playbackRate;
    const sourceStart = scene.startTime;
    const maxSourceEnd = Math.min(scene.endTime, videoAnalysis.duration);
    const availableSource = maxSourceEnd - sourceStart;
    let effectivePlaybackRate = playbackRate;
    let sourceEnd = sourceStart + rawSourceNeeded;
    if (availableSource < rawSourceNeeded) {
      effectivePlaybackRate = Math.max(0.25, availableSource / cutDuration);
      sourceEnd = sourceStart + cutDuration * effectivePlaybackRate;
    }
    sourceEnd = Math.min(sourceEnd, maxSourceEnd);

    const clipConfig: ClipConfig = {
      src: videoAnalysis.sourceVideo,
      startFrom: Math.round(sourceStart * 1000) / 1000,
      endAt: Math.round(sourceEnd * 1000) / 1000,
      showAt: Math.round((cutStart - args.from) * 1000) / 1000,
      playbackRate: Math.round(effectivePlaybackRate * 100) / 100,
      scale: Math.round(scale * 100) / 100,
      scaleAnchor: {
        x: Math.round(scaleAnchor.x * 100) / 100,
        y: Math.round(scaleAnchor.y * 100) / 100,
      },
    };
    if (clipTransition) clipConfig.transition = clipTransition;

    clips.push(clipConfig);

  }

  console.log(`  ${clips.length} clips generated`);

  // ── Step 3: Generate beat effects ────────────────────────────────

  const beatEffects: BeatTimestamp[] = [];

  for (const beat of beats) {
    if (beat < args.from || beat > args.to) continue;
    const relativeTime = beat - args.from;
    const isStrong = strongBeats.has(beat);
    const localEnergy = getEnergyAt(audioAnalysis.energyEnvelope, beat);

    if (isChillMode) {
      // Chill mode: extremely minimal effects — only the softest pulse on every 2nd strong beat
      if (isStrong) {
        const strongIdx = [...strongBeats].indexOf(beat);
        if (strongIdx % 2 === 0) {
          beatEffects.push({
            timeInSeconds: Math.round(relativeTime * 1000) / 1000,
            effect: "pulse",
            intensity: 0.4 + localEnergy * 0.2,
          });
        }
      }
      // No shake, no flash, no regular-beat effects — let the edit breathe
    } else if (isSmoothMode) {
      // Smooth mode: gentle pulse on every strong beat, no shake/flash
      if (isStrong) {
        beatEffects.push({
          timeInSeconds: Math.round(relativeTime * 1000) / 1000,
          effect: "pulse",
          intensity: 0.6 + localEnergy * 0.3,
        });
      }
    } else if (isVibeMode) {
      // Vibe mode: layered creative effects with more variety
      if (isStrong) {
        // Every other strong beat: shake+flash combo vs just a big pulse
        const strongIdx = [...strongBeats].indexOf(beat);
        if (strongIdx % 2 === 0) {
          beatEffects.push({
            timeInSeconds: Math.round(relativeTime * 1000) / 1000,
            effect: "shake",
            intensity: 0.9 + localEnergy * 0.4,
          });
          beatEffects.push({
            timeInSeconds: Math.round(relativeTime * 1000) / 1000,
            effect: "flash",
            intensity: 0.5 + localEnergy * 0.3,
          });
        } else {
          beatEffects.push({
            timeInSeconds: Math.round(relativeTime * 1000) / 1000,
            effect: "pulse",
            intensity: 1.3 + localEnergy * 0.3,
          });
        }
      } else if (localEnergy > 0.55) {
        // Alternate between pulse and subtle flash for groove
        const effectType = Math.random() > 0.5 ? "pulse" : "flash";
        beatEffects.push({
          timeInSeconds: Math.round(relativeTime * 1000) / 1000,
          effect: effectType as "pulse" | "flash",
          intensity: 0.6 + localEnergy * 0.3,
        });
      }
      // Below 0.55 energy: clean — let the video breathe
    } else if (isEditMode) {
      if (isStrong) {
        beatEffects.push({
          timeInSeconds: Math.round(relativeTime * 1000) / 1000,
          effect: "shake",
          intensity: 1.2 + localEnergy * 0.5,
        });
        beatEffects.push({
          timeInSeconds: Math.round(relativeTime * 1000) / 1000,
          effect: "flash",
          intensity: 0.6 + localEnergy * 0.4,
        });
      } else if (localEnergy > 0.5) {
        beatEffects.push({
          timeInSeconds: Math.round(relativeTime * 1000) / 1000,
          effect: "pulse",
          intensity: 0.8 + localEnergy * 0.4,
        });
      }
    } else {
      // Lyric mode: only strong beats get effects, and gentler
      if (isStrong) {
        beatEffects.push({
          timeInSeconds: Math.round(relativeTime * 1000) / 1000,
          effect: "pulse",
          intensity: 0.8,
        });
      }
    }
  }

  console.log(`  ${beatEffects.length} beat effects generated`);

  // ── Step 4: Build config ─────────────────────────────────────────

  const effects: EffectsConfig = {
    beatSync: beatEffects.length > 0,
    beats: beatEffects.length > 0 ? beatEffects : undefined,
    transitions: isChillMode || isSmoothMode ? "zoom" : isEditMode ? "glitch" : "cut",
    colorGrade: args.style,
    vignette: true,
  };

  const config: VideoConfig = {
    id: generateId(args),
    title: generateTitle(args),
    mode: args.mode,
    audioSrc: derivePublicPath(args.audioFile),
    audioStartFrom: args.from > 0 ? args.from : undefined,
    clips,
    effects,
    output: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationInSeconds: Math.round(duration * 100) / 100,
    },
  };

  // Add caption config when captions are available (lyric mode or edit mode with lyrics)
  if (args.captionsPath || args.mode === "lyric") {
    if (args.captionsPath) {
      config.captionsPath = args.captionsPath;
    }
    const presetName = (args.captionPreset ?? "bounce") as NonNullable<VideoConfig["captionStyle"]>["preset"];
    const isVfx = presetName === "vfx";
    config.captionStyle = {
      preset: presetName,
      fontSize: isVfx ? 90 : 72,
      fontFamily: "Inter",
      activeColor: "#FFFFFF",
      inactiveColor: isVfx ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.5)",
      glowColor: isVfx ? "#FF0055" : undefined,
      position: "center",
      combineTokensWithinMs: isVfx ? 800 : 1200,
    };
  }

  return config;
}

// ── Helper functions ───────────────────────────────────────────────────

/** Derive the Remotion staticFile path relative to public/ */
function derivePublicPath(filePath: string): string {
  const abs = path.resolve(filePath);
  const publicDir = path.join(process.cwd(), "public");
  if (abs.startsWith(publicDir)) {
    return abs.slice(publicDir.length + 1); // strip "public/" prefix
  }
  // Fallback: just use the basename under clips/
  return `clips/${path.basename(filePath)}`;
}

function getEnergyAt(
  envelope: AudioAnalysis["energyEnvelope"],
  time: number,
): number {
  if (envelope.length === 0) return 0.5;

  // Find the closest energy entry
  let closest = envelope[0];
  let minDist = Math.abs(closest.time - time);

  for (const entry of envelope) {
    const dist = Math.abs(entry.time - time);
    if (dist < minDist) {
      minDist = dist;
      closest = entry;
    }
  }

  return closest.energy;
}

function snapToBeat(target: number, beats: number[]): number {
  if (beats.length === 0) return target;

  let closest = beats[0];
  let minDist = Math.abs(closest - target);

  for (const beat of beats) {
    const dist = Math.abs(beat - target);
    if (dist < minDist) {
      minDist = dist;
      closest = beat;
    }
  }

  return closest;
}

function pickScene(
  scenes: VideoAnalysis["scenes"],
  highEnergyMoments: VideoAnalysis["highEnergyMoments"],
  audioEnergy: number,
  usedSceneIndices: Set<number>,
  neededDuration: number,
): VideoAnalysis["scenes"][0] {
  if (scenes.length === 0) {
    return { startTime: 0, endTime: 2, duration: 2, visualEnergy: 0.5 };
  }

  // Prefer scenes that are AT LEAST as long as the output cut needs, so the
  // picked clip fills the sequence without black gaps. Falls back to shorter
  // scenes only if nothing long enough is available.
  const longEnough = scenes.filter((s) => s.duration >= neededDuration);
  const candidatePool = longEnough.length > 0 ? longEnough : scenes;

  const scored = candidatePool.map((scene) => {
    const idx = scenes.indexOf(scene);
    let score = 0;

    // Prefer scenes matching audio energy level
    const energyDiff = Math.abs(scene.visualEnergy - audioEnergy);
    score += (1 - energyDiff) * 3;

    // Strong penalty for recently used scenes (force variety across runs)
    if (usedSceneIndices.has(idx)) score -= 6;

    // Stronger random factor → different picks between runs even for similar inputs
    score += Math.random() * 1.5;

    return { scene, idx, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored[0];

  // Track usage (reset after all scenes used)
  usedSceneIndices.add(picked.idx);
  if (usedSceneIndices.size >= scenes.length) {
    usedSceneIndices.clear();
  }

  return picked.scene;
}

function getPlaybackRate(
  energy: number,
  isEditMode: boolean,
  isOnStrongBeat: boolean,
  currentTime: number,
  beats: number[],
  strongBeats: Set<number>,
  isVibeMode?: boolean,
  isChillMode?: boolean,
  isSmoothMode?: boolean,
): number {
  if (isChillMode) {
    // Chill mode: almost no speed ramping — subtle slowdown on calm parts for cinematic feel
    if (energy < 0.35) return 0.92;
    if (energy > 0.75) return 1.02;
    return 1.0;
  }
  if (isSmoothMode) {
    // Smooth mode: gentle, consistent — slight lift on high energy, mild drop on low
    if (energy < 0.35) return 0.9;
    if (energy > 0.7) return 1.05;
    return 1.0;
  }
  if (!isEditMode && !isVibeMode) return 1.0; // No speed ramping in lyric mode

  // Check if we're approaching a strong beat (build-up moment)
  const nextStrongBeat = [...strongBeats].find((b) => b > currentTime && b - currentTime < 1.5);
  const isPreDrop = nextStrongBeat !== undefined && nextStrongBeat - currentTime < 0.8;

  if (isVibeMode) {
    // Vibe mode: more dramatic speed changes for creative feel
    if (isPreDrop) return 0.5; // Deeper slowmo before drops
    if (isOnStrongBeat) return 1.0; // Snap back on impact
    if (energy > 0.75) return 1.15; // Push the energy
    if (energy < 0.35) return 0.6; // Dreamy slowmo on calm parts
    return 0.9 + Math.random() * 0.2; // Slight organic variation
  }

  if (isPreDrop) return 0.6;
  if (isOnStrongBeat) return 1.0;
  if (energy > 0.8) return 1.1;
  if (energy < 0.3) return 0.7;
  return 1.0;
}

function sanitizeId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, "-") // replace non-alphanumeric with hyphens
    .replace(/-+/g, "-")            // collapse multiple hyphens
    .replace(/^-|-$/g, "")          // trim leading/trailing hyphens
    .toLowerCase();
}

function generateId(args: GenerateArgs): string {
  const base = path.basename(args.audioFile, path.extname(args.audioFile));
  const from = Math.round(args.from);
  const to = Math.round(args.to);
  const suffix = args.chill
    ? "chill"
    : args.smooth
      ? "smooth"
      : args.vibe
        ? "vibe"
        : args.mode;
  return sanitizeId(`${base}-${suffix}-${from}s-${to}s`);
}

function generateTitle(args: GenerateArgs): string {
  const base = path.basename(args.audioFile, path.extname(args.audioFile));
  const label = args.chill
    ? "Chill Edit"
    : args.smooth
      ? "Smooth Edit"
      : args.vibe
        ? "Vibe Edit"
        : args.mode === "edit"
          ? "Hype Edit"
          : "Lyric Video";
  return `${base} ${label} (${Math.round(args.from)}s-${Math.round(args.to)}s)`;
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs();

  // Load video analysis
  const videoAnalysisPath = path.resolve(args.videoAnalysisPath);
  if (!fs.existsSync(videoAnalysisPath)) {
    console.error(`Video analysis not found: ${videoAnalysisPath}`);
    process.exit(1);
  }
  const videoAnalysis: VideoAnalysis = JSON.parse(
    fs.readFileSync(videoAnalysisPath, "utf-8"),
  );

  // Load or generate audio analysis
  const audioBaseName = path.basename(args.audioFile, path.extname(args.audioFile));
  const audioAnalysisPath = path.join(
    process.cwd(),
    "public/analysis",
    `${audioBaseName}_${args.from}s-${Math.round(args.to)}s.beats.json`,
  );

  let audioAnalysis: AudioAnalysis;
  if (fs.existsSync(audioAnalysisPath)) {
    console.log(`Using cached audio analysis: ${audioAnalysisPath}`);
    audioAnalysis = JSON.parse(fs.readFileSync(audioAnalysisPath, "utf-8"));
  } else {
    // Check for full analysis
    const fullPath = path.join(
      process.cwd(),
      "public/analysis",
      `${audioBaseName}_full.beats.json`,
    );
    if (fs.existsSync(fullPath)) {
      console.log(`Using full audio analysis: ${fullPath}`);
      audioAnalysis = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      // Filter beats to our range
      audioAnalysis = {
        ...audioAnalysis,
        fromSeconds: args.from,
        toSeconds: args.to,
        duration: args.to - args.from,
        beats: audioAnalysis.beats.filter((b) => b >= args.from && b <= args.to),
        strongBeats: audioAnalysis.strongBeats.filter(
          (b) => b >= args.from && b <= args.to,
        ),
        energyEnvelope: audioAnalysis.energyEnvelope.filter(
          (e) => e.time >= args.from && e.time <= args.to,
        ),
      };
    } else {
      console.error(
        `Audio analysis not found. Run:\n  npm run analyze-audio -- ${args.audioFile} --from ${args.from} --to ${args.to}`,
      );
      process.exit(1);
    }
  }

  console.log("Generating edit config...");
  const config = generateEdit(videoAnalysis, audioAnalysis, args);

  // Save config
  const outputDir = path.join(process.cwd(), "configs", "auto-generated");
  ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${config.id}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

  console.log(`\nConfig saved to: ${outputPath}`);
  console.log(`Preview: npm run dev → navigate to "${config.title}"`);
  console.log(`Render:  npm run render -- ${outputPath}`);
}

main();
