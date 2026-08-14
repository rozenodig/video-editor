/**
 * Analyzes audio for beats, energy envelope, and BPM.
 *
 * Usage:
 *   npx tsx scripts/analyze-audio.ts <audio-or-video-file> [--from <seconds>] [--to <seconds>]
 *
 * If --from/--to are omitted, analyzes the full track.
 * Output: public/analysis/<name>_<from>s-<to>s.beats.json
 */

import path from "path";
import fs from "fs";
import { extractPcmWav, probeVideo, ensureDir } from "./utils/ffmpeg-helpers.js";
import { readWav, detectBeats } from "./utils/beat-detection.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface AudioAnalysis {
  sourceAudio: string;
  fromSeconds: number;
  toSeconds: number;
  duration: number;
  estimatedBPM: number;
  beats: number[];
  strongBeats: number[];
  energyEnvelope: Array<{
    time: number;
    energy: number;
  }>;
}

// ── CLI argument parsing ───────────────────────────────────────────────

function parseArgs(): {
  inputFile: string;
  from: number | undefined;
  to: number | undefined;
} {
  const args = process.argv.slice(2);
  const inputFile = args.find((a) => !a.startsWith("--"));

  if (!inputFile) {
    console.error(
      "Usage: npx tsx scripts/analyze-audio.ts <audio-or-video-file> [--from <s>] [--to <s>]",
    );
    process.exit(1);
  }

  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const from = fromIdx !== -1 ? parseFloat(args[fromIdx + 1]) : undefined;
  const to = toIdx !== -1 ? parseFloat(args[toIdx + 1]) : undefined;

  return { inputFile, from, to };
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  const { inputFile, from, to } = parseArgs();

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  // Get duration for range defaults
  const meta = probeVideo(inputPath);
  const fromSec = from ?? 0;
  const toSec = to ?? meta.duration;
  const duration = toSec - fromSec;

  console.log(`Analyzing audio: ${inputPath}`);
  console.log(`  Range: ${fromSec.toFixed(1)}s - ${toSec.toFixed(1)}s (${duration.toFixed(1)}s)`);

  // Step 1: Extract audio section to temporary WAV
  console.log("Step 1: Extracting audio to PCM WAV...");
  const tmpWav = path.join("/tmp", `analyze-audio-${Date.now()}.wav`);
  extractPcmWav(inputPath, tmpWav, {
    from: fromSec > 0 ? fromSec : undefined,
    to: toSec < meta.duration ? toSec : undefined,
    sampleRate: 44100,
  });

  // Step 2: Read WAV and detect beats
  console.log("Step 2: Reading PCM data...");
  const { samples, sampleRate } = readWav(tmpWav);
  console.log(`  ${samples.length} samples at ${sampleRate}Hz`);

  console.log("Step 3: Detecting beats and computing energy...");
  const result = detectBeats(samples, sampleRate, fromSec);

  console.log(`  ${result.beats.length} beats detected`);
  console.log(`  ${result.strongBeats.length} strong beats`);
  console.log(`  Estimated BPM: ${result.estimatedBPM}`);

  // Step 3: Build output
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const analysisDir = path.join(process.cwd(), "public", "analysis");
  ensureDir(analysisDir);

  const suffix =
    from !== undefined || to !== undefined
      ? `_${fromSec}s-${toSec.toFixed(0)}s`
      : "_full";
  const outputPath = path.join(
    analysisDir,
    `${baseName}${suffix}.beats.json`,
  );

  const analysis: AudioAnalysis = {
    sourceAudio: path.relative(
      path.join(process.cwd(), "public"),
      inputPath,
    ),
    fromSeconds: fromSec,
    toSeconds: toSec,
    duration,
    estimatedBPM: result.estimatedBPM,
    beats: result.beats,
    strongBeats: result.strongBeats,
    energyEnvelope: result.energyEnvelope,
  };

  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));

  // Cleanup temp file
  try {
    fs.unlinkSync(tmpWav);
  } catch {
    // ignore
  }

  console.log(`\nAnalysis saved to: ${outputPath}`);
  console.log(
    `  BPM: ${result.estimatedBPM} | Beats: ${result.beats.length} | Strong: ${result.strongBeats.length}`,
  );
}

main();
