/**
 * Analyzes a source video for scene boundaries and visual energy.
 *
 * Uses ffprobe frame-level data (packet sizes + keyframes) since
 * Remotion's bundled ffmpeg lacks select/showinfo/mestimate filters.
 *
 * Usage: npx tsx scripts/analyze-video.ts <video-file>
 * Output: public/analysis/<video-name>.analysis.json
 */

import path from "path";
import fs from "fs";
import { probeVideo, runFfprobe, ensureDir } from "./utils/ffmpeg-helpers.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface VideoAnalysis {
  sourceVideo: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  scenes: Array<{
    startTime: number;
    endTime: number;
    duration: number;
    visualEnergy: number; // 0-1
  }>;
  sceneChanges: number[];
  highEnergyMoments: Array<{
    timestamp: number;
    energy: number;
  }>;
}

interface FrameInfo {
  time: number;
  size: number;
  type: "I" | "P" | "B";
}

// ── Frame extraction ───────────────────────────────────────────────────

function extractFrameData(videoPath: string): FrameInfo[] {
  console.log("  Extracting frame data via ffprobe...");

  const raw = runFfprobe(
    `-v quiet -select_streams v -show_entries "frame=pts_time,pict_type,pkt_size" -of csv=p=0 "${videoPath}"`,
  );

  const frames: FrameInfo[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",");
    if (parts.length < 3) continue;

    const time = parseFloat(parts[0]);
    const size = parseInt(parts[1], 10);
    const type = parts[2] as "I" | "P" | "B";

    if (!isNaN(time) && !isNaN(size)) {
      frames.push({ time, size, type });
    }
  }

  frames.sort((a, b) => a.time - b.time);
  console.log(`  ${frames.length} frames extracted`);
  return frames;
}

// ── Scene detection ────────────────────────────────────────────────────
// Detect scenes using frame size analysis:
// - Large jumps in I-frame sizes indicate scene changes
// - Significant changes in average frame size in a sliding window

function detectSceneChanges(
  frames: FrameInfo[],
  duration: number,
): number[] {
  if (frames.length === 0) return [0];

  const sceneChanges: number[] = [0]; // Always start with 0

  // Method 1: I-frame size jumps
  const iFrames = frames.filter((f) => f.type === "I");
  if (iFrames.length > 1) {
    const avgISize =
      iFrames.reduce((sum, f) => sum + f.size, 0) / iFrames.length;

    for (let i = 1; i < iFrames.length; i++) {
      const sizeRatio = iFrames[i].size / avgISize;
      // Large I-frames relative to average suggest scene changes
      if (sizeRatio > 1.5 && iFrames[i].time > 0.5) {
        sceneChanges.push(iFrames[i].time);
      }
    }
  }

  // Method 2: Sliding window frame size variance
  const windowSize = 0.5; // seconds
  const stepSize = 0.25;
  const windowAvgs: Array<{ time: number; avgSize: number }> = [];

  for (let t = 0; t < duration - windowSize; t += stepSize) {
    const windowFrames = frames.filter(
      (f) => f.time >= t && f.time < t + windowSize,
    );
    if (windowFrames.length === 0) continue;
    const avg =
      windowFrames.reduce((sum, f) => sum + f.size, 0) / windowFrames.length;
    windowAvgs.push({ time: t + windowSize / 2, avgSize: avg });
  }

  // Detect significant changes in window averages
  for (let i = 1; i < windowAvgs.length; i++) {
    const prev = windowAvgs[i - 1].avgSize;
    const curr = windowAvgs[i].avgSize;
    const change = Math.abs(curr - prev) / Math.max(prev, 1);

    if (change > 0.35 && windowAvgs[i].time > 0.3) {
      // Don't add if too close to an existing scene change
      const tooClose = sceneChanges.some(
        (sc) => Math.abs(sc - windowAvgs[i].time) < 1.0,
      );
      if (!tooClose) {
        sceneChanges.push(windowAvgs[i].time);
      }
    }
  }

  // Ensure we have enough scenes for editing (at least every 3 seconds)
  const minSceneInterval = 3.0;
  for (let t = minSceneInterval; t < duration - 1; t += minSceneInterval) {
    const tooClose = sceneChanges.some((sc) => Math.abs(sc - t) < 1.5);
    if (!tooClose) {
      sceneChanges.push(t);
    }
  }

  sceneChanges.sort((a, b) => a - b);
  return sceneChanges;
}

// ── Visual energy scoring ──────────────────────────────────────────────
// Higher frame sizes = more visual complexity/motion = higher energy

function computeVisualEnergy(
  frames: FrameInfo[],
  startTime: number,
  endTime: number,
): { avgChange: number; avgSize: number } {
  const segmentFrames = frames.filter(
    (f) => f.time >= startTime && f.time < endTime,
  );
  if (segmentFrames.length < 2) return { avgChange: 0, avgSize: 0 };

  // Compute frame-to-frame size changes (proxy for motion)
  let totalChange = 0;
  for (let i = 1; i < segmentFrames.length; i++) {
    totalChange += Math.abs(segmentFrames[i].size - segmentFrames[i - 1].size);
  }
  const avgChange = totalChange / (segmentFrames.length - 1);

  // Also factor in average frame size (bigger = more detail/motion)
  const avgSize =
    segmentFrames.reduce((sum, f) => sum + f.size, 0) / segmentFrames.length;

  return { avgChange, avgSize };
}

function buildScenes(
  frames: FrameInfo[],
  sceneChanges: number[],
  duration: number,
): VideoAnalysis["scenes"] {
  // Collect raw energy values first for normalization
  const rawScenes: Array<{
    startTime: number;
    endTime: number;
    duration: number;
    avgChange: number;
    avgSize: number;
  }> = [];

  for (let i = 0; i < sceneChanges.length; i++) {
    const start = sceneChanges[i];
    const end = i < sceneChanges.length - 1 ? sceneChanges[i + 1] : duration;
    const { avgChange, avgSize } = computeVisualEnergy(frames, start, end);
    rawScenes.push({
      startTime: Math.round(start * 1000) / 1000,
      endTime: Math.round(end * 1000) / 1000,
      duration: Math.round((end - start) * 1000) / 1000,
      avgChange,
      avgSize,
    });
  }

  // Normalize energy to 0-1
  const maxChange = Math.max(...rawScenes.map((s) => s.avgChange), 1);
  const maxSize = Math.max(...rawScenes.map((s) => s.avgSize), 1);

  return rawScenes.map((s) => ({
    startTime: s.startTime,
    endTime: s.endTime,
    duration: s.duration,
    visualEnergy:
      Math.round(
        ((s.avgChange / maxChange) * 0.6 + (s.avgSize / maxSize) * 0.4) * 100,
      ) / 100,
  }));
}

// ── High energy moments ────────────────────────────────────────────────

function findHighEnergyMoments(
  frames: FrameInfo[],
  duration: number,
): VideoAnalysis["highEnergyMoments"] {
  const windowSize = 1.0; // 1-second windows
  const stepSize = 0.5;
  const moments: Array<{ timestamp: number; rawEnergy: number }> = [];

  for (let t = 0; t < duration - windowSize; t += stepSize) {
    const windowFrames = frames.filter(
      (f) => f.time >= t && f.time < t + windowSize,
    );
    if (windowFrames.length < 2) continue;

    let totalChange = 0;
    for (let i = 1; i < windowFrames.length; i++) {
      totalChange += Math.abs(
        windowFrames[i].size - windowFrames[i - 1].size,
      );
    }

    moments.push({
      timestamp: Math.round((t + windowSize / 2) * 1000) / 1000,
      rawEnergy: totalChange / (windowFrames.length - 1),
    });
  }

  // Normalize
  const maxEnergy = Math.max(...moments.map((m) => m.rawEnergy), 1);

  // Return only moments above 0.6 threshold
  return moments
    .map((m) => ({
      timestamp: m.timestamp,
      energy: Math.round((m.rawEnergy / maxEnergy) * 100) / 100,
    }))
    .filter((m) => m.energy >= 0.6)
    .sort((a, b) => b.energy - a.energy);
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error("Usage: npx tsx scripts/analyze-video.ts <video-file>");
    process.exit(1);
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`Analyzing video: ${inputPath}`);

  // Step 1: Probe metadata
  console.log("Step 1: Probing video metadata...");
  const meta = probeVideo(inputPath);
  console.log(
    `  ${meta.width}x${meta.height} @ ${meta.fps}fps, ${meta.duration.toFixed(2)}s`,
  );

  // Step 2: Extract frame data
  console.log("Step 2: Extracting frame-level data...");
  const frames = extractFrameData(inputPath);

  // Step 3: Detect scene changes
  console.log("Step 3: Detecting scene boundaries...");
  const sceneChanges = detectSceneChanges(frames, meta.duration);
  console.log(`  ${sceneChanges.length} scene boundaries found`);

  // Step 4: Build scenes with energy scores
  console.log("Step 4: Computing visual energy per scene...");
  const scenes = buildScenes(frames, sceneChanges, meta.duration);

  // Step 5: Find high energy moments
  console.log("Step 5: Finding high-energy moments...");
  const highEnergyMoments = findHighEnergyMoments(frames, meta.duration);
  console.log(`  ${highEnergyMoments.length} high-energy moments found`);

  // Build output
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const analysisDir = path.join(process.cwd(), "public", "analysis");
  ensureDir(analysisDir);
  const outputPath = path.join(analysisDir, `${baseName}.analysis.json`);

  const analysis: VideoAnalysis = {
    sourceVideo: path.relative(
      path.join(process.cwd(), "public"),
      inputPath,
    ),
    duration: meta.duration,
    fps: meta.fps,
    width: meta.width,
    height: meta.height,
    scenes,
    sceneChanges,
    highEnergyMoments,
  };

  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
  console.log(`\nAnalysis saved to: ${outputPath}`);
  console.log(
    `  ${scenes.length} scenes, ${highEnergyMoments.length} high-energy moments`,
  );
}

main();
