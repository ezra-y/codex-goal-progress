import type { GoalProgressViewModel } from "../../contracts/src/goal-contract.js";
import { GOAL_PROGRESS_RELEASE_VERSION } from "../../contracts/src/release-version.js";
import {
  GOAL_PROGRESS_HOT_ELEMENT_NAME,
  GOAL_PROGRESS_UI_INTENT_BINDING_PREFIX,
  GOAL_PROGRESS_UI_INTENT_PROTOCOL_VERSION,
  type GoalProgressUiIntentEnvelope,
} from "../../contracts/src/renderer-events.js";
import type {
  GoalProgressUiIntent,
  GoalProgressUiPreference,
} from "../../contracts/src/ui-preference.js";
import {
  type CodexAnchorAdapter,
  type CodexAnchorAdapterRegistry,
  type CodexHostPlatform,
  createDefaultCodexAnchorAdapterRegistry,
} from "./anchor-adapter.js";
import {
  GOAL_PROGRESS_ELEMENT_NAME,
  removeManagedGoalProgressHosts,
  type SidecarHealthResult,
  type SidecarLayoutDiagnostics,
  SidecarMountController,
  type SidecarMountResult,
} from "./sidecar-mount.js";

export const GOAL_PROGRESS_PAGE_HOST_GLOBAL = "__CODEX_GOAL_PROGRESS__";
export const GOAL_PROGRESS_PAGE_HOST_VERSION = 51;
export const GOAL_PROGRESS_OBSERVER_DEBOUNCE_MS = 150;
export const GOAL_PROGRESS_OBSERVER_RETRY_DELAYS_MS = Object.freeze([
  250, 500, 1_000, 2_000, 4_000,
] as const);

const OBSERVED_REGION_SELECTOR = "[data-codex-composer-root], [data-app-action-sidebar-thread-row]";
const GOAL_PROGRESS_HOST_SELECTOR = `${GOAL_PROGRESS_ELEMENT_NAME},${GOAL_PROGRESS_HOT_ELEMENT_NAME}`;
const OBSERVED_ATTRIBUTES = [
  "aria-hidden",
  "aria-current",
  "class",
  "data-app-action-sidebar-thread-active",
  "data-app-action-sidebar-thread-host-id",
  "data-app-action-sidebar-thread-id",
  "data-app-action-sidebar-thread-selected",
  "data-codex-composer",
  "data-codex-composer-root",
  "dir",
  "hidden",
  "lang",
  "style",
] as const;

type PageHostFailureReason =
  | "invalid-input"
  | "not-configured"
  | "platform-unsupported"
  | "app-version-unsupported"
  | "capability-unsupported"
  | "adapter-ambiguous";

export interface GoalProgressPageHostFailure {
  readonly action: "none";
  readonly reason: PageHostFailureReason;
  readonly adapterId: null;
  readonly adapterRejectionReason: null;
  readonly hostCount: number;
  readonly threadChanged: false;
}

export interface GoalProgressPageRuntimeDiagnostics {
  readonly uiIntentBindingActive: boolean;
  readonly observerActive: boolean;
  readonly debounceDelayMs: typeof GOAL_PROGRESS_OBSERVER_DEBOUNCE_MS;
  readonly retryDelaysMs: typeof GOAL_PROGRESS_OBSERVER_RETRY_DELAYS_MS;
  readonly mutationBatches: number;
  readonly debounceRuns: number;
  readonly retryRuns: number;
  readonly retryScheduled: number;
  readonly reconcileRuns: number;
  readonly mountActions: number;
  readonly updateActions: number;
  readonly unmountActions: number;
  readonly failureCount: number;
  readonly lastFailureReason: string | null;
  readonly retryExhausted: boolean;
  readonly lastReconcileCause:
    | "none"
    | "initial-mount"
    | "view-model-update"
    | "relevant-mutation"
    | "retry";
  readonly lastMutationKind: "none" | "attributes" | "child-list" | "mixed";
  readonly layout: SidecarLayoutDiagnostics;
}

export type GoalProgressPageHealthResult = (SidecarHealthResult | GoalProgressPageHostFailure) & {
  readonly runtime: GoalProgressPageRuntimeDiagnostics;
};

export interface GoalProgressPageMountInput {
  readonly platform: CodexHostPlatform;
  readonly appVersion: string;
  readonly viewModel: GoalProgressViewModel;
  readonly bridgeNonce?: string;
  readonly bridgeBindingName?: string;
  readonly uiPreference: GoalProgressUiPreference;
}

export interface GoalProgressPageHostApi {
  readonly namespace: "codex-goal-progress";
  readonly version: typeof GOAL_PROGRESS_PAGE_HOST_VERSION;
  readonly releaseVersion: typeof GOAL_PROGRESS_RELEASE_VERSION;
  mount(input: unknown): SidecarMountResult | GoalProgressPageHostFailure;
  update(viewModel: unknown): SidecarMountResult | GoalProgressPageHostFailure;
  unmount(): SidecarMountResult | GoalProgressPageHostFailure;
  health(): GoalProgressPageHealthResult;
}

export interface GoalProgressPageHostOptions {
  readonly elementName?: string;
  readonly registry?: CodexAnchorAdapterRegistry;
}

type GoalProgressPageWindow = Window &
  typeof globalThis & {
    [GOAL_PROGRESS_PAGE_HOST_GLOBAL]?: unknown;
  };

const trackingPhases = new Set([
  "preparing",
  "active",
  "paused",
  "blocked",
  "completed",
  "error",
  "detached",
]);

const defaultUiPreference: GoalProgressUiPreference = {
  schemaVersion: 2,
  collapsed: false,
  motionPaused: false,
  hidden: false,
  placement: "inline",
  floatingXRatio: 0.5,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseUiPreference(value: unknown): GoalProgressUiPreference | null {
  if (
    !isRecord(value) ||
    typeof value.collapsed !== "boolean" ||
    typeof value.motionPaused !== "boolean" ||
    typeof value.hidden !== "boolean"
  ) {
    return null;
  }
  if (value.schemaVersion === 1) {
    return {
      ...defaultUiPreference,
      collapsed: value.collapsed,
      motionPaused: value.motionPaused,
      hidden: value.hidden,
    };
  }
  if (
    value.schemaVersion !== 2 ||
    (value.placement !== "inline" && value.placement !== "floating") ||
    typeof value.floatingXRatio !== "number" ||
    !Number.isFinite(value.floatingXRatio) ||
    value.floatingXRatio < 0 ||
    value.floatingXRatio > 1
  ) {
    return null;
  }
  return value as GoalProgressUiPreference;
}

function applyLocalUiIntent(
  preference: GoalProgressUiPreference,
  intent: GoalProgressUiIntent,
): GoalProgressUiPreference {
  if (intent.type === "setCollapsed") {
    return { ...preference, collapsed: intent.collapsed };
  }
  if (intent.type === "setMotionPaused") {
    return { ...preference, motionPaused: intent.motionPaused };
  }
  if (intent.type === "setPlacement") {
    return { ...preference, placement: intent.placement };
  }
  if (intent.type === "setFloatingXRatio") {
    return { ...preference, floatingXRatio: intent.floatingXRatio };
  }
  return preference;
}

function isViewModelEnvelope(value: unknown): value is GoalProgressViewModel {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 2 &&
    typeof value.contractId === "string" &&
    value.contractId.length > 0 &&
    value.contractId.length <= 128 &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= 256 &&
    Number.isSafeInteger(value.revision) &&
    Number.isSafeInteger(value.scopeRevision) &&
    typeof value.trackingPhase === "string" &&
    trackingPhases.has(value.trackingPhase) &&
    typeof value.objective === "string" &&
    Array.isArray(value.objectives) &&
    (value.optionalObjectives === undefined || Array.isArray(value.optionalObjectives)) &&
    value.maxVisibleObjectives === 3
  );
}

function parseMountInput(value: unknown): GoalProgressPageMountInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const platform = value.platform;
  const appVersion = value.appVersion;
  const bridgeNonce = value.bridgeNonce;
  const bridgeBindingName = value.bridgeBindingName;
  const uiPreference =
    value.uiPreference === undefined ? defaultUiPreference : parseUiPreference(value.uiPreference);
  if (
    (platform !== "macos" && platform !== "windows") ||
    typeof appVersion !== "string" ||
    !/^[0-9]+(?:\.[0-9]+){1,5}$/u.test(appVersion) ||
    !isViewModelEnvelope(value.viewModel) ||
    (bridgeNonce === undefined) !== (bridgeBindingName === undefined) ||
    (bridgeBindingName !== undefined && typeof bridgeBindingName !== "string") ||
    (bridgeNonce !== undefined &&
      (typeof bridgeNonce !== "string" ||
        !/^[A-Za-z0-9_-]{32}$/u.test(bridgeNonce) ||
        bridgeBindingName !== `${GOAL_PROGRESS_UI_INTENT_BINDING_PREFIX}${bridgeNonce}`)) ||
    uiPreference === null
  ) {
    return null;
  }
  return {
    platform,
    appVersion,
    viewModel: value.viewModel,
    ...(bridgeNonce === undefined ? {} : { bridgeNonce }),
    ...(bridgeBindingName === undefined ? {} : { bridgeBindingName }),
    uiPreference,
  };
}

function hostCount(document: Document): number {
  return document.querySelectorAll(
    `${GOAL_PROGRESS_ELEMENT_NAME},${GOAL_PROGRESS_HOT_ELEMENT_NAME}`,
  ).length;
}

function failure(document: Document, reason: PageHostFailureReason): GoalProgressPageHostFailure {
  return {
    action: "none",
    reason,
    adapterId: null,
    adapterRejectionReason: null,
    hostCount: hostCount(document),
    threadChanged: false,
  };
}

function emptyLayoutDiagnostics(): SidecarLayoutDiagnostics {
  return {
    lastAnchorState: "none",
    lastConstraintTransition: "none",
    lastCollapsedTransition: "none",
    lastPlacementTransition: "none",
    layoutReadCount: 0,
    layoutWriteCount: 0,
    nativeGeometryFingerprint: null,
    sidecarGeometryFingerprint: null,
    continuityModeActive: false,
    requestedPlacement: "inline",
    effectivePlacement: "none",
    floatingFallbackReason: null,
    lastHostRemovalReason: null,
    visibility: {
      composerRectFingerprint: null,
      textboxRectFingerprint: null,
      hostRectFingerprint: null,
      textboxClientHeight: null,
      textboxScrollHeight: null,
      textboxScrollTop: null,
      textboxOverflowY: null,
      composerClassTokenCount: 0,
      composerInlineStylePropertyCount: 0,
      clippingAncestorFingerprint: null,
      clippingOverflow: null,
      hostViewportIntersectionRatio: 0,
      hostClippedIntersectionRatio: 0,
      anchorConnected: false,
      composerCount: 0,
      textboxCount: 0,
      surface: "none",
      lastObserverReason: "none",
    },
  };
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isInsideObservedRegion(node: Node): boolean {
  if (!isElement(node)) {
    return false;
  }
  if (
    node.matches(GOAL_PROGRESS_HOST_SELECTOR) ||
    node.closest(GOAL_PROGRESS_HOST_SELECTOR) !== null
  ) {
    return false;
  }
  return node.matches(OBSERVED_REGION_SELECTOR) || node.closest(OBSERVED_REGION_SELECTOR) !== null;
}

function containsObservedRegion(node: Node): boolean {
  if (!isElement(node)) {
    return false;
  }
  if (
    node.matches(GOAL_PROGRESS_HOST_SELECTOR) ||
    node.closest(GOAL_PROGRESS_HOST_SELECTOR) !== null
  ) {
    return false;
  }
  return (
    node.matches(OBSERVED_REGION_SELECTOR) || node.querySelector(OBSERVED_REGION_SELECTOR) !== null
  );
}

function relevantMutation(record: MutationRecord): boolean {
  if (record.type === "attributes") {
    if (
      record.target === record.target.ownerDocument?.documentElement &&
      (record.attributeName === "lang" || record.attributeName === "dir")
    ) {
      return true;
    }
    return isInsideObservedRegion(record.target);
  }
  const changedNodes = [...record.addedNodes, ...record.removedNodes];
  if (
    changedNodes.length > 0 &&
    changedNodes.every((node) => isElement(node) && node.matches(GOAL_PROGRESS_HOST_SELECTOR))
  ) {
    return false;
  }
  if (isInsideObservedRegion(record.target)) {
    return true;
  }
  return changedNodes.some(containsObservedRegion);
}

class GoalProgressPageHost implements GoalProgressPageHostApi {
  readonly namespace = "codex-goal-progress";
  readonly version = GOAL_PROGRESS_PAGE_HOST_VERSION;
  readonly releaseVersion = GOAL_PROGRESS_RELEASE_VERSION;
  readonly #document: Document;
  readonly #elementName: string;
  readonly #registry: CodexAnchorAdapterRegistry;
  #uiIntentBinding: ((payload: string) => void) | undefined;
  #uiIntentBindingName: string | undefined;
  #adapter: CodexAnchorAdapter | null = null;
  #controller: SidecarMountController | null = null;
  #configuration: GoalProgressPageMountInput | null = null;
  #observer: MutationObserver | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #retryIndex = 0;
  #retryExhausted = false;
  #mutationBatches = 0;
  #debounceRuns = 0;
  #retryRuns = 0;
  #retryScheduled = 0;
  #reconcileRuns = 0;
  #mountActions = 0;
  #updateActions = 0;
  #unmountActions = 0;
  #failureCount = 0;
  #lastFailureReason: string | null = null;
  #lastReconcileCause: GoalProgressPageRuntimeDiagnostics["lastReconcileCause"] = "none";
  #lastMutationKind: GoalProgressPageRuntimeDiagnostics["lastMutationKind"] = "none";

  constructor(document: Document, options: GoalProgressPageHostOptions) {
    this.#document = document;
    this.#elementName = options.elementName ?? GOAL_PROGRESS_ELEMENT_NAME;
    this.#registry = options.registry ?? createDefaultCodexAnchorAdapterRegistry();
  }

  mount(input: unknown): SidecarMountResult | GoalProgressPageHostFailure {
    const parsed = parseMountInput(input);
    if (!parsed) {
      this.#stopRuntime();
      return failure(this.#document, "invalid-input");
    }
    const current = this.#configuration;
    const sameView =
      current?.viewModel.contractId === parsed.viewModel.contractId &&
      current.viewModel.sessionId === parsed.viewModel.sessionId;
    this.#captureUiIntentBinding(parsed.bridgeBindingName);
    this.#configuration = sameView
      ? {
          ...parsed,
          uiPreference: current.uiPreference,
        }
      : parsed;
    this.#startObserver();
    this.#lastReconcileCause = "initial-mount";
    return this.#reconcile();
  }

  update(viewModel: unknown): SidecarMountResult | GoalProgressPageHostFailure {
    if (!this.#configuration) {
      return failure(this.#document, "not-configured");
    }
    if (!isViewModelEnvelope(viewModel)) {
      this.#stopRuntime();
      return failure(this.#document, "invalid-input");
    }
    this.#configuration = {
      ...this.#configuration,
      viewModel,
    };
    this.#lastReconcileCause = "view-model-update";
    return this.#reconcile();
  }

  unmount(): SidecarMountResult | GoalProgressPageHostFailure {
    if (!this.#configuration && !this.#controller) {
      removeManagedGoalProgressHosts(this.#document);
      return failure(this.#document, "not-configured");
    }
    const result = this.#controller?.unmount() ?? failure(this.#document, "not-configured");
    this.#recordResult(result);
    this.#controller = null;
    this.#stopRuntime();
    return result;
  }

  health(): GoalProgressPageHealthResult {
    const result = this.#controller?.health() ?? failure(this.#document, "not-configured");
    return {
      ...result,
      runtime: this.#diagnostics(),
    };
  }

  #reconcile(): SidecarMountResult | GoalProgressPageHostFailure {
    const parsed = this.#configuration;
    if (!parsed) {
      return failure(this.#document, "not-configured");
    }
    this.#reconcileRuns += 1;
    const selected = this.#registry.resolve({
      platform: parsed.platform,
      appVersion: parsed.appVersion,
      document: this.#document,
    });
    if (!selected.supported) {
      if (
        selected.rejectionReason === "capability-unsupported" &&
        this.#controller &&
        this.#adapter
      ) {
        const retained = this.#controller.ensureMounted(parsed.viewModel, parsed.uiPreference, {
          environmentChanged: this.#lastReconcileCause === "relevant-mutation",
        });
        this.#recordResult(retained);
        if (retained.reason === "ok") {
          this.#cancelRetry();
          this.#retryIndex = 0;
          this.#retryExhausted = false;
          return retained;
        }
      }
      if (this.#controller) {
        this.#recordResult(this.#controller.unmount());
      }
      this.#controller = null;
      this.#adapter = null;
      const result = failure(this.#document, selected.rejectionReason);
      this.#recordResult(result);
      this.#scheduleRetry();
      return result;
    }
    if (this.#adapter?.id !== selected.adapter.id || !this.#controller) {
      if (this.#controller) {
        this.#recordResult(this.#controller.unmount());
      }
      this.#adapter = selected.adapter;
      this.#controller = new SidecarMountController(this.#document, selected.adapter, {
        elementName: this.#elementName,
        onUiIntent: (intent, context) => this.#forwardUiIntent(intent, context.userActivated),
      });
    }
    const result = this.#controller.ensureMounted(parsed.viewModel, parsed.uiPreference, {
      environmentChanged: this.#lastReconcileCause === "relevant-mutation",
    });
    this.#recordResult(result);
    if (result.reason === "native-goal-changed") {
      this.#stopRuntime();
      return result;
    }
    if (result.reason === "ok") {
      this.#cancelRetry();
      this.#retryIndex = 0;
      this.#retryExhausted = false;
    } else {
      this.#scheduleRetry();
    }
    return result;
  }

  #forwardUiIntent(intent: GoalProgressUiIntent, userActivated: boolean): void {
    const configuration = this.#configuration;
    if (!configuration) {
      return;
    }
    this.#configuration = {
      ...configuration,
      uiPreference: applyLocalUiIntent(configuration.uiPreference, intent),
    };
    if (!configuration.bridgeNonce || !this.#uiIntentBinding) {
      return;
    }
    const envelope: GoalProgressUiIntentEnvelope = {
      protocolVersion: GOAL_PROGRESS_UI_INTENT_PROTOCOL_VERSION,
      bridgeNonce: configuration.bridgeNonce,
      contractId: configuration.viewModel.contractId,
      threadId: configuration.viewModel.sessionId,
      userActivated,
      intent,
    };
    this.#uiIntentBinding(JSON.stringify(envelope));
  }

  #captureUiIntentBinding(bindingName: string | undefined): void {
    if (!bindingName || bindingName === this.#uiIntentBindingName) {
      return;
    }
    const target = this.#document.defaultView as (Window & Record<string, unknown>) | null;
    const binding = target?.[bindingName];
    if (!target || typeof binding !== "function") {
      return;
    }
    this.#uiIntentBinding = (payload: string) =>
      (binding as (this: Window, value: string) => void).call(target, payload);
    this.#uiIntentBindingName = bindingName;
    delete target[bindingName];
  }

  #startObserver(): void {
    if (this.#observer) {
      return;
    }
    this.#observer = new MutationObserver((records) => {
      const relevant = records.filter(relevantMutation);
      if (relevant.length === 0) {
        return;
      }
      const kinds = new Set(relevant.map((record) => record.type));
      this.#lastMutationKind =
        kinds.size > 1 ? "mixed" : relevant[0]?.type === "attributes" ? "attributes" : "child-list";
      this.#mutationBatches += 1;
      if (this.#controller?.health().reason === "native-goal-changed") {
        if (this.#debounceTimer) {
          clearTimeout(this.#debounceTimer);
          this.#debounceTimer = null;
        }
        this.#cancelRetry();
        this.#retryIndex = 0;
        this.#retryExhausted = false;
        this.#lastReconcileCause = "relevant-mutation";
        this.#reconcile();
        return;
      }
      if (this.#debounceTimer) {
        clearTimeout(this.#debounceTimer);
      }
      this.#debounceTimer = setTimeout(() => {
        this.#debounceTimer = null;
        this.#debounceRuns += 1;
        this.#cancelRetry();
        this.#retryIndex = 0;
        this.#retryExhausted = false;
        this.#lastReconcileCause = "relevant-mutation";
        this.#reconcile();
      }, GOAL_PROGRESS_OBSERVER_DEBOUNCE_MS);
    });
    this.#observer.observe(this.#document.documentElement, {
      attributes: true,
      attributeFilter: [...OBSERVED_ATTRIBUTES],
      childList: true,
      subtree: true,
    });
  }

  #scheduleRetry(): void {
    if (this.#retryTimer || !this.#configuration) {
      return;
    }
    const delay = GOAL_PROGRESS_OBSERVER_RETRY_DELAYS_MS[this.#retryIndex];
    if (delay === undefined) {
      this.#retryExhausted = true;
      return;
    }
    this.#retryIndex += 1;
    this.#retryScheduled += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#retryRuns += 1;
      this.#lastReconcileCause = "retry";
      this.#reconcile();
    }, delay);
  }

  #cancelRetry(): void {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #stopRuntime(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    this.#cancelRetry();
    this.#controller?.unmount();
    this.#controller = null;
    this.#adapter = null;
    this.#configuration = null;
    this.#retryIndex = 0;
    this.#retryExhausted = false;
  }

  #recordResult(result: SidecarMountResult | GoalProgressPageHostFailure): void {
    if (result.action === "mounted") {
      this.#mountActions += 1;
    } else if (result.action === "updated") {
      this.#updateActions += 1;
    } else if (result.action === "unmounted") {
      this.#unmountActions += 1;
    }
    if (result.reason !== "ok") {
      this.#failureCount += 1;
      this.#lastFailureReason = result.reason;
    }
  }

  #diagnostics(): GoalProgressPageRuntimeDiagnostics {
    return {
      uiIntentBindingActive: this.#uiIntentBinding !== undefined,
      observerActive: this.#observer !== null,
      debounceDelayMs: GOAL_PROGRESS_OBSERVER_DEBOUNCE_MS,
      retryDelaysMs: GOAL_PROGRESS_OBSERVER_RETRY_DELAYS_MS,
      mutationBatches: this.#mutationBatches,
      debounceRuns: this.#debounceRuns,
      retryRuns: this.#retryRuns,
      retryScheduled: this.#retryScheduled,
      reconcileRuns: this.#reconcileRuns,
      mountActions: this.#mountActions,
      updateActions: this.#updateActions,
      unmountActions: this.#unmountActions,
      failureCount: this.#failureCount,
      lastFailureReason: this.#lastFailureReason,
      retryExhausted: this.#retryExhausted,
      lastReconcileCause: this.#lastReconcileCause,
      lastMutationKind: this.#lastMutationKind,
      layout: this.#controller?.diagnostics() ?? emptyLayoutDiagnostics(),
    };
  }
}

function isInstalledApi(value: unknown): value is GoalProgressPageHostApi {
  return (
    isRecord(value) &&
    value.namespace === "codex-goal-progress" &&
    value.version === GOAL_PROGRESS_PAGE_HOST_VERSION &&
    value.releaseVersion === GOAL_PROGRESS_RELEASE_VERSION &&
    typeof value.mount === "function" &&
    typeof value.update === "function" &&
    typeof value.unmount === "function" &&
    typeof value.health === "function"
  );
}

function isReplaceableApi(
  value: unknown,
): value is { readonly version: number; readonly releaseVersion?: string; unmount(): unknown } {
  return (
    isRecord(value) &&
    value.namespace === "codex-goal-progress" &&
    Number.isSafeInteger(value.version) &&
    (value.version as number) > 0 &&
    ((value.version as number) < GOAL_PROGRESS_PAGE_HOST_VERSION ||
      (value.version === GOAL_PROGRESS_PAGE_HOST_VERSION &&
        value.releaseVersion !== GOAL_PROGRESS_RELEASE_VERSION)) &&
    typeof value.unmount === "function"
  );
}

export function installGoalProgressPageHost(
  target: GoalProgressPageWindow,
  options: GoalProgressPageHostOptions = {},
): GoalProgressPageHostApi | null {
  const existing = target[GOAL_PROGRESS_PAGE_HOST_GLOBAL];
  if (isInstalledApi(existing)) {
    return existing;
  }
  if (existing !== undefined) {
    if (!isReplaceableApi(existing)) {
      return null;
    }
    try {
      existing.unmount();
      if (!delete target[GOAL_PROGRESS_PAGE_HOST_GLOBAL]) {
        return null;
      }
    } catch {
      return null;
    }
  }
  const api = Object.freeze(new GoalProgressPageHost(target.document, options));
  Object.defineProperty(target, GOAL_PROGRESS_PAGE_HOST_GLOBAL, {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return api;
}
