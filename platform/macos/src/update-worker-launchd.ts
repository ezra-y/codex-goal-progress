import { spawnSync } from "node:child_process";
import { isSea } from "node:sea";

export interface UpdateWorkerLaunchctlInvocation {
  readonly label: string;
  readonly command: "/bin/launchctl";
  readonly args: readonly string[];
  readonly removeArgs: readonly string[];
  readonly options: {
    readonly shell: false;
    readonly stdio: "ignore";
    readonly env: Readonly<Record<string, string>>;
  };
}

export type UpdateWorkerLaunchctlRunner = (
  command: string,
  args: readonly string[],
  options: UpdateWorkerLaunchctlInvocation["options"],
) => { readonly status: number | null };

export const GOAL_PROGRESS_UPDATE_WORKER_NOTIFY_DELAYS_MS = [0, 250, 750] as const;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function notifyUpdateWorkerResult(
  send: () => Promise<void>,
  delaysMs: readonly number[] = GOAL_PROGRESS_UPDATE_WORKER_NOTIFY_DELAYS_MS,
): Promise<boolean> {
  for (const delayMs of delaysMs) {
    if (delayMs > 0) {
      await delay(delayMs);
    }
    try {
      await send();
      return true;
    } catch {
      // A later bounded attempt may reach the replacement Helper.
    }
  }
  return false;
}

export interface CreateUpdateWorkerInvocationInput {
  readonly execPath: string;
  readonly argvEntry: string;
  readonly execArgv: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly operationId: string;
  readonly sea?: boolean;
}

function programArguments(
  input: CreateUpdateWorkerInvocationInput,
  internalCommand: string,
): readonly string[] {
  return (input.sea ?? input.argvEntry === input.execPath)
    ? [input.execPath, internalCommand]
    : [input.execPath, ...input.execArgv, input.argvEntry, internalCommand];
}

export function createUpdateWorkerInvocation(
  input: CreateUpdateWorkerInvocationInput,
  kind: "install" | "restart",
): UpdateWorkerLaunchctlInvocation {
  const homeDirectory = input.environment.HOME;
  const root = input.environment.GOAL_PROGRESS_ROOT;
  if (!homeDirectory || !root) {
    throw new Error("GOAL_PROGRESS_UPDATE_WORKER_ENVIRONMENT_INVALID");
  }
  const internalCommand =
    kind === "install" ? "__update-install-handoff" : "__update-restart-handoff";
  const internalFlag =
    kind === "install"
      ? "GOAL_PROGRESS_INTERNAL_UPDATE_INSTALL"
      : "GOAL_PROGRESS_INTERNAL_UPDATE_RESTART";
  const environment = {
    HOME: homeDirectory,
    GOAL_PROGRESS_ROOT: root,
    [internalFlag]: "1",
    GOAL_PROGRESS_UPDATE_OPERATION_ID: input.operationId,
  };
  const label = `com.codexgoalprogress.update-${kind}.${input.operationId}`;
  return {
    label,
    command: "/bin/launchctl",
    args: [
      "submit",
      "-l",
      label,
      "--",
      "/usr/bin/env",
      ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      ...programArguments(input, internalCommand),
    ],
    removeArgs: ["remove", label],
    options: {
      shell: false,
      stdio: "ignore",
      env: environment,
    },
  };
}

export function submitUpdateWorker(
  invocation: UpdateWorkerLaunchctlInvocation,
  runner: UpdateWorkerLaunchctlRunner = (command, args, options) =>
    spawnSync(command, [...args], options),
): void {
  const result = runner(invocation.command, invocation.args, invocation.options);
  if (result.status !== 0) {
    throw new Error(
      invocation.label.includes("update-install")
        ? "GOAL_PROGRESS_UPDATE_INSTALL_SUBMIT_FAILED"
        : "GOAL_PROGRESS_UPDATE_RESTART_SUBMIT_FAILED",
    );
  }
}

export function currentUpdateWorkerInvocationInput(
  operationId: string,
): CreateUpdateWorkerInvocationInput {
  return {
    execPath: process.execPath,
    argvEntry: process.argv[1] ?? process.execPath,
    execArgv: process.execArgv,
    environment: process.env,
    operationId,
    sea: isSea(),
  };
}
