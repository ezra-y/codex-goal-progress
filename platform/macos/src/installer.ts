import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isSea } from "node:sea";
import {
  GOAL_PROGRESS_IPC_PROTOCOL_VERSION,
  GoalProgressIpcClient,
} from "../../../packages/ipc/src/index.js";
import {
  atomicWriteFile,
  ensurePrivateDirectory,
  type GoalProgressPaths,
  inspectCurrentHelperOwners,
  readCurrentHelperIdentity,
  resolveGoalProgressPaths,
} from "../../../packages/store/src/index.js";
import type {
  MacosCommandHandlers,
  MacosCommandInput,
  MacosCommandName,
  MacosCommandResult,
} from "./command-protocol.js";
import {
  ensureMacosInstallationDirectories,
  GOAL_PROGRESS_LAUNCH_AGENT_LABEL,
  type MacosInstallationLayout,
  resolveMacosInstallationLayout,
} from "./install-layout.js";
import { InstallTransaction } from "./install-transaction.js";
import { assertPluginTreeHasNoSymlinks, verifyPluginTreeManifest } from "./plugin-integrity.js";
import { GOAL_PROGRESS_STABLE_HOOK_COMMAND } from "./plugin-release.js";
import type { MacosReleaseFile } from "./release.js";

const EXPECTED_BUNDLE_ID = "com.openai.codex";
const EXPECTED_TEAM_ID = "2DC432GLL2";
const INSTALL_MANIFEST_SCHEMA_VERSION = 1;
const PLUGIN_ID = "codex-goal-progress@codex-goal-progress-local";
const PLUGIN_NAME = "codex-goal-progress";
const MARKETPLACE_NAME = "codex-goal-progress-local";

interface CodexInstallIdentity {
  readonly realAppPath: string;
  readonly bundleId: string;
  readonly teamId: string;
}

interface ParsedReleaseManifest {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly platform: "darwin";
  readonly arch: "arm64";
  readonly pluginTreeManifestSha256: string;
  readonly runtime: {
    readonly kind: "node-sea";
    readonly nodeVersion: string;
  };
  readonly files: {
    readonly helper: MacosReleaseFile;
    readonly renderer: MacosReleaseFile;
    readonly rendererManifest: MacosReleaseFile;
    readonly pluginArchive: MacosReleaseFile;
    readonly license: MacosReleaseFile;
    readonly readme: MacosReleaseFile;
    readonly installGuide: MacosReleaseFile;
    readonly installCommand: MacosReleaseFile;
    readonly repairCommand: MacosReleaseFile;
    readonly disableCommand: MacosReleaseFile;
    readonly uninstallCommand: MacosReleaseFile;
  };
}

interface InstalledManifest {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly installedAt: string;
  readonly helperSha256: string;
  readonly pluginVersion: string;
  readonly hookSha256: string;
  readonly programReleaseRoot: string;
  readonly currentReleasePath: string;
  readonly launchAgentLabel: string;
  readonly launchAgentPath: string;
  readonly codex: CodexInstallIdentity;
}

export interface LaunchAgentController {
  ensure(label: string, plistPath: string, restart: boolean): Promise<boolean>;
  remove(label: string, plistPath: string): Promise<boolean>;
  isLoaded(label: string): Promise<boolean>;
}

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

export interface CdpController {
  ensure(restartCodex: boolean): Promise<boolean>;
  verify(): Promise<boolean>;
  rollback?(): Promise<void>;
}

export interface HelperHealthInspection {
  readonly ok: boolean;
  readonly socketPathExists: boolean;
  readonly socketIsSocket: boolean;
  readonly socketMode: number | null;
  readonly pingOk: boolean;
  readonly protocolVersion: number | null;
  readonly protocolMatches: boolean;
  readonly pid: number | null;
  readonly identityPid: number | null;
  readonly pidMatches: boolean;
  readonly ownerCount: number;
  readonly singleOwner: boolean;
  readonly storeReadOnly: boolean;
  readonly code: string | null;
}

export type HookTrust = "pending_review" | "verified_by_smoke_test" | "unknown";

interface InstalledHookInspection {
  readonly hashMatchesManifest: boolean;
  readonly stableCommand: boolean;
  readonly userLevelHookAbsent: boolean;
  readonly trustedHashAbsent: boolean;
  readonly hookTrust: HookTrust;
}

interface FileSnapshot {
  readonly exists: boolean;
  readonly contents: string | null;
  readonly mode: number | null;
}

export interface RestoreCdpResult {
  readonly changed: boolean;
  readonly scheduled: boolean;
  readonly restartedCodex: boolean;
}

export interface CreateMacosCommandHandlersOptions {
  readonly homeDirectory: string;
  readonly releaseRoot: string;
  readonly launchAgent?: LaunchAgentController;
  readonly plugin?: PluginController;
  readonly cdp?: CdpController;
  readonly inspectHelper?: (paths: GoalProgressPaths) => Promise<HelperHealthInspection>;
  readonly codexHomeDirectory?: string;
  readonly discoverCodex?: () => Promise<CodexInstallIdentity>;
  readonly restoreCdp?: (restartCodex: boolean) => Promise<RestoreCdpResult>;
  readonly now?: () => Date;
  readonly installFaultForTest?: (
    point:
      | "after-cdp"
      | "after-copy-release"
      | "after-plist"
      | "after-plugin"
      | "after-current"
      | "after-helper"
      | "after-manifest"
      | "before-backup-cleanup",
  ) => void | Promise<void>;
}

function commandResult(
  command: MacosCommandName,
  input: {
    readonly ok: boolean;
    readonly code: string;
    readonly changed: boolean;
    readonly nextStep?: string | null;
    readonly details?: Readonly<Record<string, unknown>>;
  },
): MacosCommandResult {
  return {
    schemaVersion: 1,
    command,
    ok: input.ok,
    code: input.code,
    changed: input.changed,
    nextStep: input.nextStep ?? null,
    details: input.details ?? {},
  };
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function stableErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.trim()
  ) {
    return error.code.slice(0, 128);
  }
  return error instanceof Error ? error.message.slice(0, 128) : "HELPER_INSPECTION_FAILED";
}

const releaseBackupNamePattern =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.rollback-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

async function inspectOrphanReleaseBackups(programReleasesRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(programReleasesRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && releaseBackupNamePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

async function cleanupOrphanReleaseBackups(programReleasesRoot: string): Promise<{
  readonly removed: readonly string[];
  readonly warningCode: string | null;
}> {
  const candidates = await inspectOrphanReleaseBackups(programReleasesRoot).catch(() => []);
  const removed: string[] = [];
  let warningCode: string | null = null;
  for (const name of candidates) {
    const path = resolve(programReleasesRoot, name);
    try {
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        continue;
      }
      await rm(path, { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      if (!isNotFound(error)) {
        warningCode ??= stableErrorCode(error);
      }
    }
  }
  return { removed, warningCode };
}

async function captureFile(path: string): Promise<FileSnapshot> {
  try {
    const [contents, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return {
      exists: true,
      contents,
      mode: metadata.mode & 0o777,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return { exists: false, contents: null, mode: null };
    }
    throw error;
  }
}

async function restoreFile(path: string, snapshot: FileSnapshot): Promise<void> {
  if (!snapshot.exists) {
    await rm(path, { force: true });
    return;
  }
  await atomicWriteFile(path, snapshot.contents ?? "");
  await chmod(path, snapshot.mode ?? 0o600);
}

async function captureLink(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function restoreLink(path: string, target: string | null): Promise<void> {
  if (target === null) {
    await rm(path, { recursive: true, force: true });
    return;
  }
  await replaceCurrentReleaseLink(path, target);
}

async function waitForHelperStopped(paths: GoalProgressPaths): Promise<void> {
  for (const waitMs of [0, 100, 250, 500, 900]) {
    if (waitMs > 0) {
      await delay(waitMs);
    }
    if ((await readCurrentHelperIdentity(paths).catch(() => null)) === null) {
      await rm(paths.helperSocketPath, { force: true });
      return;
    }
  }
  throw new Error("GOAL_PROGRESS_HELPER_STOP_TIMEOUT");
}

export async function inspectInstalledHelper(
  paths: GoalProgressPaths,
): Promise<HelperHealthInspection> {
  let socketPathExists = false;
  let socketIsSocket = false;
  let socketMode: number | null = null;
  try {
    const metadata = await lstat(paths.helperSocketPath);
    socketPathExists = true;
    socketIsSocket = metadata.isSocket();
    socketMode = metadata.mode & 0o777;
  } catch (error) {
    if (!isNotFound(error)) {
      return {
        ok: false,
        socketPathExists: false,
        socketIsSocket: false,
        socketMode: null,
        pingOk: false,
        protocolVersion: null,
        protocolMatches: false,
        pid: null,
        identityPid: null,
        pidMatches: false,
        ownerCount: 0,
        singleOwner: false,
        storeReadOnly: false,
        code: stableErrorCode(error),
      };
    }
  }

  const [identity, owners] = await Promise.all([
    readCurrentHelperIdentity(paths).catch(() => null),
    inspectCurrentHelperOwners(paths).catch(() => []),
  ]);
  let pingOk = false;
  let protocolVersion: number | null = null;
  let protocolMatches = false;
  let pid: number | null = null;
  let instanceId: string | null = null;
  let storeReadOnly = false;
  let code: string | null = socketPathExists ? null : "HELPER_SOCKET_MISSING";
  if (socketIsSocket) {
    const client = new GoalProgressIpcClient(paths.helperSocketPath, {
      clientKind: "doctor",
      timeoutMs: 1_000,
    });
    try {
      const ping = await client.request({ method: "ping", params: {} });
      protocolVersion = ping.protocolVersion;
      protocolMatches = ping.protocolVersion === GOAL_PROGRESS_IPC_PROTOCOL_VERSION;
      const result =
        ping.result !== null && typeof ping.result === "object"
          ? (ping.result as Record<string, unknown>)
          : {};
      pingOk = result.status === "ok" && Number.isInteger(result.pid);
      pid = pingOk ? Number(result.pid) : null;
      instanceId = typeof result.instanceId === "string" ? result.instanceId : null;
      if (!pingOk) {
        code = "HELPER_PING_INVALID";
      } else if (!protocolMatches) {
        code = "PROTOCOL_VERSION_MISMATCH";
      } else {
        const doctor = await client.request({ method: "doctor", params: {} });
        const doctorResult =
          doctor.result !== null && typeof doctor.result === "object"
            ? (doctor.result as Record<string, unknown>)
            : {};
        const storeSmoke =
          doctorResult.storeSmoke !== null && typeof doctorResult.storeSmoke === "object"
            ? (doctorResult.storeSmoke as Record<string, unknown>)
            : {};
        storeReadOnly =
          storeSmoke.checked === true && storeSmoke.readable === true && storeSmoke.code === null;
        if (!storeReadOnly) {
          code = "HELPER_STORE_READ_FAILED";
        }
      }
    } catch (error) {
      code = stableErrorCode(error);
    }
  } else if (socketPathExists) {
    code = "HELPER_SOCKET_INVALID";
  }

  const owner = owners[0];
  const singleOwner =
    owners.length === 1 &&
    identity !== null &&
    owner?.instanceId === identity.instanceId &&
    owner.pid === identity.pid;
  const pidMatches =
    pingOk && identity !== null && pid === identity.pid && instanceId === identity.instanceId;
  const ok =
    socketIsSocket && pingOk && protocolMatches && pidMatches && singleOwner && storeReadOnly;
  if (!code && !pidMatches) {
    code = "HELPER_PID_MISMATCH";
  }
  if (!code && !singleOwner) {
    code = "HELPER_OWNER_INVALID";
  }
  return {
    ok,
    socketPathExists,
    socketIsSocket,
    socketMode,
    pingOk,
    protocolVersion,
    protocolMatches,
    pid,
    identityPid: identity?.pid ?? null,
    pidMatches,
    ownerCount: owners.length,
    singleOwner,
    storeReadOnly,
    code: ok ? null : code,
  };
}

async function inspectInstalledHook(
  homeDirectory: string,
  installed: InstalledManifest,
): Promise<InstalledHookInspection> {
  const hookPath = resolve(
    installed.programReleaseRoot,
    "plugin-marketplace/plugins/codex-goal-progress/hooks/hooks.json",
  );
  const hookText = await readFile(hookPath, "utf8");
  const hookDocument = JSON.parse(hookText) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: unknown }> }>>;
  };
  const commands = Object.values(hookDocument.hooks ?? {}).flatMap((groups) =>
    groups.flatMap((group) => (group.hooks ?? []).map((hook) => hook.command)),
  );
  let userLevelHookAbsent = true;
  try {
    const userHookText = (
      await readFile(resolve(homeDirectory, ".codex/hooks.json"), "utf8")
    ).toLowerCase();
    userLevelHookAbsent =
      !userHookText.includes("goal_progress") &&
      !userHookText.includes("goal-progress") &&
      !userHookText.includes("codexgoalprogress");
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  return {
    hashMatchesManifest: (await fileSha256(hookPath)) === installed.hookSha256,
    stableCommand:
      commands.length > 0 &&
      commands.every((command) => command === GOAL_PROGRESS_STABLE_HOOK_COMMAND),
    userLevelHookAbsent,
    trustedHashAbsent:
      !hookText.includes("trusted_hash") &&
      !Object.hasOwn(hookDocument.hooks ?? {}, "UserPromptSubmit"),
    hookTrust: "pending_review",
  };
}

function assertReleaseFile(file: unknown): asserts file is MacosReleaseFile {
  if (
    file === null ||
    typeof file !== "object" ||
    !("path" in file) ||
    typeof file.path !== "string" ||
    file.path.startsWith("/") ||
    file.path.split("/").includes("..") ||
    !("bytes" in file) ||
    !Number.isSafeInteger(file.bytes) ||
    Number(file.bytes) < 0 ||
    !("sha256" in file) ||
    typeof file.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(file.sha256)
  ) {
    throw new Error("GOAL_PROGRESS_RELEASE_FILE_INVALID");
  }
}

function parseReleaseManifest(input: unknown): ParsedReleaseManifest {
  if (
    input === null ||
    typeof input !== "object" ||
    !("schemaVersion" in input) ||
    input.schemaVersion !== 1 ||
    !("releaseVersion" in input) ||
    typeof input.releaseVersion !== "string" ||
    !("platform" in input) ||
    input.platform !== "darwin" ||
    !("arch" in input) ||
    input.arch !== "arm64" ||
    !("pluginTreeManifestSha256" in input) ||
    typeof input.pluginTreeManifestSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.pluginTreeManifestSha256) ||
    !("runtime" in input) ||
    input.runtime === null ||
    typeof input.runtime !== "object" ||
    !("kind" in input.runtime) ||
    input.runtime.kind !== "node-sea" ||
    !("nodeVersion" in input.runtime) ||
    typeof input.runtime.nodeVersion !== "string" ||
    !("files" in input) ||
    input.files === null ||
    typeof input.files !== "object" ||
    !("helper" in input.files) ||
    !("renderer" in input.files) ||
    !("rendererManifest" in input.files) ||
    !("pluginArchive" in input.files) ||
    !("license" in input.files) ||
    !("readme" in input.files) ||
    !("installGuide" in input.files) ||
    !("installCommand" in input.files) ||
    !("repairCommand" in input.files) ||
    !("disableCommand" in input.files) ||
    !("uninstallCommand" in input.files)
  ) {
    throw new Error("GOAL_PROGRESS_RELEASE_MANIFEST_INVALID");
  }
  assertReleaseFile(input.files.helper);
  assertReleaseFile(input.files.renderer);
  assertReleaseFile(input.files.rendererManifest);
  assertReleaseFile(input.files.pluginArchive);
  assertReleaseFile(input.files.license);
  assertReleaseFile(input.files.readme);
  assertReleaseFile(input.files.installGuide);
  assertReleaseFile(input.files.installCommand);
  assertReleaseFile(input.files.repairCommand);
  assertReleaseFile(input.files.disableCommand);
  assertReleaseFile(input.files.uninstallCommand);
  return input as ParsedReleaseManifest;
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function verifyReleaseFile(root: string, file: MacosReleaseFile): Promise<void> {
  const path = resolve(root, file.path);
  if (!path.startsWith(`${resolve(root)}/`)) {
    throw new Error("GOAL_PROGRESS_RELEASE_FILE_ESCAPE");
  }
  const metadata = await stat(path);
  if (
    !metadata.isFile() ||
    metadata.size !== file.bytes ||
    (await fileSha256(path)) !== file.sha256
  ) {
    throw new Error(`GOAL_PROGRESS_RELEASE_CHECKSUM_MISMATCH: ${file.path}`);
  }
}

async function verifySha256Sums(root: string, expectedFiles: readonly MacosReleaseFile[]) {
  const lines = (await readFile(resolve(root, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean);
  const expected = new Map(expectedFiles.map((file) => [file.path, file.sha256]));
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
    if (!match?.[1] || !match[2] || expected.get(match[2]) !== match[1]) {
      throw new Error("GOAL_PROGRESS_RELEASE_SHA256_MANIFEST_INVALID");
    }
    expected.delete(match[2]);
  }
  if (expected.size !== 0) {
    throw new Error("GOAL_PROGRESS_RELEASE_SHA256_MANIFEST_INCOMPLETE");
  }
}

async function readVerifiedRelease(root: string): Promise<ParsedReleaseManifest> {
  const manifestPath = resolve(root, "manifest.json");
  const manifest = parseReleaseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const manifestFile: MacosReleaseFile = {
    path: "manifest.json",
    bytes: (await stat(manifestPath)).size,
    sha256: await fileSha256(manifestPath),
  };
  const files = Object.values(manifest.files);
  await Promise.all(files.map((file) => verifyReleaseFile(root, file)));
  await verifySha256Sums(root, [...files, manifestFile]);
  return manifest;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function launchAgentPlist(layout: MacosInstallationLayout, codex: CodexInstallIdentity): string {
  const helperPath = resolve(layout.currentReleasePath, "bin/goal-progress");
  const values = {
    label: escapeXml(layout.launchAgentLabel),
    helper: escapeXml(helperPath),
    root: escapeXml(layout.applicationSupportRoot),
    stdout: escapeXml(resolve(layout.logsRoot, "helper.log")),
    stderr: escapeXml(resolve(layout.logsRoot, "helper-error.log")),
    codexCommand: escapeXml(resolve(codex.realAppPath, "Contents/Resources/codex")),
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${values.label}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${values.helper}</string>`,
    "    <string>serve</string>",
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>GOAL_PROGRESS_ROOT</key>",
    `    <string>${values.root}</string>`,
    "    <key>GOAL_PROGRESS_CODEX_COMMAND</key>",
    `    <string>${values.codexCommand}</string>`,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${values.stdout}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${values.stderr}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

async function writeIfChanged(path: string, contents: string): Promise<boolean> {
  try {
    if ((await readFile(path, "utf8")) === contents) {
      return false;
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  await atomicWriteFile(path, contents);
  return true;
}

async function replaceCurrentReleaseLink(currentPath: string, releasePath: string): Promise<void> {
  const temporaryPath = `${currentPath}.${process.pid}.new`;
  await unlink(temporaryPath).catch((error) => {
    if (!isNotFound(error)) {
      throw error;
    }
  });
  try {
    await symlink(releasePath, temporaryPath, "dir");
    try {
      const metadata = await lstat(currentPath);
      if (!metadata.isSymbolicLink()) {
        throw new Error("GOAL_PROGRESS_CURRENT_RELEASE_NOT_SYMLINK");
      }
      await unlink(currentPath);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
    await rename(temporaryPath, currentPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readInstalledManifest(path: string): Promise<InstalledManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as InstalledManifest;
    return parsed.schemaVersion === INSTALL_MANIFEST_SCHEMA_VERSION ? parsed : null;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function currentLinkMatches(layout: MacosInstallationLayout): Promise<boolean> {
  try {
    return (await readlink(layout.currentReleasePath)) === layout.programReleaseRoot;
  } catch {
    return false;
  }
}

async function installedReleaseMatches(
  layout: MacosInstallationLayout,
  release: ParsedReleaseManifest,
): Promise<boolean> {
  try {
    const installedRelease = await readVerifiedRelease(layout.programReleaseRoot);
    const installedFiles = Object.values(installedRelease.files).sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const candidateFiles = Object.values(release.files).sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    return (
      installedRelease.releaseVersion === release.releaseVersion &&
      installedFiles.length === candidateFiles.length &&
      installedFiles.every((installedFile, index) => {
        const candidateFile = candidateFiles[index];
        return (
          candidateFile !== undefined &&
          installedFile.path === candidateFile.path &&
          installedFile.bytes === candidateFile.bytes &&
          installedFile.sha256 === candidateFile.sha256
        );
      })
    );
  } catch {
    return false;
  }
}

async function copyRelease(
  sourceRoot: string,
  layout: MacosInstallationLayout,
  manifest: ParsedReleaseManifest,
): Promise<void> {
  await ensureMacosInstallationDirectories(layout);
  const files = [
    ...Object.values(manifest.files),
    { path: "manifest.json" },
    { path: "SHA256SUMS" },
  ];
  for (const file of files) {
    const source = resolve(sourceRoot, file.path);
    const destination = resolve(layout.programReleaseRoot, file.path);
    await ensurePrivateDirectory(dirname(destination));
    await copyFile(source, destination);
    await chmod(
      destination,
      file.path === manifest.files.helper.path ||
        file.path === manifest.files.installCommand.path ||
        file.path === manifest.files.repairCommand.path ||
        file.path === manifest.files.disableCommand.path ||
        file.path === manifest.files.uninstallCommand.path
        ? 0o700
        : 0o600,
    );
  }
}

function validateCodexIdentity(identity: CodexInstallIdentity): void {
  if (
    identity.bundleId !== EXPECTED_BUNDLE_ID ||
    identity.teamId !== EXPECTED_TEAM_ID ||
    !identity.realAppPath.endsWith(".app")
  ) {
    throw new Error("GOAL_PROGRESS_CODEX_IDENTITY_INVALID");
  }
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

function runLaunchctl(args: readonly string[]): { readonly status: number } {
  const result = spawnSync("/bin/launchctl", [...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return { status: result.status ?? 1 };
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
    const plugin = pluginList().find(
      (candidate) =>
        candidate.pluginId === PLUGIN_ID &&
        candidate.installed === true &&
        (releaseVersion === undefined || candidate.version === releaseVersion),
    );
    const version = typeof plugin?.version === "string" ? plugin.version : null;
    const marketplace = marketplaceList().find((candidate) => candidate.name === MARKETPLACE_NAME);
    const marketplaceRoot = typeof marketplace?.root === "string" ? marketplace.root : null;
    if (!version || !marketplaceRoot) {
      return false;
    }
    const sourceRoot = resolve(marketplaceRoot, "plugins", PLUGIN_NAME);
    const cacheRoot = resolve(
      options.codexHomeDirectory,
      "plugins/cache",
      MARKETPLACE_NAME,
      PLUGIN_NAME,
      version,
    );
    try {
      await Promise.all([
        verifyPluginTreeManifest(sourceRoot, expectedTreeManifestSha256),
        verifyPluginTreeManifest(cacheRoot, expectedTreeManifestSha256),
      ]);
      const [sourceManifest, cacheManifest, sourceMcp, cacheMcp, sourceHook, cacheHook] =
        await Promise.all([
          readFile(resolve(sourceRoot, ".codex-plugin/plugin.json"), "utf8"),
          readFile(resolve(cacheRoot, ".codex-plugin/plugin.json"), "utf8"),
          readFile(resolve(sourceRoot, ".mcp.json"), "utf8"),
          readFile(resolve(cacheRoot, ".mcp.json"), "utf8"),
          fileSha256(resolve(sourceRoot, "hooks/hooks.json")),
          fileSha256(resolve(cacheRoot, "hooks/hooks.json")),
        ]);
      const parsedManifest = JSON.parse(cacheManifest) as {
        name?: string;
        version?: string;
      };
      if (
        sourceManifest !== cacheManifest ||
        sourceMcp !== cacheMcp ||
        parsedManifest.name !== PLUGIN_NAME ||
        parsedManifest.version !== version ||
        cacheMcp.includes('"command": "node"') ||
        sourceHook !== cacheHook
      ) {
        return false;
      }
      for (const launcher of ["bin/goal-progress-mcp", "bin/goal-progress-hook"]) {
        if (((await stat(resolve(cacheRoot, launcher))).mode & 0o777) !== 0o700) {
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
      try {
        if (previousPlugin) {
          runCodexJson(
            command,
            ["plugin", "remove", PLUGIN_ID, "--json"],
            options.codexHomeDirectory,
          );
          if (previousCacheRoot && retainedCacheRoot) {
            await cp(retainedCacheRoot, previousCacheRoot, {
              recursive: true,
              force: true,
              preserveTimestamps: true,
            });
          }
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
      } finally {
        if (previousCacheRoot && retainedCacheRoot) {
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
      return changed;
    },
    async verify(releaseVersion, expectedTreeManifestSha256) {
      return verifyInstalled(releaseVersion, expectedTreeManifestSha256);
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export const GOAL_PROGRESS_CDP_HANDOFF_COMMAND = "__cdp-handoff";
export const GOAL_PROGRESS_CDP_SCHEDULE_COMMAND = "__cdp-schedule";
export const GOAL_PROGRESS_RESTORE_HANDOFF_COMMAND = "__restore-handoff";
const GOAL_PROGRESS_LEGACY_CDP_HANDOFF_LABEL = "com.codexgoalprogress.cdp-handoff";
const GOAL_PROGRESS_LEGACY_RESTORE_HANDOFF_LABEL = "com.codexgoalprogress.restore-handoff";
export const GOAL_PROGRESS_CDP_HANDOFF_LABEL = "com.codexgoalprogress.cdp-handoff-v2";
export const GOAL_PROGRESS_RESTORE_HANDOFF_LABEL = "com.codexgoalprogress.restore-handoff-v2";

export function decideCodexCdpRestart(input: {
  readonly cdpReady: boolean;
  readonly restartRequested: boolean;
  readonly handoffProcess: boolean;
}): "skip" | "schedule" | "run" {
  if (!input.restartRequested || (input.cdpReady && !input.handoffProcess)) {
    return "skip";
  }
  return input.handoffProcess ? "run" : "schedule";
}

export function createCodexNormalRelaunchInvocation(appPath: string) {
  return {
    command: "/usr/bin/open",
    args: ["-n", appPath],
  };
}

async function reopenCodexNormally(appPath: string): Promise<void> {
  const invocation = createCodexNormalRelaunchInvocation(appPath);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("GOAL_PROGRESS_CODEX_FALLBACK_RESTART_FAILED");
  }
}

export async function runCdpRestartWithFallback<Value>(
  run: () => Promise<Value>,
  reopen?: () => Promise<void>,
): Promise<Value> {
  try {
    return await run();
  } catch (error) {
    if (reopen) {
      try {
        await reopen();
      } catch (reopenError) {
        throw new Error(
          `GOAL_PROGRESS_CODEX_FALLBACK_RESTART_FAILED: original=${stableErrorCode(
            error,
          )}; fallback=${stableErrorCode(reopenError)}`,
        );
      }
    }
    throw error;
  }
}

export async function recordCdpHandoffFailure(
  homeDirectory: string,
  error: unknown,
  observedAt = new Date(),
): Promise<void> {
  const candidate = stableErrorCode(error);
  const code = /^([A-Z][A-Z0-9_]{2,127})/u.exec(candidate)?.[1] ?? "CDP_HANDOFF_FAILED";
  const paths = resolveGoalProgressPaths({
    platform: "darwin",
    homeDirectory,
  });
  await ensurePrivateDirectory(paths.logsRoot);
  await atomicWriteFile(
    resolve(paths.logsRoot, "cdp-handoff-error.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        observedAt: observedAt.toISOString(),
        code,
      },
      null,
      2,
    )}\n`,
  );
}

interface CreateCodexCdpHandoffInvocationInput {
  readonly execPath: string;
  readonly argvEntry: string;
  readonly execArgv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly sea?: boolean;
}

function handoffProgramArgs(
  input: CreateCodexCdpHandoffInvocationInput,
  command: string,
): readonly string[] {
  return (input.sea ?? input.argvEntry === input.execPath)
    ? [input.execPath, command]
    : [input.execPath, ...input.execArgv, input.argvEntry, command];
}

function createLaunchctlHandoffInvocation(
  input: CreateCodexCdpHandoffInvocationInput,
  label: string,
  command: string,
  environment: Readonly<Record<string, string>>,
) {
  const homeDirectory = input.environment.HOME;
  if (!homeDirectory) {
    throw new Error("GOAL_PROGRESS_HOME_DIRECTORY_MISSING");
  }
  return {
    label,
    command: "/bin/launchctl",
    removeArgs: ["remove", label],
    args: [
      "submit",
      "-l",
      label,
      "--",
      "/usr/bin/env",
      `HOME=${homeDirectory}`,
      ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      ...handoffProgramArgs(input, command),
    ],
    options: {
      shell: false as const,
      stdio: "ignore" as const,
      env: input.environment,
    },
  };
}

export function createCodexCdpHandoffInvocation(input: CreateCodexCdpHandoffInvocationInput) {
  return createLaunchctlHandoffInvocation(
    input,
    GOAL_PROGRESS_CDP_HANDOFF_LABEL,
    GOAL_PROGRESS_CDP_HANDOFF_COMMAND,
    {
      GOAL_PROGRESS_INTERNAL_CDP_HANDOFF: "1",
    },
  );
}

interface CreateCodexRestoreHandoffInvocationInput extends CreateCodexCdpHandoffInvocationInput {
  readonly restartCodex: boolean;
}

export function createCodexRestoreHandoffInvocation(
  input: CreateCodexRestoreHandoffInvocationInput,
) {
  return createLaunchctlHandoffInvocation(
    input,
    GOAL_PROGRESS_RESTORE_HANDOFF_LABEL,
    GOAL_PROGRESS_RESTORE_HANDOFF_COMMAND,
    {
      GOAL_PROGRESS_INTERNAL_RESTORE_HANDOFF: "1",
      GOAL_PROGRESS_RESTORE_RESTART_CODEX: input.restartCodex ? "1" : "0",
    },
  );
}

function submitCodexHandoff(invocation: ReturnType<typeof createCodexCdpHandoffInvocation>): void {
  spawnSync(invocation.command, invocation.removeArgs, invocation.options);
  const submitted = spawnSync(invocation.command, invocation.args, invocation.options);
  if (submitted.status !== 0) {
    throw new Error("GOAL_PROGRESS_CODEX_HANDOFF_SUBMIT_FAILED");
  }
}

function removeSubmittedHandoffJobs(currentLabel: string): void {
  for (const label of [
    GOAL_PROGRESS_LEGACY_CDP_HANDOFF_LABEL,
    GOAL_PROGRESS_LEGACY_RESTORE_HANDOFF_LABEL,
    currentLabel,
  ]) {
    spawnSync("/bin/launchctl", ["remove", label], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
  }
}

export async function scheduleCodexCdpHandoff(): Promise<void> {
  const invocation = createCodexCdpHandoffInvocation({
    execPath: process.execPath,
    argvEntry: process.argv[1] ?? process.execPath,
    execArgv: process.execArgv,
    environment: process.env,
    sea: isSea(),
  });
  submitCodexHandoff(invocation);
}

async function scheduleCodexRestoreHandoff(restartCodex: boolean): Promise<void> {
  const invocation = createCodexRestoreHandoffInvocation({
    execPath: process.execPath,
    argvEntry: process.argv[1] ?? process.execPath,
    execArgv: process.execArgv,
    environment: process.env,
    sea: isSea(),
    restartCodex,
  });
  submitCodexHandoff(invocation);
}

export async function runCodexCdpHandoff(homeDirectory: string): Promise<void> {
  if (process.env.GOAL_PROGRESS_INTERNAL_CDP_HANDOFF !== "1") {
    throw new Error("GOAL_PROGRESS_CDP_HANDOFF_UNAUTHORIZED");
  }
  await delay(750);
  const controller = createCdpController(homeDirectory);
  try {
    await controller.ensure(true);
    if (!(await controller.verify())) {
      throw new Error("GOAL_PROGRESS_CDP_HANDOFF_VERIFY_FAILED");
    }
  } catch (error) {
    await recordCdpHandoffFailure(homeDirectory, error).catch(() => undefined);
    throw error;
  } finally {
    removeSubmittedHandoffJobs(GOAL_PROGRESS_CDP_HANDOFF_LABEL);
  }
}

export function createCdpController(homeDirectory: string): CdpController {
  const paths = resolveGoalProgressPaths({
    platform: "darwin",
    homeDirectory,
  });

  const verify = async (): Promise<boolean> => {
    const { inspectCodexMacosApp, readCodexCdpRuntimeState, verifyCodexCdpListenerOwnership } =
      await import("./index.js");
    let state: Awaited<ReturnType<typeof readCodexCdpRuntimeState>>;
    try {
      state = await readCodexCdpRuntimeState(paths.cdpRuntimePath);
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
    const app = await inspectCodexMacosApp(state.appPath);
    if (
      app.realExecutablePath !== state.executablePath ||
      app.bundleId !== state.bundleId ||
      app.teamId !== state.teamId
    ) {
      throw new Error("GOAL_PROGRESS_CDP_RUNTIME_APP_MISMATCH");
    }
    try {
      await verifyCodexCdpListenerOwnership(app, state.mainPid, state.port);
      const { discoverCodexCdp } = await import("../../../packages/codex-adapter/src/cdp.js");
      await discoverCodexCdp(state.port);
      return true;
    } catch {
      return false;
    }
  };

  return {
    verify,
    async rollback() {
      await restoreCdpInstallation(homeDirectory, true, false);
    },
    async ensure(restartCodex) {
      const decision = decideCodexCdpRestart({
        cdpReady: await verify(),
        restartRequested: restartCodex,
        handoffProcess: process.env.GOAL_PROGRESS_INTERNAL_CDP_HANDOFF === "1",
      });
      if (decision === "skip") {
        return false;
      }
      if (decision === "schedule") {
        await scheduleCodexCdpHandoff();
        return true;
      }
      const {
        allocateRandomLoopbackPort,
        commandBelongsToExecutable,
        createCodexCdpRuntimeState,
        inspectProcess,
        launchCodexWithCdp,
        requireSingleCodexMacosApp,
        runSystemCommand,
        stopLaunchedCodexCdpProcess,
        waitForCodexCdpListenerOwnership,
        writeCodexCdpRuntimeState,
      } = await import("./index.js");
      const app = await requireSingleCodexMacosApp();
      const processList = await runSystemCommand("/bin/ps", ["-axo", "pid=,command="]);
      if (processList.exitCode !== 0) {
        throw new Error("GOAL_PROGRESS_CODEX_PROCESS_LIST_FAILED");
      }
      const running: Array<Awaited<ReturnType<typeof inspectProcess>>> = [];
      for (const line of processList.stdout.split(/\r?\n/u)) {
        const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
        const pid = Number(match?.[1]);
        if (
          Number.isSafeInteger(pid) &&
          pid > 1 &&
          match?.[2] &&
          commandBelongsToExecutable(match[2].trim(), app.realExecutablePath)
        ) {
          running.push(await inspectProcess(pid));
        }
      }
      if (running.length > 1) {
        throw new Error(`GOAL_PROGRESS_CODEX_MAIN_PROCESS_AMBIGUOUS: count=${running.length}`);
      }
      const original = running[0];
      if (original) {
        process.kill(original.pid, "SIGTERM");
        const timeoutAt = Date.now() + 15_000;
        while (Date.now() < timeoutAt) {
          try {
            const current = await inspectProcess(original.pid);
            if (current.startedAt !== original.startedAt) {
              break;
            }
          } catch {
            break;
          }
          await delay(100);
        }
        try {
          const current = await inspectProcess(original.pid);
          if (current.startedAt === original.startedAt) {
            throw new Error("GOAL_PROGRESS_CODEX_CURRENT_PROCESS_STOP_TIMEOUT");
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "GOAL_PROGRESS_CODEX_CURRENT_PROCESS_STOP_TIMEOUT"
          ) {
            throw error;
          }
        }
      }
      return runCdpRestartWithFallback(
        async () => {
          const appMetadataBefore = await stat(app.realAppPath);
          const port = await allocateRandomLoopbackPort();
          let launched: Awaited<ReturnType<typeof launchCodexWithCdp>> | undefined;
          try {
            launched = await launchCodexWithCdp(app, { port });
            const ownership = await waitForCodexCdpListenerOwnership(app, launched.pid, port);
            const state = createCodexCdpRuntimeState(app, launched, ownership, port);
            await writeCodexCdpRuntimeState(paths.cdpRuntimePath, state);
            const appMetadataAfter = await stat(app.realAppPath);
            if (
              appMetadataAfter.mtimeMs !== appMetadataBefore.mtimeMs ||
              appMetadataAfter.size !== appMetadataBefore.size
            ) {
              throw new Error("GOAL_PROGRESS_CODEX_APP_MODIFIED");
            }
            launched.child.unref();
            restartLoadedLaunchAgent(GOAL_PROGRESS_LAUNCH_AGENT_LABEL);
            return true;
          } catch (error) {
            if (launched) {
              await stopLaunchedCodexCdpProcess(app, launched, port).catch(() => undefined);
            }
            throw error;
          }
        },
        original ? () => reopenCodexNormally(app.realAppPath) : undefined,
      );
    },
  };
}

function launchDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error("GOAL_PROGRESS_LAUNCHD_UID_UNAVAILABLE");
  }
  return `gui/${uid}`;
}

export function restartLoadedLaunchAgent(
  label: string,
  runner: (args: readonly string[]) => { readonly status: number } = runLaunchctl,
): boolean {
  const service = `${launchDomain()}/${label}`;
  if (runner(["print", service]).status !== 0) {
    return false;
  }
  if (runner(["kickstart", "-k", service]).status !== 0) {
    throw new Error("GOAL_PROGRESS_LAUNCHD_KICKSTART_FAILED");
  }
  return true;
}

export function createLaunchAgentController(
  runner: (args: readonly string[]) => { readonly status: number } = runLaunchctl,
  wait: (milliseconds: number) => Promise<void> = delay,
): LaunchAgentController {
  return {
    async isLoaded(label) {
      return runner(["print", `${launchDomain()}/${label}`]).status === 0;
    },
    async ensure(label, plistPath, restart) {
      const loaded = await this.isLoaded(label);
      if (loaded && !restart) {
        return false;
      }
      if (loaded) {
        if (runner(["bootout", `${launchDomain()}/${label}`]).status !== 0) {
          throw new Error("GOAL_PROGRESS_LAUNCHD_BOOTOUT_FAILED");
        }
      }
      let bootstrapped = false;
      for (const retryDelayMs of [0, 100, 500, 1000, 2000, 4000]) {
        if (retryDelayMs > 0) {
          await wait(retryDelayMs);
        }
        if (runner(["bootstrap", launchDomain(), plistPath]).status === 0) {
          bootstrapped = true;
          break;
        }
      }
      if (!bootstrapped) {
        throw new Error("GOAL_PROGRESS_LAUNCHD_BOOTSTRAP_FAILED");
      }
      return true;
    },
    async remove(label) {
      if (!(await this.isLoaded(label))) {
        return false;
      }
      if (runner(["bootout", `${launchDomain()}/${label}`]).status !== 0) {
        throw new Error("GOAL_PROGRESS_LAUNCHD_BOOTOUT_FAILED");
      }
      return true;
    },
  };
}

async function restoreCdpInstallation(
  homeDirectory: string,
  restartCodex: boolean,
  allowSchedule: boolean,
): Promise<RestoreCdpResult> {
  const paths = resolveGoalProgressPaths({
    platform: "darwin",
    homeDirectory,
  });
  const { inspectCodexMacosApp, readCodexCdpRuntimeState, stopCodexCdpRuntime } = await import(
    "./index.js"
  );
  let state: Awaited<ReturnType<typeof readCodexCdpRuntimeState>>;
  try {
    state = await readCodexCdpRuntimeState(paths.cdpRuntimePath);
  } catch (error) {
    if (isNotFound(error)) {
      return { changed: false, scheduled: false, restartedCodex: false };
    }
    throw error;
  }
  if (allowSchedule && process.env.GOAL_PROGRESS_INTERNAL_RESTORE_HANDOFF !== "1") {
    await scheduleCodexRestoreHandoff(restartCodex);
    return { changed: true, scheduled: true, restartedCodex: false };
  }
  const app = await inspectCodexMacosApp(state.appPath);
  if (
    app.realExecutablePath !== state.executablePath ||
    app.bundleId !== state.bundleId ||
    app.teamId !== state.teamId
  ) {
    throw new Error("GOAL_PROGRESS_CDP_RUNTIME_APP_MISMATCH");
  }
  await stopCodexCdpRuntime(state);
  await unlink(paths.cdpRuntimePath);
  if (restartCodex) {
    const opened = spawnSync("/usr/bin/open", [app.realAppPath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (opened.status !== 0) {
      throw new Error("GOAL_PROGRESS_CODEX_RESTART_FAILED");
    }
  }
  return {
    changed: true,
    scheduled: false,
    restartedCodex: restartCodex,
  };
}

function createDefaultRestoreCdp(homeDirectory: string) {
  return (restartCodex: boolean): Promise<RestoreCdpResult> =>
    restoreCdpInstallation(homeDirectory, restartCodex, true);
}

export async function runCodexRestoreHandoff(homeDirectory: string): Promise<void> {
  if (process.env.GOAL_PROGRESS_INTERNAL_RESTORE_HANDOFF !== "1") {
    throw new Error("GOAL_PROGRESS_RESTORE_HANDOFF_UNAUTHORIZED");
  }
  await delay(750);
  try {
    const result = await createDefaultRestoreCdp(homeDirectory)(
      process.env.GOAL_PROGRESS_RESTORE_RESTART_CODEX === "1",
    );
    if (!result.changed || result.scheduled) {
      throw new Error("GOAL_PROGRESS_RESTORE_HANDOFF_FAILED");
    }
  } finally {
    removeSubmittedHandoffJobs(GOAL_PROGRESS_RESTORE_HANDOFF_LABEL);
  }
}

export function createMacosCommandHandlers(
  options: CreateMacosCommandHandlersOptions,
): MacosCommandHandlers {
  const launchAgent = options.launchAgent ?? createLaunchAgentController();
  const pluginFor = async (codex: CodexInstallIdentity): Promise<PluginController> =>
    options.plugin ??
    createPluginController({
      codexHomeDirectory: options.codexHomeDirectory ?? resolve(options.homeDirectory, ".codex"),
      codexCommand: await resolveVerifiedCodexCli(codex),
    });
  const cdp = options.cdp ?? createCdpController(options.homeDirectory);
  const inspectHelper = options.inspectHelper ?? inspectInstalledHelper;
  const goalPaths = resolveGoalProgressPaths({
    platform: "darwin",
    homeDirectory: options.homeDirectory,
  });
  const discoverCodex =
    options.discoverCodex ??
    (async () => {
      const { requireSingleCodexMacosApp } = await import("./index.js");
      const app = await requireSingleCodexMacosApp();
      return {
        realAppPath: app.realAppPath,
        bundleId: app.bundleId,
        teamId: app.teamId,
      };
    });
  const now = options.now ?? (() => new Date());
  const restoreCdp = options.restoreCdp ?? createDefaultRestoreCdp(options.homeDirectory);

  const installOrUpgrade = async (
    command: "install" | "upgrade",
    input: MacosCommandInput,
  ): Promise<MacosCommandResult> => {
    const release = await readVerifiedRelease(options.releaseRoot);
    const layout = resolveMacosInstallationLayout({
      homeDirectory: options.homeDirectory,
      releaseVersion: release.releaseVersion,
    });
    const cleanupBeforeInstall = await cleanupOrphanReleaseBackups(layout.programReleasesRoot);
    const codex = await discoverCodex();
    validateCodexIdentity(codex);
    const plugin = await pluginFor(codex);
    const installed = await readInstalledManifest(layout.installManifestPath);
    const installedRelease = installed
      ? await readVerifiedRelease(installed.programReleaseRoot).catch(() => null)
      : null;
    const transaction = new InstallTransaction();
    const alreadyCurrent =
      installed?.releaseVersion === release.releaseVersion &&
      installed.helperSha256 === release.files.helper.sha256 &&
      installed.pluginVersion === release.releaseVersion &&
      /^[0-9a-f]{64}$/u.test(installed.hookSha256) &&
      (await currentLinkMatches(layout)) &&
      (await installedReleaseMatches(layout, release));
    const currentTarget = await captureLink(layout.currentReleasePath);
    const plistSnapshot = await captureFile(layout.launchAgentPath);
    const manifestSnapshot = await captureFile(layout.installManifestPath);
    const helperJobWasLoaded = await launchAgent.isLoaded(layout.launchAgentLabel);
    const pluginWasHealthy =
      installed !== null &&
      installedRelease !== null &&
      (await plugin
        .verify(installed.releaseVersion, installedRelease.pluginTreeManifestSha256)
        .catch(() => false));
    const releaseBackupPath = `${layout.programReleaseRoot}.rollback-${randomUUID()}`;
    let releaseBackupCreated = false;
    try {
      const cdpInitiallyReady = await cdp.verify();
      const cdpChanged = await transaction.step(
        "ensure-cdp",
        async () => {
          if (cdpInitiallyReady || !input.restartCodex) {
            return { changed: false, value: false };
          }
          const changed = await cdp.ensure(true);
          await options.installFaultForTest?.("after-cdp");
          return { changed, value: changed };
        },
        async () => {
          if (cdp.rollback) {
            await cdp.rollback();
            return;
          }
          const restored = await restoreCdp(true);
          if (restored.scheduled) {
            throw new Error("GOAL_PROGRESS_CDP_ROLLBACK_PENDING");
          }
        },
      );
      const cdpReady = await cdp.verify();
      if (!cdpReady) {
        transaction.commit();
        return commandResult(command, {
          ok: true,
          code: input.restartCodex ? "INSTALL_RESTART_PENDING" : "INSTALL_RESTART_REQUIRED",
          changed: cdpChanged,
          nextStep: input.restartCodex
            ? "After Codex reopens, run install --json again."
            : `After the user confirms a Codex restart, run ${command} --json --restart-codex.`,
          details: {
            releaseVersion: release.releaseVersion,
            cdpReady: false,
            restartScheduled: cdpChanged,
            states: ["pending_restart"],
            partialState: transaction.partialState,
          },
        });
      }

      await transaction.step(
        "copy-release",
        async () => {
          if (alreadyCurrent) {
            return { changed: false, value: undefined };
          }
          try {
            await lstat(layout.programReleaseRoot);
            await rm(releaseBackupPath, { recursive: true, force: true });
            await rename(layout.programReleaseRoot, releaseBackupPath);
            releaseBackupCreated = true;
          } catch (error) {
            if (!isNotFound(error)) {
              throw error;
            }
          }
          await copyRelease(options.releaseRoot, layout, release);
          await readVerifiedRelease(layout.programReleaseRoot);
          const helperPath = resolve(layout.programReleaseRoot, release.files.helper.path);
          if (((await stat(helperPath)).mode & 0o777) !== 0o700) {
            throw new Error("GOAL_PROGRESS_HELPER_PERMISSION_INVALID");
          }
          await access(helperPath, constants.X_OK);
          await options.installFaultForTest?.("after-copy-release");
          return { changed: true, value: undefined };
        },
        async () => {
          if (alreadyCurrent) {
            return;
          }
          await rm(layout.programReleaseRoot, { recursive: true, force: true });
          if (releaseBackupCreated) {
            await rename(releaseBackupPath, layout.programReleaseRoot);
            releaseBackupCreated = false;
          }
        },
      );

      const plistChanged = await transaction.step(
        "write-launchd-plist",
        async () => {
          const changed = await writeIfChanged(
            layout.launchAgentPath,
            launchAgentPlist(layout, codex),
          );
          await options.installFaultForTest?.("after-plist");
          return { changed, value: changed };
        },
        async () => restoreFile(layout.launchAgentPath, plistSnapshot),
      );

      await transaction.step(
        "install-plugin",
        async () => {
          const changed = await plugin.ensure(
            resolve(layout.programReleaseRoot, release.files.pluginArchive.path),
            resolve(layout.programReleaseRoot, "plugin-marketplace"),
            !alreadyCurrent,
            release.pluginTreeManifestSha256,
          );
          await options.installFaultForTest?.("after-plugin");
          return { changed, value: undefined };
        },
        async () => {
          if (!pluginWasHealthy || !installed || !installedRelease) {
            await plugin.remove();
            return;
          }
          const oldReleaseRoot =
            installed.programReleaseRoot === layout.programReleaseRoot && releaseBackupCreated
              ? releaseBackupPath
              : installed.programReleaseRoot;
          await plugin.ensure(
            resolve(oldReleaseRoot, "plugin-marketplace.zip"),
            resolve(
              installed.programReleaseRoot === layout.programReleaseRoot
                ? layout.programReleaseRoot
                : installed.programReleaseRoot,
              "plugin-marketplace",
            ),
            true,
            installedRelease.pluginTreeManifestSha256,
          );
        },
      );

      await transaction.step(
        "switch-current",
        async () => {
          if (alreadyCurrent) {
            return { changed: false, value: undefined };
          }
          await replaceCurrentReleaseLink(layout.currentReleasePath, layout.programReleaseRoot);
          await options.installFaultForTest?.("after-current");
          return { changed: true, value: undefined };
        },
        async () => restoreLink(layout.currentReleasePath, currentTarget),
      );

      await transaction.step(
        "start-helper",
        async () => {
          const changed = await launchAgent.ensure(
            layout.launchAgentLabel,
            layout.launchAgentPath,
            !alreadyCurrent || plistChanged,
          );
          await options.installFaultForTest?.("after-helper");
          return { changed, value: undefined };
        },
        async () => {
          await restoreFile(layout.launchAgentPath, plistSnapshot);
          if (helperJobWasLoaded) {
            await launchAgent.ensure(layout.launchAgentLabel, layout.launchAgentPath, true);
          } else {
            await launchAgent.remove(layout.launchAgentLabel, layout.launchAgentPath);
          }
        },
      );

      const hookSha256 = await fileSha256(
        resolve(
          layout.programReleaseRoot,
          "plugin-marketplace/plugins/codex-goal-progress/hooks/hooks.json",
        ),
      );
      const installManifest: InstalledManifest = {
        schemaVersion: 1,
        releaseVersion: release.releaseVersion,
        installedAt: alreadyCurrent && installed ? installed.installedAt : now().toISOString(),
        helperSha256: release.files.helper.sha256,
        pluginVersion: release.releaseVersion,
        hookSha256,
        programReleaseRoot: layout.programReleaseRoot,
        currentReleasePath: layout.currentReleasePath,
        launchAgentLabel: layout.launchAgentLabel,
        launchAgentPath: layout.launchAgentPath,
        codex,
      };

      await transaction.step(
        "doctor",
        async () => {
          let helper: HelperHealthInspection | null = null;
          for (const waitMs of [0, 100, 250, 500, 900, 1_800, 4_000]) {
            if (waitMs > 0) {
              await delay(waitMs);
            }
            helper = await inspectHelper(goalPaths);
            if (helper.ok) {
              break;
            }
          }
          const [jobLoaded, pluginInstalled, hook, cdpReadyNow] = await Promise.all([
            launchAgent.isLoaded(layout.launchAgentLabel),
            plugin.verify(release.releaseVersion, release.pluginTreeManifestSha256),
            inspectInstalledHook(options.homeDirectory, installManifest),
            cdp.verify(),
          ]);
          if (
            !jobLoaded ||
            !helper?.ok ||
            !pluginInstalled ||
            !hook.hashMatchesManifest ||
            !hook.stableCommand ||
            !hook.userLevelHookAbsent ||
            !hook.trustedHashAbsent ||
            !cdpReadyNow
          ) {
            throw new Error("GOAL_PROGRESS_INSTALL_DOCTOR_FAILED");
          }
          return { changed: false, value: undefined };
        },
        async () => undefined,
      );

      await transaction.step(
        "verify",
        async () => {
          await readVerifiedRelease(layout.programReleaseRoot);
          if (
            ((await stat(layout.launchAgentPath)).mode & 0o777) !== 0o600 ||
            ((await stat(resolve(layout.programReleaseRoot, release.files.helper.path))).mode &
              0o777) !==
              0o700
          ) {
            throw new Error("GOAL_PROGRESS_INSTALL_VERIFY_FAILED");
          }
          return { changed: false, value: undefined };
        },
        async () => undefined,
      );

      await transaction.step(
        "write-manifest",
        async () => {
          const changed = await writeIfChanged(
            layout.installManifestPath,
            `${JSON.stringify(installManifest, null, 2)}\n`,
          );
          await options.installFaultForTest?.("after-manifest");
          return { changed, value: undefined };
        },
        async () => restoreFile(layout.installManifestPath, manifestSnapshot),
      );
      transaction.commit();
      let cleanupWarningCode = cleanupBeforeInstall.warningCode;
      if (releaseBackupCreated) {
        try {
          await options.installFaultForTest?.("before-backup-cleanup");
          await rm(releaseBackupPath, { recursive: true, force: true });
          releaseBackupCreated = false;
        } catch (error) {
          cleanupWarningCode ??= stableErrorCode(error);
        }
      }
      const cleanupBackups = await inspectOrphanReleaseBackups(layout.programReleasesRoot).catch(
        () => (releaseBackupCreated ? [basename(releaseBackupPath)] : []),
      );
      const cleanupPending = cleanupBackups.length > 0;
      const changed =
        transaction.partialState.changedSteps.length > 0 || cleanupBeforeInstall.removed.length > 0;
      const codexSessionReconnectRequired =
        changed &&
        transaction.partialState.changedSteps.some(
          (step) => step === "copy-release" || step === "install-plugin",
        );
      return commandResult(command, {
        ok: true,
        code:
          command === "install"
            ? changed
              ? "INSTALL_OK"
              : "INSTALL_ALREADY_CURRENT"
            : changed
              ? "UPGRADE_OK"
              : "UPGRADE_ALREADY_CURRENT",
        changed,
        nextStep: codexSessionReconnectRequired
          ? "Review and trust the Goal Progress Hook, then close and reopen the current Codex session so MCP loads this release."
          : "Review and trust the Goal Progress Hook in Codex.",
        details: {
          releaseVersion: release.releaseVersion,
          applicationSupportRoot: layout.applicationSupportRoot,
          launchAgentLabel: layout.launchAgentLabel,
          codexAppPath: codex.realAppPath,
          pluginInstalled: true,
          hookReviewRequired: true,
          codexSessionReconnectRequired,
          hookSha256,
          cdpReady: true,
          restartScheduled: false,
          cleanupPending,
          cleanupBackups,
          cleanupWarningCode,
          states: changed
            ? [
                "installed",
                "hook_review_required",
                ...(codexSessionReconnectRequired ? ["session_reconnect_required"] : []),
              ]
            : ["already_current"],
          transaction: transaction.partialState,
        },
      });
    } catch (error) {
      const partialState = transaction.partialState;
      const rollback = await transaction.rollback();
      const rollbackOk = rollback.every((result) => result.ok);
      return commandResult(command, {
        ok: false,
        code: rollbackOk ? "INSTALL_ROLLED_BACK" : "INSTALL_PARTIAL_STATE",
        changed: !rollbackOk,
        nextStep: rollbackOk
          ? `Fix ${stableErrorCode(error)}, then retry ${command} --json.`
          : `Run goal-progress restore --json --restart-codex, then inspect ${layout.installRoot}.`,
        details: {
          errorCode: stableErrorCode(error),
          partialState,
          rollback,
          previousRelease: currentTarget,
          preservedRelease: releaseBackupCreated ? releaseBackupPath : null,
          states: [rollbackOk ? "partial_failure_rolled_back" : "partial_failure"],
        },
      });
    }
  };

  const doctor = async (): Promise<MacosCommandResult> => {
    const release = await readVerifiedRelease(options.releaseRoot);
    const layout = resolveMacosInstallationLayout({
      homeDirectory: options.homeDirectory,
      releaseVersion: release.releaseVersion,
    });
    const installed = await readInstalledManifest(layout.installManifestPath);
    if (!installed) {
      return commandResult("doctor", {
        ok: false,
        code: "DOCTOR_NOT_INSTALLED",
        changed: false,
        nextStep: "Run install --json.",
        details: { hookTrust: "unknown" satisfies HookTrust },
      });
    }
    const helperJobLoaded = await launchAgent.isLoaded(layout.launchAgentLabel);
    if (!helperJobLoaded) {
      return commandResult("doctor", {
        ok: false,
        code: "DOCTOR_HELPER_JOB_NOT_LOADED",
        changed: false,
        nextStep: "Run install --json to load the Helper job.",
        details: {
          helperJobLoaded: false,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    const helper = await inspectHelper(goalPaths);
    if (!helper.ok) {
      const code = !helper.socketPathExists
        ? "DOCTOR_HELPER_SOCKET_MISSING"
        : !helper.protocolMatches && helper.code === "PROTOCOL_VERSION_MISMATCH"
          ? "DOCTOR_HELPER_PROTOCOL_MISMATCH"
          : !helper.pingOk
            ? "DOCTOR_HELPER_UNAVAILABLE"
            : !helper.pidMatches
              ? "DOCTOR_HELPER_PID_MISMATCH"
              : !helper.singleOwner
                ? "DOCTOR_HELPER_OWNER_INVALID"
                : !helper.storeReadOnly
                  ? "DOCTOR_STORE_READ_FAILED"
                  : "DOCTOR_HELPER_UNAVAILABLE";
      return commandResult("doctor", {
        ok: false,
        code,
        changed: false,
        nextStep: "Run install --json to repair and restart the Helper.",
        details: {
          helperJobLoaded,
          helper,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    const codex = await discoverCodex();
    validateCodexIdentity(codex);
    const plugin = await pluginFor(codex);
    const pluginInstalled = await plugin.verify(
      installed.releaseVersion,
      release.pluginTreeManifestSha256,
    );
    if (!pluginInstalled) {
      return commandResult("doctor", {
        ok: false,
        code: "DOCTOR_PLUGIN_INVALID",
        changed: false,
        nextStep: "Run install --json, then review the Hook trust prompt.",
        details: {
          helperJobLoaded,
          helper,
          pluginInstalled: false,
          pluginCacheMatchesSource: false,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    let hook: InstalledHookInspection;
    try {
      hook = await inspectInstalledHook(options.homeDirectory, installed);
    } catch {
      return commandResult("doctor", {
        ok: false,
        code: "DOCTOR_HOOK_INVALID",
        changed: false,
        nextStep: "Run install --json, then review the Hook trust prompt again.",
        details: {
          helperJobLoaded,
          helper,
          pluginInstalled: true,
          pluginCacheMatchesSource: true,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    const hookFailureCode = !hook.hashMatchesManifest
      ? "DOCTOR_HOOK_HASH_MISMATCH"
      : !hook.stableCommand
        ? "DOCTOR_HOOK_COMMAND_UNSAFE"
        : !hook.userLevelHookAbsent
          ? "DOCTOR_USER_HOOK_PRESENT"
          : !hook.trustedHashAbsent
            ? "DOCTOR_HOOK_CONFIG_UNSAFE"
            : null;
    if (hookFailureCode) {
      return commandResult("doctor", {
        ok: false,
        code: hookFailureCode,
        changed: false,
        nextStep: "Run install --json, then review the Hook trust prompt again.",
        details: {
          helperJobLoaded,
          helper,
          pluginInstalled: true,
          pluginCacheMatchesSource: true,
          hook,
          hookTrust: hook.hookTrust,
        },
      });
    }
    const cdpReady = await cdp.verify();
    if (!cdpReady) {
      return commandResult("doctor", {
        ok: false,
        code: "DOCTOR_CDP_NOT_READY",
        changed: false,
        nextStep: "After the user confirms a Codex restart, run install --json --restart-codex.",
        details: {
          helperJobLoaded,
          helper,
          pluginInstalled: true,
          pluginCacheMatchesSource: true,
          hook,
          hookTrust: hook.hookTrust,
          cdpReady: false,
        },
      });
    }
    const cleanupBackups = await inspectOrphanReleaseBackups(layout.programReleasesRoot).catch(
      () => [],
    );
    return commandResult("doctor", {
      ok: true,
      code: "DOCTOR_OK",
      changed: false,
      details: {
        releaseVersion: installed.releaseVersion,
        helperJobLoaded,
        helper,
        codexAppPath: codex.realAppPath,
        pluginInstalled,
        pluginCacheMatchesSource: true,
        hook,
        hookTrust: hook.hookTrust,
        hookSha256: installed.hookSha256,
        cdpReady,
        cleanupPending: cleanupBackups.length > 0,
        cleanupBackups,
      },
    });
  };

  const verify = async (): Promise<MacosCommandResult> => {
    const release = await readVerifiedRelease(options.releaseRoot);
    const layout = resolveMacosInstallationLayout({
      homeDirectory: options.homeDirectory,
      releaseVersion: release.releaseVersion,
    });
    const installed = await readInstalledManifest(layout.installManifestPath);
    if (!installed) {
      return commandResult("verify", {
        ok: false,
        code: "VERIFY_NOT_INSTALLED",
        changed: false,
        nextStep: "Run install --json.",
        details: { hookTrust: "unknown" satisfies HookTrust },
      });
    }
    const helperJobLoaded = await launchAgent.isLoaded(layout.launchAgentLabel);
    const helper = helperJobLoaded ? await inspectHelper(goalPaths) : null;
    if (!helperJobLoaded || !helper?.ok) {
      return commandResult("verify", {
        ok: false,
        code: "VERIFY_HELPER_UNAVAILABLE",
        changed: false,
        nextStep: "Run install --json to repair and restart the Helper.",
        details: {
          helperJobLoaded,
          helper,
          helperPing: helper?.pingOk ?? false,
          ipcRoundTrip: helper?.pingOk === true && helper.protocolMatches,
          storeReadOnly: helper?.storeReadOnly ?? false,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    const codex = await discoverCodex();
    validateCodexIdentity(codex);
    const plugin = await pluginFor(codex);
    if (!(await plugin.verify(installed.releaseVersion, release.pluginTreeManifestSha256))) {
      return commandResult("verify", {
        ok: false,
        code: "VERIFY_PLUGIN_INVALID",
        changed: false,
        nextStep: "Run install --json to restore the Plugin cache.",
        details: {
          helperJobLoaded,
          helper,
          pluginInstalled: false,
          pluginCacheMatchesSource: false,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    let hook: InstalledHookInspection;
    try {
      hook = await inspectInstalledHook(options.homeDirectory, installed);
    } catch {
      return commandResult("verify", {
        ok: false,
        code: "VERIFY_HOOK_INVALID",
        changed: false,
        nextStep: "Run install --json to restore the Hook.",
        details: {
          helperJobLoaded,
          helper,
          hookTrust: "unknown" satisfies HookTrust,
        },
      });
    }
    if (
      !hook.hashMatchesManifest ||
      !hook.stableCommand ||
      !hook.userLevelHookAbsent ||
      !hook.trustedHashAbsent
    ) {
      return commandResult("verify", {
        ok: false,
        code: "VERIFY_HOOK_INVALID",
        changed: false,
        nextStep: "Run install --json to restore the Hook.",
        details: {
          helperJobLoaded,
          helper,
          pluginInstalled: true,
          pluginCacheMatchesSource: true,
          hook,
          hookTrust: hook.hookTrust,
        },
      });
    }
    if (!(await cdp.verify())) {
      return commandResult("verify", {
        ok: false,
        code: "VERIFY_CDP_NOT_READY",
        changed: false,
        nextStep: "Restart Codex through install --json --restart-codex.",
        details: {
          helperJobLoaded,
          helper,
          cdpOwnership: false,
          hookTrust: hook.hookTrust,
        },
      });
    }
    await readVerifiedRelease(installed.programReleaseRoot);
    for (const path of [
      layout.installManifestPath,
      layout.launchAgentPath,
      resolve(installed.programReleaseRoot, release.files.renderer.path),
    ]) {
      if (((await stat(path)).mode & 0o777) !== 0o600) {
        throw new Error(`GOAL_PROGRESS_INSTALL_PERMISSION_INVALID: ${path}`);
      }
    }
    for (const executable of [
      release.files.helper,
      release.files.installCommand,
      release.files.repairCommand,
      release.files.disableCommand,
      release.files.uninstallCommand,
    ]) {
      if (
        ((await stat(resolve(installed.programReleaseRoot, executable.path))).mode & 0o777) !==
        0o700
      ) {
        throw new Error(`GOAL_PROGRESS_EXECUTABLE_PERMISSION_INVALID: ${executable.path}`);
      }
    }
    return commandResult("verify", {
      ok: true,
      code: "VERIFY_OK",
      changed: false,
      details: {
        releaseVersion: installed.releaseVersion,
        checksumsValid: true,
        permissionsValid: true,
        pluginInstalled: true,
        pluginCacheMatchesSource: true,
        hookSha256: installed.hookSha256,
        hookTrust: hook.hookTrust,
        helperPing: true,
        ipcRoundTrip: true,
        storeReadOnly: true,
        helperPid: helper.pid,
        helperOwnerCount: helper.ownerCount,
        cdpOwnership: true,
        cdpReady: true,
      },
    });
  };

  const restore = async (input: MacosCommandInput): Promise<MacosCommandResult> => {
    const restored = await restoreCdp(input.restartCodex);
    return commandResult("restore", {
      ok: true,
      code: restored.changed ? "RESTORE_OK" : "RESTORE_NOT_NEEDED",
      changed: restored.changed,
      nextStep: restored.scheduled
        ? "Codex restore has been scheduled."
        : input.restartCodex
          ? null
          : "Restart Codex normally if it is still open.",
      details: {
        restartedCodex: restored.restartedCodex,
        restoreScheduled: restored.scheduled,
      },
    });
  };

  const uninstall = async (input: MacosCommandInput): Promise<MacosCommandResult> => {
    const basePaths = resolveGoalProgressPaths({
      platform: "darwin",
      homeDirectory: options.homeDirectory,
    });
    const installed = await readInstalledManifest(basePaths.installManifestPath);
    let releaseVersion = installed?.releaseVersion;
    if (!releaseVersion) {
      try {
        releaseVersion = (await readVerifiedRelease(options.releaseRoot)).releaseVersion;
      } catch {
        releaseVersion = "uninstalled";
      }
    }
    const layout = resolveMacosInstallationLayout({
      homeDirectory: options.homeDirectory,
      releaseVersion,
    });
    let pluginChanged = false;
    let pluginError: string | null = null;
    try {
      const codex = await discoverCodex();
      validateCodexIdentity(codex);
      pluginChanged = await (await pluginFor(codex)).remove();
    } catch (error) {
      pluginError = stableErrorCode(error);
    }
    const jobChanged = await launchAgent.remove(layout.launchAgentLabel, layout.launchAgentPath);
    await waitForHelperStopped(basePaths);
    const cdpRestore = await restoreCdp(true);
    if (cdpRestore.scheduled) {
      return commandResult("uninstall", {
        ok: pluginError === null,
        code:
          pluginError === null
            ? "UNINSTALL_RESTORE_SCHEDULED"
            : "UNINSTALL_PARTIAL_RESTORE_SCHEDULED",
        changed: true,
        nextStep:
          pluginError === null
            ? "After Codex reopens normally, run uninstall --json again."
            : "Remove the Goal Progress Plugin in Codex, then rerun uninstall after Codex reopens.",
        details: {
          historyPreserved: input.preserveHistory,
          codexRestored: true,
          restoreScheduled: true,
          pluginRemoved: pluginError === null,
          pluginError,
          helperStopped: true,
        },
      });
    }
    let filesChanged = false;
    for (const path of [layout.launchAgentPath, layout.installRoot, layout.runtimeRoot]) {
      try {
        await access(path);
        await rm(path, { recursive: true, force: true });
        filesChanged = true;
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    }
    if (!input.preserveHistory) {
      await rm(layout.applicationSupportRoot, { recursive: true, force: true });
      filesChanged = true;
    }
    const changed = cdpRestore.changed || pluginChanged || jobChanged || filesChanged;
    if (pluginError) {
      return commandResult("uninstall", {
        ok: false,
        code: "UNINSTALL_PARTIAL",
        changed,
        nextStep: "Remove the Goal Progress Plugin in Codex, then retry uninstall.",
        details: {
          historyPreserved: input.preserveHistory,
          codexRestored: cdpRestore.changed,
          restoreScheduled: false,
          pluginRemoved: false,
          pluginError,
          helperStopped: true,
        },
      });
    }
    return commandResult("uninstall", {
      ok: true,
      code: changed ? "UNINSTALL_OK" : "UNINSTALL_NOT_INSTALLED",
      changed,
      details: {
        historyPreserved: input.preserveHistory,
        codexRestored: cdpRestore.changed,
        restoreScheduled: cdpRestore.scheduled,
        pluginRemoved: true,
        helperStopped: true,
      },
    });
  };

  const emergencyDisable = async (): Promise<MacosCommandResult> => {
    const basePaths = resolveGoalProgressPaths({
      platform: "darwin",
      homeDirectory: options.homeDirectory,
    });
    const installed = await readInstalledManifest(basePaths.installManifestPath);
    const releaseVersion = installed?.releaseVersion ?? "disabled";
    const layout = resolveMacosInstallationLayout({
      homeDirectory: options.homeDirectory,
      releaseVersion,
    });
    let pluginChanged = false;
    let pluginError: string | null = null;
    try {
      const codex = await discoverCodex();
      validateCodexIdentity(codex);
      pluginChanged = await (await pluginFor(codex)).remove();
    } catch (error) {
      pluginError = stableErrorCode(error);
    }
    const jobChanged = await launchAgent.remove(layout.launchAgentLabel, layout.launchAgentPath);
    await waitForHelperStopped(basePaths);
    const currentExisted = (await captureLink(layout.currentReleasePath)) !== null;
    await rm(layout.currentReleasePath, { recursive: true, force: true });
    const changed = pluginChanged || jobChanged || currentExisted;
    return commandResult("emergency-disable", {
      ok: pluginError === null,
      code: pluginError === null ? "EMERGENCY_DISABLE_OK" : "EMERGENCY_DISABLE_PARTIAL",
      changed,
      nextStep:
        "Open /hooks, disable only the Goal Progress Hook if it is still listed, then run repair --json to re-enable.",
      details: {
        pluginRemoved: pluginError === null,
        pluginError,
        helperStopped: true,
        stableHookDisabled: true,
        historyPreserved: true,
      },
    });
  };

  const repair = async (input: MacosCommandInput): Promise<MacosCommandResult> => {
    let current = await doctor();
    const doctorCodes = [current.code];
    if (current.ok) {
      return commandResult("repair", {
        ok: true,
        code: "REPAIR_NOT_NEEDED",
        changed: false,
        details: {
          doctorCodeBefore: current.code,
          doctorCodes,
          hookReviewRequired: false,
          contractPreserved: true,
          tokenPreserved: true,
        },
      });
    }
    const basePaths = resolveGoalProgressPaths({
      platform: "darwin",
      homeDirectory: options.homeDirectory,
    });
    const installed = await readInstalledManifest(basePaths.installManifestPath);
    if (!installed) {
      return commandResult("repair", {
        ok: false,
        code: "REPAIR_NOT_INSTALLED",
        changed: false,
        nextStep: "Run install --json.",
      });
    }
    const layout = resolveMacosInstallationLayout({
      homeDirectory: options.homeDirectory,
      releaseVersion: installed.releaseVersion,
    });
    const installedRelease = await readVerifiedRelease(installed.programReleaseRoot);
    const helperCodes = new Set([
      "DOCTOR_HELPER_JOB_NOT_LOADED",
      "DOCTOR_HELPER_SOCKET_MISSING",
      "DOCTOR_HELPER_UNAVAILABLE",
      "DOCTOR_HELPER_PROTOCOL_MISMATCH",
      "DOCTOR_HELPER_PID_MISMATCH",
      "DOCTOR_HELPER_OWNER_INVALID",
      "DOCTOR_STORE_READ_FAILED",
    ]);
    const hookCodes = new Set([
      "DOCTOR_HOOK_HASH_MISMATCH",
      "DOCTOR_HOOK_COMMAND_UNSAFE",
      "DOCTOR_HOOK_CONFIG_UNSAFE",
      "DOCTOR_HOOK_INVALID",
    ]);
    const visited = new Set<string>();
    let changed = false;

    for (let round = 0; round < 5; round += 1) {
      if (visited.has(current.code)) {
        return commandResult("repair", {
          ok: false,
          code: "REPAIR_CYCLE_DETECTED",
          changed,
          nextStep: "Run doctor --json and inspect the reported Repair code cycle.",
          details: {
            doctorCodes,
            hookReviewRequired: false,
            contractPreserved: true,
            tokenPreserved: true,
          },
        });
      }
      visited.add(current.code);

      let actionChanged = false;
      try {
        if (helperCodes.has(current.code)) {
          const codex = await discoverCodex();
          validateCodexIdentity(codex);
          if ((await captureLink(layout.currentReleasePath)) !== installed.programReleaseRoot) {
            await replaceCurrentReleaseLink(
              layout.currentReleasePath,
              installed.programReleaseRoot,
            );
            actionChanged = true;
          }
          actionChanged =
            (await writeIfChanged(layout.launchAgentPath, launchAgentPlist(layout, codex))) ||
            actionChanged;
          actionChanged =
            (await launchAgent.ensure(layout.launchAgentLabel, layout.launchAgentPath, true)) ||
            actionChanged;
        } else if (current.code === "DOCTOR_PLUGIN_INVALID") {
          const codex = await discoverCodex();
          validateCodexIdentity(codex);
          actionChanged = await (await pluginFor(codex)).ensure(
            resolve(installed.programReleaseRoot, "plugin-marketplace.zip"),
            resolve(installed.programReleaseRoot, "plugin-marketplace"),
            true,
            installedRelease.pluginTreeManifestSha256,
          );
        } else if (hookCodes.has(current.code)) {
          const installedAgain = await installOrUpgrade("install", input);
          return commandResult("repair", {
            ...installedAgain,
            changed: changed || installedAgain.changed,
            code: installedAgain.ok ? "REPAIR_OK" : installedAgain.code,
            details: {
              ...installedAgain.details,
              doctorCodeBefore: doctorCodes[0],
              doctorCodes,
              hookReviewRequired: false,
              contractPreserved: true,
              tokenPreserved: true,
            },
          });
        } else if (current.code === "DOCTOR_CDP_NOT_READY") {
          if (!input.restartCodex) {
            return commandResult("repair", {
              ok: true,
              code: "REPAIR_RESTART_REQUIRED",
              changed,
              nextStep:
                "After the user confirms a Codex restart, run repair --json --restart-codex.",
              details: { doctorCodes },
            });
          }
          actionChanged = await cdp.ensure(true);
          if (!(await cdp.verify())) {
            return commandResult("repair", {
              ok: true,
              code: "REPAIR_RESTART_PENDING",
              changed: changed || actionChanged,
              nextStep: "After Codex reopens, run repair --json again.",
              details: { doctorCodes },
            });
          }
        } else {
          return commandResult("repair", {
            ok: false,
            code: "REPAIR_MANUAL_ACTION_REQUIRED",
            changed,
            nextStep: current.nextStep,
            details: {
              doctorCodeBefore: doctorCodes[0],
              doctorCodes,
              hookReviewRequired: false,
              contractPreserved: true,
              tokenPreserved: true,
            },
          });
        }
      } catch (error) {
        const errorCode = stableErrorCode(error);
        return commandResult("repair", {
          ok: false,
          code: "REPAIR_ACTION_FAILED",
          changed,
          nextStep: `Fix ${errorCode}, then retry repair --json.`,
          details: {
            doctorCodes,
            errorCode,
            hookReviewRequired: false,
            contractPreserved: true,
            tokenPreserved: true,
          },
        });
      }

      changed = changed || actionChanged;
      if (!actionChanged) {
        return commandResult("repair", {
          ok: false,
          code: "REPAIR_INCOMPLETE",
          changed,
          nextStep: current.nextStep,
          details: {
            doctorCodeBefore: doctorCodes[0],
            doctorCodeAfter: current.code,
            doctorCodes,
            hookReviewRequired: false,
            contractPreserved: true,
            tokenPreserved: true,
          },
        });
      }

      current = await doctor();
      doctorCodes.push(current.code);
      if (current.ok) {
        return commandResult("repair", {
          ok: true,
          code: "REPAIR_OK",
          changed,
          details: {
            doctorCodeBefore: doctorCodes[0],
            doctorCodeAfter: current.code,
            doctorCodes,
            hookReviewRequired: false,
            contractPreserved: true,
            tokenPreserved: true,
          },
        });
      }
    }

    if (visited.has(current.code)) {
      return commandResult("repair", {
        ok: false,
        code: "REPAIR_CYCLE_DETECTED",
        changed,
        nextStep: "Run doctor --json and inspect the reported Repair code cycle.",
        details: {
          doctorCodes,
          hookReviewRequired: false,
          contractPreserved: true,
          tokenPreserved: true,
        },
      });
    }
    return commandResult("repair", {
      ok: false,
      code: "REPAIR_LIMIT_REACHED",
      changed,
      nextStep: "Run doctor --json; automatic Repair reached its five-round limit.",
      details: {
        doctorCodes,
        hookReviewRequired: false,
        contractPreserved: true,
        tokenPreserved: true,
      },
    });
  };

  return {
    install: (input) => installOrUpgrade("install", input),
    doctor,
    "emergency-disable": emergencyDisable,
    repair,
    verify,
    restore,
    uninstall,
    upgrade: (input) => installOrUpgrade("upgrade", input),
  };
}
