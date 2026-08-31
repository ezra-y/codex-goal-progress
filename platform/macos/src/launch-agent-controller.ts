import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWriteFile } from "../../../packages/store/src/index.js";
import type { MacosInstallationLayout } from "./install-layout.js";
import { isNotFound } from "./macos-errors.js";
import type { CodexInstallIdentity } from "./verified-release.js";

export interface LaunchAgentController {
  ensure(label: string, plistPath: string, restart: boolean): Promise<boolean>;
  remove(label: string, plistPath: string): Promise<boolean>;
  isLoaded(label: string): Promise<boolean>;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function launchAgentPlist(
  layout: MacosInstallationLayout,
  codex: CodexInstallIdentity,
): string {
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

export async function writeIfChanged(path: string, contents: string): Promise<boolean> {
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

function runLaunchctl(args: readonly string[]): { readonly status: number } {
  const result = spawnSync("/bin/launchctl", [...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return { status: result.status ?? 1 };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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
