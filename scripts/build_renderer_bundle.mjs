import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "dist/renderer");
const bundlePath = resolve(outputDirectory, "goal-progress.js");
const manifestPath = resolve(outputDirectory, "goal-progress.manifest.json");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: ["packages/codex-adapter/src/browser-entry.ts"],
  format: "iife",
  legalComments: "none",
  minify: true,
  outfile: bundlePath,
  platform: "browser",
  target: "chrome120",
});

const bundle = await readFile(bundlePath);
const manifest = {
  schemaVersion: 1,
  releaseVersion: packageJson.version,
  pageHostVersion: 51,
  file: "goal-progress.js",
  bytes: bundle.byteLength,
  sha256: createHash("sha256").update(bundle).digest("hex"),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
