import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const managedOutputDirectories = [
  resolve(root, "dist/packages"),
  resolve(root, "dist/platform"),
  resolve(root, "dist/hooks"),
];

await Promise.all(
  managedOutputDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
);

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const entryPoints = [];
for (const parent of ["packages", "platform"]) {
  const modules = await readdir(resolve(root, parent), { withFileTypes: true });
  for (const module of modules) {
    if (!module.isDirectory()) {
      continue;
    }
    entryPoints.push(...(await collectTypeScriptFiles(resolve(root, parent, module.name, "src"))));
  }
}
entryPoints.push(...(await collectTypeScriptFiles(resolve(root, "hooks/src"))));

await build({
  absWorkingDir: root,
  entryPoints,
  outbase: ".",
  outdir: "dist",
  platform: "neutral",
  format: "esm",
});
