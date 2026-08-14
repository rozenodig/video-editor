/**
 * Batch renders all config JSON files in a directory.
 *
 * Usage: npx tsx scripts/batch-render.ts [configs-dir]
 *
 * Defaults to ./configs/ if no directory is specified.
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import type { VideoConfig } from "../src/types/VideoConfig";

async function main() {
  const configsDir = path.resolve(process.argv[2] ?? "configs");

  if (!fs.existsSync(configsDir)) {
    console.error(`Directory not found: ${configsDir}`);
    process.exit(1);
  }

  const configFiles = fs
    .readdirSync(configsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (configFiles.length === 0) {
    console.error("No JSON config files found.");
    process.exit(1);
  }

  console.log(`Found ${configFiles.length} config(s) to render.\n`);

  const outputDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outputDir, { recursive: true });

  const results: Array<{ file: string; status: "success" | "failed"; error?: string }> = [];

  for (const file of configFiles) {
    const configPath = path.join(configsDir, file);
    const config: VideoConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8"),
    );
    const outputPath = path.join(outputDir, `${config.id}.mp4`);

    console.log(`\n[${ results.length + 1}/${configFiles.length}] Rendering: ${config.title}`);

    try {
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
      results.push({ file, status: "success" });
      console.log(`  Done: ${outputPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ file, status: "failed", error: message });
      console.error(`  FAILED: ${file}`);
    }
  }

  // Summary
  console.log("\n─── BATCH RENDER SUMMARY ───");
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`  Succeeded: ${succeeded}/${configFiles.length}`);
  if (failed > 0) {
    console.log(`  Failed: ${failed}`);
    results
      .filter((r) => r.status === "failed")
      .forEach((r) => console.log(`    - ${r.file}: ${r.error}`));
  }
}

main().catch((err) => {
  console.error("Batch render failed:", err);
  process.exit(1);
});
