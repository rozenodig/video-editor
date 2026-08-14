/**
 * Extracts audio from a video file using ffmpeg.
 *
 * Usage: npx tsx scripts/extract-audio.ts <video-file> [--output <path>] [--format wav|mp3]
 *
 * Default output: public/audio/<filename>.wav
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";

function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];

  if (!inputFile) {
    console.error(
      "Usage: npx tsx scripts/extract-audio.ts <video-file> [--output <path>] [--format wav|mp3]",
    );
    process.exit(1);
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const formatIdx = args.indexOf("--format");
  const format = formatIdx !== -1 ? args[formatIdx + 1] : "wav";

  const outputIdx = args.indexOf("--output");
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const audioDir = path.join(process.cwd(), "public", "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const outputPath =
    outputIdx !== -1
      ? path.resolve(args[outputIdx + 1])
      : path.join(audioDir, `${baseName}.${format}`);

  console.log(`Extracting audio from: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Format: ${format}`);

  const codecArgs =
    format === "wav" ? "-c:a pcm_s16le -ar 16000 -ac 1" : "-c:a libmp3lame -q:a 2";

  execSync(`ffmpeg -y -i "${inputPath}" -vn ${codecArgs} "${outputPath}"`, {
    stdio: "inherit",
  });

  console.log(`\nDone! Audio extracted to: ${outputPath}`);
}

main();
