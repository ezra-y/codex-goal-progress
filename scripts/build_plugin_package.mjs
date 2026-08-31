import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const defaultSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputRoot = resolve(defaultSourceRoot, "plugins/codex-goal-progress");

async function assertNoSymbolicLinks(path, sourceRoot) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(
      `Plugin components cannot contain symbolic links: ${relative(sourceRoot, path)}`,
    );
  }
  if (!metadata.isDirectory()) {
    return;
  }
  for (const entry of await readdir(path)) {
    await assertNoSymbolicLinks(resolve(path, entry), sourceRoot);
  }
}

export async function buildPluginPackage(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? defaultSourceRoot);
  const outputRoot = resolve(options.outputRoot ?? defaultOutputRoot);
  const defaultOutput = sourceRoot === defaultSourceRoot && outputRoot === defaultOutputRoot;
  await mkdir(dirname(outputRoot), { recursive: true });
  const temporaryBundleRoot = defaultOutput
    ? null
    : await mkdtemp(resolve(dirname(outputRoot), ".goal-progress-plugin-bundle-"));
  const bundleOutput =
    temporaryBundleRoot === null
      ? resolve(sourceRoot, "dist/plugin")
      : resolve(temporaryBundleRoot, "dist/plugin");
  const manifest = JSON.parse(
    await readFile(resolve(sourceRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  const rootPackage = JSON.parse(await readFile(resolve(sourceRoot, "package.json"), "utf8"));
  if (manifest.version !== rootPackage.version) {
    throw new Error(
      `Plugin version ${manifest.version} must match root package.json ${rootPackage.version}`,
    );
  }

  const copyFromRoot = async (relativePath) => {
    const normalized = relativePath.replace(/^\.\//, "").replace(/\/$/, "");
    const source = resolve(sourceRoot, normalized);
    const destination = resolve(outputRoot, normalized);
    const sourceRelation = relative(sourceRoot, source);
    if (sourceRelation.startsWith("..") || sourceRelation === "") {
      throw new Error(`Plugin component must stay inside the repository: ${relativePath}`);
    }
    await stat(source);
    await assertNoSymbolicLinks(source, sourceRoot);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: false });
  };

  try {
    await rm(bundleOutput, { recursive: true, force: true });
    await build({
      absWorkingDir: sourceRoot,
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

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });
    await copyFromRoot(".codex-plugin");
    for (const field of ["skills", "hooks", "mcpServers", "apps"]) {
      const value = manifest[field];
      if (typeof value === "string") {
        await copyFromRoot(value);
      }
    }
    await copyFromRoot("bin");
    await mkdir(resolve(outputRoot, "dist"), { recursive: true });
    await cp(bundleOutput, resolve(outputRoot, "dist/plugin"), {
      recursive: true,
      dereference: false,
    });

    const { assertReleaseTree } = await import("./check_release_hygiene.mjs");
    await assertReleaseTree(outputRoot, "Plugin package");
    for (const field of ["composerIcon", "logo", "logoDark"]) {
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
    return outputRoot;
  } finally {
    if (temporaryBundleRoot !== null) {
      await rm(temporaryBundleRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildPluginPackage()
    .then((outputRoot) => {
      process.stdout.write(`${relative(defaultSourceRoot, outputRoot)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
