import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  acceptGoalProgressUiIntent,
  type CodexAppServerRuntime,
  CurrentThreadResolverError,
  type CurrentThreadResolverInput,
  createCodexAppServerRuntime,
  type GoalProgressRendererBridgeDoctor,
  type GoalUsageSnapshot,
} from "../../codex-adapter/src/index.js";
import {
  DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
  GOAL_NATIVE_OBJECTIVE_MAX_LENGTH,
  type GoalContract,
  type GoalContractAny,
  type GoalContractInitialization,
  type GoalEvidence,
  type GoalObjective,
  type GoalProgressCommand,
  type GoalProgressTrackingOverlay,
  type GoalProgressUiPreference,
  type GoalProgressViewModel,
  GoalProgressViewModelSchema,
  issueRuntimeProof,
  type RuntimeContext,
  type RuntimeIdentity,
  type RuntimeProof,
  type ThreadGoal,
  verifyRuntimeProof,
} from "../../contracts/src/index.js";
import {
  hashNativeGoalObjective,
  migrateGoalContractV1ToV2,
  normalizeGoalProgressObjectiveBody,
  type ProjectViewModelOptions,
  planGoalProgressActivation,
  projectGoalProgressViewModel,
} from "../../core/src/index.js";
import {
  consumeRuntimeProofOnce,
  GOAL_PROGRESS_IPC_PROTOCOL_VERSION,
  type GoalProgressActivationResumeResult,
  GoalProgressIpcClient,
  GoalProgressIpcClientError,
  type GoalProgressIpcConnectionContext,
  type GoalProgressIpcHandler,
  GoalProgressIpcHandlerError,
  GoalProgressIpcServer,
  loadOrCreateRuntimeProofKey,
} from "../../ipc/src/index.js";
import {
  acquireHelperInstanceLock,
  atomicWriteFile,
  GoalEventStore,
  type GoalEventStoreOptions,
  type GoalEventStoreWriteSuccess,
  GoalProgressLogger,
  type GoalProgressLoggerOptions,
  type GoalProgressLogInput,
  type GoalProgressPaths,
  GoalProgressStoreError,
  type HelperInstanceLock,
  type HelperLockOptions,
  hashGoalProgressIdentity,
  readCurrentHelperIdentity,
  readGoalProgressTrackingOverlay,
  readGoalProgressUiPreference,
  resolveGoalProgressPaths,
  resolveGoalProgressSessionPaths,
  writeGoalProgressTrackingOverlay,
  writeGoalProgressUiPreference,
} from "../../store/src/index.js";
import { connectHelperRendererBridge } from "./renderer-bridge-runtime.js";
import { RendererBridgeSupervisor } from "./renderer-bridge-supervisor.js";
import { ViewModelPublisher, type ViewModelPublisherSink } from "./view-model-publisher.js";

export {
  RendererBridgeSupervisor,
  type RendererBridgeSupervisorConnection,
} from "./renderer-bridge-supervisor.js";
export {
  ViewModelPublisher,
  type ViewModelPublisherSink,
} from "./view-model-publisher.js";

export const HELPER_VISIBLE_THREAD_RECOVERY_DELAYS_MS = [
  0, 1_000, 2_000, 5_000, 10_000, 30_000,
] as const;
export const HELPER_VISIBLE_THREAD_WATCH_INTERVAL_MS = 2_000;

export interface GoalProgressHelperOptions {
  readonly paths?: GoalProgressPaths;
  readonly lock?: HelperLockOptions;
  readonly store?: GoalEventStoreOptions;
  readonly logger?: GoalProgressLoggerOptions;
  readonly runtime?: CodexAppServerRuntime;
  readonly resolveNativeGoal?: NativeGoalResolver;
  readonly resolveCurrentThread?: ResolveCurrentThread;
  readonly viewModelSink?: ViewModelPublisherSink;
  readonly rendererDoctor?: (
    expectedThreadId?: string,
  ) => Promise<GoalProgressRendererBridgeDoctor>;
  readonly visibleThreadRecoveryDelaysMs?: readonly number[];
  readonly visibleThreadWatchIntervalMs?: number;
}

export interface TrustedNativeGoal {
  readonly threadId: string;
  readonly objective: string;
  readonly status: ThreadGoal["status"];
  readonly createdAt: number;
  readonly tokenBudget?: number | null;
}

export type NativeGoalResolver = (threadId: string) => Promise<TrustedNativeGoal | null>;
export type ResolveCurrentThread = (input: CurrentThreadResolverInput) => Promise<RuntimeIdentity>;

const GoalProgressDetachReasonSchema = z.enum([
  "user-dismissed-preparation",
  "user-detached-tracking",
  "native-goal-ended",
  "native-goal-replaced",
  "stale-contract",
  "unavailable",
]);
type GoalProgressDetachReason = z.infer<typeof GoalProgressDetachReasonSchema>;

const GoalProgressActivationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    detachReason: GoalProgressDetachReasonSchema.nullable(),
  })
  .strict();
type GoalProgressActivationState = z.infer<typeof GoalProgressActivationStateSchema>;

const DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE: GoalProgressActivationState = {
  schemaVersion: 1,
  detachReason: null,
};

interface GoalProgressActivationStateSnapshot {
  readonly state: GoalProgressActivationState;
  readonly exists: boolean;
}

function activationStatePath(threadId: string, paths: GoalProgressPaths): string {
  return resolve(resolveGoalProgressSessionPaths(paths, threadId).directory, "activation.json");
}

async function readGoalProgressActivationStateSnapshot(
  threadId: string,
  paths: GoalProgressPaths,
): Promise<GoalProgressActivationStateSnapshot> {
  try {
    const parsed = GoalProgressActivationStateSchema.safeParse(
      JSON.parse(await readFile(activationStatePath(threadId, paths), "utf8")),
    );
    return {
      state: parsed.success ? parsed.data : DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
      exists: true,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        state: DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
        exists: false,
      };
    }
    throw error;
  }
}

async function readGoalProgressActivationState(
  threadId: string,
  paths: GoalProgressPaths,
): Promise<GoalProgressActivationState> {
  return (await readGoalProgressActivationStateSnapshot(threadId, paths)).state;
}

function isUserDetachedActivationState(state: GoalProgressActivationState): boolean {
  return (
    state.detachReason === "user-dismissed-preparation" ||
    state.detachReason === "user-detached-tracking"
  );
}

async function writeGoalProgressActivationState(
  threadId: string,
  paths: GoalProgressPaths,
  state: GoalProgressActivationState,
): Promise<GoalProgressActivationState> {
  const parsed = GoalProgressActivationStateSchema.parse(state);
  await atomicWriteFile(
    activationStatePath(threadId, paths),
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  return parsed;
}

export function resolveGoalProgressCodexCommand(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const command = environment.GOAL_PROGRESS_CODEX_COMMAND?.trim();
  return command ? command : undefined;
}

export interface GoalProgressDoctorResult {
  readonly schemaVersion: 1;
  readonly protocolVersion: typeof GOAL_PROGRESS_IPC_PROTOCOL_VERSION;
  readonly root: string;
  readonly helper: {
    readonly running: boolean;
    readonly pid: number | null;
    readonly instanceId: string | null;
  };
  readonly ipc: {
    readonly socketExists: boolean;
    readonly socketMode: number | null;
    readonly reachable: boolean;
    readonly code: string | null;
  };
  readonly store:
    | {
        readonly checked: false;
      }
    | {
        readonly checked: true;
        readonly sessionKey: string;
        readonly revision: number | null;
        readonly eventCount: number | null;
        readonly code: string | null;
      };
  readonly storeSmoke:
    | {
        readonly checked: false;
      }
    | {
        readonly checked: true;
        readonly readable: boolean;
        readonly sessionCount: number | null;
        readonly code: string | null;
      };
  readonly runtime: {
    readonly app: {
      readonly path: string | null;
      readonly signatureValid: boolean | null;
    };
    readonly cdp: {
      readonly port: number | null;
      readonly loopback: boolean | null;
      readonly targetUrl: string | null;
    };
    readonly renderer: {
      readonly adapterId: string | null;
      readonly capabilitySupported: boolean | null;
      readonly capabilityReason: string | null;
      readonly anchorMatched: boolean | null;
      readonly componentCount: number | null;
      readonly bundleReleaseVersion: string | null;
      readonly bundlePageHostVersion: number | null;
      readonly bundleSha256: string | null;
      readonly latestViewModelRevision: number | null;
      readonly currentThreadMatched: boolean | null;
    };
    readonly goal: {
      readonly actualThreadProven: boolean | null;
      readonly nativeGoalBindingMatches: boolean | null;
      readonly tokenAvailability: "available" | "stale" | "unavailable" | "unknown";
    };
    readonly lastErrorCode: string | null;
  };
}

function emptyDoctorRuntime(lastErrorCode: string | null): GoalProgressDoctorResult["runtime"] {
  return {
    app: { path: null, signatureValid: null },
    cdp: { port: null, loopback: null, targetUrl: null },
    renderer: {
      adapterId: null,
      capabilitySupported: null,
      capabilityReason: null,
      anchorMatched: null,
      componentCount: null,
      bundleReleaseVersion: null,
      bundlePageHostVersion: null,
      bundleSha256: null,
      latestViewModelRevision: null,
      currentThreadMatched: null,
    },
    goal: {
      actualThreadProven: null,
      nativeGoalBindingMatches: null,
      tokenAvailability: "unknown",
    },
    lastErrorCode,
  };
}

function errorCode(error: unknown): string {
  if (
    error instanceof GoalProgressStoreError ||
    error instanceof GoalProgressIpcClientError ||
    error instanceof GoalProgressIpcHandlerError
  ) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

function diagnosticCauseCode(error: unknown): string {
  const candidate = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    "code" in candidate &&
    typeof candidate.code === "string" &&
    candidate.code.trim()
  ) {
    return candidate.code.slice(0, 128);
  }
  if (candidate instanceof Error) {
    const stablePrefix = /^([A-Z][A-Z0-9_]{2,127})/.exec(candidate.message)?.[1];
    return stablePrefix ?? candidate.name.slice(0, 128);
  }
  return `UNKNOWN_${typeof candidate}`.slice(0, 128);
}

function handlerError(error: unknown): GoalProgressIpcHandlerError {
  if (error instanceof GoalProgressIpcHandlerError) {
    return error;
  }
  if (error instanceof GoalProgressStoreError) {
    return new GoalProgressIpcHandlerError(
      error.code,
      error.message,
      error.committedRevision ?? null,
    );
  }
  return new GoalProgressIpcHandlerError(
    "INTERNAL_ERROR",
    "Goal Progress Helper request failed",
    null,
    undefined,
    error,
  );
}

function sanitizeModelEvidence(evidence: GoalEvidence): GoalEvidence {
  return {
    ...evidence,
    source: "model",
    verification: "reported",
  };
}

function sanitizeModelObjective(objective: GoalObjective): GoalObjective {
  return {
    ...objective,
    evidence: objective.evidence.map(sanitizeModelEvidence),
    items: objective.items.map((item) => ({
      ...item,
      evidence: item.evidence.map(sanitizeModelEvidence),
    })),
  };
}

function mapNativeGoalStatus(
  status: TrustedNativeGoal["status"],
): GoalContract["nativeGoal"]["status"] {
  if (status === "complete") {
    return "complete";
  }
  if (status === "paused") {
    return "paused";
  }
  if (status === "blocked" || status === "usageLimited" || status === "budgetLimited") {
    return "blocked";
  }
  return "active";
}

function mapNativeGoalBlockedReason(
  status: TrustedNativeGoal["status"],
): GoalContract["nativeGoal"]["blockedReason"] {
  if (status === "usageLimited") {
    return "usage-limit";
  }
  if (status === "budgetLimited") {
    return "budget-limit";
  }
  return status === "blocked" ? "native-goal" : undefined;
}

function contractNativeGoal(nativeGoal: TrustedNativeGoal): GoalContract["nativeGoal"] {
  const blockedReason = mapNativeGoalBlockedReason(nativeGoal.status);
  return {
    objective: nativeGoal.objective,
    status: mapNativeGoalStatus(nativeGoal.status),
    ...(blockedReason ? { blockedReason } : {}),
    ...(nativeGoal.tokenBudget === null || nativeGoal.tokenBudget === undefined
      ? {}
      : { tokenBudget: nativeGoal.tokenBudget }),
  };
}

function createModelContract(
  initialization: GoalContractInitialization,
  nativeGoal: TrustedNativeGoal,
  identity: RuntimeIdentity,
  occurredAt: string,
): GoalContract {
  const nativeGoalStatus = mapNativeGoalStatus(nativeGoal.status);
  return {
    schemaVersion: 2,
    contractId: initialization.contractId,
    sessionId: identity.threadId,
    sessionTreeId: identity.sessionTreeId,
    threadId: identity.threadId,
    nativeGoalBinding: {
      threadId: identity.threadId,
      createdAt: nativeGoal.createdAt,
      objectiveHash: hashNativeGoalObjective(nativeGoal.objective),
    },
    nativeGoal: contractNativeGoal(nativeGoal),
    phase: nativeGoalStatus === "paused" ? "paused" : "active",
    revision: 1,
    scopeRevision: 0,
    source: initialization.source,
    objectives: initialization.objectives.map(sanitizeModelObjective),
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function projectContract(
  contract: GoalContractAny,
  usage?: GoalUsageSnapshot,
  overlay: GoalProgressTrackingOverlay = DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
): GoalProgressViewModel {
  const projected = projectGoalProgressViewModel(contract, {
    ...viewModelOptionsFromUsage(usage, contract.sessionId),
    ...(overlay.detached ? { detached: true } : {}),
  });
  if (!projected.ok) {
    throw new GoalProgressIpcHandlerError(projected.code, projected.message, contract.revision);
  }
  return projected.viewModel;
}

function viewModelOptionsFromUsage(
  usage: GoalUsageSnapshot | undefined,
  sessionId: string,
): ProjectViewModelOptions {
  if (!usage || usage.threadId !== sessionId) {
    return {};
  }
  return {
    tokenUsage: usage.tokenUsage,
    ...(usage.stale ? { tokenStale: true } : {}),
    ...(usage.unavailable ? { tokenUnavailable: true } : {}),
  };
}

function projectContractState(
  contract: GoalContractAny,
  usage?: GoalUsageSnapshot,
  overlay: GoalProgressTrackingOverlay = DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
): {
  readonly viewModel: GoalProgressViewModel;
  readonly nextTargetId: string | null;
} {
  const viewModel = projectContract(contract, usage, overlay);
  if (viewModel.trackingPhase === "detached") {
    return { viewModel, nextTargetId: null };
  }
  const objectivesById = new Map(contract.objectives.map((objective) => [objective.id, objective]));
  for (const objectiveView of viewModel.objectives) {
    if (objectiveView.status !== "active" && objectiveView.status !== "pending") {
      continue;
    }
    const item = objectivesById
      .get(objectiveView.id)
      ?.items.find((candidate) => candidate.status === "active" || candidate.status === "pending");
    return {
      viewModel,
      nextTargetId: item?.id ?? objectiveView.id,
    };
  }
  const blocked = viewModel.objectives.find((objective) => objective.status === "blocked");
  return {
    viewModel,
    nextTargetId: blocked?.id ?? null,
  };
}

function sanitizeModelCommand(command: GoalProgressCommand): GoalProgressCommand {
  if (command.type === "update-items") {
    return {
      ...command,
      source: "model",
      changes: command.changes.map((change) => ({
        ...change,
        ...(change.evidence ? { evidence: change.evidence.map(sanitizeModelEvidence) } : {}),
      })),
    };
  }
  if (command.type === "rescope") {
    return {
      ...command,
      source: "model",
      objectives: command.objectives.map(sanitizeModelObjective),
    };
  }
  return { ...command, source: "model" };
}

function trustedNativeGoalFromThreadGoal(goal: ThreadGoal | null): TrustedNativeGoal | null {
  if (!goal) {
    return null;
  }
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    createdAt: goal.createdAt,
    ...(goal.tokenBudget === undefined ? {} : { tokenBudget: goal.tokenBudget }),
  };
}

function claimedSessionMatchesIdentity(
  claimedSessionId: string,
  identity: RuntimeIdentity,
): boolean {
  return claimedSessionId === identity.threadId || claimedSessionId === identity.sessionTreeId;
}

function assertBoundNativeGoal(
  contract: GoalContract,
  nativeGoal: TrustedNativeGoal | null,
  revision: number | null,
): TrustedNativeGoal {
  if (!nativeGoal) {
    throw new GoalProgressIpcHandlerError(
      "NATIVE_GOAL_DETACHED",
      "Native Goal is missing; do not keep writing the previous Contract",
      revision,
    );
  }
  if (nativeGoal.threadId !== contract.threadId) {
    throw new GoalProgressIpcHandlerError(
      "NATIVE_GOAL_MISMATCH",
      "Current Session native Goal is unavailable or mismatched",
      revision,
    );
  }
  if (nativeGoal.createdAt !== contract.nativeGoalBinding.createdAt) {
    throw new GoalProgressIpcHandlerError(
      "NATIVE_GOAL_REPLACED",
      "Native Goal was replaced even if the objective text matches",
      revision,
    );
  }
  if (hashNativeGoalObjective(nativeGoal.objective) !== contract.nativeGoalBinding.objectiveHash) {
    throw new GoalProgressIpcHandlerError(
      "NATIVE_GOAL_OBJECTIVE_CHANGED",
      "Native Goal objective no longer matches the bound Contract",
      revision,
    );
  }
  if (nativeGoal.objective.length > GOAL_NATIVE_OBJECTIVE_MAX_LENGTH) {
    throw new GoalProgressIpcHandlerError(
      "NATIVE_GOAL_OBJECTIVE_TOO_LONG",
      `Native Goal objective exceeds ${GOAL_NATIVE_OBJECTIVE_MAX_LENGTH} characters`,
      revision,
    );
  }
  return nativeGoal;
}

function nativeGoalErrorDetachesContract(error: unknown): boolean {
  return (
    error instanceof GoalProgressIpcHandlerError &&
    [
      "NATIVE_GOAL_DETACHED",
      "NATIVE_GOAL_MISMATCH",
      "NATIVE_GOAL_REPLACED",
      "NATIVE_GOAL_OBJECTIVE_CHANGED",
    ].includes(error.code)
  );
}

function detachReasonForNativeGoalError(error: unknown): GoalProgressDetachReason {
  if (!(error instanceof GoalProgressIpcHandlerError)) {
    return "stale-contract";
  }
  switch (error.code) {
    case "NATIVE_GOAL_DETACHED":
      return "native-goal-ended";
    case "NATIVE_GOAL_REPLACED":
      return "native-goal-replaced";
    case "NATIVE_GOAL_MISMATCH":
    case "NATIVE_GOAL_OBJECTIVE_CHANGED":
      return "stale-contract";
    default:
      return "stale-contract";
  }
}

function identityLogFields(identity: RuntimeIdentity): {
  readonly sessionKey: string;
  readonly sessionTreeKey: string;
  readonly threadKey: string;
} {
  const threadKey = hashGoalProgressIdentity(identity.threadId);
  return {
    sessionKey: threadKey,
    sessionTreeKey: hashGoalProgressIdentity(identity.sessionTreeId),
    threadKey,
  };
}

function methodIsAllowed(
  method: Parameters<GoalProgressIpcHandler>[0]["method"],
  context: GoalProgressIpcConnectionContext,
): boolean {
  if (method === "ping") {
    return true;
  }
  const allowed: Record<
    GoalProgressIpcConnectionContext["clientKind"],
    readonly Parameters<GoalProgressIpcHandler>[0]["method"][]
  > = {
    hook: ["runtime-proof.issue", "hook.audit", "activation.resume"],
    mcp: [
      "runtime-proof.consume",
      "activation.plan",
      "store.load",
      "store.initialize",
      "store.apply",
    ],
    cdp: ["view.get", "ui.intent"],
    doctor: ["doctor"],
  };
  return allowed[context.clientKind].includes(method);
}

async function inspectSocket(path: string): Promise<{
  readonly exists: boolean;
  readonly mode: number | null;
}> {
  try {
    const metadata = await lstat(path);
    return {
      exists: metadata.isSocket(),
      mode: metadata.mode & 0o777,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { exists: false, mode: null };
    }
    throw error;
  }
}

async function inspectStoreReadOnly(
  paths: GoalProgressPaths,
): Promise<Extract<GoalProgressDoctorResult["storeSmoke"], { checked: true }>> {
  try {
    const entries = await readdir(paths.stateRoot, { withFileTypes: true });
    return {
      checked: true,
      readable: true,
      sessionCount: entries.filter(
        (entry) => entry.isDirectory() && /^[0-9a-f]{64}$/u.test(entry.name),
      ).length,
      code: null,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { checked: true, readable: true, sessionCount: 0, code: null };
    }
    return {
      checked: true,
      readable: false,
      sessionCount: null,
      code: errorCode(error),
    };
  }
}

async function inspectGoalProgressLocal(
  paths: GoalProgressPaths,
  sessionId?: string,
  assumeReachable = false,
  storeInstance?: GoalEventStore,
): Promise<GoalProgressDoctorResult> {
  const identity = await readCurrentHelperIdentity(paths).catch(() => null);
  const socket = await inspectSocket(paths.helperSocketPath).catch(() => ({
    exists: false,
    mode: null,
  }));
  let reachable = assumeReachable;
  let ipcCode: string | null = null;
  if (socket.exists && !assumeReachable) {
    try {
      await new GoalProgressIpcClient(paths.helperSocketPath, {
        clientKind: "doctor",
        timeoutMs: 1_000,
      }).request({ method: "ping", params: {} });
      reachable = true;
    } catch (error) {
      ipcCode = errorCode(error);
    }
  }

  let store: GoalProgressDoctorResult["store"] = { checked: false };
  if (sessionId) {
    const sessionPaths = resolveGoalProgressSessionPaths(paths, sessionId);
    try {
      if (!storeInstance) {
        throw new GoalProgressIpcHandlerError(
          "HELPER_UNAVAILABLE",
          "Store inspection requires the running Helper",
        );
      }
      const loaded = await storeInstance.load(sessionId);
      store = {
        checked: true,
        sessionKey: sessionPaths.sessionKey,
        revision: loaded.contract?.revision ?? null,
        eventCount: loaded.eventCount,
        code: null,
      };
    } catch (error) {
      store = {
        checked: true,
        sessionKey: sessionPaths.sessionKey,
        revision: null,
        eventCount: null,
        code: errorCode(error),
      };
    }
  }

  return {
    schemaVersion: 1,
    protocolVersion: GOAL_PROGRESS_IPC_PROTOCOL_VERSION,
    root: paths.root,
    helper: {
      running: identity !== null,
      pid: identity?.pid ?? null,
      instanceId: identity?.instanceId ?? null,
    },
    ipc: {
      socketExists: socket.exists,
      socketMode: socket.mode,
      reachable,
      code: ipcCode,
    },
    store,
    storeSmoke:
      assumeReachable && storeInstance ? await inspectStoreReadOnly(paths) : { checked: false },
    runtime: emptyDoctorRuntime(reachable ? null : "HELPER_UNAVAILABLE"),
  };
}

export async function inspectGoalProgress(
  paths: GoalProgressPaths,
  sessionId?: string,
): Promise<GoalProgressDoctorResult> {
  const base = await inspectGoalProgressLocal(paths);
  if (base.ipc.reachable) {
    try {
      const response = await new GoalProgressIpcClient(paths.helperSocketPath, {
        clientKind: "doctor",
        timeoutMs: 1_000,
      }).request({
        method: "doctor",
        params: sessionId === undefined ? {} : { sessionId },
      });
      if (
        response.result !== null &&
        typeof response.result === "object" &&
        "schemaVersion" in response.result &&
        response.result.schemaVersion === 1
      ) {
        return response.result as GoalProgressDoctorResult;
      }
    } catch {
      // Fall through to a read-only offline result.
    }
  }
  return {
    ...base,
    store:
      sessionId === undefined
        ? { checked: false }
        : {
            checked: true,
            sessionKey: resolveGoalProgressSessionPaths(paths, sessionId).sessionKey,
            revision: null,
            eventCount: null,
            code: "HELPER_UNAVAILABLE",
          },
  };
}

export class GoalProgressHelper {
  readonly paths: GoalProgressPaths;
  readonly #lockOptions: HelperLockOptions;
  readonly #logger: GoalProgressLogger;
  readonly #store: GoalEventStore;
  readonly #runtime: CodexAppServerRuntime;
  readonly #resolveNativeGoal: NativeGoalResolver;
  readonly #resolveCurrentThread: ResolveCurrentThread;
  readonly #rendererDoctor:
    | ((expectedThreadId?: string) => Promise<GoalProgressRendererBridgeDoctor>)
    | undefined;
  readonly #viewModelPublisher: ViewModelPublisher;
  readonly #enableGoalWatch: boolean;
  readonly #visibleThreadRecoveryDelaysMs: readonly number[];
  readonly #visibleThreadWatchIntervalMs: number;
  readonly #goalUsage = new Map<string, GoalUsageSnapshot>();
  readonly #preparingObjectives = new Map<string, string>();
  #lock: HelperInstanceLock | undefined;
  #server: GoalProgressIpcServer | undefined;
  #runtimeProofKey: Uint8Array | undefined;
  #visibleThreadRecoveryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: GoalProgressHelperOptions = {}) {
    this.paths = options.paths ?? resolveGoalProgressPaths();
    this.#lockOptions = options.lock ?? {};
    this.#logger = new GoalProgressLogger(this.paths.helperLogPath, options.logger);
    this.#store = new GoalEventStore(this.paths, {
      ...options.store,
      logger: this.#logger,
    });
    const codexCommand = resolveGoalProgressCodexCommand();
    this.#runtime =
      options.runtime ??
      createCodexAppServerRuntime(codexCommand === undefined ? {} : { command: codexCommand });
    this.#enableGoalWatch = options.resolveNativeGoal === undefined;
    this.#resolveNativeGoal =
      options.resolveNativeGoal ??
      (async (threadId) => trustedNativeGoalFromThreadGoal(await this.#runtime.getGoal(threadId)));
    this.#resolveCurrentThread =
      options.resolveCurrentThread ?? ((input) => this.#runtime.resolveCurrentThread(input));
    this.#viewModelPublisher = new ViewModelPublisher(options.viewModelSink);
    this.#rendererDoctor = options.rendererDoctor;
    this.#visibleThreadRecoveryDelaysMs =
      options.visibleThreadRecoveryDelaysMs ?? HELPER_VISIBLE_THREAD_RECOVERY_DELAYS_MS;
    this.#visibleThreadWatchIntervalMs =
      options.visibleThreadWatchIntervalMs ?? HELPER_VISIBLE_THREAD_WATCH_INTERVAL_MS;
  }

  async #log(input: GoalProgressLogInput): Promise<void> {
    await this.#logger.write(input).catch(() => undefined);
  }

  #usageFor(contract: GoalContractAny): GoalUsageSnapshot | undefined {
    const threadId = contract.schemaVersion === 2 ? contract.threadId : contract.sessionId;
    return this.#goalUsage.get(threadId);
  }

  #project(
    contract: GoalContractAny,
    overlay: GoalProgressTrackingOverlay = DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
  ): GoalProgressViewModel {
    return projectContract(contract, this.#usageFor(contract), overlay);
  }

  #projectState(
    contract: GoalContractAny,
    overlay: GoalProgressTrackingOverlay = DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
  ): {
    readonly viewModel: GoalProgressViewModel;
    readonly nextTargetId: string | null;
  } {
    return projectContractState(contract, this.#usageFor(contract), overlay);
  }

  #threadIdOf(contract: GoalContractAny): string {
    return contract.schemaVersion === 2 ? contract.threadId : contract.sessionId;
  }

  async #overlayFor(threadId: string): Promise<GoalProgressTrackingOverlay> {
    return readGoalProgressTrackingOverlay(resolveGoalProgressSessionPaths(this.paths, threadId));
  }

  async #activationStateForOverlay(
    threadId: string,
    overlay: GoalProgressTrackingOverlay,
  ): Promise<GoalProgressActivationState> {
    const snapshot = await readGoalProgressActivationStateSnapshot(threadId, this.paths);
    if (!overlay.detached || snapshot.exists) {
      return snapshot.state;
    }
    return writeGoalProgressActivationState(threadId, this.paths, {
      schemaVersion: 1,
      detachReason: "user-detached-tracking",
    });
  }

  async #detachTracking(
    threadId: string,
    detachReason: GoalProgressDetachReason,
  ): Promise<GoalProgressTrackingOverlay> {
    const sessionPaths = resolveGoalProgressSessionPaths(this.paths, threadId);
    const current = await readGoalProgressTrackingOverlay(sessionPaths);
    const activationState = await readGoalProgressActivationState(threadId, this.paths);
    if (
      current.detached &&
      (activationState.detachReason === detachReason ||
        activationState.detachReason === "user-dismissed-preparation" ||
        activationState.detachReason === "user-detached-tracking")
    ) {
      return current;
    }
    await writeGoalProgressActivationState(threadId, this.paths, {
      schemaVersion: 1,
      detachReason,
    });
    const detached = await writeGoalProgressTrackingOverlay(sessionPaths, {
      ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
      detached: true,
    });
    if (this.#enableGoalWatch) {
      this.#runtime.setPollingMode(
        this.#preparingObjectives.has(threadId) ? "collapsed-or-background" : "stopped",
      );
    }
    return detached;
  }

  #rememberChangedGoalPreparation(
    threadId: string,
    nativeGoal: TrustedNativeGoal | null,
    error: unknown,
  ): void {
    if (
      nativeGoal?.threadId === threadId &&
      error instanceof GoalProgressIpcHandlerError &&
      (error.code === "NATIVE_GOAL_REPLACED" || error.code === "NATIVE_GOAL_OBJECTIVE_CHANGED")
    ) {
      this.#preparingObjectives.set(threadId, nativeGoal.objective);
    }
  }

  async #reconcileDetachedPreparation(
    contract: GoalContract,
    nativeGoal: TrustedNativeGoal | null,
    overlay: GoalProgressTrackingOverlay,
  ): Promise<GoalProgressTrackingOverlay> {
    const activationState = await this.#activationStateForOverlay(contract.threadId, overlay);
    if (isUserDetachedActivationState(activationState) || !nativeGoal) {
      return overlay;
    }
    try {
      assertBoundNativeGoal(contract, nativeGoal, contract.revision);
      this.#preparingObjectives.delete(contract.threadId);
      await writeGoalProgressActivationState(
        contract.threadId,
        this.paths,
        DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
      );
      return writeGoalProgressTrackingOverlay(
        resolveGoalProgressSessionPaths(this.paths, contract.threadId),
        DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
      );
    } catch (error) {
      if (nativeGoalErrorDetachesContract(error)) {
        this.#rememberChangedGoalPreparation(contract.threadId, nativeGoal, error);
        return this.#detachTracking(contract.threadId, detachReasonForNativeGoalError(error));
      }
      return overlay;
    }
  }

  async #assertBoundNativeGoalOrDetach(
    contract: GoalContract,
    nativeGoal: TrustedNativeGoal | null,
  ): Promise<TrustedNativeGoal> {
    try {
      return assertBoundNativeGoal(contract, nativeGoal, contract.revision);
    } catch (error) {
      if (nativeGoalErrorDetachesContract(error)) {
        this.#rememberChangedGoalPreparation(contract.threadId, nativeGoal, error);
        await this.#detachTracking(contract.threadId, detachReasonForNativeGoalError(error));
      }
      throw error;
    }
  }

  async #overlayForCurrentNativeGoal(
    contract: GoalContractAny,
    usage?: GoalUsageSnapshot,
  ): Promise<GoalProgressTrackingOverlay> {
    const threadId = this.#threadIdOf(contract);
    const overlay = await this.#overlayFor(threadId);
    if (contract.schemaVersion !== 2 || usage?.stale) {
      return overlay;
    }
    if (contract.nativeGoal.status === "complete" && usage && !usage.goal) {
      return overlay;
    }
    let nativeGoal: TrustedNativeGoal | null;
    if (usage) {
      nativeGoal = trustedNativeGoalFromThreadGoal(usage.goal);
    } else {
      try {
        nativeGoal = await this.#readNativeGoal(threadId, contract.revision);
      } catch {
        return overlay;
      }
    }
    if (contract.nativeGoal.status === "complete" && !nativeGoal) {
      return overlay;
    }
    if (overlay.detached) {
      return this.#reconcileDetachedPreparation(contract, nativeGoal, overlay);
    }
    try {
      assertBoundNativeGoal(contract, nativeGoal, contract.revision);
      return overlay;
    } catch (error) {
      this.#rememberChangedGoalPreparation(threadId, nativeGoal, error);
      return nativeGoalErrorDetachesContract(error)
        ? this.#detachTracking(threadId, detachReasonForNativeGoalError(error))
        : overlay;
    }
  }

  async #applyPollingMode(
    threadId: string,
    preference: GoalProgressUiPreference,
    overlay: GoalProgressTrackingOverlay,
    contract?: GoalContractAny,
  ): Promise<void> {
    if (!this.#enableGoalWatch) {
      return;
    }
    const usage = this.#goalUsage.get(threadId);
    if (preference.hidden) {
      this.#runtime.setPollingMode("stopped");
      return;
    }
    if (overlay.detached) {
      this.#runtime.setPollingMode(
        this.#preparingObjectives.has(threadId) ? "collapsed-or-background" : "stopped",
      );
      return;
    }
    if (!usage?.goal) {
      this.#runtime.setPollingMode(
        contract?.nativeGoal.status === "complete" ? "collapsed-or-background" : "stopped",
      );
      return;
    }
    if (usage.goal.status === "complete") {
      this.#runtime.setPollingMode("collapsed-or-background");
      return;
    }
    if (
      contract?.phase === "paused" ||
      usage.goal.status === "paused" ||
      usage.goal.status === "blocked" ||
      usage.goal.status === "usageLimited" ||
      usage.goal.status === "budgetLimited"
    ) {
      this.#runtime.setPollingMode("paused");
      return;
    }
    if (preference.collapsed) {
      this.#runtime.setPollingMode("collapsed-or-background");
      return;
    }
    this.#runtime.setPollingMode("active");
  }

  #watchThread(threadId: string): void {
    if (!this.#enableGoalWatch) {
      return;
    }
    this.#runtime.watchGoalUsage(threadId, (snapshot) => {
      this.#goalUsage.set(snapshot.threadId, snapshot);
      void this.#publishUsageChange(snapshot).catch(() => undefined);
    });
  }

  async #publishVerified(threadId: string, viewModel: GoalProgressViewModel): Promise<void> {
    if (this.#viewModelPublisher.visibleThreadAwarenessAvailable) {
      const visibleThreadId = await this.#viewModelPublisher.recoverVisibleThreadId();
      if (
        (visibleThreadId !== undefined && visibleThreadId !== threadId) ||
        (visibleThreadId === undefined &&
          this.#viewModelPublisher.currentThreadId !== undefined &&
          this.#viewModelPublisher.currentThreadId !== threadId)
      ) {
        return;
      }
    }
    await this.#viewModelPublisher.activateThread(threadId);
    await this.#viewModelPublisher.setUiPreference(await readGoalProgressUiPreference(this.paths));
    await this.#viewModelPublisher.publish(threadId, viewModel);
  }

  async #syncNativeGoalStatus(snapshot: GoalUsageSnapshot): Promise<GoalContractAny | null> {
    const loaded = await this.#store.load(snapshot.threadId);
    const contract = loaded.contract;
    if (contract?.schemaVersion !== 2 || snapshot.stale) {
      return contract;
    }
    if (contract.nativeGoal.status === "complete" && !snapshot.goal) {
      return contract;
    }
    const overlay = await this.#overlayFor(snapshot.threadId);
    if (overlay.detached || !snapshot.goal) {
      return contract;
    }
    const nativeGoal = trustedNativeGoalFromThreadGoal(snapshot.goal);
    try {
      assertBoundNativeGoal(contract, nativeGoal, contract.revision);
    } catch (error) {
      if (nativeGoalErrorDetachesContract(error)) {
        this.#rememberChangedGoalPreparation(snapshot.threadId, nativeGoal, error);
        await this.#detachTracking(snapshot.threadId, detachReasonForNativeGoalError(error));
      }
      return contract;
    }
    if (!nativeGoal) {
      return contract;
    }
    const nextNativeGoal = contractNativeGoal(nativeGoal);
    if (JSON.stringify(nextNativeGoal) === JSON.stringify(contract.nativeGoal)) {
      return contract;
    }
    const syncKey = hashGoalProgressIdentity(
      `${contract.contractId}:${contract.revision}:${snapshot.goal.status}:${snapshot.goal.updatedAt}`,
    ).slice(0, 24);
    const occurredAt = new Date(
      Math.max(Date.parse(contract.updatedAt), snapshot.goal.updatedAt * 1_000),
    ).toISOString();
    const applied = await this.#store.apply({
      contractId: contract.contractId,
      sessionId: contract.sessionId,
      expectedRevision: contract.revision,
      eventId: `evt-native-sync-${syncKey}`,
      requestId: `req-native-sync-${syncKey}`,
      turnId: "system-native-goal-watch",
      occurredAt,
      source: "system",
      type: "sync-native-goal",
      nativeGoal: nextNativeGoal,
    });
    if (applied.ok) {
      return applied.contract;
    }
    return (await this.#store.load(snapshot.threadId)).contract;
  }

  #transientView(
    threadId: string,
    objective: string,
    phase: "preparing" | "error" | "detached",
    options: {
      readonly preparingStep?: "reading-goal" | "preparing-checklist" | "establishing-baseline";
      readonly errorCode?: string;
    } = {},
  ): GoalProgressViewModel {
    return GoalProgressViewModelSchema.parse({
      schemaVersion: 2,
      contractId: `gp_prepare_${hashGoalProgressIdentity(threadId).slice(0, 16)}`,
      sessionId: threadId,
      revision: 0,
      scopeRevision: 0,
      trackingPhase: phase,
      objective,
      overallProgressBps: null,
      overallPercent: null,
      finalVerificationPending: false,
      objectives: [],
      optionalObjectives: [],
      maxVisibleObjectives: 3,
      ...(options.preparingStep === undefined ? {} : { preparingStep: options.preparingStep }),
      ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
    });
  }

  async #publishPreparing(
    threadId: string,
    objective: string,
    preparingStep: "reading-goal" | "preparing-checklist" | "establishing-baseline",
  ): Promise<GoalProgressViewModel> {
    this.#preparingObjectives.set(threadId, objective);
    const viewModel = this.#transientView(threadId, objective, "preparing", {
      preparingStep,
    });
    await this.#publishVerified(threadId, viewModel);
    return viewModel;
  }

  async #publishPreparationError(threadId: string, code: string): Promise<GoalProgressViewModel> {
    const objective = this.#preparingObjectives.get(threadId) ?? "当前 Goal";
    const viewModel = this.#transientView(threadId, objective, "error", {
      errorCode: code,
    });
    await this.#publishVerified(threadId, viewModel);
    return viewModel;
  }

  async #publishResumeUnavailable(
    contract: GoalContractAny,
    code: string,
  ): Promise<GoalProgressViewModel> {
    const threadId = this.#threadIdOf(contract);
    const viewModel = GoalProgressViewModelSchema.parse({
      schemaVersion: 2,
      contractId: contract.contractId,
      sessionId: threadId,
      revision: contract.revision,
      scopeRevision: contract.scopeRevision,
      trackingPhase: "error",
      objective: contract.nativeGoal.objective,
      overallProgressBps: null,
      overallPercent: null,
      finalVerificationPending: false,
      objectives: [],
      optionalObjectives: [],
      maxVisibleObjectives: 3,
      errorCode: code,
    });
    await this.#publishVerified(threadId, viewModel);
    return viewModel;
  }

  async #resumeTracking(threadId: string): Promise<GoalProgressActivationResumeResult> {
    const loaded = await this.#store.load(threadId);
    const contract = loaded.contract;
    if (!contract || contract.phase === "completed") {
      return { status: "inactive" };
    }
    const contractThreadId = contract.schemaVersion === 2 ? contract.threadId : contract.sessionId;
    if (contractThreadId !== threadId) {
      return { status: "inactive" };
    }
    const persistedOverlay = await this.#overlayFor(threadId);
    const activationState = await this.#activationStateForOverlay(threadId, persistedOverlay);
    if (isUserDetachedActivationState(activationState)) {
      if (!persistedOverlay.detached && activationState.detachReason) {
        await this.#detachTracking(threadId, activationState.detachReason);
      }
      return { status: "inactive" };
    }
    let nativeGoal: TrustedNativeGoal | null = null;
    try {
      nativeGoal = await this.#readNativeGoal(threadId);
      if (!nativeGoal) {
        if (contract.schemaVersion === 2) {
          await this.#detachTracking(threadId, "native-goal-ended");
        }
        return { status: "inactive" };
      }
      if (contract.schemaVersion === 2) {
        assertBoundNativeGoal(contract, nativeGoal, contract.revision);
      } else if (nativeGoal.objective !== contract.nativeGoal.objective) {
        return { status: "inactive" };
      }
    } catch (error) {
      if (
        nativeGoalErrorDetachesContract(error) ||
        (error instanceof GoalProgressIpcHandlerError &&
          error.code === "NATIVE_GOAL_OBJECTIVE_TOO_LONG")
      ) {
        if (nativeGoalErrorDetachesContract(error)) {
          this.#rememberChangedGoalPreparation(threadId, nativeGoal, error);
          await this.#detachTracking(threadId, detachReasonForNativeGoalError(error));
        }
        return { status: "inactive" };
      }
      const causeCode = diagnosticCauseCode(error);
      await this.#publishResumeUnavailable(contract, "GOAL_PROGRESS_TEMPORARILY_UNAVAILABLE").catch(
        () => undefined,
      );
      return {
        status: "temporarily_unavailable",
        reasonCode: causeCode,
      };
    }
    this.#watchThread(threadId);
    const usage = await this.#refreshUsage(threadId);
    const latest = (await this.#store.load(threadId)).contract ?? contract;
    const overlay = await this.#overlayForCurrentNativeGoal(latest, usage);
    await this.#publishVerified(threadId, this.#projectState(latest, overlay).viewModel);
    return {
      status: "active",
      contractId: latest.contractId,
      revision: latest.revision,
    };
  }

  async #recoverVisibleThread(): Promise<"done" | "retry"> {
    if (!this.#server) {
      return "done";
    }
    const threadId = await this.#viewModelPublisher.recoverVisibleThreadId();
    if (!threadId) {
      return "retry";
    }
    if (await this.#rendererMatchesVisibleThread(threadId)) {
      return "done";
    }
    return this.#restoreVisibleThread(threadId);
  }

  async #rendererMatchesVisibleThread(threadId: string): Promise<boolean> {
    if (this.#viewModelPublisher.currentThreadId !== threadId) {
      return false;
    }
    if (!this.#rendererDoctor) {
      return true;
    }
    try {
      const doctor = await this.#rendererDoctor(threadId);
      return (
        doctor.capabilitySupported === true &&
        doctor.anchorMatched === true &&
        doctor.componentCount === 1 &&
        doctor.currentThreadMatched === true &&
        doctor.latestViewModelRevision !== null
      );
    } catch {
      return false;
    }
  }

  async #restoreVisibleThread(threadId: string): Promise<"done" | "retry"> {
    const resumed = await this.#resumeTracking(threadId);
    if (resumed.status === "temporarily_unavailable") {
      return "retry";
    }
    if (resumed.status === "inactive" || !this.#rendererDoctor) {
      return "done";
    }
    try {
      const doctor = await this.#rendererDoctor(threadId);
      if (
        doctor.capabilitySupported === true &&
        doctor.anchorMatched === true &&
        doctor.componentCount === 1 &&
        doctor.currentThreadMatched === true &&
        doctor.latestViewModelRevision === resumed.revision
      ) {
        return "done";
      }
    } catch {
      // The next bounded attempt reconnects the Bridge and republishes the same full snapshot.
    }
    await this.#viewModelPublisher.markDeliveryStale();
    return "retry";
  }

  #scheduleVisibleThreadRecovery(attempt: number): void {
    if (!this.#server || this.#visibleThreadRecoveryTimer) {
      return;
    }
    if (attempt >= this.#visibleThreadRecoveryDelaysMs.length) {
      this.#scheduleVisibleThreadWatch();
      return;
    }
    const delay = this.#visibleThreadRecoveryDelaysMs[attempt];
    if (delay === undefined || !Number.isInteger(delay) || delay < 0 || delay > 60_000) {
      return;
    }
    this.#visibleThreadRecoveryTimer = setTimeout(() => {
      this.#visibleThreadRecoveryTimer = undefined;
      void this.#recoverVisibleThread()
        .then((result) => {
          if (result === "retry") {
            this.#scheduleVisibleThreadRecovery(attempt + 1);
          } else {
            this.#scheduleVisibleThreadWatch();
          }
        })
        .catch(() => {
          this.#scheduleVisibleThreadRecovery(attempt + 1);
        });
    }, delay);
    this.#visibleThreadRecoveryTimer.unref?.();
  }

  #scheduleVisibleThreadWatch(): void {
    if (
      !this.#server ||
      this.#visibleThreadRecoveryTimer ||
      !this.#viewModelPublisher.visibleThreadAwarenessAvailable ||
      !Number.isInteger(this.#visibleThreadWatchIntervalMs) ||
      this.#visibleThreadWatchIntervalMs < 1 ||
      this.#visibleThreadWatchIntervalMs > 60_000
    ) {
      return;
    }
    this.#visibleThreadRecoveryTimer = setTimeout(() => {
      this.#visibleThreadRecoveryTimer = undefined;
      void this.#recoverVisibleThread()
        .then((result) => {
          if (result === "retry") {
            this.#scheduleVisibleThreadRecovery(0);
          } else {
            this.#scheduleVisibleThreadWatch();
          }
        })
        .catch(() => {
          this.#scheduleVisibleThreadRecovery(0);
        });
    }, this.#visibleThreadWatchIntervalMs);
    this.#visibleThreadRecoveryTimer.unref?.();
  }

  async #publishUsageChange(snapshot: GoalUsageSnapshot): Promise<void> {
    if (snapshot.threadId !== this.#viewModelPublisher.currentThreadId) {
      return;
    }
    const contract = await this.#syncNativeGoalStatus(snapshot);
    if (!contract) {
      return;
    }
    const overlay = await this.#overlayForCurrentNativeGoal(contract, snapshot);
    await this.#applyPollingMode(
      snapshot.threadId,
      await readGoalProgressUiPreference(this.paths),
      overlay,
      contract,
    );
    if (overlay.detached) {
      const preparingObjective = this.#preparingObjectives.get(snapshot.threadId);
      if (preparingObjective) {
        await this.#publishPreparing(snapshot.threadId, preparingObjective, "preparing-checklist");
      } else {
        await this.#viewModelPublisher.clear(snapshot.threadId);
      }
      return;
    }
    await this.#viewModelPublisher.publish(
      snapshot.threadId,
      this.#projectState(contract, overlay).viewModel,
    );
  }

  async #refreshUsage(threadId: string): Promise<GoalUsageSnapshot | undefined> {
    if (!this.#enableGoalWatch) {
      return this.#goalUsage.get(threadId);
    }
    try {
      const snapshot = await this.#runtime.refreshGoalUsage(threadId);
      this.#goalUsage.set(threadId, snapshot);
      const contract = await this.#syncNativeGoalStatus(snapshot);
      if (contract) {
        await this.#applyPollingMode(
          threadId,
          await readGoalProgressUiPreference(this.paths),
          await this.#overlayForCurrentNativeGoal(contract, snapshot),
          contract,
        );
      } else if (!snapshot.goal || snapshot.goal.status === "complete") {
        this.#runtime.setPollingMode("stopped");
      }
      return snapshot;
    } catch {
      return this.#goalUsage.get(threadId);
    }
  }

  async #inspectRuntimeDoctor(sessionId?: string): Promise<GoalProgressDoctorResult["runtime"]> {
    let renderer: GoalProgressRendererBridgeDoctor | undefined;
    let lastErrorCode: string | null = null;
    try {
      renderer = await this.#rendererDoctor?.(sessionId);
      if (!renderer && !this.#rendererDoctor) {
        lastErrorCode = "RENDERER_BRIDGE_UNAVAILABLE";
      }
    } catch (error) {
      lastErrorCode = diagnosticCauseCode(error);
    }

    let actualThreadProven: boolean | null = null;
    let nativeGoalBindingMatches: boolean | null = null;
    let tokenAvailability: GoalProgressDoctorResult["runtime"]["goal"]["tokenAvailability"] =
      "unknown";
    if (sessionId) {
      const loaded = await this.#store.load(sessionId).catch(() => null);
      const contract = loaded?.contract;
      if (contract?.schemaVersion === 2) {
        actualThreadProven =
          contract.threadId === sessionId &&
          contract.sessionId === sessionId &&
          contract.nativeGoalBinding.threadId === sessionId;
        const usage = await this.#refreshUsage(sessionId);
        tokenAvailability =
          usage?.tokenUsage.availability === "available"
            ? usage.stale
              ? "stale"
              : "available"
            : usage?.tokenUsage.availability === "unavailable"
              ? "unavailable"
              : "unknown";
        try {
          assertBoundNativeGoal(
            contract,
            usage
              ? trustedNativeGoalFromThreadGoal(usage.goal)
              : await this.#readNativeGoal(sessionId, contract.revision),
            contract.revision,
          );
          nativeGoalBindingMatches = true;
        } catch (error) {
          nativeGoalBindingMatches = false;
          lastErrorCode ??= diagnosticCauseCode(error);
        }
      }
    }

    return {
      app: {
        path: renderer?.appPath ?? null,
        signatureValid: renderer?.appSignatureValid ?? null,
      },
      cdp: {
        port: renderer?.cdpPort ?? null,
        loopback: renderer?.cdpLoopback ?? null,
        targetUrl: renderer?.targetUrl ?? null,
      },
      renderer: {
        adapterId: renderer?.adapterId ?? null,
        capabilitySupported: renderer?.capabilitySupported ?? null,
        capabilityReason: renderer?.capabilityReason ?? null,
        anchorMatched: renderer?.anchorMatched ?? null,
        componentCount: renderer?.componentCount ?? null,
        bundleReleaseVersion: renderer?.bundleReleaseVersion ?? null,
        bundlePageHostVersion: renderer?.bundlePageHostVersion ?? null,
        bundleSha256: renderer?.bundleSha256 ?? null,
        latestViewModelRevision: renderer?.latestViewModelRevision ?? null,
        currentThreadMatched: renderer?.currentThreadMatched ?? null,
      },
      goal: {
        actualThreadProven,
        nativeGoalBindingMatches,
        tokenAvailability,
      },
      lastErrorCode: renderer?.lastErrorCode ?? lastErrorCode,
    };
  }

  async #key(): Promise<Uint8Array> {
    this.#runtimeProofKey ??= await loadOrCreateRuntimeProofKey(this.paths.runtimeRoot);
    return this.#runtimeProofKey;
  }

  async #consumeRuntimeProof(
    runtimeContext: RuntimeContext,
    runtimeProof: RuntimeProof,
  ): Promise<boolean> {
    const nowMs = Date.now();
    return (
      (await verifyRuntimeProof(runtimeContext, runtimeProof, await this.#key(), nowMs)) &&
      (await consumeRuntimeProofOnce(this.paths.runtimeRoot, runtimeProof, nowMs))
    );
  }

  async #resolveIdentity(runtimeContext: RuntimeContext): Promise<RuntimeIdentity> {
    try {
      return await this.#resolveCurrentThread({
        sessionTreeId: runtimeContext.hookSessionId,
        turnId: runtimeContext.turnId,
        cwd: runtimeContext.cwd,
        model: runtimeContext.model,
      });
    } catch (error) {
      if (error instanceof CurrentThreadResolverError) {
        throw new GoalProgressIpcHandlerError(error.code, error.message);
      }
      throw new GoalProgressIpcHandlerError(
        "CURRENT_THREAD_UNAVAILABLE",
        "Could not resolve the current Goal thread",
        null,
        undefined,
        error,
      );
    }
  }

  async #authorizeSessionRequest(
    runtimeContext: RuntimeContext,
    runtimeProof: RuntimeProof,
    claimedSessionId: string,
    turnId?: string,
  ): Promise<RuntimeIdentity> {
    if (!(await this.#consumeRuntimeProof(runtimeContext, runtimeProof))) {
      throw new GoalProgressIpcHandlerError(
        "RUNTIME_PROOF_INVALID",
        "Write request does not have a valid runtime proof",
      );
    }
    if (turnId !== undefined && runtimeContext.turnId !== turnId) {
      throw new GoalProgressIpcHandlerError(
        "SESSION_MISMATCH",
        "Write request identity does not match its Session and turn",
      );
    }
    const identity = await this.#resolveIdentity(runtimeContext);
    if (!claimedSessionMatchesIdentity(claimedSessionId, identity)) {
      throw new GoalProgressIpcHandlerError(
        "SESSION_MISMATCH",
        "Write request identity does not match its Session and turn",
      );
    }
    await this.#log({
      level: "info",
      event: "ipc.request",
      ...identityLogFields(identity),
    });
    return identity;
  }

  async #trustedNativeGoal(
    sessionId: string,
    revision: number | null = null,
  ): Promise<TrustedNativeGoal> {
    const nativeGoal = await this.#readNativeGoal(sessionId, revision);
    if (!nativeGoal) {
      throw new GoalProgressIpcHandlerError(
        "NATIVE_GOAL_DETACHED",
        "Native Goal is missing; do not keep writing the previous Contract",
        revision,
      );
    }
    if (nativeGoal.threadId !== sessionId || !nativeGoal.objective.trim()) {
      throw new GoalProgressIpcHandlerError(
        "NATIVE_GOAL_MISMATCH",
        "Current Session native Goal is unavailable or mismatched",
        revision,
      );
    }
    if (nativeGoal.objective.length > GOAL_NATIVE_OBJECTIVE_MAX_LENGTH) {
      throw new GoalProgressIpcHandlerError(
        "NATIVE_GOAL_OBJECTIVE_TOO_LONG",
        `Native Goal objective exceeds ${GOAL_NATIVE_OBJECTIVE_MAX_LENGTH} characters`,
        revision,
      );
    }
    return nativeGoal;
  }

  async #readNativeGoal(
    threadId: string,
    revision: number | null = null,
  ): Promise<TrustedNativeGoal | null> {
    try {
      return await this.#resolveNativeGoal(threadId);
    } catch (error) {
      throw new GoalProgressIpcHandlerError(
        "NATIVE_GOAL_UNAVAILABLE",
        "Could not read the current Session native Goal",
        revision,
        undefined,
        error,
      );
    }
  }

  async #contractForWrite(
    identity: RuntimeIdentity,
    contract: GoalContractAny | null,
    revision: number | null,
    trustedNativeGoal?: TrustedNativeGoal | null,
  ): Promise<GoalContract | null> {
    if (!contract) {
      return null;
    }
    if (contract.schemaVersion === 2) {
      return contract;
    }
    const nativeGoal =
      trustedNativeGoal === undefined
        ? await this.#readNativeGoal(identity.threadId, revision)
        : trustedNativeGoal;
    const migrated = migrateGoalContractV1ToV2({
      contract,
      identity,
      nativeGoal,
    });
    if (!migrated.ok) {
      throw new GoalProgressIpcHandlerError(migrated.code, migrated.message, revision);
    }
    const migrateKey = hashGoalProgressIdentity(`${identity.threadId}:${contract.revision}`);
    const persisted = await this.#store.persistMigrated(migrated.contract, {
      eventId: `evt-migrate-${migrateKey}`,
      requestId: `req-migrate-${migrateKey}`,
      turnId: identity.turnId,
      occurredAt: new Date().toISOString(),
      source: "system",
    });
    if (persisted.contract.schemaVersion !== 2) {
      throw new GoalProgressIpcHandlerError(
        "REBIND_REQUIRED",
        "Migrated Contract is not schema v2",
        revision,
      );
    }
    return persisted.contract;
  }

  #handler(): GoalProgressIpcHandler {
    return async (request, context) => {
      const startedAt = Date.now();
      try {
        if (!methodIsAllowed(request.method, context)) {
          throw new GoalProgressIpcHandlerError(
            "IPC_METHOD_FORBIDDEN",
            `${context.clientKind} cannot call ${request.method}`,
          );
        }
        if (request.method === "ping") {
          return {
            revision: null,
            result: {
              status: "ok",
              pid: this.#lock?.identity.pid ?? process.pid,
              instanceId: this.#lock?.identity.instanceId ?? null,
            },
          };
        }
        if (request.method === "runtime-proof.issue") {
          const proof = await issueRuntimeProof(
            request.params.runtimeContext,
            request.params.toolUseId,
            await this.#key(),
          );
          return { revision: null, result: { runtimeProof: proof } };
        }
        if (request.method === "runtime-proof.consume") {
          const consumed = await this.#consumeRuntimeProof(
            request.params.runtimeContext,
            request.params.runtimeProof,
          );
          return { revision: null, result: { valid: consumed } };
        }
        if (request.method === "activation.resume") {
          const resumed = await this.#resumeTracking(request.params.hookSessionId);
          if (resumed.status === "active") {
            await this.#log({
              level: "info",
              event: "hook.resume",
              sessionKey: hashGoalProgressIdentity(request.params.hookSessionId),
              sessionTreeKey: hashGoalProgressIdentity(request.params.hookSessionId),
              threadKey: hashGoalProgressIdentity(request.params.hookSessionId),
              contractId: resumed.contractId,
              revision: resumed.revision,
            });
          }
          const responseRevision =
            resumed.status === "active"
              ? resumed.revision
              : ((await this.#store.load(request.params.hookSessionId)).contract?.revision ?? null);
          return {
            revision: responseRevision,
            result: resumed,
          };
        }
        if (request.method === "hook.audit") {
          if (request.params.event === "ResumeTemporarilyUnavailable") {
            const loaded = await this.#store.load(request.params.hookSessionId);
            if (!loaded.contract || loaded.contract.phase === "completed") {
              return { revision: loaded.contract?.revision ?? null, result: { accepted: false } };
            }
            await this.#log({
              level: "warn",
              event: "hook.resume-unavailable",
              sessionKey: hashGoalProgressIdentity(request.params.hookSessionId),
              sessionTreeKey: hashGoalProgressIdentity(request.params.hookSessionId),
              threadKey: hashGoalProgressIdentity(request.params.hookSessionId),
              contractId: loaded.contract.contractId,
              revision: loaded.contract.revision,
              causeCode: request.params.reasonCode,
              count: 1,
            });
            return { revision: loaded.contract.revision, result: { accepted: true } };
          }
          if (request.params.event === "NativeGoalCompleted") {
            let identity: RuntimeIdentity;
            try {
              identity = await this.#resolveCurrentThread({
                sessionTreeId: request.params.hookSessionId,
                turnId: request.params.turnId,
                cwd: request.params.cwd,
                model: request.params.model,
              });
            } catch {
              return { revision: null, result: { accepted: false } };
            }
            const loaded = await this.#store.load(identity.threadId);
            const contract = loaded.contract;
            if (!contract) {
              return { revision: null, result: { accepted: false } };
            }
            if (contract.nativeGoal.status === "complete") {
              return { revision: contract.revision, result: { accepted: true } };
            }
            const requestKey = hashGoalProgressIdentity(request.params.toolUseId);
            const applied = await this.#store.apply({
              contractId: contract.contractId,
              sessionId: identity.threadId,
              expectedRevision: contract.revision,
              eventId: `evt-native-complete-${requestKey}`,
              requestId: `req-native-complete-${requestKey}`,
              turnId: identity.turnId,
              occurredAt: new Date().toISOString(),
              source: "system",
              type: "sync-native-goal",
              nativeGoal: {
                objective: contract.nativeGoal.objective,
                status: "complete",
                ...(contract.nativeGoal.tokenBudget === undefined
                  ? {}
                  : { tokenBudget: contract.nativeGoal.tokenBudget }),
              },
            });
            if (!applied.ok) {
              return {
                revision: applied.currentRevision,
                result: { accepted: false },
              };
            }
            const sessionPaths = resolveGoalProgressSessionPaths(this.paths, identity.threadId);
            const existingOverlay = await this.#overlayFor(identity.threadId);
            const activationState = await this.#activationStateForOverlay(
              identity.threadId,
              existingOverlay,
            );
            if (isUserDetachedActivationState(activationState)) {
              if (this.#enableGoalWatch) {
                this.#runtime.setPollingMode("collapsed-or-background");
              }
              await this.#log({
                level: "info",
                event: "hook.native-goal-complete",
                ...identityLogFields(identity),
                contractId: applied.contract.contractId,
                revision: applied.contract.revision,
              });
              return {
                revision: applied.contract.revision,
                result: { accepted: true },
              };
            }
            await writeGoalProgressActivationState(
              identity.threadId,
              this.paths,
              DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
            );
            const overlay = await writeGoalProgressTrackingOverlay(sessionPaths, {
              ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
              detached: false,
            });
            if (this.#enableGoalWatch) {
              this.#runtime.setPollingMode("collapsed-or-background");
            }
            const projected = this.#projectState(applied.contract, overlay);
            await this.#publishVerified(identity.threadId, projected.viewModel);
            await this.#log({
              level: "info",
              event: "hook.native-goal-complete",
              ...identityLogFields(identity),
              contractId: applied.contract.contractId,
              revision: applied.contract.revision,
            });
            return {
              revision: applied.contract.revision,
              result: { accepted: true },
            };
          }
          return { revision: null, result: { accepted: false } };
        }
        if (request.method === "activation.plan") {
          const identity = await this.#authorizeSessionRequest(
            request.params.runtimeContext,
            request.params.runtimeProof,
            request.params.runtimeContext.hookSessionId,
            request.params.runtimeContext.turnId,
          );
          const objectiveBody = normalizeGoalProgressObjectiveBody(request.params.objectiveBody);
          await this.#log({
            level: "info",
            event: "activation.requested",
            ...identityLogFields(identity),
            count: objectiveBody?.length ?? 0,
          });
          const nativeGoal = await this.#readNativeGoal(identity.threadId);
          const loaded = await this.#store.load(identity.threadId);
          const current = await this.#contractForWrite(
            identity,
            loaded.contract,
            loaded.contract?.revision ?? null,
            nativeGoal,
          );
          let contractId: string | null = null;
          let revision: number | null = null;
          let contractExists = false;
          if (current && nativeGoal) {
            try {
              assertBoundNativeGoal(current, nativeGoal, current.revision);
              contractExists = true;
              contractId = current.contractId;
              revision = current.revision;
            } catch {
              // A stale Contract cannot be reused for a different native Goal.
            }
          }
          const plan = planGoalProgressActivation({
            objectiveBody,
            nativeGoal: nativeGoal ? { objective: nativeGoal.objective } : null,
            contractExists,
            replacementRequested: request.params.replacementRequested,
          });
          if (contractExists && current && plan.progressAction === "get") {
            const sessionPaths = resolveGoalProgressSessionPaths(this.paths, identity.threadId);
            const overlay = await this.#overlayFor(identity.threadId);
            const activationState = await this.#activationStateForOverlay(
              identity.threadId,
              overlay,
            );
            if (isUserDetachedActivationState(activationState)) {
              await writeGoalProgressActivationState(
                identity.threadId,
                this.paths,
                DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
              );
              const activeOverlay = await writeGoalProgressTrackingOverlay(sessionPaths, {
                ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
                detached: false,
              });
              await this.#publishVerified(
                identity.threadId,
                this.#projectState(current, activeOverlay).viewModel,
              );
            }
          }
          if (plan.preparing) {
            const objective = nativeGoal?.objective ?? objectiveBody;
            if (objective) {
              const sessionPaths = resolveGoalProgressSessionPaths(this.paths, identity.threadId);
              await writeGoalProgressActivationState(
                identity.threadId,
                this.paths,
                DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
              );
              await writeGoalProgressTrackingOverlay(sessionPaths, {
                ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
                detached: false,
              });
              await this.#publishPreparing(identity.threadId, objective, "reading-goal");
              await this.#publishPreparing(identity.threadId, objective, "preparing-checklist");
            }
          }
          return {
            revision,
            result: {
              ...plan,
              contractId,
              revision,
              ...(plan.progressAction === "initialize" && nativeGoal
                ? { preparedForObjective: nativeGoal.objective }
                : {}),
            },
          };
        }
        if (request.method === "store.load") {
          const identity = await this.#authorizeSessionRequest(
            request.params.runtimeContext,
            request.params.runtimeProof,
            request.params.sessionId,
          );
          let loaded = await this.#store.load(identity.threadId);
          const recovery = {
            snapshotRecovered: loaded.snapshotRecovered,
            tornTailRepaired: loaded.tornTailRepaired,
          };
          let contract = loaded.contract;
          if (contract?.schemaVersion === 1) {
            try {
              contract = await this.#contractForWrite(identity, contract, contract.revision);
            } catch {
              contract = loaded.contract;
            }
          }
          if (contract) {
            this.#watchThread(identity.threadId);
            const usage = await this.#refreshUsage(identity.threadId);
            loaded = await this.#store.load(identity.threadId);
            contract = loaded.contract ?? contract;
            const overlay = await this.#overlayForCurrentNativeGoal(contract, usage);
            const { contract: _ignored, ...latestDiagnostics } = loaded;
            const diagnostics = {
              ...latestDiagnostics,
              snapshotRecovered: recovery.snapshotRecovered || latestDiagnostics.snapshotRecovered,
              tornTailRepaired: recovery.tornTailRepaired || latestDiagnostics.tornTailRepaired,
            };
            const preparingObjective = this.#preparingObjectives.get(identity.threadId);
            if (overlay.detached && preparingObjective) {
              await this.#publishPreparing(
                identity.threadId,
                preparingObjective,
                "preparing-checklist",
              );
              return {
                revision: contract.revision,
                result: {
                  ...diagnostics,
                  viewModel: null,
                  nextTargetId: null,
                  previousContractId: contract.contractId,
                  previousRevision: contract.revision,
                  preparedForObjective: preparingObjective,
                },
              };
            }
            const projected = this.#projectState(contract, overlay);
            await this.#publishVerified(identity.threadId, projected.viewModel);
            return {
              revision: contract.revision,
              result: {
                ...diagnostics,
                ...projected,
              },
            };
          }
          const { contract: _ignored, ...diagnostics } = loaded;
          return {
            revision: null,
            result: {
              ...diagnostics,
              viewModel: null,
              nextTargetId: null,
            },
          };
        }
        if (request.method === "view.get") {
          const loaded = await this.#store.load(request.params.sessionId);
          if (!loaded.contract) {
            throw new GoalProgressIpcHandlerError(
              "STORE_NOT_INITIALIZED",
              "Session has no Goal Contract",
            );
          }
          const threadId = this.#threadIdOf(loaded.contract);
          this.#watchThread(threadId);
          const usage = await this.#refreshUsage(threadId);
          const contract = (await this.#store.load(threadId)).contract ?? loaded.contract;
          const overlay = await this.#overlayForCurrentNativeGoal(contract, usage);
          const preparingObjective = this.#preparingObjectives.get(threadId);
          if (overlay.detached && preparingObjective) {
            const viewModel = await this.#publishPreparing(
              threadId,
              preparingObjective,
              "preparing-checklist",
            );
            return {
              revision: null,
              result: {
                viewModel,
                uiPreference: await readGoalProgressUiPreference(this.paths),
              },
            };
          }
          const presented = {
            ...this.#projectState(contract, overlay),
            uiPreference: await readGoalProgressUiPreference(this.paths),
          };
          return {
            revision: contract.revision,
            result: {
              viewModel: presented.viewModel,
              uiPreference: presented.uiPreference,
            },
          };
        }
        if (request.method === "ui.intent") {
          const accepted = acceptGoalProgressUiIntent(request.params.intent);
          if (!accepted.ok) {
            throw new GoalProgressIpcHandlerError(accepted.code, accepted.message);
          }
          const loaded = await this.#store.load(request.params.sessionId);
          if (!loaded.contract) {
            const threadId = request.params.sessionId;
            const sessionPaths = resolveGoalProgressSessionPaths(this.paths, threadId);
            const preference = await readGoalProgressUiPreference(this.paths);
            if (accepted.intent.type === "requestRetry") {
              const activationState = await readGoalProgressActivationState(threadId, this.paths);
              if (activationState.detachReason === "user-dismissed-preparation") {
                throw new GoalProgressIpcHandlerError(
                  "ACTIVATION_CANCELLED",
                  "Goal Progress preparation was closed by the user",
                );
              }
              await writeGoalProgressActivationState(
                threadId,
                this.paths,
                DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
              );
              await writeGoalProgressTrackingOverlay(sessionPaths, {
                ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
                detached: false,
              });
              const nativeGoal = await this.#readNativeGoal(threadId);
              if (!nativeGoal) {
                const viewModel = await this.#publishPreparationError(
                  threadId,
                  "NATIVE_GOAL_DETACHED",
                );
                return {
                  revision: null,
                  result: { viewModel, uiPreference: preference },
                };
              }
              await this.#publishPreparing(threadId, nativeGoal.objective, "reading-goal");
              const viewModel = await this.#publishPreparing(
                threadId,
                nativeGoal.objective,
                "preparing-checklist",
              );
              return {
                revision: null,
                result: { viewModel, uiPreference: preference },
              };
            }
            if (accepted.intent.type === "requestDetach") {
              await writeGoalProgressActivationState(threadId, this.paths, {
                schemaVersion: 1,
                detachReason: "user-dismissed-preparation",
              });
              await writeGoalProgressTrackingOverlay(sessionPaths, {
                ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
                detached: true,
              });
              const objective = this.#preparingObjectives.get(threadId) ?? "当前 Goal";
              const viewModel = this.#transientView(threadId, objective, "detached");
              this.#preparingObjectives.delete(threadId);
              await this.#viewModelPublisher.clear(threadId);
              return {
                revision: null,
                result: {
                  viewModel,
                  uiPreference: preference,
                  dismissed: true,
                },
              };
            }
            throw new GoalProgressIpcHandlerError(
              "STORE_NOT_INITIALIZED",
              "Session has no Goal Contract",
            );
          }
          const threadId = this.#threadIdOf(loaded.contract);
          const sessionPaths = resolveGoalProgressSessionPaths(this.paths, threadId);
          let preference = await readGoalProgressUiPreference(this.paths);
          let overlay = await this.#overlayFor(threadId);
          let dismissedPreparation = false;
          if (accepted.intent.type === "setCollapsed") {
            preference = await writeGoalProgressUiPreference(this.paths, {
              ...preference,
              collapsed: accepted.intent.collapsed,
            });
          } else if (accepted.intent.type === "setMotionPaused") {
            preference = await writeGoalProgressUiPreference(this.paths, {
              ...preference,
              motionPaused: accepted.intent.motionPaused,
            });
          } else if (accepted.intent.type === "setPlacement") {
            preference = await writeGoalProgressUiPreference(this.paths, {
              ...preference,
              placement: accepted.intent.placement,
            });
          } else if (accepted.intent.type === "setFloatingXRatio") {
            preference = await writeGoalProgressUiPreference(this.paths, {
              ...preference,
              floatingXRatio: accepted.intent.floatingXRatio,
            });
          } else if (accepted.intent.type === "requestDetach") {
            dismissedPreparation = this.#preparingObjectives.has(threadId);
            await writeGoalProgressActivationState(threadId, this.paths, {
              schemaVersion: 1,
              detachReason: dismissedPreparation
                ? "user-dismissed-preparation"
                : "user-detached-tracking",
            });
            overlay = await writeGoalProgressTrackingOverlay(sessionPaths, {
              ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
              detached: true,
            });
            if (dismissedPreparation) {
              this.#preparingObjectives.delete(threadId);
            }
          }
          this.#watchThread(threadId);
          await this.#refreshUsage(threadId);
          const contract = (await this.#store.load(threadId)).contract ?? loaded.contract;
          await this.#applyPollingMode(threadId, preference, overlay, contract);
          const viewModel = this.#project(contract, overlay);
          return {
            revision: contract.revision,
            result: {
              viewModel,
              uiPreference: preference,
              ...(dismissedPreparation ? { dismissed: true } : {}),
            },
          };
        }
        if (request.method === "store.initialize") {
          const identity = await this.#authorizeSessionRequest(
            request.params.runtimeContext,
            request.params.runtimeProof,
            request.params.runtimeContext.hookSessionId,
            request.params.metadata.turnId,
          );
          try {
            const overlay = await this.#overlayFor(identity.threadId);
            const activationState = await this.#activationStateForOverlay(
              identity.threadId,
              overlay,
            );
            if (activationState.detachReason === "user-dismissed-preparation") {
              throw new GoalProgressIpcHandlerError(
                "ACTIVATION_CANCELLED",
                "Goal Progress preparation was closed by the user before initialization",
              );
            }
            if (activationState.detachReason === "user-detached-tracking") {
              throw new GoalProgressIpcHandlerError(
                "TRACKING_DETACHED_BY_USER",
                "Goal Progress tracking was closed by the user",
              );
            }
            const preparingObjective = this.#preparingObjectives.get(identity.threadId);
            if (preparingObjective) {
              await this.#publishPreparing(
                identity.threadId,
                preparingObjective,
                "establishing-baseline",
              );
            }
            const nativeGoal = await this.#trustedNativeGoal(identity.threadId);
            const current = await this.#store.load(identity.threadId);
            const currentContract = current.contract?.schemaVersion === 2 ? current.contract : null;
            if (request.params.initialization.preparedForObjective !== nativeGoal.objective) {
              throw new GoalProgressIpcHandlerError(
                "PREPARATION_OBJECTIVE_STALE",
                "Prepared Checklist does not match the current native Goal objective",
                currentContract?.revision ?? null,
              );
            }
            const contract = createModelContract(
              request.params.initialization,
              nativeGoal,
              identity,
              request.params.metadata.occurredAt,
            );
            const metadata =
              context.clientKind === "mcp"
                ? { ...request.params.metadata, source: "model" as const }
                : request.params.metadata;
            let initialized: GoalEventStoreWriteSuccess;
            const currentBinding = currentContract?.nativeGoalBinding ?? null;
            const objectiveChangedInPlace =
              currentBinding !== null &&
              currentBinding.createdAt === nativeGoal.createdAt &&
              currentBinding.objectiveHash !== hashNativeGoalObjective(nativeGoal.objective);
            if (
              currentContract &&
              (currentContract.nativeGoalBinding.createdAt !== nativeGoal.createdAt ||
                objectiveChangedInPlace)
            ) {
              initialized = await this.#store.replace(contract, metadata, {
                contractId: currentContract.contractId,
                revision: currentContract.revision,
              });
            } else {
              if (currentContract) {
                assertBoundNativeGoal(currentContract, nativeGoal, currentContract.revision);
              }
              initialized = await this.#store.initialize(contract, metadata);
            }
            this.#preparingObjectives.delete(identity.threadId);
            this.#watchThread(identity.threadId);
            await this.#refreshUsage(identity.threadId);
            const latest =
              (await this.#store.load(identity.threadId)).contract ?? initialized.contract;
            await writeGoalProgressActivationState(
              identity.threadId,
              this.paths,
              DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
            );
            const activeOverlay = overlay.detached
              ? await writeGoalProgressTrackingOverlay(
                  resolveGoalProgressSessionPaths(this.paths, identity.threadId),
                  DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
                )
              : overlay;
            const projected = this.#projectState(latest, activeOverlay);
            await this.#publishVerified(identity.threadId, projected.viewModel);
            return {
              revision: latest.revision,
              result: {
                ...projected,
                duplicate: initialized.duplicate,
              },
            };
          } catch (error) {
            const loaded = await this.#store.load(identity.threadId).catch(() => null);
            if (!loaded?.contract && this.#preparingObjectives.has(identity.threadId)) {
              await this.#publishPreparationError(identity.threadId, errorCode(error));
            }
            throw error;
          }
        }
        if (request.method === "store.apply") {
          const identity = await this.#authorizeSessionRequest(
            request.params.runtimeContext,
            request.params.runtimeProof,
            request.params.command.sessionId,
            request.params.command.turnId,
          );
          const persistedOverlay = await this.#overlayFor(identity.threadId);
          const activationState = await this.#activationStateForOverlay(
            identity.threadId,
            persistedOverlay,
          );
          if (isUserDetachedActivationState(activationState)) {
            throw new GoalProgressIpcHandlerError(
              "TRACKING_DETACHED_BY_USER",
              "Goal Progress tracking was closed by the user",
            );
          }
          const command = { ...request.params.command, sessionId: identity.threadId };
          if (command.type === "sync-native-goal" || command.type === "retarget-rescope") {
            throw new GoalProgressIpcHandlerError(
              "NATIVE_GOAL_SOURCE_UNVERIFIED",
              "Only the trusted native Goal adapter can synchronize or retarget native Goal state",
            );
          }
          const current = await this.#store.load(identity.threadId);
          const contract = await this.#contractForWrite(
            identity,
            current.contract,
            current.contract?.revision ?? null,
          );
          let commandForStore: GoalProgressCommand =
            context.clientKind === "mcp" ? sanitizeModelCommand(command) : command;
          let retargeted = false;
          if (contract && contract.nativeGoal.status !== "complete") {
            const nativeGoal = await this.#readNativeGoal(identity.threadId, contract.revision);
            if (command.type === "rescope" && nativeGoal) {
              try {
                assertBoundNativeGoal(contract, nativeGoal, contract.revision);
              } catch (error) {
                if (!nativeGoalErrorDetachesContract(error)) {
                  throw error;
                }
                const sanitized = (
                  context.clientKind === "mcp" ? sanitizeModelCommand(command) : command
                ) as Extract<GoalProgressCommand, { type: "rescope" }>;
                commandForStore = {
                  ...sanitized,
                  type: "retarget-rescope",
                  source: "system",
                  nativeGoalBinding: {
                    threadId: identity.threadId,
                    createdAt: nativeGoal.createdAt,
                    objectiveHash: hashNativeGoalObjective(nativeGoal.objective),
                  },
                  nativeGoal: contractNativeGoal(nativeGoal),
                };
                retargeted = true;
              }
            } else {
              await this.#assertBoundNativeGoalOrDetach(contract, nativeGoal);
            }
          }
          const applied = await this.#store.apply(commandForStore);
          if (!applied.ok) {
            if (applied.code === "REVISION_CONFLICT") {
              const latest = await this.#store.load(identity.threadId);
              if (latest.contract) {
                const currentViewModel = this.#project(
                  latest.contract,
                  await this.#overlayFor(identity.threadId),
                );
                throw new GoalProgressIpcHandlerError(
                  applied.code,
                  applied.message,
                  currentViewModel.revision,
                  currentViewModel,
                );
              }
            }
            throw new GoalProgressIpcHandlerError(
              applied.code,
              applied.message,
              applied.currentRevision,
            );
          }
          const overlay = retargeted
            ? await (async () => {
                await writeGoalProgressActivationState(
                  identity.threadId,
                  this.paths,
                  DEFAULT_GOAL_PROGRESS_ACTIVATION_STATE,
                );
                return writeGoalProgressTrackingOverlay(
                  resolveGoalProgressSessionPaths(this.paths, identity.threadId),
                  {
                    ...DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY,
                    detached: false,
                  },
                );
              })()
            : await this.#overlayFor(identity.threadId);
          if (retargeted) {
            this.#preparingObjectives.delete(identity.threadId);
          }
          this.#watchThread(identity.threadId);
          await this.#refreshUsage(identity.threadId);
          await this.#applyPollingMode(
            identity.threadId,
            await readGoalProgressUiPreference(this.paths),
            overlay,
            applied.contract,
          );
          const projected = this.#projectState(applied.contract, overlay);
          await this.#publishVerified(identity.threadId, projected.viewModel);
          return {
            revision: applied.contract.revision,
            result: {
              ...projected,
              duplicate: applied.duplicate,
            },
          };
        }
        const doctor = await inspectGoalProgressLocal(
          this.paths,
          request.params.sessionId,
          true,
          this.#store,
        );
        const runtime = await this.#inspectRuntimeDoctor(request.params.sessionId);
        return {
          revision:
            doctor.store.checked && doctor.store.revision !== null ? doctor.store.revision : null,
          result: { ...doctor, runtime },
        };
      } catch (error) {
        const code = errorCode(error);
        const causeCode = diagnosticCauseCode(error);
        await this.#log({
          level: "error",
          event: "ipc.error",
          code,
          ...(causeCode === code ? {} : { causeCode }),
          durationMs: Date.now() - startedAt,
        });
        throw handlerError(error);
      } finally {
        await this.#log({
          level: "info",
          event: "ipc.response",
          durationMs: Date.now() - startedAt,
        });
      }
    };
  }

  async start(): Promise<void> {
    if (this.#lock || this.#server) {
      throw new GoalProgressIpcHandlerError(
        "HELPER_ALREADY_RUNNING",
        "This Helper instance is already running",
      );
    }
    const lock = await acquireHelperInstanceLock(this.paths, this.#lockOptions);
    const server = new GoalProgressIpcServer(this.paths.helperSocketPath, this.#handler());
    try {
      await this.#key();
      await server.start({ removeStaleSocket: true });
    } catch (error) {
      await lock.release();
      throw error;
    }
    this.#lock = lock;
    this.#server = server;
    const recoveredVisibleThreadId = await this.#viewModelPublisher.recoverVisibleThreadId();
    await this.#viewModelPublisher.initialize();
    if (recoveredVisibleThreadId) {
      const restored = await this.#restoreVisibleThread(recoveredVisibleThreadId).catch(
        (): "retry" => "retry",
      );
      if (restored === "retry") {
        this.#scheduleVisibleThreadRecovery(0);
      } else {
        this.#scheduleVisibleThreadWatch();
      }
    } else {
      this.#scheduleVisibleThreadRecovery(0);
    }
    await this.#log({
      level: "info",
      event: "helper.started",
    });
  }

  async setViewModelSink(sink?: ViewModelPublisherSink): Promise<void> {
    await this.#viewModelPublisher.setSink(sink);
  }

  async stop(): Promise<void> {
    const server = this.#server;
    const lock = this.#lock;
    this.#server = undefined;
    this.#lock = undefined;
    if (this.#visibleThreadRecoveryTimer) {
      clearTimeout(this.#visibleThreadRecoveryTimer);
      this.#visibleThreadRecoveryTimer = undefined;
    }
    await server?.stop();
    await this.#viewModelPublisher.close();
    await this.#runtime.close();
    await this.#log({
      level: "info",
      event: "helper.stopped",
    });
    await lock?.release();
  }
}

export async function runHelperCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const root = process.env.GOAL_PROGRESS_ROOT;
  const paths = resolveGoalProgressPaths(root === undefined ? {} : { root: resolve(root) });
  if (argv[0] === "doctor") {
    const sessionFlag = argv.indexOf("--session-id");
    const sessionId = sessionFlag >= 0 && argv[sessionFlag + 1] ? argv[sessionFlag + 1] : undefined;
    const result = await inspectGoalProgress(paths, sessionId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (argv.length > 0 && argv[0] !== "serve") {
    throw new Error("Usage: goal-progress-helper [serve|doctor --json]");
  }
  const viewModelSink =
    process.platform === "darwin"
      ? new RendererBridgeSupervisor({
          connector: () => connectHelperRendererBridge(paths),
        })
      : undefined;
  const helper = new GoalProgressHelper({
    paths,
    ...(viewModelSink === undefined ? {} : { viewModelSink }),
    ...(viewModelSink === undefined
      ? {}
      : { rendererDoctor: (expectedThreadId?: string) => viewModelSink.doctor(expectedThreadId) }),
  });
  try {
    await helper.start();
  } catch (error) {
    await viewModelSink?.close();
    throw error;
  }
  const stop = async () => {
    await helper.stop();
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  runHelperCli().catch((error: unknown) => {
    process.stderr.write(`${errorCode(error)}\n`);
    process.exitCode = 1;
  });
}
