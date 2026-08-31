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

const entryPoints = [];
for (const parent of ["packages", "platform"]) {
  const modules = await readdir(resolve(root, parent), { withFileTypes: true });
  for (const module of modules) {
    if (!module.isDirectory()) {
      continue;
    }
    const sourceDirectory = resolve(root, parent, module.name, "src");
    const sources = await readdir(sourceDirectory, { withFileTypes: true }).catch(() => []);
    for (const source of sources) {
      if (source.isFile() && source.name.endsWith(".ts")) {
        entryPoints.push(resolve(parent, module.name, "src", source.name));
      }
    }
  }
}
for (const source of await readdir(resolve(root, "hooks/src"), { withFileTypes: true })) {
  if (source.isFile() && source.name.endsWith(".ts")) {
    entryPoints.push(resolve("hooks/src", source.name));
  }
}

await build({
  absWorkingDir: root,
  entryPoints,
  outbase: ".",
  outdir: "dist",
  platform: "neutral",
  format: "esm",
});
