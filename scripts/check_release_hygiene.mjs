#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN_DIRECTORY_NAMES = new Set([
  "__pycache__",
  ".git",
  ".venv",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const FORBIDDEN_FILE_NAMES = new Set([
  ".DS_Store",
  ".env",
  "auth.json",
  "credentials.json",
  "id_rsa",
]);

const FORBIDDEN_SUFFIXES = [".pem", ".pyc", ".tsbuildinfo"];

export const MACOS_RELEASE_FILES = [
  "Disable Goal Progress.command",
  "INSTALL-FOR-AI.md",
  "Install Goal Progress.command",
  "LICENSE",
  "README.md",
  "Repair Goal Progress.command",
  "SHA256SUMS",
  "Uninstall Goal Progress.command",
  "bin/goal-progress",
  "manifest.json",
  "plugin-marketplace.zip",
  "renderer/goal-progress.js",
  "renderer/goal-progress.manifest.json",
];

function isForbiddenPath(relativePath) {
  const parts = relativePath.split(/[\\/]/u);
  if (parts.some((part) => FORBIDDEN_DIRECTORY_NAMES.has(part))) {
    return `forbidden directory '${parts.find((part) => FORBIDDEN_DIRECTORY_NAMES.has(part))}'`;
  }
  const fileName = parts[parts.length - 1] ?? "";
  if (parts.includes("__MACOSX")) {
    return "AppleDouble metadata directory";
  }
  if (fileName.startsWith("._")) {
    return "AppleDouble metadata file";
  }
  if (fileName.startsWith(".env.")) {
    return "forbidden dotenv file";
  }
  if (FORBIDDEN_FILE_NAMES.has(fileName)) {
    return `forbidden file '${fileName}'`;
  }
  if (FORBIDDEN_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
    return `forbidden suffix on '${fileName}'`;
  }
  if (fileName.includes("codex-home") || relativePath.includes("tmp-home")) {
    return "temporary HOME or Codex home fixture";
  }
  return undefined;
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function assertReleaseVersions(root = repoRoot) {
  const packageJson = await readJson(resolve(root, "package.json"));
  const version = packageJson.version;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("Root package.json version must be a non-empty string");
  }

  const manifests = [
    "package.json",
    ".codex-plugin/plugin.json",
    "plugins/codex-goal-progress/.codex-plugin/plugin.json",
    "platform/macos/package.json",
  ];
  const workspacePackages = await readdir(resolve(root, "packages"), { withFileTypes: true });
  for (const entry of workspacePackages) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    manifests.push(`packages/${entry.name}/package.json`);
  }

  for (const relativePath of manifests) {
    const path = resolve(root, relativePath);
    const manifest = await readJson(path);
    if (manifest.version !== version) {
      throw new Error(`${relativePath} version ${manifest.version} does not match root ${version}`);
    }
  }
}

export async function assertReleaseTree(root, label) {
  let metadata;
  try {
    metadata = await stat(root);
  } catch {
    throw new Error(`${label} is missing`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} is not a directory`);
  }
  for (const filePath of await walkFiles(root)) {
    const relativePath = relative(root, filePath);
    const reason = isForbiddenPath(relativePath);
    if (reason) {
      throw new Error(`${label} contains ${reason}: ${relativePath}`);
    }
  }
}

export async function assertMacosReleaseTree(root) {
  await assertReleaseTree(root, "macOS release");
  const actual = (await walkFiles(root)).map((path) => relative(root, path)).sort();
  const expected = [...MACOS_RELEASE_FILES].sort();
  for (const path of actual) {
    if (!expected.includes(path)) {
      throw new Error(`macOS release contains unexpected release file: ${path}`);
    }
  }
  for (const path of expected) {
    if (!actual.includes(path)) {
      throw new Error(`macOS release is missing release file: ${path}`);
    }
  }
}

export async function assertReleaseHygiene(root = repoRoot) {
  await assertReleaseVersions(root);
  await assertReleaseTree(resolve(root, "plugins/codex-goal-progress"), "Plugin package");
  for (const optional of ["dist/plugin", "dist/renderer"]) {
    try {
      await stat(resolve(root, optional));
    } catch {
      continue;
    }
    await assertReleaseTree(resolve(root, optional), optional);
  }
  try {
    await stat(resolve(root, "dist/release/macos-arm64"));
  } catch {
    return;
  }
  await assertMacosReleaseTree(resolve(root, "dist/release/macos-arm64"));
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  try {
    await assertReleaseHygiene();
    console.log("Release hygiene passed");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
