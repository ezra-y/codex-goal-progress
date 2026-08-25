import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export {
  executeMacosCommand,
  MACOS_COMMAND_NAMES,
  type MacosCommandHandler,
  type MacosCommandHandlers,
  type MacosCommandInput,
  type MacosCommandName,
  type MacosCommandResult,
  type ParseMacosCommandResult,
  parseMacosCommand,
  serializeMacosCommandResult,
  serializeMacosCommandResultHuman,
} from "./command-protocol.js";
export {
  ensureMacosInstallationDirectories,
  GOAL_PROGRESS_LAUNCH_AGENT_LABEL,
  MACOS_PRIVATE_DIRECTORY_MODE,
  MACOS_PRIVATE_FILE_MODE,
  type MacosInstallationLayout,
  type ResolveMacosInstallationLayoutInput,
  resolveMacosInstallationLayout,
} from "./install-layout.js";
export {
  type InstallRollbackResult,
  type InstallStepResult,
  InstallTransaction,
} from "./install-transaction.js";
export {
  type CdpController,
  type CreateMacosCommandHandlersOptions,
  createCdpController,
  createLaunchAgentController,
  createMacosCommandHandlers,
  createPluginController,
  type LaunchAgentController,
  type PluginController,
} from "./installer.js";
export {
  createReleasePluginRuntimeFiles,
  type ReleasePluginRuntimeFiles,
} from "./plugin-release.js";
export {
  assertSafeMacosReleaseOutput,
  type CreateMacosReleaseManifestInput,
  createMacosReleaseManifest,
  GOAL_PROGRESS_MACOS_RELEASE_NODE_VERSION,
  type MacosReleaseFile,
  renderSha256Sums,
} from "./release.js";

export const CODEX_BUNDLE_ID = "com.openai.codex";
export const CODEX_TEAM_ID = "2DC432GLL2";

const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const SYSTEM_COMMANDS = {
  codesign: "/usr/bin/codesign",
  file: "/usr/bin/file",
  lipo: "/usr/bin/lipo",
  mdfind: "/usr/bin/mdfind",
  plutil: "/usr/bin/plutil",
} as const;

export type MacosExecutableArchitecture = "arm64" | "x86_64";

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

export interface CodexMacosAppIdentity {
  readonly appPath: string;
  readonly realAppPath: string;
  readonly bundleId: typeof CODEX_BUNDLE_ID;
  readonly shortVersion: string;
  readonly bundleVersion: string;
  readonly executableName: string;
  readonly executablePath: string;
  readonly realExecutablePath: string;
  readonly teamId: typeof CODEX_TEAM_ID;
  readonly signingAuthority: string;
  readonly architectures: readonly MacosExecutableArchitecture[];
  readonly hostArchitecture: MacosExecutableArchitecture;
  readonly fileDescription: string;
  readonly signatureValid: true;
}

export interface RejectedCodexAppCandidate {
  readonly appPath: string;
  readonly error: string;
}

export interface CodexAppDiscoveryResult {
  readonly candidates: readonly string[];
  readonly validApps: readonly CodexMacosAppIdentity[];
  readonly rejectedCandidates: readonly RejectedCodexAppCandidate[];
}

export interface InspectCodexAppOptions {
  readonly runner?: CommandRunner;
  readonly hostArchitecture?: MacosExecutableArchitecture;
}

export interface DiscoverCodexAppsOptions extends InspectCodexAppOptions {
  readonly candidatePaths?: readonly string[];
  readonly includeDefaultCandidates?: boolean;
  readonly useSpotlight?: boolean;
}

function discoveryError(code: string, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

export const runSystemCommand: CommandRunner = (command, args) =>
  new Promise((resolveCommand) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        resolveCommand({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });

function requireSuccessfulCommand(result: CommandResult, errorCode: string): string {
  if (result.exitCode !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim().slice(0, 1_000);
    throw discoveryError(errorCode, detail || `exit ${result.exitCode}`);
  }
  return result.stdout.trim();
}

async function readPlistValue(
  runner: CommandRunner,
  infoPlistPath: string,
  key: string,
): Promise<string> {
  const result = await runner(SYSTEM_COMMANDS.plutil, ["-extract", key, "raw", infoPlistPath]);
  const value = requireSuccessfulCommand(result, `GOAL_PROGRESS_CODEX_APP_PLIST_${key}`);
  if (!value) {
    throw discoveryError(`GOAL_PROGRESS_CODEX_APP_PLIST_${key}_EMPTY`);
  }
  return value;
}

function parseCodesignValue(output: string, key: string): string | undefined {
  const prefix = `${key}=`;
  return output
    .split(/\r?\n/u)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}

function parseHostArchitecture(architecture: NodeJS.Architecture): MacosExecutableArchitecture {
  if (architecture === "arm64") {
    return "arm64";
  }
  if (architecture === "x64") {
    return "x86_64";
  }
  throw discoveryError("GOAL_PROGRESS_CODEX_APP_UNSUPPORTED_HOST_ARCH", architecture);
}

function parseArchitectures(output: string): readonly MacosExecutableArchitecture[] {
  const architectures = output.trim().split(/\s+/u).filter(Boolean);
  if (
    architectures.length === 0 ||
    architectures.some((architecture) => architecture !== "arm64" && architecture !== "x86_64")
  ) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_INVALID_ARCH", output.trim());
  }
  return [...new Set(architectures)] as MacosExecutableArchitecture[];
}

function assertSafeExecutableName(executableName: string): void {
  if (
    executableName === "." ||
    executableName === ".." ||
    basename(executableName) !== executableName
  ) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_UNSAFE_EXECUTABLE_NAME");
  }
}

export async function inspectCodexMacosApp(
  appPath: string,
  options: InspectCodexAppOptions = {},
): Promise<CodexMacosAppIdentity> {
  if (!isAbsolute(appPath)) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_PATH_NOT_ABSOLUTE");
  }
  const runner = options.runner ?? runSystemCommand;
  const realAppPath = await realpath(appPath);
  if (!realAppPath.endsWith(".app")) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_NOT_APP_BUNDLE");
  }
  const appStat = await stat(realAppPath);
  if (!appStat.isDirectory()) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_NOT_DIRECTORY");
  }

  const infoPlistPath = join(realAppPath, "Contents", "Info.plist");
  const bundleId = await readPlistValue(runner, infoPlistPath, "CFBundleIdentifier");
  if (bundleId !== CODEX_BUNDLE_ID) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_BUNDLE_ID_MISMATCH", bundleId);
  }

  const executableName = await readPlistValue(runner, infoPlistPath, "CFBundleExecutable");
  assertSafeExecutableName(executableName);
  const [shortVersion, bundleVersion] = await Promise.all([
    readPlistValue(runner, infoPlistPath, "CFBundleShortVersionString"),
    readPlistValue(runner, infoPlistPath, "CFBundleVersion"),
  ]);

  const executablePath = join(realAppPath, "Contents", "MacOS", executableName);
  const realExecutablePath = await realpath(executablePath);
  const executableRoot = join(realAppPath, "Contents", "MacOS");
  const executableRelativePath = relative(executableRoot, realExecutablePath);
  if (executableRelativePath.startsWith("..") || isAbsolute(executableRelativePath)) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_EXECUTABLE_ESCAPE");
  }
  const executableStat = await stat(realExecutablePath);
  if (!executableStat.isFile()) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_EXECUTABLE_NOT_FILE");
  }
  await access(realExecutablePath, constants.X_OK);

  const signatureDetails = await runner(SYSTEM_COMMANDS.codesign, [
    "-dv",
    "--verbose=4",
    realAppPath,
  ]);
  const codesignOutput = `${signatureDetails.stdout}\n${signatureDetails.stderr}`;
  if (signatureDetails.exitCode !== 0) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_SIGNATURE_DETAILS_FAILED");
  }
  const signedIdentifier = parseCodesignValue(codesignOutput, "Identifier");
  const teamId = parseCodesignValue(codesignOutput, "TeamIdentifier");
  const signingAuthority = parseCodesignValue(codesignOutput, "Authority");
  if (signedIdentifier !== CODEX_BUNDLE_ID) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_SIGNED_IDENTIFIER_MISMATCH", signedIdentifier);
  }
  if (teamId !== CODEX_TEAM_ID) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_TEAM_ID_MISMATCH", teamId);
  }
  if (!signingAuthority) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_AUTHORITY_MISSING");
  }

  const signatureVerification = await runner(SYSTEM_COMMANDS.codesign, [
    "--verify",
    "--deep",
    "--strict",
    realAppPath,
  ]);
  requireSuccessfulCommand(signatureVerification, "GOAL_PROGRESS_CODEX_APP_SIGNATURE_INVALID");

  const lipoResult = await runner(SYSTEM_COMMANDS.lipo, ["-archs", realExecutablePath]);
  const architectures = parseArchitectures(
    requireSuccessfulCommand(lipoResult, "GOAL_PROGRESS_CODEX_APP_ARCH_READ_FAILED"),
  );
  const hostArchitecture = options.hostArchitecture ?? parseHostArchitecture(process.arch);
  if (!architectures.includes(hostArchitecture)) {
    throw discoveryError(
      "GOAL_PROGRESS_CODEX_APP_HOST_ARCH_MISMATCH",
      `${hostArchitecture} not in ${architectures.join(",")}`,
    );
  }

  const fileResult = await runner(SYSTEM_COMMANDS.file, ["-b", realExecutablePath]);
  const fileDescription = requireSuccessfulCommand(
    fileResult,
    "GOAL_PROGRESS_CODEX_APP_FILE_READ_FAILED",
  );
  if (!fileDescription.includes("Mach-O")) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_EXECUTABLE_NOT_MACHO");
  }

  return {
    appPath: resolve(appPath),
    realAppPath,
    bundleId: CODEX_BUNDLE_ID,
    shortVersion,
    bundleVersion,
    executableName,
    executablePath,
    realExecutablePath,
    teamId: CODEX_TEAM_ID,
    signingAuthority,
    architectures,
    hostArchitecture,
    fileDescription,
    signatureValid: true,
  };
}

function defaultCandidatePaths(): readonly string[] {
  return [
    "/Applications/Codex.app",
    "/Applications/ChatGPT.app",
    join(homedir(), "Applications", "Codex.app"),
    join(homedir(), "Applications", "ChatGPT.app"),
  ];
}

export async function discoverCodexMacosApps(
  options: DiscoverCodexAppsOptions = {},
): Promise<CodexAppDiscoveryResult> {
  const runner = options.runner ?? runSystemCommand;
  const candidatePaths = new Set<string>(options.candidatePaths ?? []);
  if (options.includeDefaultCandidates ?? true) {
    for (const candidatePath of defaultCandidatePaths()) {
      candidatePaths.add(candidatePath);
    }
  }
  if (options.useSpotlight ?? true) {
    const spotlight = await runner(SYSTEM_COMMANDS.mdfind, [
      `kMDItemCFBundleIdentifier == "${CODEX_BUNDLE_ID}"`,
    ]);
    if (spotlight.exitCode === 0) {
      for (const candidatePath of spotlight.stdout.split(/\r?\n/u)) {
        if (candidatePath.trim()) {
          candidatePaths.add(candidatePath.trim());
        }
      }
    }
  }

  const candidates = [...candidatePaths];
  const validApps: CodexMacosAppIdentity[] = [];
  const rejectedCandidates: RejectedCodexAppCandidate[] = [];
  const seenRealAppPaths = new Set<string>();

  for (const candidatePath of candidates) {
    try {
      const identity = await inspectCodexMacosApp(candidatePath, {
        runner,
        ...(options.hostArchitecture === undefined
          ? {}
          : { hostArchitecture: options.hostArchitecture }),
      });
      if (!seenRealAppPaths.has(identity.realAppPath)) {
        validApps.push(identity);
        seenRealAppPaths.add(identity.realAppPath);
      }
    } catch (error) {
      rejectedCandidates.push({
        appPath: candidatePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    candidates,
    validApps,
    rejectedCandidates,
  };
}

export async function requireSingleCodexMacosApp(
  options: DiscoverCodexAppsOptions = {},
): Promise<CodexMacosAppIdentity> {
  const discovery = await discoverCodexMacosApps(options);
  if (discovery.validApps.length === 0) {
    throw discoveryError(
      "GOAL_PROGRESS_CODEX_APP_NOT_FOUND",
      discovery.rejectedCandidates.map((candidate) => candidate.error).join("; "),
    );
  }
  if (discovery.validApps.length > 1) {
    throw discoveryError(
      "GOAL_PROGRESS_CODEX_APP_AMBIGUOUS",
      discovery.validApps.map((app) => app.realAppPath).join(", "),
    );
  }
  const app = discovery.validApps[0];
  if (!app) {
    throw discoveryError("GOAL_PROGRESS_CODEX_APP_NOT_FOUND");
  }
  return app;
}

const LOOPBACK_ADDRESS = "127.0.0.1";
const PROCESS_LOOKUP_LIMIT = 32;
const PROCESS_LAUNCH_TIMEOUT_MS = 15_000;
const PROCESS_STOP_TIMEOUT_MS = 5_000;

export interface CodexCdpProcessSnapshot {
  readonly pid: number;
  readonly parentPid: number;
  readonly startedAt: string;
  readonly command: string;
}

export interface CodexCdpListener {
  readonly pid: number;
  readonly commandName: string;
  readonly address: string;
}

export interface CodexCdpListenerOwnership {
  readonly mainProcess: CodexCdpProcessSnapshot;
  readonly listeners: readonly CodexCdpListener[];
  readonly listenerPids: readonly number[];
}

export interface CodexCdpRuntimeState {
  readonly schemaVersion: 1;
  readonly launchId: string;
  readonly address: typeof LOOPBACK_ADDRESS;
  readonly port: number;
  readonly mainPid: number;
  readonly launchedAt: string;
  readonly processStartedAt: string;
  readonly executablePath: string;
  readonly appPath: string;
  readonly bundleId: typeof CODEX_BUNDLE_ID;
  readonly teamId: typeof CODEX_TEAM_ID;
  readonly command: string;
  readonly listenerPids: readonly number[];
}

export interface LaunchCodexCdpOptions {
  readonly port: number;
  readonly userDataDir?: string;
  readonly headless?: boolean;
  readonly extraArgs?: readonly string[];
  readonly runner?: CommandRunner;
  readonly processSnapshotTimeoutMs?: number;
  readonly postSpawnCleanupTimeoutMs?: number;
  readonly portOpenProbe?: (port: number) => Promise<boolean>;
  readonly spawnProcess?: (executablePath: string, args: readonly string[]) => ChildProcess;
}

export class CodexCdpPostSpawnCleanupError extends Error {
  readonly port: number;
  readonly userDataDir: string | undefined;

  constructor(port: number, userDataDir: string | undefined, detail: string) {
    super(
      `GOAL_PROGRESS_CDP_POST_SPAWN_CLEANUP_FAILED: port=${port}; userDataDir=${
        userDataDir ?? "default"
      }; cause=${detail}`,
    );
    this.name = "CodexCdpPostSpawnCleanupError";
    this.port = port;
    this.userDataDir = userDataDir;
  }
}

export interface LaunchedCodexCdpProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly launchedAt: string;
  readonly args: readonly string[];
  readonly processStartedAt: string;
  readonly command: string;
}

export interface RestoreCodexCdpResult {
  readonly mainPid: number;
  readonly forced: boolean;
  readonly portClosed: boolean;
}

export interface CodexCdpLaunchServicesInvocation {
  readonly command: "/usr/bin/open";
  readonly args: readonly string[];
}

export type ProcessSignalSender = (pid: number, signal: NodeJS.Signals) => void;

export interface StopCodexCdpOptions {
  readonly runner?: CommandRunner;
  readonly signalProcess?: ProcessSignalSender;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw discoveryError("GOAL_PROGRESS_CDP_INVALID_PORT", String(port));
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function allocateRandomLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolvePort, rejectPort) => {
    server.once("error", rejectPort);
    server.listen(0, LOOPBACK_ADDRESS, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectPort(discoveryError("GOAL_PROGRESS_CDP_PORT_ALLOCATION_FAILED"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function validateLaunchArgs(extraArgs: readonly string[]): void {
  const protectedPrefixes = [
    "--remote-debugging-address",
    "--remote-debugging-port",
    "--user-data-dir",
  ];
  const protectedArgument = extraArgs.find((argument) =>
    protectedPrefixes.some((prefix) => argument === prefix || argument.startsWith(`${prefix}=`)),
  );
  if (protectedArgument) {
    throw discoveryError("GOAL_PROGRESS_CDP_PROTECTED_LAUNCH_ARG", protectedArgument);
  }
}

export function createCodexCdpLaunchServicesInvocation(
  app: CodexMacosAppIdentity,
  args: readonly string[],
): CodexCdpLaunchServicesInvocation {
  return {
    command: "/usr/bin/open",
    args: ["-n", app.realAppPath, "--args", ...args],
  };
}

async function findCodexCdpMainProcess(
  app: CodexMacosAppIdentity,
  port: number,
  runner: CommandRunner,
): Promise<CodexCdpProcessSnapshot | null> {
  const result = await runner("/bin/ps", ["-axo", "pid=,command="]);
  if (result.exitCode !== 0) {
    throw discoveryError("GOAL_PROGRESS_CDP_PROCESS_LIST_FAILED", result.stderr);
  }
  const portArgument = `--remote-debugging-port=${port}`;
  const candidatePids = result.stdout.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    const pid = Number(match?.[1]);
    const command = match?.[2]?.trim();
    return Number.isSafeInteger(pid) &&
      pid > 1 &&
      command &&
      commandBelongsToExecutable(command, app.realExecutablePath) &&
      command.split(/\s+/u).includes(portArgument)
      ? [pid]
      : [];
  });
  if (candidatePids.length > 1) {
    throw discoveryError(
      "GOAL_PROGRESS_CDP_MAIN_PROCESS_AMBIGUOUS",
      `count=${candidatePids.length}`,
    );
  }
  const pid = candidatePids[0];
  return pid === undefined ? null : inspectProcess(pid, runner);
}

async function waitForCodexCdpMainProcess(
  app: CodexMacosAppIdentity,
  port: number,
  runner: CommandRunner,
  timeoutMs: number,
): Promise<CodexCdpProcessSnapshot> {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      const process = await findCodexCdpMainProcess(app, port, runner);
      if (process) {
        return process;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  } while (Date.now() < timeoutAt);
  throw discoveryError(
    "GOAL_PROGRESS_CDP_PROCESS_SNAPSHOT_TIMEOUT",
    lastError instanceof Error ? lastError.message : String(lastError ?? "not found"),
  );
}

export async function launchCodexWithCdp(
  app: CodexMacosAppIdentity,
  options: LaunchCodexCdpOptions,
): Promise<LaunchedCodexCdpProcess> {
  validatePort(options.port);
  const extraArgs = options.extraArgs ?? [];
  validateLaunchArgs(extraArgs);
  if (options.userDataDir !== undefined && !isAbsolute(options.userDataDir)) {
    throw discoveryError("GOAL_PROGRESS_CDP_USER_DATA_PATH_NOT_ABSOLUTE");
  }
  const args = [
    `--remote-debugging-address=${LOOPBACK_ADDRESS}`,
    `--remote-debugging-port=${options.port}`,
    ...(options.userDataDir === undefined
      ? []
      : [`--user-data-dir=${resolve(options.userDataDir)}`]),
    ...(options.headless ? ["--headless=new"] : []),
    "--no-first-run",
    ...extraArgs,
  ];
  const launchedAt = new Date().toISOString();
  const invocation = createCodexCdpLaunchServicesInvocation(app, args);
  const child =
    options.spawnProcess?.(invocation.command, invocation.args) ??
    spawn(invocation.command, invocation.args, {
      stdio: "ignore",
      detached: false,
      shell: false,
    });
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    child.once("spawn", resolveLaunch);
    child.once("error", rejectLaunch);
  });
  let processSnapshot: CodexCdpProcessSnapshot;
  try {
    processSnapshot = await waitForCodexCdpMainProcess(
      app,
      options.port,
      options.runner ?? runSystemCommand,
      options.processSnapshotTimeoutMs ?? PROCESS_LAUNCH_TIMEOUT_MS,
    );
  } catch (error) {
    const stopped = await stopUnidentifiedSpawnedChild(
      child,
      options.port,
      options.postSpawnCleanupTimeoutMs ?? 2_000,
      options.portOpenProbe ?? isLoopbackPortOpen,
    );
    if (!stopped) {
      throw new CodexCdpPostSpawnCleanupError(
        options.port,
        options.userDataDir,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
  return {
    child,
    pid: processSnapshot.pid,
    launchedAt,
    args,
    processStartedAt: processSnapshot.startedAt,
    command: processSnapshot.command,
  };
}

async function readProcessField(
  runner: CommandRunner,
  pid: number,
  field: "ppid" | "lstart" | "command",
): Promise<string> {
  const result = await runner("/bin/ps", ["-p", String(pid), "-o", `${field}=`]);
  return requireSuccessfulCommand(result, "GOAL_PROGRESS_CDP_PROCESS_LOOKUP_FAILED").trim();
}

export async function inspectProcess(
  pid: number,
  runner: CommandRunner = runSystemCommand,
): Promise<CodexCdpProcessSnapshot> {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw discoveryError("GOAL_PROGRESS_CDP_INVALID_PID", String(pid));
  }
  const [parentPidText, startedAt, command] = await Promise.all([
    readProcessField(runner, pid, "ppid"),
    readProcessField(runner, pid, "lstart"),
    readProcessField(runner, pid, "command"),
  ]);
  const parentPid = Number(parentPidText);
  if (!Number.isSafeInteger(parentPid) || parentPid < 0 || !startedAt || !command) {
    throw discoveryError("GOAL_PROGRESS_CDP_INVALID_PROCESS_SNAPSHOT");
  }
  return {
    pid,
    parentPid,
    startedAt,
    command,
  };
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childHasExited(child)) {
    return true;
  }
  return new Promise<boolean>((resolveExit) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(childHasExited(child));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopUnidentifiedSpawnedChild(
  child: ChildProcess,
  port: number,
  timeoutMs: number,
  portOpenProbe: (port: number) => Promise<boolean>,
): Promise<boolean> {
  if (!childHasExited(child)) {
    child.kill("SIGTERM");
    if (!(await waitForChildExit(child, timeoutMs)) && !childHasExited(child)) {
      child.kill("SIGKILL");
    }
  }
  if (!(await waitForChildExit(child, timeoutMs))) {
    return false;
  }
  return waitForPortClosed(port, timeoutMs, portOpenProbe);
}

function parseLsofListeners(output: string): readonly CodexCdpListener[] {
  const listeners: CodexCdpListener[] = [];
  let pid: number | undefined;
  let commandName = "";
  for (const line of output.split(/\r?\n/u)) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      pid = Number(value);
      commandName = "";
    } else if (field === "c") {
      commandName = value;
    } else if (field === "n" && pid !== undefined && Number.isSafeInteger(pid) && pid > 1) {
      listeners.push({
        pid,
        commandName,
        address: value,
      });
    }
  }
  return listeners;
}

async function isProcessDescendant(
  pid: number,
  ancestorPid: number,
  runner: CommandRunner,
): Promise<boolean> {
  let currentPid = pid;
  const visited = new Set<number>();
  for (let depth = 0; depth < PROCESS_LOOKUP_LIMIT; depth += 1) {
    if (currentPid === ancestorPid) {
      return true;
    }
    if (currentPid <= 1 || visited.has(currentPid)) {
      return false;
    }
    visited.add(currentPid);
    try {
      const snapshot = await inspectProcess(currentPid, runner);
      currentPid = snapshot.parentPid;
    } catch {
      return false;
    }
  }
  return false;
}

export async function verifyCodexCdpListenerOwnership(
  app: CodexMacosAppIdentity,
  mainPid: number,
  port: number,
  runner: CommandRunner = runSystemCommand,
): Promise<CodexCdpListenerOwnership> {
  validatePort(port);
  const mainProcess = await inspectProcess(mainPid, runner);
  if (!commandBelongsToExecutable(mainProcess.command, app.realExecutablePath)) {
    throw discoveryError("GOAL_PROGRESS_CDP_MAIN_EXECUTABLE_MISMATCH");
  }
  const lsofResult = await runner("/usr/sbin/lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-Fpctn",
  ]);
  const listeners = parseLsofListeners(
    requireSuccessfulCommand(lsofResult, "GOAL_PROGRESS_CDP_LISTENER_NOT_FOUND"),
  );
  if (listeners.length === 0) {
    throw discoveryError("GOAL_PROGRESS_CDP_LISTENER_NOT_FOUND");
  }
  const expectedAddress = `${LOOPBACK_ADDRESS}:${port}`;
  if (listeners.some((listener) => listener.address !== expectedAddress)) {
    throw discoveryError(
      "GOAL_PROGRESS_CDP_NON_LOOPBACK_LISTENER",
      listeners.map((listener) => listener.address).join(","),
    );
  }
  const listenerPids = [...new Set(listeners.map((listener) => listener.pid))];
  for (const listenerPid of listenerPids) {
    if (!(await isProcessDescendant(listenerPid, mainPid, runner))) {
      throw discoveryError("GOAL_PROGRESS_CDP_LISTENER_PROCESS_MISMATCH", String(listenerPid));
    }
  }
  return {
    mainProcess,
    listeners,
    listenerPids,
  };
}

export function commandBelongsToExecutable(command: string, executablePath: string): boolean {
  return command === executablePath || command.startsWith(`${executablePath} `);
}

export async function waitForCodexCdpListenerOwnership(
  app: CodexMacosAppIdentity,
  mainPid: number,
  port: number,
  options: {
    readonly runner?: CommandRunner;
    readonly timeoutMs?: number;
    readonly intervalMs?: number;
  } = {},
): Promise<CodexCdpListenerOwnership> {
  const runner = options.runner ?? runSystemCommand;
  const timeoutAt = Date.now() + (options.timeoutMs ?? 30_000);
  let lastError: unknown;
  do {
    try {
      return await verifyCodexCdpListenerOwnership(app, mainPid, port, runner);
    } catch (error) {
      lastError = error;
      await delay(options.intervalMs ?? 250);
    }
  } while (Date.now() < timeoutAt);
  throw discoveryError(
    "GOAL_PROGRESS_CDP_LISTENER_TIMEOUT",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

function validateRuntimeState(state: CodexCdpRuntimeState): void {
  validatePort(state.port);
  if (
    state.schemaVersion !== 1 ||
    state.address !== LOOPBACK_ADDRESS ||
    state.bundleId !== CODEX_BUNDLE_ID ||
    state.teamId !== CODEX_TEAM_ID ||
    !state.launchId ||
    !state.launchedAt ||
    !state.processStartedAt ||
    !isAbsolute(state.executablePath) ||
    !isAbsolute(state.appPath) ||
    !Number.isSafeInteger(state.mainPid) ||
    state.mainPid <= 1 ||
    state.listenerPids.length === 0
  ) {
    throw discoveryError("GOAL_PROGRESS_CDP_INVALID_RUNTIME_STATE");
  }
}

export async function readCodexCdpRuntimeState(statePath: string): Promise<CodexCdpRuntimeState> {
  if (!isAbsolute(statePath)) {
    throw discoveryError("GOAL_PROGRESS_CDP_STATE_PATH_NOT_ABSOLUTE");
  }
  const metadata = await stat(statePath);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw discoveryError("GOAL_PROGRESS_CDP_RUNTIME_STATE_PERMISSION_INVALID");
  }
  let state: CodexCdpRuntimeState;
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as CodexCdpRuntimeState;
  } catch {
    throw discoveryError("GOAL_PROGRESS_CDP_INVALID_RUNTIME_STATE");
  }
  validateRuntimeState(state);
  return state;
}

export async function writeCodexCdpRuntimeState(
  statePath: string,
  state: CodexCdpRuntimeState,
): Promise<void> {
  if (!isAbsolute(statePath)) {
    throw discoveryError("GOAL_PROGRESS_CDP_STATE_PATH_NOT_ABSOLUTE");
  }
  validateRuntimeState(state);
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, statePath);
    await chmod(statePath, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function createCodexCdpRuntimeState(
  app: CodexMacosAppIdentity,
  launched: LaunchedCodexCdpProcess,
  ownership: CodexCdpListenerOwnership,
  port: number,
): CodexCdpRuntimeState {
  if (
    ownership.mainProcess.pid !== launched.pid ||
    ownership.mainProcess.startedAt !== launched.processStartedAt ||
    ownership.mainProcess.command !== launched.command
  ) {
    throw discoveryError("GOAL_PROGRESS_CDP_LAUNCH_IDENTITY_CHANGED");
  }
  return {
    schemaVersion: 1,
    launchId: randomUUID(),
    address: LOOPBACK_ADDRESS,
    port,
    mainPid: launched.pid,
    launchedAt: launched.launchedAt,
    processStartedAt: launched.processStartedAt,
    executablePath: app.realExecutablePath,
    appPath: app.realAppPath,
    bundleId: CODEX_BUNDLE_ID,
    teamId: CODEX_TEAM_ID,
    command: launched.command,
    listenerPids: ownership.listenerPids,
  };
}

interface ProtectedProcessIdentity {
  readonly mainPid: number;
  readonly processStartedAt: string;
  readonly command: string;
  readonly executablePath: string;
  readonly port: number;
}

async function processIdentityMatches(
  identity: ProtectedProcessIdentity,
  runner: CommandRunner,
): Promise<boolean> {
  try {
    const snapshot = await inspectProcess(identity.mainPid, runner);
    return (
      snapshot.startedAt === identity.processStartedAt &&
      snapshot.command === identity.command &&
      (snapshot.command === identity.executablePath ||
        snapshot.command.startsWith(`${identity.executablePath} `))
    );
  } catch {
    return false;
  }
}

async function waitForOriginalProcessExit(
  identity: ProtectedProcessIdentity,
  runner: CommandRunner,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    if (!(await processIdentityMatches(identity, runner))) {
      return true;
    }
    await delay(intervalMs);
  }
  return !(await processIdentityMatches(identity, runner));
}

async function isLoopbackPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolveOpen) => {
    const socket = new Socket();
    const finish = (isOpen: boolean) => {
      socket.destroy();
      resolveOpen(isOpen);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, LOOPBACK_ADDRESS);
  });
}

async function waitForPortClosed(
  port: number,
  timeoutMs: number,
  portOpenProbe: (port: number) => Promise<boolean> = isLoopbackPortOpen,
): Promise<boolean> {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    if (!(await portOpenProbe(port))) {
      return true;
    }
    await delay(100);
  }
  return !(await portOpenProbe(port));
}

async function stopProtectedCodexProcess(
  identity: ProtectedProcessIdentity,
  options: StopCodexCdpOptions,
): Promise<RestoreCodexCdpResult> {
  const runner = options.runner ?? runSystemCommand;
  const signalProcess = options.signalProcess ?? process.kill.bind(process);
  const timeoutMs = options.timeoutMs ?? PROCESS_STOP_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 100;
  if (await processIdentityMatches(identity, runner)) {
    signalProcess(identity.mainPid, "SIGTERM");
  }
  let forced = false;
  if (!(await waitForOriginalProcessExit(identity, runner, timeoutMs, intervalMs))) {
    if (await processIdentityMatches(identity, runner)) {
      forced = true;
      signalProcess(identity.mainPid, "SIGKILL");
    }
    if (!(await waitForOriginalProcessExit(identity, runner, timeoutMs, intervalMs))) {
      throw discoveryError("GOAL_PROGRESS_CDP_RUNTIME_STOP_FAILED");
    }
  }
  const portClosed = await waitForPortClosed(identity.port, timeoutMs);
  if (!portClosed) {
    throw discoveryError("GOAL_PROGRESS_CDP_PORT_STILL_OPEN");
  }
  return {
    mainPid: identity.mainPid,
    forced,
    portClosed,
  };
}

export async function stopLaunchedCodexCdpProcess(
  app: CodexMacosAppIdentity,
  launched: LaunchedCodexCdpProcess,
  port: number,
  options: StopCodexCdpOptions = {},
): Promise<RestoreCodexCdpResult> {
  validatePort(port);
  return stopProtectedCodexProcess(
    {
      mainPid: launched.pid,
      processStartedAt: launched.processStartedAt,
      command: launched.command,
      executablePath: app.realExecutablePath,
      port,
    },
    options,
  );
}

export async function stopCodexCdpRuntime(
  state: CodexCdpRuntimeState,
  options: StopCodexCdpOptions = {},
): Promise<RestoreCodexCdpResult> {
  validateRuntimeState(state);
  return stopProtectedCodexProcess(
    {
      mainPid: state.mainPid,
      processStartedAt: state.processStartedAt,
      command: state.command,
      executablePath: state.executablePath,
      port: state.port,
    },
    options,
  );
}
