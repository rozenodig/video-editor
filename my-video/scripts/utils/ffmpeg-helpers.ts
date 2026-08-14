/**
 * Shared ffmpeg utilities — path resolution, command execution, video probing.
 *
 * Remotion's bundled ffmpeg requires DYLD_LIBRARY_PATH on macOS 14.
 * macOS SIP strips DYLD_* from child process env, so we inject it
 * inline in the shell command string instead.
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";

/** Locate a working ffmpeg binary or exit with a clear message. */
export function findFfmpeg(): string {
  // System ffmpeg
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    // fall through
  }

  // Remotion bundled — arm64
  const remotionArm = path.join(
    process.cwd(),
    "node_modules/@remotion/compositor-darwin-arm64/ffmpeg",
  );
  if (fs.existsSync(remotionArm)) return remotionArm;

  // Remotion bundled — x64
  const remotionX64 = path.join(
    process.cwd(),
    "node_modules/@remotion/compositor-darwin-x64/ffmpeg",
  );
  if (fs.existsSync(remotionX64)) return remotionX64;

  console.error(
    "ERROR: ffmpeg not found.\n" +
      "Install via: brew install ffmpeg\n" +
      "Or ensure @remotion/compositor-darwin-arm64 is installed.",
  );
  process.exit(1);
}

/** Locate ffprobe (same directory as ffmpeg). */
export function findFfprobe(): string {
  // System ffprobe
  try {
    execSync("ffprobe -version", { stdio: "ignore" });
    return "ffprobe";
  } catch {
    // fall through
  }

  // Remotion bundles ffprobe alongside ffmpeg
  const ffmpeg = findFfmpeg();
  const dir = path.dirname(ffmpeg);
  const probe = path.join(dir, "ffprobe");
  if (fs.existsSync(probe)) return probe;

  // Fall back to using ffmpeg -i for probing
  return ffmpeg;
}

/**
 * Build a shell command prefix that sets DYLD_LIBRARY_PATH inline.
 * macOS SIP strips DYLD_* from env when spawning child processes,
 * so we must prepend it directly in the command string.
 */
function buildCmd(binaryPath: string, args: string): string {
  if (binaryPath === "ffmpeg" || binaryPath === "ffprobe") {
    return `"${binaryPath}" ${args}`;
  }
  const libDir = path.dirname(binaryPath);
  return `DYLD_LIBRARY_PATH="${libDir}" "${binaryPath}" ${args}`;
}

/** Run an ffmpeg command and return stdout. */
export function runFfmpeg(
  args: string,
  options?: { silent?: boolean; timeout?: number },
): string {
  const ffmpeg = findFfmpeg();
  const cmd = buildCmd(ffmpeg, args);

  return execSync(cmd, {
    maxBuffer: 50 * 1024 * 1024,
    timeout: options?.timeout ?? 120_000,
    stdio: options?.silent ? "pipe" : undefined,
  }).toString();
}

/**
 * Run an ffmpeg command that produces output on stderr (most analysis filters).
 * Captures both stdout and stderr. Tolerates non-zero exit codes (common with -f null).
 */
export function runFfmpegStderr(
  args: string,
  options?: { timeout?: number },
): string {
  const ffmpeg = findFfmpeg();
  const cmd = `${buildCmd(ffmpeg, args)} 2>&1`;

  try {
    return execSync(cmd, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: options?.timeout ?? 120_000,
    }).toString();
  } catch (e: unknown) {
    // ffmpeg often exits non-zero but still produces useful output
    const err = e as { stdout?: Buffer; status?: number };
    if (err.stdout) return err.stdout.toString();
    throw e;
  }
}

/** Run ffprobe and return stdout. */
export function runFfprobe(args: string): string {
  const probe = findFfprobe();
  const cmd = buildCmd(probe, args);

  return execSync(cmd, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  }).toString();
}

/** Probe basic video metadata. */
export interface VideoMeta {
  duration: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export function probeVideo(filePath: string): VideoMeta {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const raw = runFfprobe(
    `-v quiet -print_format json -show_format -show_streams "${abs}"`,
  );
  const data = JSON.parse(raw);

  const videoStream = data.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const audioStream = data.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );

  if (!videoStream) {
    // Audio-only file — return duration from format/audio stream
    if (!audioStream && !data.format?.duration) {
      console.error("No video or audio stream found in file.");
      process.exit(1);
    }
    return {
      duration: parseFloat(data.format?.duration ?? audioStream?.duration ?? "0"),
      fps: 30,
      width: 0,
      height: 0,
      hasAudio: !!audioStream,
    };
  }

  const [fpsNum, fpsDen] = (videoStream.r_frame_rate || "30/1")
    .split("/")
    .map(Number);
  const fps = fpsDen ? fpsNum / fpsDen : fpsNum;

  return {
    duration: parseFloat(data.format?.duration ?? videoStream.duration ?? "0"),
    fps: Math.round(fps * 100) / 100,
    width: videoStream.width,
    height: videoStream.height,
    hasAudio: !!audioStream,
  };
}

/** Ensure the output directory exists. */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Extract audio to mono 16-bit PCM WAV. Optionally trim to a time range.
 * Returns the output file path.
 */
export function extractPcmWav(
  inputPath: string,
  outputPath: string,
  options?: { from?: number; to?: number; sampleRate?: number },
): string {
  const abs = path.resolve(inputPath);
  const out = path.resolve(outputPath);
  ensureDir(path.dirname(out));

  const sr = options?.sampleRate ?? 44100;
  const timeArgs: string[] = [];
  if (options?.from !== undefined) timeArgs.push(`-ss ${options.from}`);
  if (options?.to !== undefined) timeArgs.push(`-to ${options.to}`);

  const ffmpeg = findFfmpeg();
  const cmd = buildCmd(
    ffmpeg,
    `${timeArgs.join(" ")} -y -i "${abs}" -vn -acodec pcm_s16le -ar ${sr} -ac 1 "${out}"`,
  );

  execSync(cmd, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
    stdio: "pipe",
  });

  return out;
}
