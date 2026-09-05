import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writePluginTreeManifest } from "../platform/macos/src/plugin-integrity.js";
import {
  createReleasePluginManifest,
  createReleasePluginRuntimeFiles,
  writeReleasePluginRuntimeFiles,
} from "../platform/macos/src/plugin-release.js";
import {
  assertReleaseBinaryHygiene,
  assertSafeMacosReleaseOutput,
  createMacosReleaseManifest,
  createNodeSeaConfig,
  GOAL_PROGRESS_DISABLE_COMMAND_PATH,
  GOAL_PROGRESS_INSTALL_COMMAND_PATH,
  GOAL_PROGRESS_MACOS_RELEASE_NODE_VERSION,
  GOAL_PROGRESS_REPAIR_COMMAND_PATH,
  GOAL_PROGRESS_UNINSTALL_COMMAND_PATH,
  type MacosReleaseFile,
  renderDisableGoalProgressCommand,
  renderInstallGoalProgressCommand,
  renderRepairGoalProgressCommand,
  renderSha256Sums,
  renderUninstallGoalProgressCommand,
} from "../platform/macos/src/release.js";
import { generateThirdPartyNotices } from "./generate_third_party_notices.js";

const require = createRequire(import.meta.url);
const { inject } = require("postject") as {
  inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options: {
      readonly machoSegmentName: string;
      readonly sentinelFuse: string;
    },
  ): Promise<void>;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(
  process.env.GOAL_PROGRESS_RELEASE_OUTPUT ?? resolve(root, "dist/release/macos-arm64"),
);
const nodeBinary = process.env.GOAL_PROGRESS_NODE_BINARY;
const rendererSourceRoot = resolve(root, "dist/renderer");
const rendererBundleSource = resolve(rendererSourceRoot, "goal-progress.js");
const rendererManifestSource = resolve(rendererSourceRoot, "goal-progress.manifest.json");
const helperRelativePath = "bin/goal-progress";
const startupListenerRelativePath = "bin/goal-progress-startup-listener";
const rendererRelativePath = "renderer/goal-progress.js";
const rendererManifestRelativePath = "renderer/goal-progress.manifest.json";
const pluginArchiveRelativePath = "plugin-marketplace.zip";
const installCommandPath = resolve(outputRoot, GOAL_PROGRESS_INSTALL_COMMAND_PATH);
const repairCommandPath = resolve(outputRoot, GOAL_PROGRESS_REPAIR_COMMAND_PATH);
const disableCommandPath = resolve(outputRoot, GOAL_PROGRESS_DISABLE_COMMAND_PATH);
const uninstallCommandPath = resolve(outputRoot, GOAL_PROGRESS_UNINSTALL_COMMAND_PATH);
const nodeLicensePath = resolve(outputRoot, "NODE-LICENSE.txt");
const thirdPartyNoticesPath = resolve(outputRoot, "THIRD_PARTY_NOTICES.txt");
const documentationRelativePaths = ["INSTALL-FOR-AI.md", "LICENSE", "README.md"] as const;
const seaFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command: string, args: readonly string[], code: string, cwd?: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim().slice(0, 2_000);
    throw new Error(`${code}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function requireNodeBinary(): string {
  if (!nodeBinary || !isAbsolute(nodeBinary)) {
    throw new Error("GOAL_PROGRESS_RELEASE_NODE_BINARY_REQUIRED");
  }
  const version = run(nodeBinary, ["--version"], "GOAL_PROGRESS_RELEASE_NODE_VERSION_READ_FAILED");
  if (version !== GOAL_PROGRESS_MACOS_RELEASE_NODE_VERSION) {
    throw new Error(
      `GOAL_PROGRESS_RELEASE_NODE_VERSION_MISMATCH: expected ${GOAL_PROGRESS_MACOS_RELEASE_NODE_VERSION}; received ${version}`,
    );
  }
  const description = run(
    "/usr/bin/file",
    ["-b", nodeBinary],
    "GOAL_PROGRESS_RELEASE_NODE_FILE_READ_FAILED",
  );
  if (!description.includes("Mach-O") || !description.includes("arm64")) {
    throw new Error("GOAL_PROGRESS_RELEASE_NODE_ARCH_MISMATCH");
  }
  return nodeBinary;
}

async function releaseFile(path: string, relativePath: string): Promise<MacosReleaseFile> {
  const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
  return {
    path: relativePath,
    bytes: metadata.size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function main(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("GOAL_PROGRESS_RELEASE_MACOS_ARM64_REQUIRED");
  }
  assertSafeMacosReleaseOutput(root, outputRoot);
  const releaseNode = requireNodeBinary();
  const nodeLicenseSource = resolve(dirname(releaseNode), "..", "LICENSE");
  const nodeContents = await readFile(releaseNode);
  if (!nodeContents.includes(Buffer.from(`${seaFuse}:0`))) {
    throw new Error("GOAL_PROGRESS_RELEASE_NODE_SEA_FUSE_MISSING");
  }

  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    version?: string;
  };
  if (!packageJson.version) {
    throw new Error("GOAL_PROGRESS_RELEASE_VERSION_MISSING");
  }
  const rendererManifest = JSON.parse(await readFile(rendererManifestSource, "utf8")) as {
    releaseVersion?: string;
  };

  await rm(outputRoot, { recursive: true, force: true });
  const workRoot = resolve(outputRoot, ".build");
  const helperPath = resolve(outputRoot, helperRelativePath);
  const startupListenerPath = resolve(outputRoot, startupListenerRelativePath);
  const rendererPath = resolve(outputRoot, rendererRelativePath);
  const rendererManifestPath = resolve(outputRoot, rendererManifestRelativePath);
  await Promise.all([
    mkdir(dirname(helperPath), { recursive: true }),
    mkdir(dirname(rendererPath), { recursive: true }),
    mkdir(workRoot, { recursive: true }),
  ]);
  const startupListenerSource = resolve(root, "platform/macos/startup-listener/main.swift");
  run(
    "/usr/bin/xcrun",
    ["swiftc", "-O", "-framework", "AppKit", startupListenerSource, "-o", startupListenerPath],
    "GOAL_PROGRESS_STARTUP_LISTENER_BUILD_FAILED",
  );
  assertReleaseBinaryHygiene(await readFile(startupListenerPath), [root, outputRoot, workRoot]);
  await chmod(startupListenerPath, 0o755);
  run(
    "/usr/bin/codesign",
    ["--force", "--sign", process.env.GOAL_PROGRESS_CODESIGN_IDENTITY ?? "-", startupListenerPath],
    "GOAL_PROGRESS_STARTUP_LISTENER_SIGN_FAILED",
  );
  run(
    "/usr/bin/codesign",
    ["--verify", "--strict", startupListenerPath],
    "GOAL_PROGRESS_STARTUP_LISTENER_SIGNATURE_INVALID",
  );
  await Promise.all([
    copyFile(rendererBundleSource, rendererPath),
    copyFile(rendererManifestSource, rendererManifestPath),
    ...documentationRelativePaths.map((relativePath) =>
      copyFile(resolve(root, relativePath), resolve(outputRoot, relativePath)),
    ),
    copyFile(nodeLicenseSource, nodeLicensePath),
    writeFile(thirdPartyNoticesPath, await generateThirdPartyNotices(root), "utf8"),
    writeFile(installCommandPath, renderInstallGoalProgressCommand(), { mode: 0o700 }),
    writeFile(repairCommandPath, renderRepairGoalProgressCommand(), { mode: 0o700 }),
    writeFile(disableCommandPath, renderDisableGoalProgressCommand(), { mode: 0o700 }),
    writeFile(uninstallCommandPath, renderUninstallGoalProgressCommand(), { mode: 0o700 }),
  ]);
  const marketplaceRoot = resolve(workRoot, "plugin-marketplace");
  const releasePluginRoot = resolve(marketplaceRoot, "plugins/codex-goal-progress");
  await mkdir(resolve(marketplaceRoot, ".agents/plugins"), { recursive: true });
  await copyFile(
    resolve(root, ".agents/plugins/marketplace.json"),
    resolve(marketplaceRoot, ".agents/plugins/marketplace.json"),
  );
  await cp(resolve(root, "plugins/codex-goal-progress"), releasePluginRoot, {
    recursive: true,
  });
  await Promise.all([
    rm(resolve(releasePluginRoot, "dist"), {
      recursive: true,
      force: true,
    }),
    rm(resolve(releasePluginRoot, "runtime"), {
      recursive: true,
      force: true,
    }),
  ]);
  const releasePluginManifestPath = resolve(releasePluginRoot, ".codex-plugin/plugin.json");
  const releasePluginManifest = createReleasePluginManifest(
    JSON.parse(await readFile(releasePluginManifestPath, "utf8")),
  );
  await writeFile(releasePluginManifestPath, releasePluginManifest);
  const pluginRuntime = createReleasePluginRuntimeFiles(
    JSON.parse(await readFile(resolve(releasePluginRoot, ".mcp.json"), "utf8")),
    JSON.parse(await readFile(resolve(releasePluginRoot, "hooks/hooks.json"), "utf8")),
  );
  await writeReleasePluginRuntimeFiles(releasePluginRoot, pluginRuntime);
  const pluginTreeManifestSha256 = await writePluginTreeManifest(releasePluginRoot);
  const pluginArchivePath = resolve(outputRoot, pluginArchiveRelativePath);
  run(
    "/usr/bin/ditto",
    [
      "-c",
      "-k",
      "--norsrc",
      "--noextattr",
      "--noqtn",
      "--noacl",
      marketplaceRoot,
      pluginArchivePath,
    ],
    "GOAL_PROGRESS_RELEASE_PLUGIN_ARCHIVE_FAILED",
  );
  const archiveEntries = run(
    "/usr/bin/unzip",
    ["-Z1", pluginArchivePath],
    "GOAL_PROGRESS_RELEASE_PLUGIN_ARCHIVE_READ_FAILED",
  ).split("\n");
  if (
    archiveEntries.some(
      (entry) =>
        entry.startsWith("__MACOSX/") ||
        entry.includes("/dist/plugin/") ||
        entry.endsWith("/dist/plugin") ||
        entry.includes("/runtime/"),
    ) ||
    pluginRuntime.mcpJson.includes('"command": "node"') ||
    pluginRuntime.hooksJson.includes("UserPromptSubmit") ||
    pluginRuntime.hooksJson.includes("trusted_hash")
  ) {
    throw new Error("GOAL_PROGRESS_RELEASE_PLUGIN_ARCHIVE_INVALID");
  }

  const helperBundlePath = resolve(workRoot, "helper.cjs");
  const cliEntryPath = resolve(root, "platform/macos/src/cli.ts");
  await build({
    absWorkingDir: root,
    bundle: true,
    format: "cjs",
    legalComments: "none",
    logOverride: {
      "empty-import-meta": "silent",
    },
    outfile: helperBundlePath,
    platform: "node",
    stdin: {
      contents: [
        `const { runGoalProgressCli } = require(${JSON.stringify(cliEntryPath)});`,
        "runGoalProgressCli().catch((error) => {",
        '  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\\n");',
        "  process.exitCode = 1;",
        "});",
      ].join("\n"),
      loader: "js",
      resolveDir: root,
      sourcefile: "goal-progress-helper-entry.js",
    },
    target: "node22",
  });

  const blobPath = resolve(workRoot, "sea.blob");
  const seaConfigPath = resolve(workRoot, "sea-config.json");
  await writeFile(seaConfigPath, `${JSON.stringify(createNodeSeaConfig(), null, 2)}\n`);
  run(
    releaseNode,
    ["--experimental-sea-config", seaConfigPath],
    "GOAL_PROGRESS_RELEASE_SEA_BLOB_FAILED",
    workRoot,
  );
  await copyFile(releaseNode, helperPath);
  run(
    "/usr/bin/codesign",
    ["--remove-signature", helperPath],
    "GOAL_PROGRESS_RELEASE_SIGNATURE_REMOVE_FAILED",
  );
  await inject(helperPath, "NODE_SEA_BLOB", await readFile(blobPath), {
    machoSegmentName: "NODE_SEA",
    sentinelFuse: seaFuse,
  });
  assertReleaseBinaryHygiene(await readFile(helperPath), [root, outputRoot, workRoot]);
  await chmod(helperPath, 0o755);
  run(
    "/usr/bin/codesign",
    ["--force", "--sign", process.env.GOAL_PROGRESS_CODESIGN_IDENTITY ?? "-", helperPath],
    "GOAL_PROGRESS_RELEASE_SIGN_FAILED",
  );
  run(
    "/usr/bin/codesign",
    ["--verify", "--strict", helperPath],
    "GOAL_PROGRESS_RELEASE_SIGNATURE_INVALID",
  );

  const [
    helper,
    startupListener,
    renderer,
    rendererManifestFile,
    pluginArchive,
    installGuide,
    installCommand,
    repairCommand,
    disableCommand,
    uninstallCommand,
    license,
    nodeLicense,
    thirdPartyNotices,
    readme,
  ] = await Promise.all([
    releaseFile(helperPath, helperRelativePath),
    releaseFile(startupListenerPath, startupListenerRelativePath),
    releaseFile(rendererPath, rendererRelativePath),
    releaseFile(rendererManifestPath, rendererManifestRelativePath),
    releaseFile(pluginArchivePath, pluginArchiveRelativePath),
    releaseFile(resolve(outputRoot, "INSTALL-FOR-AI.md"), "INSTALL-FOR-AI.md"),
    releaseFile(installCommandPath, GOAL_PROGRESS_INSTALL_COMMAND_PATH),
    releaseFile(repairCommandPath, GOAL_PROGRESS_REPAIR_COMMAND_PATH),
    releaseFile(disableCommandPath, GOAL_PROGRESS_DISABLE_COMMAND_PATH),
    releaseFile(uninstallCommandPath, GOAL_PROGRESS_UNINSTALL_COMMAND_PATH),
    releaseFile(resolve(outputRoot, "LICENSE"), "LICENSE"),
    releaseFile(nodeLicensePath, "NODE-LICENSE.txt"),
    releaseFile(thirdPartyNoticesPath, "THIRD_PARTY_NOTICES.txt"),
    releaseFile(resolve(outputRoot, "README.md"), "README.md"),
  ]);
  const releaseManifest = createMacosReleaseManifest({
    releaseVersion: packageJson.version,
    rendererReleaseVersion: rendererManifest.releaseVersion ?? "",
    nodeVersion: GOAL_PROGRESS_MACOS_RELEASE_NODE_VERSION,
    pluginTreeManifestSha256,
    helper,
    startupListener,
    renderer,
    rendererManifest: rendererManifestFile,
    pluginArchive,
    license,
    nodeLicense,
    thirdPartyNotices,
    readme,
    installGuide,
    installCommand,
    repairCommand,
    disableCommand,
    uninstallCommand,
  });
  const manifestPath = resolve(outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
  const manifestFile = await releaseFile(manifestPath, relative(outputRoot, manifestPath));
  await writeFile(
    resolve(outputRoot, "SHA256SUMS"),
    renderSha256Sums([
      helper,
      startupListener,
      renderer,
      rendererManifestFile,
      pluginArchive,
      installGuide,
      installCommand,
      repairCommand,
      disableCommand,
      uninstallCommand,
      license,
      nodeLicense,
      thirdPartyNotices,
      readme,
      manifestFile,
    ]),
  );
  const doctor = spawnSync(helperPath, ["doctor", "--json"], {
    encoding: "utf8",
    env: {
      HOME: resolve(workRoot, "home"),
      PATH: "/usr/bin:/bin",
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  const doctorResult = JSON.parse(doctor.stdout) as {
    schemaVersion?: number;
    command?: string;
    ok?: boolean;
    code?: string;
  };
  if (
    doctor.status !== 1 ||
    doctor.stderr ||
    doctorResult.schemaVersion !== 1 ||
    doctorResult.command !== "doctor" ||
    doctorResult.ok !== false ||
    doctorResult.code !== "DOCTOR_NOT_INSTALLED"
  ) {
    throw new Error("GOAL_PROGRESS_RELEASE_DOCTOR_INVALID");
  }
  await rm(workRoot, { recursive: true, force: true });
  process.stdout.write(`${outputRoot}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
