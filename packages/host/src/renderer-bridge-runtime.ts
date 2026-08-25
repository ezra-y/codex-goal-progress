import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectCodexMacosApp,
  readCodexCdpRuntimeState,
  verifyCodexCdpListenerOwnership,
} from "../../../platform/macos/src/index.js";
import {
  connectGoalProgressRendererBridge,
  createGoalProgressRendererBundle,
  GoalProgressCdpViewClient,
  type GoalProgressRendererBridge,
} from "../../codex-adapter/src/index.js";
import type { GoalProgressPaths } from "../../store/src/index.js";

export interface ResolveHelperRendererBundleDirectoryOptions {
  readonly configuredDirectory?: string;
  readonly executablePath?: string;
  readonly moduleUrl?: string | undefined;
}

export async function resolveHelperRendererBundleDirectory(
  options: ResolveHelperRendererBundleDirectoryOptions = {},
): Promise<string> {
  const configured =
    "configuredDirectory" in options
      ? options.configuredDirectory
      : process.env.GOAL_PROGRESS_RENDERER_BUNDLE_DIR;
  if (configured) {
    return resolve(configured);
  }
  const executablePath = "executablePath" in options ? options.executablePath : process.execPath;
  const moduleUrl =
    "moduleUrl" in options
      ? options.moduleUrl
      : typeof import.meta.url === "string"
        ? import.meta.url
        : undefined;
  const candidates = executablePath ? [resolve(dirname(executablePath), "../renderer")] : [];
  if (moduleUrl) {
    candidates.push(
      fileURLToPath(new URL("../../../renderer/", moduleUrl)),
      fileURLToPath(new URL("../../../dist/renderer/", moduleUrl)),
    );
  }
  for (const candidate of candidates) {
    try {
      await readFile(resolve(candidate, "goal-progress.manifest.json"));
      return candidate;
    } catch {
      // Try the source-tree or built-tree location next.
    }
  }
  throw new Error("GOAL_PROGRESS_RENDERER_BUNDLE_NOT_FOUND");
}

export async function connectHelperRendererBridge(
  paths: GoalProgressPaths,
): Promise<GoalProgressRendererBridge | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const statePath = resolve(paths.runtimeRoot, "cdp.json");
  let state: Awaited<ReturnType<typeof readCodexCdpRuntimeState>>;
  try {
    state = await readCodexCdpRuntimeState(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
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
  const ownership = await verifyCodexCdpListenerOwnership(app, state.mainPid, state.port);
  if (
    ownership.mainProcess.startedAt !== state.processStartedAt ||
    ownership.mainProcess.command !== state.command
  ) {
    throw new Error("GOAL_PROGRESS_CDP_RUNTIME_OWNERSHIP_CHANGED");
  }
  const bundleDirectory = await resolveHelperRendererBundleDirectory();
  const [source, manifestText] = await Promise.all([
    readFile(resolve(bundleDirectory, "goal-progress.js"), "utf8"),
    readFile(resolve(bundleDirectory, "goal-progress.manifest.json"), "utf8"),
  ]);
  const bundle = createGoalProgressRendererBundle(source, JSON.parse(manifestText));
  const viewClient = new GoalProgressCdpViewClient(paths.helperSocketPath);
  return (
    await connectGoalProgressRendererBridge({
      port: state.port,
      bundle,
      platform: "macos",
      appVersion: app.shortVersion,
      onUiIntent: (threadId, intent) => viewClient.applyUiIntent(threadId, intent),
      environment: {
        appPath: app.realAppPath,
        appSignatureValid: app.signatureValid,
      },
    })
  ).bridge;
}
