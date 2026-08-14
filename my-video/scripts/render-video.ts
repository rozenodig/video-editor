/**
 * Renders a video from a config JSON file.
 *
 * Usage: npx tsx scripts/render-video.ts <config.json> [--output <path>]
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import type { VideoConfig } from "../src/types/VideoConfig";

async function main() {
  const args = process.argv.slice(2);
  const configPath = args[0];

  if (!configPath) {
    console.error("Usage: npx tsx scripts/render-video.ts <config.json> [--output <path>]");
    process.exit(1);
  }

  const resolvedConfig = path.resolve(configPath);
  if (!fs.existsSync(resolvedConfig)) {
    console.error(`Config not found: ${resolvedConfig}`);
    process.exit(1);
  }

  const config: VideoConfig = JSON.parse(
    fs.readFileSync(resolvedConfig, "utf-8"),
  );

  const outputIdx = args.indexOf("--output");
  const outputDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath =
    outputIdx !== -1
      ? path.resolve(args[outputIdx + 1])
      : path.join(outputDir, `${config.id}.mp4`);

  console.log(`Rendering: ${config.title} (${config.id})`);
  console.log(`  Duration: ${config.output.durationInSeconds}s`);
  console.log(`  Resolution: ${config.output.width}x${config.output.height}`);
  console.log(`  Output: ${outputPath}`);

  const inputProps = JSON.stringify({ config });

  execSync(
    [
      "npx remotion render",
      `--props='${inputProps}'`,
      config.id,
      `"${outputPath}"`,
    ].join(" "),
    {
      stdio: "inherit",
      cwd: process.cwd(),
    },
  );

  console.log(`\nDone! Output: ${outputPath}`);
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
