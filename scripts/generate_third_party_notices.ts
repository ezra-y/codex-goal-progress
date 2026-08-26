import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice)(\..*)?$/iu;

interface LicenseListEntry {
  readonly license?: string;
  readonly paths?: readonly string[];
}

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly repository?: string | { readonly url?: string };
}

interface NoticeEntry {
  readonly key: string;
  readonly license: string;
  readonly repository: string | null;
  readonly text: string;
}

function repositoryUrl(value: PackageManifest["repository"]): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.url === "string") {
    return value.url;
  }
  return null;
}

async function licenseText(
  packageDirectory: string,
  packageName: string,
  workspaceRoot: string,
): Promise<string> {
  const files = await readdir(packageDirectory);
  const licenseFile = files.sort().find((file) => LICENSE_FILE_PATTERN.test(file));
  if (licenseFile) {
    return readFile(resolve(packageDirectory, licenseFile), "utf8");
  }
  if (packageName === "@lit-labs/ssr-dom-shim") {
    return readFile(resolve(workspaceRoot, "node_modules/lit/LICENSE"), "utf8");
  }
  throw new Error(`GOAL_PROGRESS_THIRD_PARTY_LICENSE_MISSING: ${packageName}`);
}

export async function generateThirdPartyNotices(workspaceRoot: string): Promise<string> {
  const result = spawnSync(
    process.env.GOAL_PROGRESS_PNPM_BINARY ?? "pnpm",
    ["licenses", "list", "--prod", "--json"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error("GOAL_PROGRESS_THIRD_PARTY_LICENSE_LIST_FAILED");
  }
  const groups = JSON.parse(result.stdout) as Record<string, readonly LicenseListEntry[]>;
  const packages = new Map<string, NoticeEntry>();
  for (const entries of Object.values(groups)) {
    for (const entry of entries) {
      for (const packageDirectory of entry.paths ?? []) {
        const manifest = JSON.parse(
          await readFile(resolve(packageDirectory, "package.json"), "utf8"),
        ) as PackageManifest;
        const key = `${manifest.name}@${manifest.version}`;
        if (packages.has(key)) {
          continue;
        }
        packages.set(key, {
          key,
          license: String(manifest.license ?? entry.license ?? "UNKNOWN"),
          repository: repositoryUrl(manifest.repository),
          text: (await licenseText(packageDirectory, manifest.name, workspaceRoot)).trim(),
        });
      }
    }
  }
  const sections = [...packages.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) =>
      [
        "=".repeat(80),
        entry.key,
        `License: ${entry.license}`,
        ...(entry.repository ? [`Repository: ${entry.repository}`] : []),
        "=".repeat(80),
        "",
        entry.text,
      ].join("\n"),
    );
  return [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "This file is generated from the production dependency graph used by this Release.",
    "",
    ...sections,
    "",
  ].join("\n");
}
