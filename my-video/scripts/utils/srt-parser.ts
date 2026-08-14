/**
 * Parse .srt subtitle files to Remotion Caption format.
 *
 * SRT format:
 *   1
 *   00:00:01,000 --> 00:00:03,500
 *   Hello world
 *
 * Converts to @remotion/captions Caption[] format.
 * Supports extracting a time range and adjusting timestamps relative to an offset.
 */

import fs from "fs";
import type { Caption } from "@remotion/captions";

interface SrtEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** Parse SRT timecode "HH:MM:SS,mmm" to milliseconds. */
function parseTimecode(tc: string): number {
  const [time, ms] = tc.trim().split(",");
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + parseInt(ms, 10);
}

/** Parse an .srt file into structured entries. */
export function parseSrtFile(filePath: string): SrtEntry[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseSrtString(content);
}

/** Parse SRT content string into structured entries. */
export function parseSrtString(content: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = content
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    const timeLine = lines[1];
    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!match) continue;

    const startMs = parseTimecode(match[1]);
    const endMs = parseTimecode(match[2]);
    const text = lines.slice(2).join(" ").trim();

    entries.push({ index, startMs, endMs, text });
  }

  return entries;
}

/**
 * Convert SRT entries to Remotion Caption format.
 * Each word becomes a separate Caption with estimated timing.
 *
 * @param entries SRT entries
 * @param fromMs Extract only entries within this range (inclusive)
 * @param toMs Extract only entries within this range (inclusive)
 * @param offsetMs Subtract this from all timestamps (to make relative to edit start)
 */
export function srtToCaptions(
  entries: SrtEntry[],
  fromMs = 0,
  toMs = Infinity,
  offsetMs = 0,
): Caption[] {
  const captions: Caption[] = [];

  for (const entry of entries) {
    // Skip entries outside the range
    if (entry.endMs < fromMs || entry.startMs > toMs) continue;

    // Clamp to range
    const clampedStart = Math.max(entry.startMs, fromMs);
    const clampedEnd = Math.min(entry.endMs, toMs);

    // Split text into words and distribute timing evenly
    const words = entry.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const entryDuration = clampedEnd - clampedStart;
    const wordDuration = entryDuration / words.length;

    for (let i = 0; i < words.length; i++) {
      const wordStart = clampedStart + i * wordDuration - offsetMs;
      const wordEnd = clampedStart + (i + 1) * wordDuration - offsetMs;

      // Add space before word (except first)
      const text = i === 0 ? words[i] : ` ${words[i]}`;

      captions.push({
        text,
        startMs: Math.round(wordStart),
        endMs: Math.round(wordEnd),
        timestampMs: Math.round(wordStart),
        confidence: 1.0,
      });
    }
  }

  return captions;
}

/**
 * Read a plain text lyric file (one line per lyric line, no timestamps).
 * Returns just the text content split into lines.
 */
export function readPlainLyrics(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
