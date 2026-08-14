/**
 * Converts any video file to browser-compatible H.264/AAC MP4.
 *
 * Usage: npx tsx scripts/convert-clip.ts <video-file> [--output <filename>]
 *
 * Output goes to public/clips/<filename>.mp4
 * Uses Remotion's bundled ffmpeg if system ffmpeg is not available.
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";

function findFfmpeg(): string {
  // Try system ffmpeg first
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    // Fall through
  }

  // Try Remotion's bundled ffmpeg
  const remotionFfmpeg = path.join(
    process.cwd(),
    "node_modules",
    "@remotion",
    "compositor-darwin-arm64",
    "ffmpeg",
  );
  if (fs.existsSync(remotionFfmpeg)) {
    return remotionFfmpeg;
  }

  // Try x64 variant
  const remotionFfmpegX64 = path.join(
    process.cwd(),
    "node_modules",
    "@remotion",
    "compositor-darwin-x64",
    "ffmpeg",
  );
  if (fs.existsSync(remotionFfmpegX64)) {
    return remotionFfmpegX64;
  }

  console.error(
    "ffmpeg not found. Install it via: brew install ffmpeg",
  );
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];

  if (!inputFile) {
    console.error(
      "Usage: npx tsx scripts/convert-clip.ts <video-file> [--output <filename>]",
    );
    process.exit(1);
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const outputIdx = args.indexOf("--output");
  const baseName = outputIdx !== -1
    ? args[outputIdx + 1].replace(/\.mp4$/i, "")
    : path.basename(inputPath, path.extname(inputPath));

  const clipsDir = path.join(process.cwd(), "public", "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  const outputPath = path.join(clipsDir, `${baseName}.mp4`);

  const ffmpeg = findFfmpeg();

  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Using:  ${ffmpeg}`);
  console.log("Converting to H.264/AAC MP4 (browser-compatible)...");

  execSync(
    [
      `"${ffmpeg}"`,
      `-y -i "${inputPath}"`,
      `-c:v libx264 -preset fast -crf 18`,
      `-c:a aac -b:a 192k`,
      `-movflags +faststart`,
      `-pix_fmt yuv420p`,
      `"${outputPath}"`,
    ].join(" "),
    { stdio: "inherit" },
  );

  const stat = fs.statSync(outputPath);
  console.log(
    `\nDone! ${(stat.size / 1024 / 1024).toFixed(1)}MB saved to: ${outputPath}`,
  );
}

main();
