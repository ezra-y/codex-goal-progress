import type { GoalProgressViewModel } from "../../contracts/src/goal-contract.js";
import {
  GOAL_PROGRESS_ELEMENT_NAME,
  GOAL_PROGRESS_FLOATING_LAYOUT_EVENT,
  GOAL_PROGRESS_HOT_ELEMENT_NAME,
  GOAL_PROGRESS_LAYOUT_OFFSET_EVENT,
  GOAL_PROGRESS_REQUEST_DETACH_EVENT,
  GOAL_PROGRESS_REQUEST_RETRY_EVENT,
  GOAL_PROGRESS_SET_COLLAPSED_EVENT,
  GOAL_PROGRESS_SET_FLOATING_X_RATIO_EVENT,
  GOAL_PROGRESS_SET_MOTION_PAUSED_EVENT,
  GOAL_PROGRESS_SET_PLACEMENT_EVENT,
} from "../../contracts/src/renderer-events.js";
import type {
  GoalProgressUiIntent,
  GoalProgressUiPreference,
} from "../../contracts/src/ui-preference.js";
import type {
  CodexAnchorAdapter,
  CodexAnchorRejectionReason,
  CodexVisibleThreadRejectionReason,
} from "./anchor-adapter.js";
import { projectFloatingCenter } from "./floating-placement.js";

export {
  GOAL_PROGRESS_ELEMENT_NAME,
  GOAL_PROGRESS_REQUEST_DETACH_EVENT,
  GOAL_PROGRESS_REQUEST_RETRY_EVENT,
  GOAL_PROGRESS_SET_COLLAPSED_EVENT,
  GOAL_PROGRESS_SET_FLOATING_X_RATIO_EVENT,
  GOAL_PROGRESS_SET_MOTION_PAUSED_EVENT,
  GOAL_PROGRESS_SET_PLACEMENT_EVENT,
} from "../../contracts/src/renderer-events.js";

export const GOAL_PROGRESS_HOST_ATTRIBUTE = "data-codex-goal-progress-host";
export const GOAL_PROGRESS_HOST_ATTRIBUTE_VALUE = "v1";
export const GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE =
  "data-codex-goal-progress-floating-fallback";
export const GOAL_PROGRESS_VIEWPORT_PORTAL_ATTRIBUTE = "data-codex-goal-progress-viewport-portal";
export const GOAL_PROGRESS_ORIGIN_MARKER_ATTRIBUTE = "data-codex-goal-progress-origin-marker";
const GOAL_PROGRESS_PORTAL_ATTRIBUTE_VALUE = "v1";
const GOAL_PROGRESS_ANCHOR_ORIGINAL_TRANSLATE_ATTRIBUTE =
  "data-codex-goal-progress-original-translate";
const GOAL_PROGRESS_MAX_EXPANDED_OFFSET_PX = 1_200;
const GOAL_PROGRESS_FLOATING_FALLBACK_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

export type GoalProgressLocalUiIntent = GoalProgressUiIntent;

export interface GoalProgressLocalUiIntentContext {
  readonly userActivated: boolean;
}

export type SidecarMountAction = "mounted" | "updated" | "unmounted" | "none";

export type SidecarMountReason =
  | "ok"
  | "anchor-unavailable"
  | "native-goal-changed"
  | "host-ambiguous"
  | "host-unmanaged"
  | CodexVisibleThreadRejectionReason;

export interface SidecarMountResult {
  readonly action: SidecarMountAction;
  readonly reason: SidecarMountReason;
  readonly adapterId: string;
  readonly adapterRejectionReason: CodexAnchorRejectionReason | null;
  readonly hostCount: number;
  readonly threadChanged: boolean;
}

export type SidecarHealthStatus = "mounted" | "unmounted" | "blocked";

export type SidecarHealthReason =
  | "ok"
  | "anchor-unavailable"
  | "native-goal-changed"
  | "host-missing"
  | "host-misplaced"
  | "host-ambiguous"
  | "host-unmanaged"
  | CodexVisibleThreadRejectionReason;

export interface SidecarHealthResult {
  readonly status: SidecarHealthStatus;
  readonly reason: SidecarHealthReason;
  readonly adapterId: string;
  readonly adapterRejectionReason: CodexAnchorRejectionReason | null;
  readonly hostCount: number;
}

export interface SidecarLayoutDiagnostics {
  readonly lastAnchorState: "none" | "live" | "unavailable";
  readonly lastConstraintTransition: "none" | "entered" | "exited";
  readonly lastCollapsedTransition:
    | "none"
    | "preference-collapsed"
    | "preference-expanded"
    | "user-collapsed"
    | "user-expanded";
  readonly lastPlacementTransition:
    | "none"
    | "preference-inline"
    | "preference-floating"
    | "user-inline"
    | "user-floating"
    | "fallback-inline";
  readonly layoutReadCount: number;
  readonly layoutWriteCount: number;
  readonly nativeGeometryFingerprint: string | null;
  readonly sidecarGeometryFingerprint: string | null;
  readonly continuityModeActive: boolean;
  readonly requestedPlacement: "inline" | "floating";
  readonly effectivePlacement: "none" | "inline" | "floating";
  readonly floatingFallbackReason: "insufficient-space" | null;
  readonly lastHostRemovalReason: string | null;
  readonly visibility: SidecarVisibilityDiagnostics;
}

export interface SidecarVisibilityDiagnostics {
  readonly composerRectFingerprint: string | null;
  readonly textboxRectFingerprint: string | null;
  readonly hostRectFingerprint: string | null;
  readonly textboxClientHeight: number | null;
  readonly textboxScrollHeight: number | null;
  readonly textboxScrollTop: number | null;
  readonly textboxOverflowY: string | null;
  readonly composerClassTokenCount: number;
  readonly composerInlineStylePropertyCount: number;
  readonly clippingAncestorFingerprint: string | null;
  readonly clippingOverflow: string | null;
  readonly hostViewportIntersectionRatio: number;
  readonly hostClippedIntersectionRatio: number;
  readonly anchorConnected: boolean;
  readonly composerCount: number;
  readonly textboxCount: number;
  readonly surface: "none" | "expanded" | "compact" | "portal";
  readonly lastObserverReason:
    | "none"
    | "inline-resize"
    | "floating-resize"
    | "textbox-input"
    | "textbox-scroll";
}

export interface SidecarMountControllerOptions {
  readonly elementName?: string;
  readonly onUiIntent?: (
    intent: GoalProgressLocalUiIntent,
    context: GoalProgressLocalUiIntentContext,
  ) => void;
}

export interface SidecarEnsureMountedOptions {
  readonly environmentChanged?: boolean;
}

function rectFingerprint(rect: DOMRect | null): string {
  if (!rect) {
    return "none";
  }
  const bounded = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].map(
    (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null),
  );
  return bounded.join(",");
}

function intersectionRatio(rect: DOMRect | null, bounds: readonly DOMRect[]): number {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return 0;
  }
  let left = rect.left;
  let top = rect.top;
  let right = rect.right;
  let bottom = rect.bottom;
  for (const bound of bounds) {
    left = Math.max(left, bound.left);
    top = Math.max(top, bound.top);
    right = Math.min(right, bound.right);
    bottom = Math.min(bottom, bound.bottom);
  }
  const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  return Math.round((visibleArea / (rect.width * rect.height)) * 10_000) / 10_000;
}

function clippingAncestors(element: HTMLElement, view: Window): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  for (let current = element.parentElement; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (/(auto|clip|hidden|scroll)/u.test(`${style.overflowX} ${style.overflowY}`)) {
      ancestors.push(current);
    }
  }
  return ancestors;
}

interface GoalProgressHostElement extends HTMLElement {
  viewModel: GoalProgressViewModel | null;
  collapsed: boolean;
  readonly expandedLayoutOffset?: number;
  floatingCenterAvailable: boolean;
  floatingPanelConstrained: boolean;
  floatingXRatio: number;
  motionPaused: boolean;
  placement: "inline" | "floating";
  requestedPlacement: "inline" | "floating";
  spaceConstrained: boolean;
}

function clampFloatingDockRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function syncHostLocale(host: GoalProgressHostElement, document: Document): void {
  const language = (document.documentElement.lang ?? "").trim();
  host.lang = language || "zh-CN";
  host.dir = document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}

function floatingGoalBlockRect(anchor: HTMLElement): DOMRect {
  const anchorRect = anchor.getBoundingClientRect();
  const block = anchor.firstElementChild;
  if (!(block instanceof HTMLElement)) {
    return anchorRect;
  }
  const blockRect = block.getBoundingClientRect();
  const isContained =
    blockRect.left >= anchorRect.left &&
    blockRect.right <= anchorRect.right &&
    blockRect.top >= anchorRect.top &&
    blockRect.bottom <= anchorRect.bottom;
  const isRepresentative =
    blockRect.width >= anchorRect.width * 0.5 && blockRect.height >= anchorRect.height * 0.5;
  return isContained && isRepresentative ? blockRect : anchorRect;
}

const GOAL_PROGRESS_KNOWN_ELEMENT_SELECTOR = `${GOAL_PROGRESS_ELEMENT_NAME},${GOAL_PROGRESS_HOT_ELEMENT_NAME}`;

function hosts(document: Document): GoalProgressHostElement[] {
  return Array.from(
    document.querySelectorAll<GoalProgressHostElement>(GOAL_PROGRESS_KNOWN_ELEMENT_SELECTOR),
  );
}

function isManagedHost(host: GoalProgressHostElement): boolean {
  return host.getAttribute(GOAL_PROGRESS_HOST_ATTRIBUTE) === GOAL_PROGRESS_HOST_ATTRIBUTE_VALUE;
}

export function removeManagedGoalProgressHosts(document: Document): number {
  const managedHosts = hosts(document).filter(isManagedHost);
  for (const host of managedHosts) {
    host.viewModel = null;
    host.remove();
  }
  for (const marker of document.querySelectorAll(
    `[${GOAL_PROGRESS_ORIGIN_MARKER_ATTRIBUTE}="${GOAL_PROGRESS_PORTAL_ATTRIBUTE_VALUE}"]`,
  )) {
    marker.remove();
  }
  return managedHosts.length;
}

function eventDetail(event: Event): unknown {
  return "detail" in event ? (event as CustomEvent<unknown>).detail : undefined;
}

function booleanDetail(event: Event, key: "collapsed" | "motionPaused"): boolean | null {
  const detail = eventDetail(event);
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return null;
  }
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function expandedOffsetDetail(event: Event): number | null {
  const detail = eventDetail(event);
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return null;
  }
  const value = (detail as Record<string, unknown>).expandedOffset;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= GOAL_PROGRESS_MAX_EXPANDED_OFFSET_PX
    ? Math.ceil(value)
    : null;
}

function placementDetail(event: Event): "inline" | "floating" | null {
  const detail = eventDetail(event);
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return null;
  }
  const value = (detail as Record<string, unknown>).placement;
  return value === "inline" || value === "floating" ? value : null;
}

function floatingXRatioDetail(event: Event): number | null {
  const detail = eventDetail(event);
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return null;
  }
  const value = (detail as Record<string, unknown>).floatingXRatio;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function findFloatingObstacle(
  document: Document,
  host: HTMLElement,
  anchor: HTMLElement,
  chip: HTMLElement | null,
  panel: HTMLElement | null,
  safeLeft: number,
  safeRight: number,
  knownObstacles?: readonly HTMLElement[],
): DOMRect | null {
  const composer = anchor.closest<HTMLElement>("[data-codex-composer-root]");
  const view = document.defaultView;
  if (!composer || !view || (!chip && !panel)) {
    return null;
  }
  const anchorRect = anchor.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  const floatingRects = [chip, panel].flatMap((element) =>
    element ? [element.getBoundingClientRect()] : [],
  );
  const floatingTop = Math.min(...floatingRects.map((rect) => rect.top));
  const floatingBottom = Math.max(...floatingRects.map((rect) => rect.bottom));
  const sampleYs = [
    ...Array.from(
      { length: 5 },
      (_, index) => floatingTop + ((floatingBottom - floatingTop) * (index + 1)) / 6,
    ),
    ...[16, 32, 48, 64, 80].map((offset) => anchorRect.top - offset),
  ].filter((y) => y >= 0 && y <= view.innerHeight);
  const candidates = new Set<HTMLElement>(knownObstacles);
  if (knownObstacles === undefined) {
    for (let xIndex = 0; xIndex <= 10; xIndex += 1) {
      const x = safeLeft + ((safeRight - safeLeft) * xIndex) / 10;
      for (const y of sampleYs) {
        for (const element of document.elementsFromPoint(x, y)) {
          if (element instanceof HTMLElement) {
            candidates.add(element);
          }
        }
      }
    }
  }
  return (
    [...candidates]
      .filter((element) => {
        if (element === host || element === anchor || element.contains(composer)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = view.getComputedStyle(element);
        const centerX = rect.left + rect.width / 2;
        const gapToGoal = anchorRect.top - rect.bottom;
        return (
          rect.width >= 300 &&
          rect.width <= composerRect.width &&
          rect.height >= 24 &&
          rect.height <= 420 &&
          centerX >= composerRect.left &&
          centerX <= composerRect.right &&
          Math.abs(centerX - (composerRect.left + composerRect.width / 2)) <=
            composerRect.width * 0.25 &&
          gapToGoal >= 0 &&
          gapToGoal <= 420 &&
          Number.parseFloat(style.borderRadius) >= 8 &&
          (style.borderWidth !== "0px" ||
            style.boxShadow !== "none" ||
            style.backgroundColor !== "rgba(0, 0, 0, 0)")
        );
      })
      .sort(
        (left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom,
      )[0]
      ?.getBoundingClientRect() ?? null
  );
}

export class SidecarMountController {
  readonly #document: Document;
  readonly #adapter: CodexAnchorAdapter;
  readonly #elementName: string;
  readonly #onUiIntent:
    | ((intent: GoalProgressLocalUiIntent, context: GoalProgressLocalUiIntentContext) => void)
    | undefined;
  #host: GoalProgressHostElement | null = null;
  #anchor: HTMLElement | null = null;
  #validatedGoalIdentity: string | null = null;
  #validatedComposer: HTMLElement | null = null;
  #continuityModeActive = false;
  #floatingActive = false;
  #floatingFallbackActive = false;
  #floatingFallbackRetryIndex = 0;
  #floatingFallbackRetryTimer: ReturnType<typeof setTimeout> | null = null;
  #floatingFrame: number | null = null;
  #floatingViewportTop: number | null = null;
  #floatingChecklistAligned = false;
  #floatingResizeObserver: ResizeObserver | null = null;
  #floatingObstacleObserver: MutationObserver | null = null;
  #observedFloatingObstacles = new Set<HTMLElement>();
  #floatingPreviewRatio: number | null = null;
  #lastFloatingPanelHeight = 0;
  #inlineConstraintFrame: number | null = null;
  #inlineResizeObserver: ResizeObserver | null = null;
  #inlineObservedSizeFingerprint: string | null = null;
  #observedTextbox: HTMLElement | null = null;
  #pendingInlineObserverReason: "inline-resize" | "textbox-input" | "textbox-scroll" | null = null;
  #viewportPortalActive = false;
  #originMarker: HTMLElement | null = null;
  #lastExpandedOffset = 0;
  #requestedFloatingXRatio = 0.5;
  #requestedPlacement: "inline" | "floating" = "inline";
  #sessionId: string | null = null;
  #userClickActive = false;
  #userClickTimer: ReturnType<typeof setTimeout> | null = null;
  #lastAnchorState: SidecarLayoutDiagnostics["lastAnchorState"] = "none";
  #lastConstraintTransition: SidecarLayoutDiagnostics["lastConstraintTransition"] = "none";
  #lastCollapsedTransition: SidecarLayoutDiagnostics["lastCollapsedTransition"] = "none";
  #lastPlacementTransition: SidecarLayoutDiagnostics["lastPlacementTransition"] = "none";
  #layoutReadCount = 0;
  #layoutWriteCount = 0;
  #nativeGeometryFingerprint: string | null = null;
  #sidecarGeometryFingerprint: string | null = null;
  #lastHostRemovalReason: string | null = null;
  #lastObserverReason: SidecarVisibilityDiagnostics["lastObserverReason"] = "none";

  readonly #onTextboxInput = (): void => {
    this.#pendingInlineObserverReason = "textbox-input";
    this.#scheduleInlineConstraint();
  };

  readonly #onTextboxScroll = (): void => {
    this.#pendingInlineObserverReason = "textbox-scroll";
    this.#scheduleInlineConstraint();
  };

  readonly #onDocumentClick = (event: Event): void => {
    this.#userClickActive =
      event.isTrusted && this.#host !== null && event.composedPath().includes(this.#host);
    if (this.#userClickTimer) {
      clearTimeout(this.#userClickTimer);
    }
    this.#userClickTimer = setTimeout(() => {
      this.#userClickActive = false;
      this.#userClickTimer = null;
    }, 0);
  };

  readonly #onCollapsed = (event: Event): void => {
    const collapsed = booleanDetail(event, "collapsed");
    if (collapsed !== null) {
      this.#lastCollapsedTransition = collapsed ? "user-collapsed" : "user-expanded";
      this.#emitUiIntent({ type: "setCollapsed", collapsed });
    }
  };

  readonly #onMotionPaused = (event: Event): void => {
    const motionPaused = booleanDetail(event, "motionPaused");
    if (motionPaused !== null) {
      this.#emitUiIntent({ type: "setMotionPaused", motionPaused });
    }
  };

  readonly #onPlacement = (event: Event): void => {
    const placement = placementDetail(event);
    if (placement !== null) {
      this.#lastPlacementTransition = placement === "floating" ? "user-floating" : "user-inline";
      this.#requestedPlacement = placement;
      if (this.#host) {
        if (this.#viewportPortalActive && placement === "floating") {
          this.#clearViewportPortal(true);
        }
        const wasFallback = this.#floatingFallbackActive;
        if (placement === "floating") {
          this.#floatingFallbackActive = false;
          this.#floatingViewportTop = null;
          this.#host.removeAttribute(GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE);
        }
        this.#host.requestedPlacement = placement;
        this.#host.placement = placement;
        this.#syncPlacement();
        if (placement === "inline") {
          if (wasFallback) {
            this.#clearFloatingLayout();
          }
          this.#floatingFallbackActive = false;
          this.#host.removeAttribute(GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE);
        }
      }
      this.#emitUiIntent({ type: "setPlacement", placement });
    }
  };

  readonly #onFloatingXRatio = (event: Event): void => {
    const floatingXRatio = floatingXRatioDetail(event);
    if (floatingXRatio !== null) {
      const ratio = clampFloatingDockRatio(floatingXRatio);
      const detail = eventDetail(event);
      const commit =
        detail === null ||
        typeof detail !== "object" ||
        Array.isArray(detail) ||
        (detail as Record<string, unknown>).commit !== false;
      if (commit) {
        this.#requestedFloatingXRatio = ratio;
        this.#floatingPreviewRatio = null;
      } else {
        this.#floatingPreviewRatio = ratio;
      }
      if (this.#host) {
        this.#host.floatingXRatio = ratio;
        this.#scheduleFloatingLayout();
      }
      if (commit) {
        this.#emitUiIntent({ type: "setFloatingXRatio", floatingXRatio: ratio });
      }
    }
  };

  readonly #onFloatingLayout = (): void => {
    this.#syncPlacement();
  };

  readonly #onWindowResize = (): void => {
    if (this.#floatingFallbackActive && this.#requestedPlacement === "floating") {
      this.#retryFloatingPlacement();
      return;
    }
    if (this.#host?.placement === "floating") {
      this.#floatingViewportTop = null;
    }
    if (!this.#viewportPortalActive) {
      this.#syncInlineInsets();
    }
    this.#scheduleInlineConstraint();
    this.#scheduleFloatingLayout();
  };

  readonly #onWindowScroll = (): void => {
    if (this.#floatingFallbackActive && this.#requestedPlacement === "floating") {
      this.#retryFloatingPlacement();
      return;
    }
    if (!this.#viewportPortalActive) {
      this.#syncInlineInsets();
    }
    this.#scheduleInlineConstraint();
    this.#scheduleFloatingLayout();
  };

  readonly #onLayoutOffset = (event: Event): void => {
    if (event.target !== this.#host) {
      return;
    }
    const expandedOffset = expandedOffsetDetail(event);
    if (expandedOffset !== null) {
      if (expandedOffset > 0) {
        this.#lastExpandedOffset = expandedOffset;
      }
      this.#applyLayoutOffset(expandedOffset);
      this.#scheduleInlineConstraint();
    }
  };

  readonly #onRetry = (): void => {
    this.#emitUiIntent({ type: "requestRetry" });
  };

  readonly #onDetach = (): void => {
    this.#emitUiIntent({ type: "requestDetach" });
  };

  constructor(
    document: Document,
    adapter: CodexAnchorAdapter,
    options: SidecarMountControllerOptions = {},
  ) {
    this.#document = document;
    this.#adapter = adapter;
    this.#elementName = options.elementName ?? GOAL_PROGRESS_ELEMENT_NAME;
    this.#onUiIntent = options.onUiIntent;
  }

  ensureMounted(
    viewModel: GoalProgressViewModel,
    uiPreference?: GoalProgressUiPreference,
    options: SidecarEnsureMountedOptions = {},
  ): SidecarMountResult {
    const existingHosts = hosts(this.#document);
    if (existingHosts.length > 1) {
      return this.#result("none", "host-ambiguous", existingHosts.length, false, null);
    }
    const existingHost = existingHosts[0] ?? null;
    if (existingHost && !isManagedHost(existingHost)) {
      return this.#result("none", "host-unmanaged", 1, false, null);
    }
    if (
      options.environmentChanged &&
      this.#floatingFallbackActive &&
      this.#floatingFallbackRetryTimer === null &&
      this.#floatingFallbackRetryIndex >= GOAL_PROGRESS_FLOATING_FALLBACK_RETRY_DELAYS_MS.length
    ) {
      this.#floatingFallbackRetryIndex = 0;
      this.#retryFloatingPlacement();
    }

    const visibleThread = this.#adapter.matchVisibleThread(this.#document, viewModel.sessionId);
    const retainingMissingThreadMarker =
      !visibleThread.matched &&
      visibleThread.rejectionReason === "visible-thread-marker-missing" &&
      existingHost !== null &&
      this.#canRetainContinuity(existingHost, viewModel.sessionId);
    if (!visibleThread.matched && !retainingMissingThreadMarker) {
      this.#lastAnchorState = "none";
      this.#lastHostRemovalReason = visibleThread.rejectionReason ?? "visible-thread-mismatch";
      const action = existingHost ? "unmounted" : "none";
      if (existingHost) {
        this.#adoptHost(existingHost);
      }
      this.#releaseHost(true);
      return this.#result(
        action,
        visibleThread.rejectionReason ?? "visible-thread-mismatch",
        hosts(this.#document).length,
        false,
        null,
      );
    }

    const probe = this.#adapter.probe(this.#document);
    const previousElement = existingHost?.previousElementSibling as HTMLElement | null;
    const retainedCandidate = this.#anchor ?? previousElement;
    const retainedAnchor =
      existingHost &&
      retainedCandidate?.isConnected === true &&
      retainedCandidate.parentElement === existingHost.parentElement
        ? retainedCandidate
        : null;
    const anchor = probe.supported ? this.#adapter.findGoalAnchor(this.#document) : retainedAnchor;
    if (existingHost && this.#anchor && anchor && !retainingMissingThreadMarker) {
      const identityFailure = this.#continuityIdentityFailure(anchor);
      if (identityFailure) {
        this.#lastAnchorState = "unavailable";
        this.#lastHostRemovalReason = identityFailure;
        this.#adoptHost(existingHost);
        this.#releaseHost(true);
        return this.#result(
          "unmounted",
          "native-goal-changed",
          hosts(this.#document).length,
          false,
          probe.rejectionReason,
        );
      }
    }
    if (retainingMissingThreadMarker && anchor) {
      const continuityFailure = this.#continuityIdentityFailure(anchor);
      if (continuityFailure) {
        this.#lastAnchorState = "unavailable";
        this.#lastHostRemovalReason = continuityFailure;
        this.#adoptHost(existingHost);
        this.#releaseHost(true);
        return this.#result(
          "unmounted",
          "visible-thread-marker-missing",
          hosts(this.#document).length,
          false,
          probe.rejectionReason,
        );
      }
    }
    if (!anchor?.parentElement) {
      if (existingHost && this.#canRetainContinuity(existingHost, viewModel.sessionId)) {
        this.#adoptHost(existingHost);
        syncHostLocale(existingHost, this.#document);
        this.#lastAnchorState = "unavailable";
        this.#lastHostRemovalReason = null;
        this.#continuityModeActive = true;
        existingHost.viewModel = viewModel;
        existingHost.spaceConstrained = true;
        existingHost.placement = "inline";
        this.#clearMeasuredInlineGeometry();
        this.#clearFloatingLayout(true);
        this.#sessionId = viewModel.sessionId;
        return this.#result("updated", "ok", 1, false, probe.rejectionReason);
      }
      this.#lastAnchorState = "unavailable";
      this.#lastHostRemovalReason = "anchor-unavailable";
      const action = existingHost ? "unmounted" : "none";
      if (existingHost) {
        this.#adoptHost(existingHost);
      }
      this.#releaseHost(true);
      return this.#result(
        action,
        "anchor-unavailable",
        hosts(this.#document).length,
        false,
        probe.rejectionReason,
      );
    }
    this.#lastAnchorState = "live";
    this.#lastHostRemovalReason = null;
    this.#continuityModeActive = retainingMissingThreadMarker;

    let host = existingHost;
    let action: SidecarMountAction = "updated";
    if (!host) {
      this.#releaseHost(false);
      host = this.#document.createElement(this.#elementName) as GoalProgressHostElement;
      host.setAttribute(GOAL_PROGRESS_HOST_ATTRIBUTE, GOAL_PROGRESS_HOST_ATTRIBUTE_VALUE);
      action = "mounted";
    }
    this.#adoptHost(host);
    syncHostLocale(host, this.#document);
    const preserveVisibleCollapsed =
      action === "updated" && this.#sessionId === viewModel.sessionId;
    const visibleCollapsed = host.collapsed;

    if (
      this.#viewportPortalActive &&
      (!this.#originMarker?.isConnected ||
        this.#originMarker.parentElement !== anchor.parentElement ||
        anchor.nextSibling !== this.#originMarker)
    ) {
      this.#clearViewportPortal(false);
    }
    if (!this.#viewportPortalActive && anchor.nextSibling !== host) {
      anchor.parentElement.insertBefore(host, anchor.nextSibling);
    }
    this.#adoptAnchor(anchor);

    const threadChanged = this.#sessionId !== null && this.#sessionId !== viewModel.sessionId;
    if (threadChanged) {
      host.viewModel = null;
    }
    host.viewModel = viewModel;
    if (uiPreference) {
      const preserveFallback =
        this.#floatingFallbackActive && uiPreference.placement === "floating";
      if (this.#floatingFallbackActive && !preserveFallback) {
        this.#clearFloatingLayout();
      }
      this.#requestedPlacement = uiPreference.placement;
      const requestedFloatingXRatio = clampFloatingDockRatio(uiPreference.floatingXRatio);
      this.#requestedFloatingXRatio = requestedFloatingXRatio;
      this.#floatingPreviewRatio = null;
      this.#lastCollapsedTransition = uiPreference.collapsed
        ? "preference-collapsed"
        : "preference-expanded";
      this.#lastPlacementTransition =
        uiPreference.placement === "floating" ? "preference-floating" : "preference-inline";
      if (this.#viewportPortalActive && uiPreference.placement === "floating") {
        this.#clearViewportPortal(true);
      }
      if (!preserveFallback) {
        this.#floatingFallbackActive = false;
        host.removeAttribute(GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE);
      }
      host.collapsed = preserveVisibleCollapsed ? visibleCollapsed : uiPreference.collapsed;
      host.motionPaused = uiPreference.motionPaused;
      host.hidden = uiPreference.hidden;
      host.requestedPlacement = this.#requestedPlacement;
      host.placement = preserveFallback ? "inline" : this.#requestedPlacement;
      host.floatingXRatio = this.#requestedFloatingXRatio;
    }
    if (host.placement !== "inline" || host.collapsed) {
      host.spaceConstrained = false;
    }
    if (options.environmentChanged && host.placement === "inline") {
      this.#pendingInlineObserverReason ??= "inline-resize";
    }
    this.#syncPlacement();
    this.#sessionId = viewModel.sessionId;
    return this.#result(action, "ok", hosts(this.#document).length, threadChanged, null);
  }

  unmount(): SidecarMountResult {
    const existingHosts = hosts(this.#document);
    if (existingHosts.length > 1) {
      return this.#result("none", "host-ambiguous", existingHosts.length, false, null);
    }
    const existingHost = existingHosts[0] ?? null;
    if (existingHost && !isManagedHost(existingHost)) {
      return this.#result("none", "host-unmanaged", 1, false, null);
    }
    if (existingHost) {
      this.#adoptHost(existingHost);
    }
    this.#lastHostRemovalReason = "explicit-unmount";
    const action = existingHost || this.#host ? "unmounted" : "none";
    this.#releaseHost(true);
    return this.#result(action, "ok", hosts(this.#document).length, false, null);
  }

  health(): SidecarHealthResult {
    const existingHosts = hosts(this.#document);
    if (existingHosts.length > 1) {
      return this.#healthResult("blocked", "host-ambiguous", existingHosts.length, null);
    }
    const host = existingHosts[0] ?? null;
    if (host && !isManagedHost(host)) {
      return this.#healthResult("blocked", "host-unmanaged", 1, null);
    }
    if (this.#sessionId !== null) {
      const visibleThread = this.#adapter.matchVisibleThread(this.#document, this.#sessionId);
      const retainingMissingThreadMarker =
        !visibleThread.matched &&
        visibleThread.rejectionReason === "visible-thread-marker-missing" &&
        host !== null &&
        this.#continuityModeActive &&
        this.#canRetainContinuity(host, this.#sessionId);
      if (!visibleThread.matched && !retainingMissingThreadMarker) {
        return this.#healthResult(
          "blocked",
          visibleThread.rejectionReason ?? "visible-thread-mismatch",
          existingHosts.length,
          null,
        );
      }
    }
    const probe = this.#adapter.probe(this.#document);
    const previousElement = host?.previousElementSibling as HTMLElement | null;
    const retainedCandidate = this.#anchor ?? previousElement;
    const retainedAnchor =
      host &&
      retainedCandidate?.isConnected === true &&
      retainedCandidate.parentElement === host.parentElement
        ? retainedCandidate
        : null;
    const anchor = probe.supported ? this.#adapter.findGoalAnchor(this.#document) : retainedAnchor;
    if (!anchor?.parentElement) {
      if (
        host &&
        this.#continuityModeActive &&
        this.#sessionId !== null &&
        this.#canRetainContinuity(host, this.#sessionId)
      ) {
        return this.#healthResult("mounted", "ok", 1, probe.rejectionReason);
      }
      return this.#healthResult(
        "unmounted",
        "anchor-unavailable",
        existingHosts.length,
        probe.rejectionReason,
      );
    }
    if (!host) {
      return this.#healthResult("unmounted", "host-missing", 0, null);
    }
    if (this.#anchor && this.#continuityIdentityFailure(anchor)) {
      return this.#healthResult("blocked", "native-goal-changed", 1, null);
    }
    if (this.#viewportPortalActive) {
      if (
        this.#originMarker?.isConnected !== true ||
        anchor.nextSibling !== this.#originMarker ||
        host.parentElement !== this.#document.body
      ) {
        return this.#healthResult("blocked", "host-misplaced", 1, null);
      }
      return this.#healthResult("mounted", "ok", 1, null);
    }
    if (anchor.nextSibling !== host) {
      return this.#healthResult("blocked", "host-misplaced", 1, null);
    }
    return this.#healthResult("mounted", "ok", 1, null);
  }

  diagnostics(): SidecarLayoutDiagnostics {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    const composer = anchor?.closest<HTMLElement>("[data-codex-composer-root]") ?? null;
    const textbox =
      composer?.querySelector<HTMLElement>('[role="textbox"][data-codex-composer]') ?? null;
    const hostRect = host?.getBoundingClientRect() ?? null;
    const clipping = host && view ? clippingAncestors(host, view) : [];
    const viewport =
      view === null
        ? []
        : [new DOMRect(0, 0, Math.max(0, view.innerWidth), Math.max(0, view.innerHeight))];
    const nearestClipping = clipping[0] ?? null;
    const nearestClippingStyle =
      nearestClipping && view ? view.getComputedStyle(nearestClipping) : null;
    return {
      lastAnchorState: this.#lastAnchorState,
      lastConstraintTransition: this.#lastConstraintTransition,
      lastCollapsedTransition: this.#lastCollapsedTransition,
      lastPlacementTransition: this.#lastPlacementTransition,
      layoutReadCount: this.#layoutReadCount,
      layoutWriteCount: this.#layoutWriteCount,
      nativeGeometryFingerprint: this.#nativeGeometryFingerprint,
      sidecarGeometryFingerprint: this.#sidecarGeometryFingerprint,
      continuityModeActive: this.#continuityModeActive,
      requestedPlacement: this.#requestedPlacement,
      effectivePlacement: host?.placement ?? "none",
      floatingFallbackReason: this.#floatingFallbackActive ? "insufficient-space" : null,
      lastHostRemovalReason: this.#lastHostRemovalReason,
      visibility: {
        composerRectFingerprint: composer
          ? rectFingerprint(composer.getBoundingClientRect())
          : null,
        textboxRectFingerprint: textbox ? rectFingerprint(textbox.getBoundingClientRect()) : null,
        hostRectFingerprint: hostRect ? rectFingerprint(hostRect) : null,
        textboxClientHeight: textbox?.clientHeight ?? null,
        textboxScrollHeight: textbox?.scrollHeight ?? null,
        textboxScrollTop: textbox?.scrollTop ?? null,
        textboxOverflowY: textbox && view ? view.getComputedStyle(textbox).overflowY : null,
        composerClassTokenCount: composer?.classList.length ?? 0,
        composerInlineStylePropertyCount: composer?.style.length ?? 0,
        clippingAncestorFingerprint: nearestClipping
          ? rectFingerprint(nearestClipping.getBoundingClientRect())
          : null,
        clippingOverflow: nearestClippingStyle
          ? `${nearestClippingStyle.overflowX}/${nearestClippingStyle.overflowY}`
          : null,
        hostViewportIntersectionRatio: intersectionRatio(hostRect, viewport),
        hostClippedIntersectionRatio: intersectionRatio(hostRect, [
          ...viewport,
          ...clipping.map((element) => element.getBoundingClientRect()),
        ]),
        anchorConnected: anchor?.isConnected === true,
        composerCount: this.#document.querySelectorAll("[data-codex-composer-root]").length,
        textboxCount: this.#document.querySelectorAll('[role="textbox"][data-codex-composer]')
          .length,
        surface:
          host === null
            ? "none"
            : this.#viewportPortalActive
              ? "portal"
              : host.collapsed || host.spaceConstrained
                ? "compact"
                : "expanded",
        lastObserverReason: this.#lastObserverReason,
      },
    };
  }

  #adoptHost(host: GoalProgressHostElement): void {
    if (this.#host === host) {
      return;
    }
    this.#releaseHost(false);
    this.#host = host;
    host.addEventListener(GOAL_PROGRESS_LAYOUT_OFFSET_EVENT, this.#onLayoutOffset);
    host.addEventListener(GOAL_PROGRESS_FLOATING_LAYOUT_EVENT, this.#onFloatingLayout);
    host.addEventListener(GOAL_PROGRESS_SET_PLACEMENT_EVENT, this.#onPlacement);
    host.addEventListener(GOAL_PROGRESS_SET_FLOATING_X_RATIO_EVENT, this.#onFloatingXRatio);
    this.#sessionId =
      host.viewModel && typeof host.viewModel.sessionId === "string"
        ? host.viewModel.sessionId
        : null;
    if (this.#onUiIntent) {
      this.#document.addEventListener("click", this.#onDocumentClick, true);
      host.addEventListener(GOAL_PROGRESS_SET_COLLAPSED_EVENT, this.#onCollapsed);
      host.addEventListener(GOAL_PROGRESS_SET_MOTION_PAUSED_EVENT, this.#onMotionPaused);
      host.addEventListener(GOAL_PROGRESS_REQUEST_RETRY_EVENT, this.#onRetry);
      host.addEventListener(GOAL_PROGRESS_REQUEST_DETACH_EVENT, this.#onDetach);
    }
  }

  #adoptAnchor(anchor: HTMLElement): void {
    if (this.#anchor === anchor) {
      return;
    }
    this.#restoreAnchor();
    this.#anchor = anchor;
    this.#validatedGoalIdentity = this.#adapter.readGoalIdentity?.(this.#document) ?? null;
    this.#validatedComposer = anchor.closest<HTMLElement>("[data-codex-composer-root]");
    const expandedOffset = this.#host?.expandedLayoutOffset;
    this.#applyLayoutOffset(
      typeof expandedOffset === "number" && Number.isFinite(expandedOffset) ? expandedOffset : 0,
    );
    this.#observeInlineConstraint();
  }

  #canRetainContinuity(host: GoalProgressHostElement, sessionId: string): boolean {
    const composer = this.#validatedComposer;
    const hostRetained =
      host.parentElement === composer ||
      (this.#viewportPortalActive &&
        host.parentElement === this.#document.body &&
        this.#originMarker?.parentElement === composer);
    if (
      !composer?.isConnected ||
      !hostRetained ||
      this.#sessionId !== sessionId ||
      host.viewModel?.sessionId !== sessionId
    ) {
      return false;
    }
    const composers = this.#document.querySelectorAll("[data-codex-composer-root]");
    if (composers.length !== 1 || composers[0] !== composer) {
      return false;
    }
    return composer.querySelectorAll('[role="textbox"][data-codex-composer]').length === 1;
  }

  #continuityIdentityFailure(anchor: HTMLElement): string | null {
    const currentGoalIdentity = this.#adapter.readGoalIdentity?.(this.#document) ?? null;
    if (anchor === this.#anchor) {
      if (this.#validatedGoalIdentity === null || currentGoalIdentity === null) {
        return null;
      }
      return currentGoalIdentity === this.#validatedGoalIdentity ? null : "continuity-goal-changed";
    }
    if (this.#validatedGoalIdentity === null || currentGoalIdentity === null) {
      return "continuity-goal-unavailable";
    }
    return currentGoalIdentity === this.#validatedGoalIdentity ? null : "continuity-goal-changed";
  }

  #applyLayoutOffset(_expandedOffset: number): void {
    const host = this.#host;
    const anchor = this.#anchor;
    if (!host || !anchor) {
      return;
    }
    if (this.#viewportPortalActive) {
      this.#scheduleInlineConstraint();
      return;
    }
    if (host.placement === "floating") {
      host.style.marginBlockStart = "";
      this.#clearInlineInsets();
      this.#resetAnchorTranslate(anchor);
      this.#scheduleFloatingLayout();
      return;
    }
    this.#clearFloatingLayout(this.#floatingFallbackActive);
    const parentGap = anchor.parentElement
      ? Number.parseFloat(
          this.#document.defaultView?.getComputedStyle(anchor.parentElement).rowGap ?? "0",
        ) || 0
      : 0;
    host.style.marginBlockStart = `${-(Math.max(0, parentGap) + 1)}px`;
    this.#syncInlineInsets();
    this.#resetAnchorTranslate(anchor);
  }

  #syncInlineInsets(): void {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    if (!host || !anchor || !view || this.#viewportPortalActive) {
      return;
    }
    this.#layoutReadCount += 1;
    const style = view.getComputedStyle(anchor);
    const anchorRect = anchor.getBoundingClientRect();
    const width = anchorRect.width;
    const composerRect =
      anchor.closest<HTMLElement>("[data-codex-composer-root]")?.getBoundingClientRect() ?? null;
    const controlArea = this.#adapter.findGoalControlArea?.(this.#document);
    const controlRect = controlArea?.getBoundingClientRect() ?? null;
    this.#nativeGeometryFingerprint = [
      rectFingerprint(anchorRect),
      rectFingerprint(composerRect),
      rectFingerprint(controlRect),
    ].join("|");
    const start = Number.parseFloat(style.paddingInlineStart) || 0;
    const end = Number.parseFloat(style.paddingInlineEnd) || 0;
    const valid =
      start >= 0 && end >= 0 && Number.isFinite(width) && width > 0 && start + end < width * 0.5;
    if (!valid) {
      this.#clearMeasuredInlineGeometry();
      return;
    }
    this.#layoutWriteCount += 1;
    host.style.marginInlineStart = valid && start > 0 ? `${start}px` : "";
    host.style.marginInlineEnd = valid && end > 0 ? `${end}px` : "";
    if (controlArea) {
      const hostRect = host.getBoundingClientRect();
      const controlRect = controlArea.getBoundingClientRect();
      const controlStart = controlRect.left - hostRect.left;
      if (Number.isFinite(controlStart) && controlStart >= 0 && controlStart <= hostRect.width) {
        host.style.setProperty("--gp-native-control-start", `${controlStart}px`);
      } else {
        host.style.removeProperty("--gp-native-control-start");
      }
      const lastControl = [...controlArea.querySelectorAll<HTMLElement>('button[type="button"]')]
        .filter((button) => button.getBoundingClientRect().width > 0)
        .sort(
          (left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left,
        )
        .at(-1);
      if (lastControl) {
        const lastRect = lastControl.getBoundingClientRect();
        const overall = host.shadowRoot?.querySelector<HTMLElement>(".overall") ?? null;
        const overallRect = overall?.getBoundingClientRect();
        const overallWidth = overall
          ? Number.parseFloat(view.getComputedStyle(overall).width)
          : Number.NaN;
        const scale =
          overallRect && Number.isFinite(overallWidth) && overallWidth > 0
            ? overallRect.width / overallWidth
            : Number.NaN;
        const center =
          overallRect === undefined || !Number.isFinite(scale) || scale <= 0
            ? Number.NaN
            : (lastRect.left + lastRect.width / 2 - overallRect.left) / scale;
        if (overallRect && Number.isFinite(center) && center >= 0 && center <= overallWidth) {
          host.style.setProperty("--gp-native-last-control-center", `${center}px`);
        } else {
          host.style.removeProperty("--gp-native-last-control-center");
        }
      } else {
        host.style.removeProperty("--gp-native-last-control-center");
      }
    } else {
      host.style.removeProperty("--gp-native-control-start");
      host.style.removeProperty("--gp-native-last-control-center");
    }
    const overallRect =
      host.shadowRoot?.querySelector<HTMLElement>(".overall")?.getBoundingClientRect() ?? null;
    this.#sidecarGeometryFingerprint = [
      rectFingerprint(host.getBoundingClientRect()),
      rectFingerprint(overallRect),
    ].join("|");
  }

  #clearInlineInsets(): void {
    if (!this.#host) {
      return;
    }
    this.#host.style.marginInlineStart = "";
    this.#host.style.marginInlineEnd = "";
  }

  #clearMeasuredInlineGeometry(): void {
    const host = this.#host;
    if (!host) {
      return;
    }
    const hadMeasuredGeometry =
      host.style.marginInlineStart !== "" ||
      host.style.marginInlineEnd !== "" ||
      host.style.getPropertyValue("--gp-native-control-start") !== "" ||
      host.style.getPropertyValue("--gp-native-last-control-center") !== "";
    host.style.marginInlineStart = "";
    host.style.marginInlineEnd = "";
    host.style.removeProperty("--gp-native-control-start");
    host.style.removeProperty("--gp-native-last-control-center");
    this.#sidecarGeometryFingerprint = null;
    if (hadMeasuredGeometry) {
      this.#layoutWriteCount += 1;
    }
  }

  #syncPlacement(): void {
    const host = this.#host;
    if (!host) {
      return;
    }
    if (host.placement === "floating") {
      this.#clearViewportPortal(true);
      host.style.marginBlockStart = "";
      this.#clearInlineInsets();
      if (this.#anchor) {
        this.#resetAnchorTranslate(this.#anchor);
      }
      this.#observeFloatingLayout();
      this.#scheduleFloatingLayout();
      return;
    }
    if (this.#viewportPortalActive) {
      this.#observeInlineConstraint();
      this.#scheduleInlineConstraint();
      return;
    }
    host.floatingPanelConstrained = false;
    this.#clearFloatingLayout(this.#floatingFallbackActive);
    const expandedOffset = host.expandedLayoutOffset;
    this.#applyLayoutOffset(
      typeof expandedOffset === "number" && Number.isFinite(expandedOffset) ? expandedOffset : 0,
    );
    this.#observeInlineConstraint();
    this.#scheduleInlineConstraint();
  }

  #observeInlineConstraint(): void {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    if (!host || !anchor || !view || host.placement !== "inline") {
      this.#clearInlineConstraintObserver();
      return;
    }
    const composer = anchor.closest<HTMLElement>("[data-codex-composer-root]");
    const textbox = composer?.querySelector<HTMLElement>('[role="textbox"][data-codex-composer]');
    const ResizeObserverCtor = view.ResizeObserver;
    if (!composer || !textbox) {
      this.#clearInlineConstraintObserver();
      return;
    }
    if (this.#observedTextbox !== textbox) {
      this.#observedTextbox?.removeEventListener("input", this.#onTextboxInput);
      this.#observedTextbox?.removeEventListener("scroll", this.#onTextboxScroll);
      this.#observedTextbox = textbox;
      textbox.addEventListener("input", this.#onTextboxInput);
      textbox.addEventListener("scroll", this.#onTextboxScroll);
    }
    if (ResizeObserverCtor) {
      this.#inlineObservedSizeFingerprint = [
        composer.clientWidth,
        composer.clientHeight,
        textbox.clientWidth,
        textbox.clientHeight,
      ].join(",");
      this.#inlineResizeObserver ??= new ResizeObserverCtor(() => {
        const currentComposer = this.#anchor?.closest<HTMLElement>("[data-codex-composer-root]");
        const currentTextbox = currentComposer?.querySelector<HTMLElement>(
          '[role="textbox"][data-codex-composer]',
        );
        if (!currentComposer || !currentTextbox) {
          return;
        }
        const nextSizeFingerprint = [
          currentComposer.clientWidth,
          currentComposer.clientHeight,
          currentTextbox.clientWidth,
          currentTextbox.clientHeight,
        ].join(",");
        if (nextSizeFingerprint === this.#inlineObservedSizeFingerprint) {
          return;
        }
        this.#inlineObservedSizeFingerprint = nextSizeFingerprint;
        this.#pendingInlineObserverReason ??= "inline-resize";
        if (!this.#viewportPortalActive) {
          this.#syncInlineInsets();
        }
        this.#scheduleInlineConstraint();
      });
      this.#inlineResizeObserver.disconnect();
      this.#inlineResizeObserver.observe(composer);
      this.#inlineResizeObserver.observe(textbox);
    }
  }

  #scheduleInlineConstraint(): void {
    const host = this.#host;
    const view = this.#document.defaultView;
    if (!host || !view || host.placement !== "inline" || this.#inlineConstraintFrame !== null) {
      return;
    }
    this.#inlineConstraintFrame = view.requestAnimationFrame(() => {
      this.#inlineConstraintFrame = null;
      if (this.#pendingInlineObserverReason) {
        this.#lastObserverReason = this.#pendingInlineObserverReason;
        this.#pendingInlineObserverReason = null;
      }
      if (!this.#viewportPortalActive) {
        this.#syncInlineInsets();
      }
      this.#syncInlineConstraint();
    });
  }

  #syncInlineConstraint(): void {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    if (!host || !anchor || !view || host.placement !== "inline") {
      return;
    }
    this.#layoutReadCount += 1;
    const composer = anchor.closest<HTMLElement>("[data-codex-composer-root]");
    if (!composer) {
      return;
    }

    if (this.#viewportPortalActive) {
      if (this.#originCanShowHost()) {
        this.#clearViewportPortal(true);
      } else {
        this.#positionViewportPortal();
        return;
      }
    }

    if (host.collapsed) {
      const changed = host.spaceConstrained;
      host.spaceConstrained = false;
      if (changed) {
        this.#layoutWriteCount += 1;
        this.#lastConstraintTransition = "exited";
      }
      if (!this.#inlineSurfaceIsFullyVisible(host)) {
        this.#activateViewportPortal();
      }
      return;
    }
    const expandedOffset = Math.max(this.#lastExpandedOffset, host.expandedLayoutOffset ?? 0);
    if (expandedOffset <= 0) {
      return;
    }
    const composerTop = composer.getBoundingClientRect().top;
    const projectedExpandedTop = composerTop - (host.spaceConstrained ? expandedOffset : 0);
    const next = projectedExpandedTop < 8;
    if (next !== host.spaceConstrained) {
      host.spaceConstrained = next;
      this.#layoutWriteCount += 1;
      this.#lastConstraintTransition = next ? "entered" : "exited";
      this.#scheduleInlineConstraint();
      return;
    }
    if (!this.#inlineSurfaceIsFullyVisible(host)) {
      this.#activateViewportPortal();
    }
  }

  #inlineSurfaceIsFullyVisible(element: HTMLElement): boolean {
    const view = this.#document.defaultView;
    if (!view) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const visibleHeight =
      Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0)) / rect.height;
    const clipping = clippingAncestors(element, view);
    const ancestorRatio =
      clipping.length === 0
        ? 1
        : intersectionRatio(
            rect,
            clipping.map((element) => element.getBoundingClientRect()),
          );
    return visibleHeight >= 0.99 && ancestorRatio >= 0.99;
  }

  #originCanShowHost(): boolean {
    const marker = this.#originMarker;
    if (!marker?.isConnected) {
      return false;
    }
    return this.#inlineSurfaceIsFullyVisible(marker);
  }

  #activateViewportPortal(): void {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    if (
      this.#viewportPortalActive ||
      !host ||
      !anchor?.parentElement ||
      !view ||
      host.parentElement !== anchor.parentElement ||
      this.#continuityIdentityFailure(anchor)
    ) {
      return;
    }
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) {
      return;
    }
    const marker = this.#document.createElement("div");
    marker.setAttribute(
      GOAL_PROGRESS_ORIGIN_MARKER_ATTRIBUTE,
      GOAL_PROGRESS_PORTAL_ATTRIBUTE_VALUE,
    );
    Object.assign(marker.style, {
      boxSizing: "border-box",
      display: "block",
      flex: "none",
      height: `${hostRect.height}px`,
      marginBlockStart: host.style.marginBlockStart,
      marginInlineEnd: host.style.marginInlineEnd,
      marginInlineStart: host.style.marginInlineStart,
      pointerEvents: "none",
      visibility: "hidden",
    });
    anchor.parentElement.insertBefore(marker, host);
    this.#document.body.append(host);
    this.#originMarker = marker;
    this.#viewportPortalActive = true;
    host.setAttribute(
      GOAL_PROGRESS_VIEWPORT_PORTAL_ATTRIBUTE,
      GOAL_PROGRESS_PORTAL_ATTRIBUTE_VALUE,
    );
    host.spaceConstrained = true;
    host.style.marginBlockStart = "";
    host.style.marginInlineStart = "";
    host.style.marginInlineEnd = "";
    host.style.position = "fixed";
    host.style.zIndex = "30";
    this.#layoutWriteCount += 1;
    this.#lastConstraintTransition = "entered";
    this.#positionViewportPortal();
  }

  #positionViewportPortal(): void {
    const host = this.#host;
    const marker = this.#originMarker;
    const view = this.#document.defaultView;
    if (!this.#viewportPortalActive || !host || !marker?.isConnected || !view) {
      return;
    }
    const markerRect = marker.getBoundingClientRect();
    const left = Math.max(8, Math.min(markerRect.left, view.innerWidth - 8));
    const right = Math.max(left, Math.min(markerRect.right, view.innerWidth - 8));
    const width = Math.max(0, right - left);
    if (width <= 0) {
      return;
    }
    const initialTop = Math.max(8, Math.min(markerRect.top, view.innerHeight - 8));
    this.#positionFloatingHost(host, left, initialTop, width);
    const hostRect = host.getBoundingClientRect();
    const top = Math.max(8, Math.min(initialTop, view.innerHeight - hostRect.height - 8));
    if (Math.abs(top - hostRect.top) >= 0.5) {
      this.#positionFloatingHost(host, left, top, width);
    }
    this.#layoutWriteCount += 1;
  }

  #clearViewportPortal(restoreInline: boolean): void {
    const host = this.#host;
    const marker = this.#originMarker;
    if (!this.#viewportPortalActive && !marker) {
      return;
    }
    if (restoreInline && host && marker?.isConnected) {
      marker.replaceWith(host);
    } else {
      marker?.remove();
    }
    if (host) {
      host.removeAttribute(GOAL_PROGRESS_VIEWPORT_PORTAL_ATTRIBUTE);
      host.style.position = "";
      host.style.left = "";
      host.style.top = "";
      host.style.width = "";
      host.style.height = "";
      host.style.zIndex = "";
      host.style.pointerEvents = "";
    }
    this.#originMarker = null;
    this.#viewportPortalActive = false;
    this.#layoutWriteCount += 1;
    if (restoreInline) {
      this.#syncInlineInsets();
    }
  }

  #clearInlineConstraintObserver(): void {
    const view = this.#document.defaultView;
    if (view && this.#inlineConstraintFrame !== null) {
      view.cancelAnimationFrame(this.#inlineConstraintFrame);
    }
    this.#inlineConstraintFrame = null;
    this.#inlineResizeObserver?.disconnect();
    this.#inlineResizeObserver = null;
    this.#inlineObservedSizeFingerprint = null;
    this.#observedTextbox?.removeEventListener("input", this.#onTextboxInput);
    this.#observedTextbox?.removeEventListener("scroll", this.#onTextboxScroll);
    this.#observedTextbox = null;
    this.#pendingInlineObserverReason = null;
  }

  #scheduleFloatingLayout(): void {
    if (this.#host?.placement !== "floating") {
      return;
    }
    const view = this.#document.defaultView;
    if (!view || this.#floatingFrame !== null) {
      return;
    }
    this.#floatingFrame = view.requestAnimationFrame(() => {
      this.#floatingFrame = null;
      this.#applyFloatingLayout();
    });
  }

  #observeFloatingLayout(chip: HTMLElement | null = null, panel: HTMLElement | null = null): void {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    if (!host || !anchor || !view || host.placement !== "floating") {
      return;
    }
    const ResizeObserverCtor = view.ResizeObserver;
    if (!ResizeObserverCtor) {
      return;
    }
    this.#floatingResizeObserver ??= new ResizeObserverCtor((entries) => {
      this.#lastObserverReason = "floating-resize";
      const composer = this.#anchor?.closest<HTMLElement>("[data-codex-composer-root]");
      const textbox = composer?.querySelector<HTMLElement>('[role="textbox"][data-codex-composer]');
      if (entries.some((entry) => entry.target === composer || entry.target === textbox)) {
        this.#floatingViewportTop = null;
      }
      if (!this.#floatingFallbackActive) {
        this.#scheduleFloatingLayout();
      }
    });
    const composer = anchor.closest<HTMLElement>("[data-codex-composer-root]");
    const textbox = composer?.querySelector<HTMLElement>('[role="textbox"][data-codex-composer]');
    this.#floatingResizeObserver.observe(anchor);
    if (composer) {
      this.#floatingResizeObserver.observe(composer);
    }
    if (textbox) {
      this.#floatingResizeObserver.observe(textbox);
    }
    if (chip) {
      this.#floatingResizeObserver.observe(chip);
    }
    if (panel) {
      this.#floatingResizeObserver.observe(panel);
    }
    this.#observeFloatingObstacleChanges();
  }

  #readFloatingObstacles(): readonly HTMLElement[] {
    return (this.#adapter.findFloatingObstacles?.(this.#document) ?? []).filter(
      (element) => element.isConnected,
    );
  }

  #observeFloatingObstacleChanges(): void {
    const host = this.#host;
    const view = this.#document.defaultView;
    const MutationObserverCtor = view?.MutationObserver;
    if (!host || !view || !MutationObserverCtor || host.placement !== "floating") {
      return;
    }
    this.#observedFloatingObstacles = new Set(this.#readFloatingObstacles());
    if (this.#floatingObstacleObserver) {
      return;
    }
    this.#floatingObstacleObserver = new MutationObserverCtor((records) => {
      const previous = this.#observedFloatingObstacles;
      const next = new Set(this.#readFloatingObstacles());
      const membershipChanged =
        previous.size !== next.size ||
        [...previous].some((element) => !next.has(element)) ||
        [...next].some((element) => !previous.has(element));
      const known = new Set([...previous, ...next]);
      const touchesKnownObstacle = records.some((record) => {
        const changedNodes = [record.target, ...record.addedNodes, ...record.removedNodes];
        return changedNodes.some((node) =>
          [...known].some(
            (obstacle) =>
              node === obstacle ||
              (node instanceof Element && (node.contains(obstacle) || obstacle.contains(node))),
          ),
        );
      });
      this.#observedFloatingObstacles = next;
      if (membershipChanged || touchesKnownObstacle) {
        this.#scheduleFloatingLayout();
      }
    });
    this.#floatingObstacleObserver.observe(this.#document.body, {
      attributes: true,
      attributeFilter: ["aria-hidden", "class", "hidden", "style"],
      childList: true,
      subtree: true,
    });
  }

  #applyFloatingLayout(): void {
    const host = this.#host;
    const anchor = this.#anchor;
    const view = this.#document.defaultView;
    if (!host || !anchor || !view || host.placement !== "floating") {
      return;
    }
    this.#layoutReadCount += 1;
    this.#clearInlineInsets();
    const anchorRect = anchor.getBoundingClientRect();
    const goalBlockRect = floatingGoalBlockRect(anchor);
    const left = Math.max(8, goalBlockRect.left);
    const right = Math.min(view.innerWidth - 8, goalBlockRect.right);
    const width = Math.max(0, right - left);
    if (width <= 0) {
      return;
    }
    const knownObstacles = this.#readFloatingObstacles();
    const checklistRect = knownObstacles
      .map((element) => element.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.bottom <= anchorRect.top &&
          anchorRect.top - rect.bottom <= 64 &&
          rect.width >= 100 &&
          rect.height >= 24,
      )
      .sort((first, second) => second.bottom - first.bottom)[0];
    this.#floatingActive = true;
    this.#layoutWriteCount += 1;
    host.style.position = "fixed";
    host.style.height = "0";
    host.style.zIndex = "30";
    host.style.pointerEvents = "none";
    if (!checklistRect && this.#floatingChecklistAligned) {
      this.#floatingViewportTop = null;
    }
    const targetTop = checklistRect?.bottom ?? this.#floatingViewportTop ?? anchorRect.top - 12;
    this.#floatingChecklistAligned = checklistRect !== undefined;
    const hostScale = this.#positionFloatingHost(host, left, targetTop, width);
    this.#floatingViewportTop = targetTop;

    const chip = host.shadowRoot?.querySelector<HTMLElement>(".floating-chip") ?? null;
    const panel = host.shadowRoot?.querySelector<HTMLElement>(".floating-panel") ?? null;
    if (
      host.floatingPanelConstrained &&
      this.#lastFloatingPanelHeight > 0 &&
      targetTop - 82 - this.#lastFloatingPanelHeight >= 8
    ) {
      host.floatingPanelConstrained = false;
      this.#scheduleFloatingLayout();
      return;
    }
    if (!chip || (!host.collapsed && !host.floatingPanelConstrained && !panel)) {
      return;
    }
    const chipRect = chip?.getBoundingClientRect() ?? null;
    const panelRect = panel?.getBoundingClientRect() ?? null;
    if (panelRect && panelRect.height > 0) {
      this.#lastFloatingPanelHeight = panelRect.height;
    }
    const chipWidth = Math.min(width, chipRect?.width ?? 0);
    const panelWidth = Math.min(width, panelRect?.width ?? 0);
    const centerAvailable = knownObstacles.length === 0;
    if (host.floatingCenterAvailable !== centerAvailable) {
      host.floatingCenterAvailable = centerAvailable;
    }
    const requestedRatio = clampFloatingDockRatio(this.#requestedFloatingXRatio);
    const ratio = this.#floatingPreviewRatio ?? requestedRatio;
    if (host.floatingXRatio !== ratio) {
      host.floatingXRatio = ratio;
    }
    const obstacle = findFloatingObstacle(
      this.#document,
      host,
      anchor,
      chip,
      panel,
      left,
      right,
      knownObstacles,
    );
    const currentStackLift =
      Number.parseFloat(host.style.getPropertyValue("--gp-floating-stack-lift")) || 0;
    const chipBaseTop = chipRect ? chipRect.top + currentStackLift * hostScale : 0;
    const chipBaseBottom = chipRect ? chipRect.bottom + currentStackLift * hostScale : 0;
    const chipObstacle =
      obstacle && chipRect && obstacle.top < chipBaseBottom && obstacle.bottom > chipBaseTop
        ? obstacle
        : null;
    let chipProjection = projectFloatingCenter({
      safeLeft: left,
      safeRight: right,
      boundaryWidth: chipWidth,
      ratio,
      ...(chipObstacle
        ? { obstacleLeft: chipObstacle.left, obstacleRight: chipObstacle.right }
        : {}),
    });
    const requiredStackLift =
      chipObstacle && chipProjection.blocked
        ? Math.max(0, chipBaseBottom - chipObstacle.top + 8) / hostScale
        : 0;
    const stackLift =
      chipObstacle && chipProjection.blocked ? Math.max(currentStackLift, requiredStackLift) : 0;
    if (stackLift > 0) {
      chipProjection = projectFloatingCenter({
        safeLeft: left,
        safeRight: right,
        boundaryWidth: chipWidth,
        ratio,
      });
    }
    const panelHalfWidth = panelWidth / 2;
    const panelMinimumCenter = left + panelHalfWidth;
    const panelMaximumCenter = Math.max(panelMinimumCenter, right - panelHalfWidth);
    const panelCenter = Math.max(
      panelMinimumCenter,
      Math.min(panelMaximumCenter, chipProjection.center),
    );
    host.style.setProperty(
      "--gp-floating-chip-center",
      `${(chipProjection.center - left) / hostScale}px`,
    );
    host.style.setProperty("--gp-floating-panel-center", `${(panelCenter - left) / hostScale}px`);
    host.style.setProperty("--gp-floating-stack-lift", `${stackLift}px`);
    const currentPanelLift =
      Number.parseFloat(host.style.getPropertyValue("--gp-floating-panel-lift")) || 0;
    const panelBaseBottom = panelRect
      ? panelRect.bottom + (currentPanelLift + currentStackLift) * hostScale
      : 0;
    const requiredTotalPanelLift =
      obstacle && panelRect ? Math.max(0, panelBaseBottom - obstacle.top + 8) / hostScale : 0;
    const requiredPanelLift = Math.max(0, requiredTotalPanelLift - stackLift);
    const panelLift = obstacle && panelRect ? Math.max(currentPanelLift, requiredPanelLift) : 0;
    const panelTopAfterLift = panelRect
      ? panelRect.top + (currentPanelLift + currentStackLift - panelLift - stackLift) * hostScale
      : null;
    const chipTopAfterLift = chipRect
      ? chipRect.top + (currentStackLift - stackLift) * hostScale
      : null;
    if (panelTopAfterLift !== null && panelTopAfterLift < 8 && !host.collapsed) {
      host.floatingPanelConstrained = true;
      host.style.setProperty("--gp-floating-panel-lift", "0px");
      this.#scheduleFloatingLayout();
      return;
    }
    if (
      chipProjection.blocked ||
      chipRect === null ||
      (chipTopAfterLift !== null && chipTopAfterLift < 8)
    ) {
      this.#fallbackToInline();
      return;
    }
    this.#floatingFallbackActive = false;
    host.removeAttribute(GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE);
    this.#cancelFloatingFallbackRetry(true);
    host.style.setProperty("--gp-floating-panel-lift", `${panelLift}px`);

    this.#observeFloatingLayout(chip, panel);
    view.removeEventListener("resize", this.#onWindowResize);
    view.addEventListener("resize", this.#onWindowResize);
    view.removeEventListener("scroll", this.#onWindowScroll, true);
    view.addEventListener("scroll", this.#onWindowScroll, true);
  }

  #positionFloatingHost(
    host: HTMLElement,
    targetLeft: number,
    targetTop: number,
    targetWidth: number,
  ): number {
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = `${targetWidth}px`;
    let rect = host.getBoundingClientRect();
    let scale = rect.width > 0 ? rect.width / targetWidth : 1;
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
    }
    let cssLeft = (targetLeft - rect.left) / scale;
    let cssTop = (targetTop - rect.top) / scale;
    let cssWidth = targetWidth / scale;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      host.style.left = `${cssLeft}px`;
      host.style.top = `${cssTop}px`;
      host.style.width = `${cssWidth}px`;
      rect = host.getBoundingClientRect();
      const measuredScale = rect.width > 0 ? rect.width / cssWidth : scale;
      if (Number.isFinite(measuredScale) && measuredScale > 0) {
        scale = measuredScale;
      }
      cssLeft += (targetLeft - rect.left) / scale;
      cssTop += (targetTop - rect.top) / scale;
      if (rect.width > 0) {
        cssWidth *= targetWidth / rect.width;
      }
    }
    host.style.left = `${cssLeft}px`;
    host.style.top = `${cssTop}px`;
    host.style.width = `${cssWidth}px`;
    return scale;
  }

  #fallbackToInline(): void {
    const host = this.#host;
    const view = this.#document.defaultView;
    if (!host || !view) {
      return;
    }
    this.#floatingFallbackActive = true;
    this.#lastPlacementTransition = "fallback-inline";
    host.floatingPanelConstrained = false;
    host.setAttribute(GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE, "insufficient-space");
    this.#clearFloatingLayout(true);
    host.placement = "inline";
    view.removeEventListener("resize", this.#onWindowResize);
    view.addEventListener("resize", this.#onWindowResize);
    view.removeEventListener("scroll", this.#onWindowScroll, true);
    view.addEventListener("scroll", this.#onWindowScroll, true);
    this.#scheduleFloatingFallbackRetry();
  }

  #retryFloatingPlacement(): void {
    const host = this.#host;
    if (!host || this.#requestedPlacement !== "floating") {
      return;
    }
    this.#floatingFallbackActive = false;
    this.#floatingViewportTop = null;
    host.removeAttribute(GOAL_PROGRESS_FLOATING_FALLBACK_ATTRIBUTE);
    host.floatingXRatio = this.#requestedFloatingXRatio;
    host.placement = "floating";
    this.#scheduleFloatingLayout();
  }

  #scheduleFloatingFallbackRetry(): void {
    if (
      this.#floatingFallbackRetryTimer ||
      !this.#floatingFallbackActive ||
      this.#requestedPlacement !== "floating"
    ) {
      return;
    }
    const delay = GOAL_PROGRESS_FLOATING_FALLBACK_RETRY_DELAYS_MS[this.#floatingFallbackRetryIndex];
    if (delay === undefined) {
      return;
    }
    this.#floatingFallbackRetryIndex += 1;
    this.#floatingFallbackRetryTimer = setTimeout(() => {
      this.#floatingFallbackRetryTimer = null;
      this.#retryFloatingPlacement();
      if (this.#floatingFallbackActive) {
        this.#scheduleFloatingFallbackRetry();
      }
    }, delay);
  }

  #cancelFloatingFallbackRetry(resetIndex: boolean): void {
    if (this.#floatingFallbackRetryTimer) {
      clearTimeout(this.#floatingFallbackRetryTimer);
      this.#floatingFallbackRetryTimer = null;
    }
    if (resetIndex) {
      this.#floatingFallbackRetryIndex = 0;
    }
  }

  #clearFloatingLayout(preserveFallbackRetry = false): void {
    if (!this.#floatingActive && !this.#floatingFallbackActive && !preserveFallbackRetry) {
      return;
    }
    const host = this.#host;
    const view = this.#document.defaultView;
    if (view && this.#floatingFrame !== null) {
      view.cancelAnimationFrame(this.#floatingFrame);
    }
    this.#floatingFrame = null;
    if (!preserveFallbackRetry) {
      this.#cancelFloatingFallbackRetry(true);
      this.#floatingResizeObserver?.disconnect();
      this.#floatingResizeObserver = null;
      this.#floatingObstacleObserver?.disconnect();
      this.#floatingObstacleObserver = null;
      this.#observedFloatingObstacles.clear();
      view?.removeEventListener("resize", this.#onWindowResize);
      view?.removeEventListener("scroll", this.#onWindowScroll, true);
    }
    if (host) {
      host.style.position = "";
      host.style.left = "";
      host.style.top = "";
      host.style.width = "";
      host.style.height = "";
      host.style.zIndex = "";
      host.style.pointerEvents = "";
      host.style.removeProperty("--gp-floating-chip-center");
      host.style.removeProperty("--gp-floating-panel-center");
      host.style.removeProperty("--gp-floating-stack-lift");
      host.style.removeProperty("--gp-floating-panel-lift");
    }
    this.#floatingViewportTop = null;
    this.#floatingChecklistAligned = false;
    this.#floatingActive = false;
  }

  #restoreAnchor(): void {
    const anchor = this.#anchor;
    if (!anchor) {
      return;
    }
    this.#resetAnchorTranslate(anchor);
    this.#clearInlineConstraintObserver();
    this.#anchor = null;
    this.#validatedGoalIdentity = null;
  }

  #resetAnchorTranslate(anchor: HTMLElement): void {
    if (anchor.hasAttribute(GOAL_PROGRESS_ANCHOR_ORIGINAL_TRANSLATE_ATTRIBUTE)) {
      anchor.style.translate =
        anchor.getAttribute(GOAL_PROGRESS_ANCHOR_ORIGINAL_TRANSLATE_ATTRIBUTE) ?? "";
      anchor.removeAttribute(GOAL_PROGRESS_ANCHOR_ORIGINAL_TRANSLATE_ATTRIBUTE);
    }
  }

  #emitUiIntent(intent: GoalProgressLocalUiIntent): void {
    this.#onUiIntent?.(intent, {
      userActivated: this.#userClickActive,
    });
  }

  #releaseHost(remove: boolean): void {
    const host = this.#host;
    if (!host) {
      this.#restoreAnchor();
      return;
    }
    host.removeEventListener(GOAL_PROGRESS_LAYOUT_OFFSET_EVENT, this.#onLayoutOffset);
    host.removeEventListener(GOAL_PROGRESS_FLOATING_LAYOUT_EVENT, this.#onFloatingLayout);
    host.removeEventListener(GOAL_PROGRESS_SET_PLACEMENT_EVENT, this.#onPlacement);
    host.removeEventListener(GOAL_PROGRESS_SET_FLOATING_X_RATIO_EVENT, this.#onFloatingXRatio);
    if (this.#onUiIntent) {
      this.#document.removeEventListener("click", this.#onDocumentClick, true);
      host.removeEventListener(GOAL_PROGRESS_SET_COLLAPSED_EVENT, this.#onCollapsed);
      host.removeEventListener(GOAL_PROGRESS_SET_MOTION_PAUSED_EVENT, this.#onMotionPaused);
      host.removeEventListener(GOAL_PROGRESS_REQUEST_RETRY_EVENT, this.#onRetry);
      host.removeEventListener(GOAL_PROGRESS_REQUEST_DETACH_EVENT, this.#onDetach);
    }
    this.#clearViewportPortal(!remove);
    host.viewModel = null;
    host.spaceConstrained = false;
    host.floatingPanelConstrained = false;
    host.style.marginBlockStart = "";
    this.#clearInlineInsets();
    this.#clearFloatingLayout();
    this.#restoreAnchor();
    if (remove) {
      host.remove();
    }
    this.#host = null;
    this.#validatedComposer = null;
    this.#continuityModeActive = false;
    this.#sessionId = null;
    this.#floatingFallbackActive = false;
    this.#cancelFloatingFallbackRetry(true);
    this.#requestedPlacement = "inline";
    this.#requestedFloatingXRatio = 0.5;
    this.#floatingPreviewRatio = null;
    this.#lastFloatingPanelHeight = 0;
    this.#lastExpandedOffset = 0;
    if (this.#userClickTimer) {
      clearTimeout(this.#userClickTimer);
      this.#userClickTimer = null;
    }
    this.#userClickActive = false;
  }

  #result(
    action: SidecarMountAction,
    reason: SidecarMountReason,
    hostCount: number,
    threadChanged: boolean,
    adapterRejectionReason: CodexAnchorRejectionReason | null,
  ): SidecarMountResult {
    return {
      action,
      reason,
      adapterId: this.#adapter.id,
      adapterRejectionReason,
      hostCount,
      threadChanged,
    };
  }

  #healthResult(
    status: SidecarHealthStatus,
    reason: SidecarHealthReason,
    hostCount: number,
    adapterRejectionReason: CodexAnchorRejectionReason | null,
  ): SidecarHealthResult {
    return {
      status,
      reason,
      adapterId: this.#adapter.id,
      adapterRejectionReason,
      hostCount,
    };
  }
}
