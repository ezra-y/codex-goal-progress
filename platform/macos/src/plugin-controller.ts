import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  lstat,
  readdir,
  readFile,
  realpath,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { ensurePrivateDirectory } from "../../../packages/store/src/index.js";
import {
  enableInstalledGoalProgressHooks,
  GOAL_PROGRESS_PLUGIN_ID as PLUGIN_ID,
  removeInstalledGoalProgressHookState,
} from "./hook-configuration.js";
import { isNotFound } from "./macos-errors.js";
import { assertPluginTreeHasNoSymlinks, verifyPluginTreeManifest } from "./plugin-integrity.js";
import { GOAL_PROGRESS_STABLE_HOOK_COMMAND } from "./plugin-release.js";
import {
  type CodexInstallIdentity,
  fileSha256,
  validateCodexIdentity,
} from "./verified-release.js";

const PLUGIN_NAME = "codex-goal-progress";
const MARKETPLACE_NAME = "codex-goal-progress-local";

export interface PluginController {
  ensure(
    archivePath: string,
    marketplaceRoot: string,
    reinstall: boolean,
    expectedTreeManifestSha256: string,
  ): Promise<boolean>;
  remove(): Promise<boolean>;
  verify(releaseVersion: string | undefined, expectedTreeManifestSha256: string): Promise<boolean>;
}

export async function resolveVerifiedCodexCli(identity: CodexInstallIdentity): Promise<string> {
  validateCodexIdentity(identity);
  const resourcesRoot = resolve(identity.realAppPath, "Contents/Resources");
  const cliPath = resolve(resourcesRoot, "codex");
  let metadata: Awaited<ReturnType<typeof stat>>;
  let realCliPath: string;
  try {
    [metadata, realCliPath] = await Promise.all([
      stat(cliPath),
      realpath(cliPath),
      access(cliPath, constants.X_OK),
    ]);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    const failureCode =
      code === "ENOENT"
        ? "GOAL_PROGRESS_CODEX_BUNDLED_CLI_NOT_FOUND"
        : "GOAL_PROGRESS_CODEX_BUNDLED_CLI_NOT_EXECUTABLE";
    throw new Error(`${failureCode}: app=${identity.realAppPath}; cli=${cliPath}`);
  }
  if (!metadata.isFile()) {
    throw new Error(
      `GOAL_PROGRESS_CODEX_BUNDLED_CLI_NOT_EXECUTABLE: app=${identity.realAppPath}; cli=${cliPath}`,
    );
  }
  const realResourcesRoot = await realpath(resourcesRoot);
  if (realCliPath !== resolve(realResourcesRoot, "codex")) {
    throw new Error(
      `GOAL_PROGRESS_CODEX_BUNDLED_CLI_APP_MISMATCH: app=${identity.realAppPath}; cli=${cliPath}`,
    );
  }
  return cliPath;
}

function runCodexJson(
  command: string,
  args: readonly string[],
  codexHomeDirectory: string,
): Record<string, unknown> {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHomeDirectory,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    throw new Error(
      `GOAL_PROGRESS_CODEX_PLUGIN_COMMAND_FAILED: cli=${command}; ${`${stderr}\n${stdout}`.trim().slice(0, 2_000)}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GOAL_PROGRESS_CODEX_PLUGIN_JSON_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function listedRecords(
  value: unknown,
  key: "installed" | "marketplaces",
): readonly Record<string, unknown>[] {
  const document =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (document === null || !(key in document) || !Array.isArray(document[key])) {
    throw new Error("GOAL_PROGRESS_CODEX_PLUGIN_LIST_INVALID");
  }
  return document[key].filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry),
  );
}

export function createPluginController(options: {
  readonly codexHomeDirectory: string;
  readonly codexCommand: string;
}): PluginController {
  const command = options.codexCommand;
  const marketplaceCacheRoot = resolve(
    options.codexHomeDirectory,
    "plugins/cache",
    MARKETPLACE_NAME,
  );
  const pluginCacheRoot = resolve(marketplaceCacheRoot, PLUGIN_NAME);
  const removeStalePluginCaches = async (currentVersion: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(pluginCacheRoot);
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
    await Promise.all(
      entries
        .filter((entry) => entry !== currentVersion)
        .map((entry) => rm(resolve(pluginCacheRoot, entry), { recursive: true, force: true })),
    );
  };
  const removePluginCache = async (): Promise<boolean> => {
    let changed = false;
    let pluginCacheExists = false;
    try {
      await lstat(pluginCacheRoot);
      pluginCacheExists = true;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
    if (pluginCacheExists) {
      await rm(pluginCacheRoot, { recursive: true, force: true });
      changed = true;
    }
    try {
      await rmdir(marketplaceCacheRoot);
      changed = true;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") {
        throw error;
      }
    }
    return changed;
  };
  const pluginList = () =>
    listedRecords(
      runCodexJson(command, ["plugin", "list", "--json"], options.codexHomeDirectory),
      "installed",
    );
  const marketplaceList = () =>
    listedRecords(
      runCodexJson(
        command,
        ["plugin", "marketplace", "list", "--json"],
        options.codexHomeDirectory,
      ),
      "marketplaces",
    );
  const isInstalled = (releaseVersion?: string) =>
    pluginList().some(
      (plugin) =>
        plugin.pluginId === PLUGIN_ID &&
        plugin.installed === true &&
        (releaseVersion === undefined || plugin.version === releaseVersion),
    );
  const hasMarketplace = () =>
    marketplaceList().some((marketplace) => marketplace.name === MARKETPLACE_NAME);
  const verifyInstalled = async (
    releaseVersion: string | undefined,
    expectedTreeManifestSha256: string,
  ): Promise<boolean> => {
    const installedPlugins = pluginList().filter(
      (candidate) => candidate.pluginId === PLUGIN_ID && candidate.installed === true,
    );
    const plugin =
      installedPlugins.find((candidate) => candidate.version === releaseVersion) ??
      installedPlugins[0];
    const reportedVersion = typeof plugin?.version === "string" ? plugin.version : null;
    const marketplace = marketplaceList().find((candidate) => candidate.name === MARKETPLACE_NAME);
    const marketplaceRoot = typeof marketplace?.root === "string" ? marketplace.root : null;
    if (!reportedVersion || !marketplaceRoot) {
      return false;
    }
    const sourceRoot = resolve(marketplaceRoot, "plugins", PLUGIN_NAME);
    try {
      await verifyPluginTreeManifest(sourceRoot, expectedTreeManifestSha256);
      const [sourceManifest, sourceMcp, sourceHook] = await Promise.all([
        readFile(resolve(sourceRoot, ".codex-plugin/plugin.json"), "utf8"),
        readFile(resolve(sourceRoot, ".mcp.json"), "utf8"),
        fileSha256(resolve(sourceRoot, "hooks/hooks.json")),
      ]);
      const parsedSourceManifest = JSON.parse(sourceManifest) as {
        name?: string;
        version?: string;
      };
      const expectedVersion = releaseVersion ?? parsedSourceManifest.version;
      if (
        !expectedVersion ||
        parsedSourceManifest.name !== PLUGIN_NAME ||
        parsedSourceManifest.version !== expectedVersion ||
        sourceMcp.includes('"command": "node"')
      ) {
        return false;
      }
      const currentCacheRoot = resolve(
        options.codexHomeDirectory,
        "plugins/cache",
        MARKETPLACE_NAME,
        PLUGIN_NAME,
        expectedVersion,
      );
      try {
        await verifyPluginTreeManifest(currentCacheRoot, expectedTreeManifestSha256);
        const [cacheManifest, cacheMcp, cacheHook] = await Promise.all([
          readFile(resolve(currentCacheRoot, ".codex-plugin/plugin.json"), "utf8"),
          readFile(resolve(currentCacheRoot, ".mcp.json"), "utf8"),
          fileSha256(resolve(currentCacheRoot, "hooks/hooks.json")),
        ]);
        if (
          sourceManifest !== cacheManifest ||
          sourceMcp !== cacheMcp ||
          sourceHook !== cacheHook
        ) {
          return false;
        }
        for (const launcher of ["bin/goal-progress-mcp", "bin/goal-progress-hook"]) {
          if (((await stat(resolve(currentCacheRoot, launcher))).mode & 0o777) !== 0o700) {
            return false;
          }
        }
        return true;
      } catch {
        // An active task may rematerialize the compatible Plugin version it started with.
      }
      if (reportedVersion === expectedVersion || plugin?.enabled !== true) {
        return false;
      }
      const pluginSource =
        plugin?.source !== null && typeof plugin?.source === "object"
          ? (plugin.source as Record<string, unknown>)
          : null;
      const marketplaceSource =
        plugin?.marketplaceSource !== null && typeof plugin?.marketplaceSource === "object"
          ? (plugin.marketplaceSource as Record<string, unknown>)
          : null;
      if (pluginSource?.path !== sourceRoot || marketplaceSource?.source !== marketplaceRoot) {
        return false;
      }
      const legacyCacheRoot = resolve(
        options.codexHomeDirectory,
        "plugins/cache",
        MARKETPLACE_NAME,
        PLUGIN_NAME,
        reportedVersion,
      );
      const [legacyManifest, legacyMcp, legacyHook] = await Promise.all([
        readFile(resolve(legacyCacheRoot, ".codex-plugin/plugin.json"), "utf8"),
        readFile(resolve(legacyCacheRoot, ".mcp.json"), "utf8"),
        readFile(resolve(legacyCacheRoot, "hooks/hooks.json"), "utf8"),
      ]);
      const parsedManifest = JSON.parse(legacyManifest) as {
        name?: string;
        version?: string;
      };
      const hookDocument = JSON.parse(legacyHook) as {
        hooks?: Record<string, Array<{ hooks?: Array<{ command?: unknown }> }>>;
      };
      const hookCommands = Object.values(hookDocument.hooks ?? {}).flatMap((groups) =>
        groups.flatMap((group) => (group.hooks ?? []).map((hook) => hook.command)),
      );
      if (
        parsedManifest.name !== PLUGIN_NAME ||
        parsedManifest.version !== reportedVersion ||
        legacyMcp.includes('"command": "node"') ||
        !legacyMcp.includes('"command": "./bin/goal-progress-mcp"') ||
        hookCommands.length === 0 ||
        hookCommands.some((command) => command !== GOAL_PROGRESS_STABLE_HOOK_COMMAND)
      ) {
        return false;
      }
      for (const launcher of ["bin/goal-progress-mcp", "bin/goal-progress-hook"]) {
        if (((await stat(resolve(legacyCacheRoot, launcher))).mode & 0o777) !== 0o700) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  return {
    async ensure(archivePath, marketplaceRoot, reinstall, expectedTreeManifestSha256) {
      if (!reinstall && (await verifyInstalled(undefined, expectedTreeManifestSha256))) {
        const currentPlugin = pluginList().find(
          (candidate) => candidate.pluginId === PLUGIN_ID && candidate.installed === true,
        );
        await enableInstalledGoalProgressHooks(command, options.codexHomeDirectory);
        if (typeof currentPlugin?.version === "string") {
          await removeStalePluginCaches(currentPlugin.version);
        }
        return false;
      }
      await rm(marketplaceRoot, { recursive: true, force: true });
      await ensurePrivateDirectory(marketplaceRoot);
      const extracted = spawnSync("/usr/bin/ditto", ["-x", "-k", archivePath, marketplaceRoot], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      if (extracted.status !== 0) {
        throw new Error("GOAL_PROGRESS_PLUGIN_EXTRACT_FAILED");
      }
      await assertPluginTreeHasNoSymlinks(marketplaceRoot);
      const pluginRoot = resolve(marketplaceRoot, "plugins", PLUGIN_NAME);
      await verifyPluginTreeManifest(pluginRoot, expectedTreeManifestSha256);
      const [manifest, mcp, hooks] = await Promise.all([
        readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
        readFile(resolve(pluginRoot, ".mcp.json"), "utf8"),
        readFile(resolve(pluginRoot, "hooks/hooks.json"), "utf8"),
      ]);
      const pluginManifest = JSON.parse(manifest) as { name?: string; version?: string };
      if (
        pluginManifest.name !== PLUGIN_NAME ||
        !pluginManifest.version ||
        mcp.includes('"command": "node"') ||
        hooks.includes("trusted_hash")
      ) {
        throw new Error("GOAL_PROGRESS_RELEASE_PLUGIN_INVALID");
      }
      for (const launcher of [
        resolve(pluginRoot, "bin/goal-progress-mcp"),
        resolve(pluginRoot, "bin/goal-progress-hook"),
      ]) {
        await chmod(launcher, 0o700);
      }
      const previousPlugin = pluginList().find(
        (candidate) => candidate.pluginId === PLUGIN_ID && candidate.installed === true,
      );
      const previousVersion =
        typeof previousPlugin?.version === "string" ? previousPlugin.version : null;
      const previousCacheRoot =
        previousVersion && previousVersion !== pluginManifest.version
          ? resolve(
              options.codexHomeDirectory,
              "plugins/cache",
              MARKETPLACE_NAME,
              PLUGIN_NAME,
              previousVersion,
            )
          : null;
      const retainedCacheRoot = previousCacheRoot
        ? resolve(options.codexHomeDirectory, "plugins", `.goal-progress-retained-${randomUUID()}`)
        : null;
      if (previousCacheRoot && retainedCacheRoot) {
        await cp(previousCacheRoot, retainedCacheRoot, {
          recursive: true,
          force: true,
          preserveTimestamps: true,
        });
      }
      let installedCurrentVersion = false;
      try {
        if (previousPlugin) {
          runCodexJson(
            command,
            ["plugin", "remove", PLUGIN_ID, "--json"],
            options.codexHomeDirectory,
          );
        }
        if (hasMarketplace()) {
          runCodexJson(
            command,
            ["plugin", "marketplace", "remove", MARKETPLACE_NAME, "--json"],
            options.codexHomeDirectory,
          );
        }
        runCodexJson(
          command,
          ["plugin", "marketplace", "add", marketplaceRoot, "--json"],
          options.codexHomeDirectory,
        );
        runCodexJson(command, ["plugin", "add", PLUGIN_ID, "--json"], options.codexHomeDirectory);
        if (!(await verifyInstalled(pluginManifest.version, expectedTreeManifestSha256))) {
          throw new Error("GOAL_PROGRESS_PLUGIN_INSTALL_VERIFY_FAILED");
        }
        await enableInstalledGoalProgressHooks(command, options.codexHomeDirectory);
        await removeStalePluginCaches(pluginManifest.version);
        installedCurrentVersion = true;
      } finally {
        if (!installedCurrentVersion && previousCacheRoot && retainedCacheRoot) {
          await cp(retainedCacheRoot, previousCacheRoot, {
            recursive: true,
            force: true,
            preserveTimestamps: true,
          });
        }
        if (retainedCacheRoot) {
          await rm(retainedCacheRoot, { recursive: true, force: true });
        }
      }
      return true;
    },
    async remove() {
      let changed = false;
      await removeInstalledGoalProgressHookState(command, options.codexHomeDirectory);
      if (isInstalled()) {
        runCodexJson(
          command,
          ["plugin", "remove", PLUGIN_ID, "--json"],
          options.codexHomeDirectory,
        );
        changed = true;
      }
      if (hasMarketplace()) {
        runCodexJson(
          command,
          ["plugin", "marketplace", "remove", MARKETPLACE_NAME, "--json"],
          options.codexHomeDirectory,
        );
        changed = true;
      }
      changed = (await removePluginCache()) || changed;
      return changed;
    },
    async verify(releaseVersion, expectedTreeManifestSha256) {
      return verifyInstalled(releaseVersion, expectedTreeManifestSha256);
    },
  };
}
