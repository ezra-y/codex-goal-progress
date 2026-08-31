import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { runHookCli } from "../../../hooks/src/index.js";
import { runHelperCli } from "../../../packages/host/src/index.js";
import { runMcpServer } from "../../../packages/mcp/src/index.js";
import {
  executeMacosCommand,
  MACOS_COMMAND_NAMES,
  serializeMacosCommandResult,
  serializeMacosCommandResultHuman,
} from "./command-protocol.js";
import {
  createMacosCommandHandlers,
  GOAL_PROGRESS_CDP_HANDOFF_COMMAND,
  GOAL_PROGRESS_CDP_SCHEDULE_COMMAND,
  GOAL_PROGRESS_RESTORE_HANDOFF_COMMAND,
  runCodexCdpHandoff,
  runCodexRestoreHandoff,
  scheduleCodexCdpHandoff,
} from "./installer.js";
import {
  GOAL_PROGRESS_UPDATE_INSTALL_HANDOFF_COMMAND,
  runUpdateInstallHandoffFromEnvironment,
} from "./update-install-handoff.js";
import {
  GOAL_PROGRESS_UPDATE_RESTART_HANDOFF_COMMAND,
  runUpdateRestartHandoffFromEnvironment,
} from "./update-restart-handoff.js";

export interface RunGoalProgressCliOptions {
  readonly homeDirectory?: string;
  readonly releaseRoot?: string;
}

export async function runGoalProgressCli(
  argv: readonly string[] = process.argv.slice(2),
  options: RunGoalProgressCliOptions = {},
): Promise<void> {
  const command = argv[0];
  if (command === GOAL_PROGRESS_UPDATE_INSTALL_HANDOFF_COMMAND) {
    await runUpdateInstallHandoffFromEnvironment();
    return;
  }
  if (command === GOAL_PROGRESS_UPDATE_RESTART_HANDOFF_COMMAND) {
    await runUpdateRestartHandoffFromEnvironment();
    return;
  }
  if (command === GOAL_PROGRESS_CDP_HANDOFF_COMMAND) {
    await runCodexCdpHandoff(resolve(options.homeDirectory ?? process.env.HOME ?? homedir()));
    return;
  }
  if (command === GOAL_PROGRESS_CDP_SCHEDULE_COMMAND) {
    await scheduleCodexCdpHandoff();
    return;
  }
  if (command === GOAL_PROGRESS_RESTORE_HANDOFF_COMMAND) {
    await runCodexRestoreHandoff(resolve(options.homeDirectory ?? process.env.HOME ?? homedir()));
    return;
  }
  if (command === "hook") {
    await runHookCli();
    return;
  }
  if (command === "mcp-server") {
    await runMcpServer();
    return;
  }
  if (command !== undefined && (MACOS_COMMAND_NAMES as readonly string[]).includes(command)) {
    const result = await executeMacosCommand(
      argv,
      createMacosCommandHandlers({
        homeDirectory: resolve(options.homeDirectory ?? process.env.HOME ?? homedir()),
        releaseRoot: resolve(
          options.releaseRoot ??
            process.env.GOAL_PROGRESS_RELEASE_ROOT ??
            resolve(dirname(process.execPath), ".."),
        ),
      }),
    );
    process.stdout.write(
      argv.includes("--human")
        ? serializeMacosCommandResultHuman(result, argv.includes("--verbose"))
        : serializeMacosCommandResult(result),
    );
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }
  await runHelperCli(argv);
}
