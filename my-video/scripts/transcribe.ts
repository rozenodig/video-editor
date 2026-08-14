/**
 * Transcribes an audio file to word-level captions using Whisper (Swedish).
 *
 * Usage: npx tsx scripts/transcribe.ts <audio-file> [--model medium|large-v3]
 *
 * Outputs a Remotion Caption[] JSON to public/captions/<filename>.json
 */

import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import {
  installWhisperCpp,
  downloadWhisperModel,
  transcribe,
  toCaptions,
} from "@remotion/install-whisper-cpp";

const WHISPER_VERSION = "1.5.5";
const WHISPER_DIR = path.join(process.cwd(), ".whisper");
const MODEL_DIR = path.join(WHISPER_DIR, "models");
const OUTPUT_DIR = path.join(process.cwd(), "public", "captions");

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];

  if (!inputFile) {
    console.error("Usage: npx tsx scripts/transcribe.ts <audio-file> [--model medium|large-v3]");
    process.exit(1);
  }

  const modelFlag = args.indexOf("--model");
  const model = (modelFlag !== -1 ? args[modelFlag + 1] : "medium") as
    | "medium"
    | "large-v3";

  if (model !== "medium" && model !== "large-v3") {
    console.error("Model must be 'medium' or 'large-v3'");
    process.exit(1);
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: Convert to 16kHz mono WAV if needed
  const wavPath = await ensureWav16k(inputPath);

  // Step 2: Install whisper.cpp
  console.log(`Installing whisper.cpp v${WHISPER_VERSION}...`);
  const { alreadyExisted: whisperExisted } = await installWhisperCpp({
    version: WHISPER_VERSION,
    to: WHISPER_DIR,
    printOutput: true,
  });
  console.log(whisperExisted ? "Whisper already installed." : "Whisper installed.");

  // Step 3: Download model
  console.log(`Downloading model: ${model}...`);
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  const { alreadyExisted: modelExisted } = await downloadWhisperModel({
    model,
    folder: MODEL_DIR,
    printOutput: true,
  });
  console.log(modelExisted ? "Model already downloaded." : "Model downloaded.");

  // Step 4: Transcribe with Swedish language and token-level timestamps
  console.log("Transcribing (Swedish, token-level timestamps)...");
  const result = await transcribe({
    inputPath: wavPath,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model,
    modelFolder: MODEL_DIR,
    language: "Swedish",
    tokenLevelTimestamps: true,
    splitOnWord: true,
    printOutput: false,
    onProgress: (p) => {
      process.stdout.write(`\rProgress: ${Math.round(p * 100)}%`);
    },
  });
  console.log("\nTranscription complete.");

  // Step 5: Convert to Remotion Caption format
  const { captions } = toCaptions({ whisperCppOutput: result });

  // Step 6: Write output
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(OUTPUT_DIR, `${baseName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(captions, null, 2));
  console.log(`Captions saved to: ${outputPath}`);
  console.log(`Total captions: ${captions.length}`);

  // Clean up temp WAV if we created one
  if (wavPath !== inputPath) {
    fs.unlinkSync(wavPath);
  }
}

async function ensureWav16k(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();

  // Check if already a 16kHz WAV
  if (ext === ".wav") {
    try {
      const probe = execSync(
        `ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "${inputPath}"`,
        { encoding: "utf-8" },
      ).trim();
      if (probe === "16000") {
        console.log("Input is already 16kHz WAV.");
        return inputPath;
      }
    } catch {
      // ffprobe failed, convert anyway
    }
  }

  const tmpDir = path.join(process.cwd(), ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const outputPath = path.join(
    tmpDir,
    `${path.basename(inputPath, path.extname(inputPath))}_16k.wav`,
  );

  console.log("Converting to 16kHz mono WAV...");
  execSync(
    `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`,
    { stdio: "inherit" },
  );

  return outputPath;
}

main().catch((err) => {
  console.error("Transcription failed:", err);
  process.exit(1);
});
