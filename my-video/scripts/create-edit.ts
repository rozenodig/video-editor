/**
 * Master CLI — ties the full pipeline together.
 *
 * Usage:
 *   # Hype edit (no lyrics) from 0-15s
 *   npm run create-edit -- \
 *     --video public/clips/my-source.mp4 \
 *     --audio public/clips/my-source.mp4 \
 *     --from 0 --to 15 \
 *     --mode edit --style highContrast
 *
 *   # Lyric edit with .srt file
 *   npm run create-edit -- \
 *     --video public/clips/my-source.mp4 \
 *     --audio public/clips/my-source.mp4 \
 *     --from 0 --to 15 \
 *     --mode lyric --lyrics public/lyrics/my-song.srt \
 *     --caption-preset neon
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { probeVideo, ensureDir } from "./utils/ffmpeg-helpers.js";
import { parseSrtFile, srtToCaptions } from "./utils/srt-parser.js";

// ── CLI parsing ────────────────────────────────────────────────────────

interface CreateEditArgs {
  video: string;
  audio: string;
  from: number;
  to: number;
  mode: "lyric" | "edit";
  style: string;
  lyrics?: string;
  captionPreset: string;
  vibe?: boolean;
  chill?: boolean;
  smooth?: boolean;
}

function parseArgs(): CreateEditArgs {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    // Collect all tokens until the next --flag (handles paths with spaces)
    const parts: string[] = [];
    for (let i = idx + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      parts.push(args[i]);
    }
    return parts.join(" ") || undefined;
  }

  const video = getArg("--video");
  const audio = getArg("--audio");

  if (!video || !audio) {
    console.error(
      `Usage: npm run create-edit -- \\
  --video <video-file> \\
  --audio <audio-file> \\
  --from <seconds> --to <seconds> \\
  [--mode edit|lyric] \\
  [--style <colorGrade>] \\
  [--lyrics <file.srt>] \\
  [--caption-preset <preset>]`,
    );
    process.exit(1);
  }

  const meta = probeVideo(audio);
  const from = parseFloat(getArg("--from") ?? "0");
  const to = parseFloat(getArg("--to") ?? String(meta.duration));

  return {
    video,
    audio,
    from,
    to,
    mode: (getArg("--mode") as "lyric" | "edit") ?? "edit",
    style: getArg("--style") ?? "highContrast",
    lyrics: getArg("--lyrics"),
    captionPreset: getArg("--caption-preset") ?? "bounce",
    vibe: process.argv.includes("--vibe"),
    chill: process.argv.includes("--chill"),
    smooth: process.argv.includes("--smooth"),
  };
}

function runScript(cmd: string): void {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
}

// ── Main pipeline ──────────────────────────────────────────────────────

function main() {
  const args = parseArgs();
  const videoPath = path.resolve(args.video);
  const audioPath = path.resolve(args.audio);

  console.log("=== CREATE EDIT PIPELINE ===");
  console.log(`  Video: ${videoPath}`);
  console.log(`  Audio: ${audioPath}`);
  console.log(`  Range: ${args.from}s - ${args.to}s`);
  console.log(`  Mode:  ${args.mode}`);
  console.log(`  Style: ${args.style}`);
  if (args.lyrics) console.log(`  Lyrics: ${args.lyrics}`);

  // ── Step 1: Video analysis ───────────────────────────────────────

  const videoBaseName = path.basename(videoPath, path.extname(videoPath));
  const videoAnalysisPath = path.join(
    process.cwd(),
    "public/analysis",
    `${videoBaseName}.analysis.json`,
  );

  if (fs.existsSync(videoAnalysisPath)) {
    console.log(`\n[1/4] Video analysis exists: ${videoAnalysisPath}`);
  } else {
    console.log("\n[1/4] Running video analysis...");
    runScript(`npx tsx scripts/analyze-video.ts "${videoPath}"`);
  }

  // ── Step 2: Audio analysis ───────────────────────────────────────

  const audioBaseName = path.basename(audioPath, path.extname(audioPath));
  const audioAnalysisPath = path.join(
    process.cwd(),
    "public/analysis",
    `${audioBaseName}_${args.from}s-${Math.round(args.to)}s.beats.json`,
  );
  const fullAudioPath = path.join(
    process.cwd(),
    "public/analysis",
    `${audioBaseName}_full.beats.json`,
  );

  if (fs.existsSync(audioAnalysisPath) || fs.existsSync(fullAudioPath)) {
    console.log(
      `[2/4] Audio analysis exists: ${fs.existsSync(audioAnalysisPath) ? audioAnalysisPath : fullAudioPath}`,
    );
  } else {
    console.log("[2/4] Running audio analysis...");
    const timeArgs =
      args.from > 0 || args.to < Infinity
        ? `--from ${args.from} --to ${args.to}`
        : "";
    runScript(
      `npx tsx scripts/analyze-audio.ts "${audioPath}" ${timeArgs}`,
    );
  }

  // ── Step 3: Handle captions (lyric mode) ─────────────────────────

  let captionsArg = "";

  if (args.lyrics) {
    const lyricsPath = path.resolve(args.lyrics);
    if (!fs.existsSync(lyricsPath)) {
      console.error(`Lyrics file not found: ${lyricsPath}`);
      process.exit(1);
    }

    const ext = path.extname(lyricsPath).toLowerCase();

    if (ext === ".srt") {
      console.log("[3/4] Parsing .srt lyrics...");
      const entries = parseSrtFile(lyricsPath);
      const fromMs = args.from * 1000;
      const toMs = args.to * 1000;
      const captions = srtToCaptions(entries, fromMs, toMs, fromMs);

      // Save captions JSON
      const captionsDir = path.join(process.cwd(), "public/captions");
      ensureDir(captionsDir);
      const safeName = audioBaseName.replace(/[^a-zA-Z0-9_-]/g, "-");
      const captionsFileName = `${safeName}_${Math.round(args.from)}s-${Math.round(args.to)}s.json`;
      const captionsOutPath = path.join(captionsDir, captionsFileName);
      fs.writeFileSync(captionsOutPath, JSON.stringify(captions, null, 2));
      console.log(`  Saved ${captions.length} caption tokens to: ${captionsOutPath}`);
      captionsArg = `--captions "captions/${captionsFileName}"`;
    } else {
      console.log("[3/4] Plain text lyrics — would need Whisper transcription for timestamps.");
      console.log("  Skipping captions (run npm run transcribe manually for word-level timestamps).");
    }
  } else {
    console.log("[3/4] No lyrics provided — skipping captions");
  }

  // ── Step 4: Generate edit config ─────────────────────────────────

  console.log("[4/4] Generating edit config...");
  const generateCmd = [
    `npx tsx scripts/generate-edit.ts`,
    `--video "${videoAnalysisPath}"`,
    `--audio "${audioPath}"`,
    `--from ${args.from}`,
    `--to ${args.to}`,
    `--mode ${args.mode}`,
    `--style ${args.style}`,
    `--caption-preset ${args.captionPreset}`,
    args.vibe ? "--vibe" : "",
    args.chill ? "--chill" : "",
    args.smooth ? "--smooth" : "",
    captionsArg,
  ]
    .filter(Boolean)
    .join(" ");

  runScript(generateCmd);

  // ── Done ─────────────────────────────────────────────────────────

  const configId = `${audioBaseName}-${args.mode}-${Math.round(args.from)}s-${Math.round(args.to)}s`;
  const configPath = `configs/auto-generated/${configId}.json`;

  console.log("\n=== DONE ===");
  console.log(`Config: ${configPath}`);
  console.log(`Preview: npm run dev → navigate to composition in Remotion Studio`);
  console.log(`Render:  npm run render -- ${configPath}`);
}

main();
