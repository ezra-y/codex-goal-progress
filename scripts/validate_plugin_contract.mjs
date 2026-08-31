import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const pluginRoot = resolve(process.argv[2] ?? ".");
const errors = [];
const pluginDataPlaceholder = "$" + "{PLUGIN_DATA}";
const stableHookCommand =
  '/bin/sh -c \'p="$HOME/Library/Application Support/CodexGoalProgress/install/current/bin/goal-progress"; [ -x "$p" ] || exit 0; exec "$p" hook\'';
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function rejectUnknownFields(value, allowed, label) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${label} field '${key}' is not accepted`);
    }
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} must be a non-empty string`);
  }
}

function validateOptionalString(value, field) {
  if (value !== undefined) {
    requireString(value, field);
  }
}

function validateOptionalHttpsUrl(value, field) {
  if (value === undefined) {
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname === "") {
      throw new Error("invalid HTTPS URL");
    }
  } catch {
    errors.push(`${field} must be an absolute https:// URL`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateHookEvent(
  hookEvents,
  eventName,
  expectedMatcher,
  expectedAdditionalContextLimit,
  expectedTimeout,
  expectedAsync,
) {
  const groups = hookEvents[eventName];
  if (!Array.isArray(groups) || groups.length !== 1 || !isObject(groups[0])) {
    errors.push(`hooks/hooks.json must define exactly one ${eventName} group`);
    return;
  }

  const group = groups[0];
  rejectUnknownFields(group, new Set(["matcher", "hooks"]), `${eventName} hook group`);
  if (expectedMatcher === undefined) {
    if (group.matcher !== undefined) {
      errors.push(`${eventName} must not define a matcher`);
    }
  } else if (group.matcher !== expectedMatcher) {
    errors.push(`${eventName} matcher must be '${expectedMatcher}'`);
  }

  if (!Array.isArray(group.hooks) || group.hooks.length !== 1 || !isObject(group.hooks[0])) {
    errors.push(`${eventName} must define exactly one command handler`);
    return;
  }

  const handler = group.hooks[0];
  rejectUnknownFields(
    handler,
    new Set(["type", "command", "timeout", "async", "additionalContextLimit"]),
    `${eventName} handler`,
  );
  if (handler.type !== "command") {
    errors.push(`${eventName} handler type must be 'command'`);
  }
  if (handler.command !== stableHookCommand) {
    errors.push(`${eventName} handler command must use the stable installed Hook`);
  }
  if (handler.timeout !== expectedTimeout) {
    errors.push(`${eventName} handler timeout must be ${expectedTimeout} seconds`);
  }
  if (expectedAsync === undefined) {
    if (handler.async !== undefined) {
      errors.push(`${eventName} handler must not define async`);
    }
  } else if (handler.async !== expectedAsync) {
    errors.push(`${eventName} handler async must be ${expectedAsync}`);
  }
  if (expectedAdditionalContextLimit === undefined) {
    if (handler.additionalContextLimit !== undefined) {
      errors.push(`${eventName} handler must not define additionalContextLimit`);
    }
  } else if (handler.additionalContextLimit !== expectedAdditionalContextLimit) {
    errors.push(
      `${eventName} handler additionalContextLimit must be ${expectedAdditionalContextLimit}`,
    );
  }
}

async function readJson(path, label) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(value)) {
      errors.push(`${label} must contain an object`);
      return null;
    }
    return value;
  } catch (error) {
    errors.push(`${label} must contain valid JSON: ${error.message}`);
    return null;
  }
}

async function readYaml(path, label) {
  try {
    const value = parseYaml(await readFile(path, "utf8"));
    if (!isObject(value)) {
      errors.push(`${label} must contain an object`);
      return null;
    }
    return value;
  } catch (error) {
    errors.push(`${label} must contain valid YAML: ${error.message}`);
    return null;
  }
}

async function validateSkill(skillRoot, directoryName) {
  const label = `skill '${directoryName}'`;
  let skillText;
  try {
    skillText = await readFile(resolve(skillRoot, "SKILL.md"), "utf8");
  } catch {
    errors.push(`${label} is missing SKILL.md`);
    return;
  }

  const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatter) {
    errors.push(`${label} frontmatter is not closed`);
    return;
  }

  let skillMetadata;
  try {
    skillMetadata = parseYaml(frontmatter[1]);
  } catch (error) {
    errors.push(`${label} frontmatter must contain valid YAML: ${error.message}`);
    return;
  }
  if (!isObject(skillMetadata)) {
    errors.push(`${label} frontmatter must contain an object`);
    return;
  }
  rejectUnknownFields(
    skillMetadata,
    new Set(["name", "description", "license", "allowed-tools", "metadata"]),
    `${label} frontmatter`,
  );
  requireString(skillMetadata.name, `${label} field 'name'`);
  requireString(skillMetadata.description, `${label} field 'description'`);
  if (
    typeof skillMetadata.name === "string" &&
    (!/^[a-z0-9-]+$/.test(skillMetadata.name) ||
      skillMetadata.name.startsWith("-") ||
      skillMetadata.name.endsWith("-") ||
      skillMetadata.name.includes("--") ||
      skillMetadata.name.length > 64)
  ) {
    errors.push(`${label} field 'name' must be a valid hyphen-case name`);
  }
  if (
    typeof skillMetadata.description === "string" &&
    (skillMetadata.description.includes("<") ||
      skillMetadata.description.includes(">") ||
      skillMetadata.description.length > 1024)
  ) {
    errors.push(`${label} field 'description' is not accepted`);
  }

  const agent = await readYaml(resolve(skillRoot, "agents/openai.yaml"), `${label} openai.yaml`);
  if (!agent) {
    return;
  }
  rejectUnknownFields(agent, new Set(["interface", "policy", "dependencies"]), `${label} agent`);
  rejectUnknownFields(
    agent.interface,
    new Set([
      "display_name",
      "short_description",
      "icon_small",
      "icon_large",
      "brand_color",
      "default_prompt",
    ]),
    `${label} agent interface`,
  );
  requireString(agent.interface?.display_name, `${label} agent interface.display_name`);
  requireString(agent.interface?.short_description, `${label} agent interface.short_description`);
  rejectUnknownFields(
    agent.policy,
    new Set(["allow_implicit_invocation"]),
    `${label} agent policy`,
  );
  if (agent.policy?.allow_implicit_invocation !== false) {
    errors.push(`${label} must set policy.allow_implicit_invocation to false`);
  }
}

const manifest = await readJson(
  resolve(pluginRoot, ".codex-plugin/plugin.json"),
  ".codex-plugin/plugin.json",
);
if (manifest) {
  rejectUnknownFields(
    manifest,
    new Set([
      "id",
      "name",
      "version",
      "description",
      "skills",
      "apps",
      "mcpServers",
      "hooks",
      "interface",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
    ]),
    "plugin.json",
  );
  requireString(manifest.name, "plugin.json name");
  requireString(manifest.version, "plugin.json version");
  if (typeof manifest.version === "string" && !semver.test(manifest.version)) {
    errors.push("plugin.json version must use strict semver");
  }
  requireString(manifest.description, "plugin.json description");
  rejectUnknownFields(manifest.author, new Set(["name", "email", "url"]), "plugin.json author");
  requireString(manifest.author?.name, "plugin.json author.name");
  validateOptionalString(manifest.author?.email, "plugin.json author.email");
  validateOptionalHttpsUrl(manifest.author?.url, "plugin.json author.url");
  if (manifest.skills?.replace(/^\.\//, "").replace(/\/$/, "") !== "skills") {
    errors.push("plugin.json skills must resolve to 'skills'");
  }
  if (manifest.mcpServers !== "./.mcp.json") {
    errors.push("plugin.json mcpServers must resolve to './.mcp.json'");
  }
  if (manifest.hooks !== "./hooks/hooks.json") {
    errors.push("plugin.json hooks must resolve to './hooks/hooks.json'");
  }

  rejectUnknownFields(
    manifest.interface,
    new Set([
      "displayName",
      "shortDescription",
      "longDescription",
      "developerName",
      "category",
      "capabilities",
      "websiteURL",
      "privacyPolicyURL",
      "termsOfServiceURL",
      "brandColor",
      "composerIcon",
      "logo",
      "logoDark",
      "screenshots",
      "defaultPrompt",
      "default_prompt",
    ]),
    "plugin.json interface",
  );
  for (const field of [
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
  ]) {
    requireString(manifest.interface?.[field], `plugin.json interface.${field}`);
  }
  for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    validateOptionalHttpsUrl(manifest.interface?.[field], `plugin.json interface.${field}`);
  }
  if (
    manifest.interface?.brandColor !== undefined &&
    (typeof manifest.interface.brandColor !== "string" ||
      !/^#[0-9A-F]{6}$/i.test(manifest.interface.brandColor))
  ) {
    errors.push("plugin.json interface.brandColor must use #RRGGBB");
  }
  if (
    !Array.isArray(manifest.interface?.capabilities) ||
    !manifest.interface.capabilities.every(
      (value) => typeof value === "string" && value.trim() !== "",
    )
  ) {
    errors.push("plugin.json interface.capabilities must be an array of strings");
  }
  const prompts = manifest.interface?.defaultPrompt ?? manifest.interface?.default_prompt;
  if (
    !Array.isArray(prompts) ||
    prompts.length === 0 ||
    !prompts.every((value) => typeof value === "string" && value.trim() !== "")
  ) {
    errors.push("plugin.json interface.defaultPrompt must be a non-empty string array");
  }

  try {
    for (const entry of await readdir(resolve(pluginRoot, "skills"), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await validateSkill(resolve(pluginRoot, "skills", entry.name), entry.name);
      }
    }
  } catch {
    errors.push("plugin archive is missing the skills directory");
  }

  const mcpConfig = await readJson(resolve(pluginRoot, ".mcp.json"), ".mcp.json");
  const mcpServer = mcpConfig?.goal_progress;
  if (!isObject(mcpServer)) {
    errors.push(".mcp.json must define the 'goal_progress' server");
  } else {
    rejectUnknownFields(
      mcpServer,
      new Set(["command", "args", "env", "cwd"]),
      ".mcp.json goal_progress server",
    );
    if (mcpServer.command !== "./bin/goal-progress-mcp") {
      errors.push(".mcp.json goal_progress command must use the stable installed MCP launcher");
    }
    if (!Array.isArray(mcpServer.args) || mcpServer.args.length !== 0) {
      errors.push(".mcp.json goal_progress args must be empty");
    }
    if (mcpServer.cwd !== ".") {
      errors.push(".mcp.json goal_progress cwd must resolve from the plugin root");
    }
    if (
      !isObject(mcpServer.env) ||
      mcpServer.env.GOAL_PROGRESS_PLUGIN_DATA !== pluginDataPlaceholder
    ) {
      errors.push(".mcp.json goal_progress env must bind the Plugin data root");
    }
  }

  const hooksConfig = await readJson(resolve(pluginRoot, "hooks/hooks.json"), "hooks/hooks.json");
  if (hooksConfig) {
    rejectUnknownFields(hooksConfig, new Set(["description", "hooks"]), "hooks/hooks.json");
    requireString(hooksConfig.description, "hooks/hooks.json description");
  }
  const hookEvents = hooksConfig?.hooks;
  if (!isObject(hookEvents)) {
    errors.push("hooks/hooks.json must define a hooks object");
  } else {
    rejectUnknownFields(
      hookEvents,
      new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"]),
      "hooks/hooks.json hooks",
    );
    if ("UserPromptSubmit" in hookEvents) {
      errors.push("hooks/hooks.json must not define Goal Progress UserPromptSubmit hooks");
    }
    validateHookEvent(hookEvents, "SessionStart", "^(?:startup|resume|compact)$", 128, 3);
    validateHookEvent(
      hookEvents,
      "PreToolUse",
      "^(?:goal_progress_|.*[^A-Za-z0-9]goal_progress[^A-Za-z0-9]+goal_progress_)(?:activate|initialize|get|update|rescope|set_phase)$",
      undefined,
      3,
    );
    validateHookEvent(hookEvents, "PostToolUse", "^update_goal$", 64, 2, true);
  }
}

if (errors.length > 0) {
  console.error("Plugin contract validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Plugin contract validation passed: ${pluginRoot}`);
