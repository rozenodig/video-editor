/**
 * Pure Node.js beat detection from 16-bit PCM WAV data.
 *
 * Approach:
 * 1. Compute RMS energy in short windows (10ms)
 * 2. Compute spectral flux (energy derivative) to detect onsets
 * 3. Find peaks in the onset function above a dynamic threshold
 * 4. Estimate BPM from inter-beat intervals
 */

import fs from "fs";

/** Read a 16-bit mono PCM WAV file and return float samples + sample rate. */
export function readWav(filePath: string): {
  samples: Float32Array;
  sampleRate: number;
} {
  const buf = fs.readFileSync(filePath);

  // Parse WAV header
  const riff = buf.toString("ascii", 0, 4);
  if (riff !== "RIFF") throw new Error("Not a valid WAV file");

  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  if (bitsPerSample !== 16) {
    throw new Error(`Expected 16-bit PCM, got ${bitsPerSample}-bit`);
  }

  // Find data chunk
  let offset = 12;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      offset += 8;
      break;
    }
    offset += 8 + chunkSize;
  }

  const numSamples = Math.floor((buf.length - offset) / 2);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const idx = offset + i * 2;
    if (idx + 1 >= buf.length) break;
    samples[i] = buf.readInt16LE(idx) / 32768;
  }

  return { samples, sampleRate };
}

/** Compute RMS energy for a range of samples. */
function rms(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  const end = Math.min(start + length, samples.length);
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (end - start));
}

export interface BeatDetectionResult {
  beats: number[];
  strongBeats: number[];
  energyEnvelope: Array<{ time: number; energy: number }>;
  estimatedBPM: number;
}

/**
 * Detect beats from PCM audio data.
 * @param samples Float32Array of mono audio samples
 * @param sampleRate Sample rate in Hz
 * @param offsetSeconds Time offset to add to all timestamps (for --from support)
 */
export function detectBeats(
  samples: Float32Array,
  sampleRate: number,
  offsetSeconds = 0,
): BeatDetectionResult {
  // ── Step 1: Compute energy in short windows ──────────────────────

  const windowMs = 10;
  const hopMs = 5;
  const windowSamples = Math.round((windowMs / 1000) * sampleRate);
  const hopSamples = Math.round((hopMs / 1000) * sampleRate);
  const numWindows = Math.floor(
    (samples.length - windowSamples) / hopSamples,
  );

  const energy = new Float32Array(numWindows);
  for (let i = 0; i < numWindows; i++) {
    energy[i] = rms(samples, i * hopSamples, windowSamples);
  }

  // ── Step 2: Compute onset detection function (spectral flux) ─────
  // Use first derivative of energy (energy change rate)

  const onset = new Float32Array(numWindows);
  for (let i = 1; i < numWindows; i++) {
    const diff = energy[i] - energy[i - 1];
    onset[i] = diff > 0 ? diff : 0; // Half-wave rectification
  }

  // ── Step 3: Adaptive threshold + peak picking ────────────────────
  // Use a moving median + offset as threshold

  const thresholdWindowSize = 80; // ~400ms at 5ms hop
  const thresholdMultiplier = 1.5;
  const minBeatIntervalMs = 200; // Max 300 BPM

  const beats: Array<{ time: number; strength: number }> = [];

  for (let i = thresholdWindowSize; i < numWindows - 1; i++) {
    // Moving average as threshold
    let sum = 0;
    for (
      let j = i - thresholdWindowSize;
      j < i + thresholdWindowSize && j < numWindows;
      j++
    ) {
      sum += onset[j >= 0 ? j : 0];
    }
    const avgOnset = sum / (thresholdWindowSize * 2);
    const threshold = avgOnset * thresholdMultiplier + 0.002;

    // Peak detection: onset must be above threshold and a local max
    if (
      onset[i] > threshold &&
      onset[i] >= onset[i - 1] &&
      onset[i] >= onset[i + 1]
    ) {
      const timeMs = (i * hopSamples) / sampleRate;
      const timeSec = timeMs + offsetSeconds;

      // Enforce minimum interval
      if (
        beats.length === 0 ||
        (timeSec - beats[beats.length - 1].time) * 1000 >= minBeatIntervalMs
      ) {
        beats.push({ time: timeSec, strength: onset[i] });
      }
    }
  }

  // ── Step 4: Classify strong vs regular beats ─────────────────────

  const avgStrength =
    beats.reduce((s, b) => s + b.strength, 0) / Math.max(beats.length, 1);
  const strongThreshold = avgStrength * 1.5;

  const allBeats = beats.map((b) => Math.round(b.time * 1000) / 1000);
  const strongBeats = beats
    .filter((b) => b.strength > strongThreshold)
    .map((b) => Math.round(b.time * 1000) / 1000);

  // ── Step 5: Energy envelope (0.5s windows) ───────────────────────

  const envWindowSec = 0.5;
  const envWindowSamples = Math.round(envWindowSec * sampleRate);
  const envHopSamples = Math.round(envWindowSec * sampleRate);
  const envEntries: Array<{ time: number; rawEnergy: number }> = [];

  for (let pos = 0; pos + envWindowSamples <= samples.length; pos += envHopSamples) {
    const e = rms(samples, pos, envWindowSamples);
    envEntries.push({
      time: Math.round((pos / sampleRate + offsetSeconds) * 1000) / 1000,
      rawEnergy: e,
    });
  }

  const maxEnvEnergy = Math.max(...envEntries.map((e) => e.rawEnergy), 0.001);
  const energyEnvelope = envEntries.map((e) => ({
    time: e.time,
    energy: Math.round((e.rawEnergy / maxEnvEnergy) * 100) / 100,
  }));

  // ── Step 6: BPM estimation ───────────────────────────────────────

  const estimatedBPM = estimateBPM(allBeats);

  return { beats: allBeats, strongBeats, energyEnvelope, estimatedBPM };
}

/** Estimate BPM from beat timestamps using inter-onset interval histogram. */
function estimateBPM(beats: number[]): number {
  if (beats.length < 3) return 120; // Default fallback

  // Compute all inter-beat intervals
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const interval = beats[i] - beats[i - 1];
    if (interval > 0.2 && interval < 2.0) {
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) return 120;

  // Histogram with 10ms bins
  const binSize = 0.01;
  const bins = new Map<number, number>();
  for (const interval of intervals) {
    const bin = Math.round(interval / binSize) * binSize;
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }

  // Find the most common interval
  let bestBin = 0.5;
  let bestCount = 0;
  for (const [bin, count] of bins) {
    if (count > bestCount) {
      bestCount = count;
      bestBin = bin;
    }
  }

  const bpm = 60 / bestBin;

  // Clamp to reasonable range (60-200 BPM)
  if (bpm < 60) return Math.round(bpm * 2);
  if (bpm > 200) return Math.round(bpm / 2);
  return Math.round(bpm);
}
