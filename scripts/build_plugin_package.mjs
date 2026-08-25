import { cp, lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "plugins/codex-goal-progress");
const bundleOutput = resolve(root, "dist/plugin");
const manifestPath = resolve(root, ".codex-plugin/plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (manifest.version !== rootPackage.version) {
  throw new Error(
    `Plugin version ${manifest.version} must match root package.json ${rootPackage.version}`,
  );
}

async function copyFromRoot(relativePath) {
  const normalized = relativePath.replace(/^\.\//, "").replace(/\/$/, "");
  const source = resolve(root, normalized);
  const destination = resolve(output, normalized);
  const sourceRelation = relative(root, source);

  if (sourceRelation.startsWith("..") || sourceRelation === "") {
    throw new Error(`Plugin component must stay inside the repository: ${relativePath}`);
  }

  await stat(source);
  await assertNoSymbolicLinks(source);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: false });
}

async function assertNoSymbolicLinks(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Plugin components cannot contain symbolic links: ${relative(root, path)}`);
  }
  if (!metadata.isDirectory()) {
    return;
  }
  for (const entry of await readdir(path)) {
    await assertNoSymbolicLinks(resolve(path, entry));
  }
}

await rm(bundleOutput, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  bundle: true,
  chunkNames: "chunks/[name]-[hash]",
  entryNames: "[name]",
  entryPoints: {
    hook: "hooks/src/index.ts",
    "mcp-server": "packages/mcp/src/index.ts",
  },
  format: "esm",
  legalComments: "none",
  minify: true,
  outExtension: { ".js": ".mjs" },
  outdir: bundleOutput,
  platform: "node",
  splitting: true,
  target: "node22",
});

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFromRoot(".codex-plugin");

for (const field of ["skills", "hooks", "mcpServers", "apps"]) {
  const value = manifest[field];
  if (typeof value === "string") {
    await copyFromRoot(value);
  }
}

await copyFromRoot("bin");
await copyFromRoot("dist/plugin");

const { assertReleaseTree } = await import("./check_release_hygiene.mjs");
await assertReleaseTree(output, "Plugin package");

const assetFields = ["composerIcon", "logo", "logoDark"];
for (const field of assetFields) {
  const value = manifest.interface?.[field];
  if (typeof value === "string") {
    await copyFromRoot(value);
  }
}

for (const screenshot of manifest.interface?.screenshots ?? []) {
  if (typeof screenshot === "string") {
    await copyFromRoot(screenshot);
  }
}

console.log(relative(root, output));
