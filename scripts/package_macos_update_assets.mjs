import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MACOS_UPDATE_ARCHIVE_NAME = "codex-goal-progress-macos-arm64.zip";
export const MACOS_UPDATE_ARCHIVE_ROOT = "codex-goal-progress-macos-arm64";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function packageMacosUpdateAssets(options = {}) {
  const releaseRoot = resolve(options.releaseRoot ?? resolve(root, "dist/release/macos-arm64"));
  const outputRoot = resolve(options.outputRoot ?? resolve(root, "dist/release/assets"));
  const version =
    options.version ?? JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
  const workRoot = await mkdtemp(resolve(dirname(outputRoot), ".goal-progress-update-assets-"));
  try {
    const archiveRoot = resolve(workRoot, MACOS_UPDATE_ARCHIVE_ROOT);
    await cp(releaseRoot, archiveRoot, { recursive: true, dereference: false });
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const archivePath = resolve(outputRoot, MACOS_UPDATE_ARCHIVE_NAME);
    execFileSync("/usr/bin/zip", ["-qry", archivePath, MACOS_UPDATE_ARCHIVE_ROOT], {
      cwd: workRoot,
      stdio: "pipe",
    });
    const entries = execFileSync("/usr/bin/unzip", ["-Z1", archivePath], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    if (
      entries.length === 0 ||
      entries.some(
        (entry) =>
          !entry.startsWith(`${MACOS_UPDATE_ARCHIVE_ROOT}/`) ||
          entry.includes("__MACOSX") ||
          entry.endsWith(".DS_Store") ||
          entry.split("/").some((segment) => segment.startsWith("._")),
      )
    ) {
      throw new Error("GOAL_PROGRESS_UPDATE_ASSET_ARCHIVE_INVALID");
    }
    const archive = await readFile(archivePath);
    await writeFile(
      resolve(outputRoot, "SHA256SUMS"),
      `${sha256(archive)}  ${MACOS_UPDATE_ARCHIVE_NAME}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(outputRoot, "update-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version,
          asset: MACOS_UPDATE_ARCHIVE_NAME,
          activation: "after-restart",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    return {
      outputRoot,
      archivePath,
      archiveSha256: sha256(archive),
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packageMacosUpdateAssets()
    .then((result) => {
      process.stdout.write(`${result.outputRoot}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
