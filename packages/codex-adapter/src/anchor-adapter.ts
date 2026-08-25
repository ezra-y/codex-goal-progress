export type CodexAnchorPlatform = "macos";
export type CodexHostPlatform = CodexAnchorPlatform | "windows";

export type CodexAnchorSignal =
  | "composer-root-unique"
  | "composer-textbox-unique"
  | "goal-button-above-composer"
  | "goal-control-area-present"
  | "goal-text-english"
  | "goal-text-chinese";

export type CodexAnchorRejectionReason =
  | "composer-root-missing"
  | "composer-root-ambiguous"
  | "composer-textbox-missing"
  | "composer-textbox-ambiguous"
  | "goal-anchor-missing"
  | "goal-anchor-ambiguous";

export type CodexVisibleThreadRejectionReason =
  | "visible-thread-marker-missing"
  | "visible-thread-marker-ambiguous"
  | "visible-thread-id-missing"
  | "visible-thread-mismatch";

export interface CapabilityProbeResult {
  readonly supported: boolean;
  readonly adapterId: string;
  readonly matchedSignals: readonly CodexAnchorSignal[];
  readonly rejectionReason: CodexAnchorRejectionReason | null;
  readonly candidateCount: number;
}

export interface VisibleThreadMatchResult {
  readonly matched: boolean;
  readonly adapterId: string;
  readonly rejectionReason: CodexVisibleThreadRejectionReason | null;
  readonly candidateCount: number;
}

export interface CodexAnchorAdapter {
  readonly id: string;
  readonly platform: CodexAnchorPlatform;
  readonly appVersionRange: string;
  probe(document: Document): CapabilityProbeResult;
  matchVisibleThread(document: Document, expectedThreadId: string): VisibleThreadMatchResult;
  findGoalAnchor(document: Document): HTMLElement | null;
  findGoalControlArea?(document: Document): HTMLElement | null;
  findFloatingObstacles?(document: Document): readonly HTMLElement[];
  readGoalIdentity?(document: Document): string | null;
}

export type CodexAnchorRegistryRejectionReason =
  | "platform-unsupported"
  | "app-version-unsupported"
  | "capability-unsupported"
  | "adapter-ambiguous";

export interface CodexAnchorRegistryInput {
  readonly platform: CodexHostPlatform;
  readonly appVersion: string;
  readonly document: Document;
}

export type CodexAnchorRegistryResult =
  | {
      readonly supported: true;
      readonly adapter: CodexAnchorAdapter;
      readonly probe: CapabilityProbeResult;
      readonly rejectionReason: null;
    }
  | {
      readonly supported: false;
      readonly adapter: null;
      readonly probes: readonly CapabilityProbeResult[];
      readonly rejectionReason: CodexAnchorRegistryRejectionReason;
    };

interface LocatedGoalAnchor {
  readonly anchor: HTMLElement;
  readonly controlArea: HTMLElement;
  readonly goalButton: HTMLElement;
}

interface AnchorLocationResult {
  readonly located: LocatedGoalAnchor | null;
  readonly probe: CapabilityProbeResult;
}

function elements<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function rectVisible(rect: DOMRect): boolean {
  return (
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    Number.isFinite(rect.left) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function verticallyOverlaps(left: DOMRect, right: DOMRect): boolean {
  return Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top);
}

function textSignals(element: HTMLElement): CodexAnchorSignal[] {
  const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
  const signals: CodexAnchorSignal[] = [];
  if (/(^|\s)goal(?=\s|:|$)/iu.test(text)) {
    signals.push("goal-text-english");
  }
  if (text.includes("目标")) {
    signals.push("goal-text-chinese");
  }
  return signals;
}

function readGoalButtonIdentity(goalButton: HTMLElement): string | null {
  const objective = goalButton.children[1];
  if (!objective) {
    return null;
  }
  const normalized = (objective.textContent ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\s*•\s*$/u, "")
    .trim();
  return normalized || null;
}

function findNativeStepSurfaces(document: Document): readonly HTMLElement[] {
  const surfaces = new Set<HTMLElement>();
  const markers = elements<HTMLElement>(document, "span").filter((element) => {
    const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    return /^第\s*\d+\s*\/\s*\d+\s*步$/u.test(text) || /^Step\s+\d+\s*\/\s*\d+$/iu.test(text);
  });
  for (const marker of markers) {
    let ancestor = marker.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const rect = ancestor.getBoundingClientRect();
      const radius =
        Number.parseFloat(document.defaultView?.getComputedStyle(ancestor).borderRadius ?? "0") ||
        0;
      if (rect.width >= 300 && rect.height >= 24 && rect.height <= 420 && radius >= 8) {
        surfaces.add(ancestor);
        break;
      }
    }
  }
  return [...surfaces];
}

function auxiliaryControlButtons(container: HTMLElement, goalButton: HTMLElement): HTMLElement[] {
  const goalRect = goalButton.getBoundingClientRect();
  return elements<HTMLElement>(container, 'button[type="button"][aria-label]').filter((button) => {
    if (button === goalButton) {
      return false;
    }
    const rect = button.getBoundingClientRect();
    return (
      rectVisible(rect) &&
      verticallyOverlaps(rect, goalRect) &&
      rect.width <= goalRect.width * 0.25 &&
      rect.height <= Math.max(goalRect.height * 2, 72)
    );
  });
}

function findGoalRow(
  composerRoot: HTMLElement,
  goalButton: HTMLElement,
): { readonly anchor: HTMLElement; readonly controlArea: HTMLElement } | null {
  let ancestor = goalButton.parentElement;
  while (ancestor && ancestor !== composerRoot) {
    const directChildren = Array.from(ancestor.children).filter(
      (child): child is HTMLElement => "getBoundingClientRect" in child,
    );
    const goalBranch = directChildren.filter(
      (child) => child === goalButton || child.contains(goalButton),
    );
    const controlBranches = directChildren.filter(
      (child) =>
        !goalBranch.includes(child) && auxiliaryControlButtons(child, goalButton).length >= 2,
    );
    if (goalBranch.length === 1 && controlBranches.length === 1) {
      let mountAnchor = ancestor;
      while (mountAnchor.parentElement && mountAnchor.parentElement !== composerRoot) {
        mountAnchor = mountAnchor.parentElement;
      }
      if (mountAnchor.parentElement !== composerRoot) {
        return null;
      }
      return {
        anchor: mountAnchor,
        controlArea: controlBranches[0] as HTMLElement,
      };
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function result(
  adapterId: string,
  supported: boolean,
  matchedSignals: readonly CodexAnchorSignal[],
  rejectionReason: CodexAnchorRejectionReason | null,
  candidateCount: number,
): CapabilityProbeResult {
  return {
    supported,
    adapterId,
    matchedSignals,
    rejectionReason,
    candidateCount,
  };
}

export function resolveCurrentMacosVisibleThreadId(document: Document): string | null {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-app-action-sidebar-thread-row]"),
  ).filter(
    (row) =>
      row.getAttribute("aria-current") === "page" &&
      row.getAttribute("data-app-action-sidebar-thread-active") === "true" &&
      row.getAttribute("data-app-action-sidebar-thread-selected") === "true",
  );
  if (rows.length !== 1) {
    return null;
  }
  const visibleThreadId = rows[0]?.getAttribute("data-app-action-sidebar-thread-id");
  if (!visibleThreadId) {
    return null;
  }
  const visibleThreadHostId = rows[0]?.getAttribute("data-app-action-sidebar-thread-host-id");
  const hostPrefix =
    typeof visibleThreadHostId === "string" && visibleThreadHostId.length > 0
      ? `${visibleThreadHostId}:`
      : "";
  const normalizedVisibleThreadId =
    hostPrefix.length > 0 && visibleThreadId.startsWith(hostPrefix)
      ? visibleThreadId.slice(hostPrefix.length)
      : visibleThreadId;
  if (normalizedVisibleThreadId.length < 1 || normalizedVisibleThreadId.length > 256) {
    return null;
  }
  if (!normalizedVisibleThreadId.startsWith("client-new-thread:")) {
    return normalizedVisibleThreadId;
  }
  const mainContent = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-app-shell-main-content-layout="thread-edge-scroll"]',
    ),
  );
  if (mainContent.length !== 1) {
    return null;
  }
  const conversationThreadIds = new Set(
    Array.from(
      mainContent[0]?.querySelectorAll<HTMLElement>("[data-response-annotation-conversation]") ??
        [],
    )
      .map((element) => element.getAttribute("data-response-annotation-conversation"))
      .filter(
        (threadId): threadId is string =>
          typeof threadId === "string" &&
          threadId.length > 0 &&
          threadId.length <= 256 &&
          !threadId.startsWith("client-new-thread:"),
      ),
  );
  if (conversationThreadIds.size !== 1) {
    return null;
  }
  return conversationThreadIds.values().next().value ?? null;
}

function matchCurrentMacosVisibleThread(
  adapterId: string,
  document: Document,
  expectedThreadId: string,
): VisibleThreadMatchResult {
  const currentRows = elements<HTMLElement>(
    document,
    "[data-app-action-sidebar-thread-row]",
  ).filter(
    (row) =>
      row.getAttribute("aria-current") === "page" &&
      row.getAttribute("data-app-action-sidebar-thread-active") === "true" &&
      row.getAttribute("data-app-action-sidebar-thread-selected") === "true",
  );
  if (currentRows.length === 0) {
    return {
      matched: false,
      adapterId,
      rejectionReason: "visible-thread-marker-missing",
      candidateCount: 0,
    };
  }
  if (currentRows.length !== 1) {
    return {
      matched: false,
      adapterId,
      rejectionReason: "visible-thread-marker-ambiguous",
      candidateCount: currentRows.length,
    };
  }
  const visibleThreadId = currentRows[0]?.getAttribute("data-app-action-sidebar-thread-id");
  if (!visibleThreadId) {
    return {
      matched: false,
      adapterId,
      rejectionReason: "visible-thread-id-missing",
      candidateCount: 1,
    };
  }
  const matchesExpectedThread = resolveCurrentMacosVisibleThreadId(document) === expectedThreadId;
  return {
    matched: matchesExpectedThread,
    adapterId,
    rejectionReason: matchesExpectedThread ? null : "visible-thread-mismatch",
    candidateCount: 1,
  };
}

function locateCurrentMacosGoalAnchor(adapterId: string, document: Document): AnchorLocationResult {
  const matchedSignals: CodexAnchorSignal[] = [];
  const composerRoots = elements<HTMLElement>(document, "[data-codex-composer-root]");
  if (composerRoots.length === 0) {
    return {
      located: null,
      probe: result(adapterId, false, matchedSignals, "composer-root-missing", 0),
    };
  }
  if (composerRoots.length !== 1) {
    return {
      located: null,
      probe: result(
        adapterId,
        false,
        matchedSignals,
        "composer-root-ambiguous",
        composerRoots.length,
      ),
    };
  }
  matchedSignals.push("composer-root-unique");
  const composerRoot = composerRoots[0] as HTMLElement;
  const textboxes = elements<HTMLElement>(composerRoot, '[role="textbox"][data-codex-composer]');
  if (textboxes.length === 0) {
    return {
      located: null,
      probe: result(adapterId, false, matchedSignals, "composer-textbox-missing", 0),
    };
  }
  if (textboxes.length !== 1) {
    return {
      located: null,
      probe: result(
        adapterId,
        false,
        matchedSignals,
        "composer-textbox-ambiguous",
        textboxes.length,
      ),
    };
  }
  matchedSignals.push("composer-textbox-unique");
  const composerRect = composerRoot.getBoundingClientRect();
  const textboxRect = (textboxes[0] as HTMLElement).getBoundingClientRect();
  const managedHosts = elements<HTMLElement>(composerRoot, '[data-codex-goal-progress-host="v1"]');
  const managedAnchor = managedHosts.length === 1 ? managedHosts[0]?.previousElementSibling : null;
  const candidates = elements<HTMLElement>(composerRoot, 'button[type="button"]').flatMap(
    (button) => {
      const buttonRect = button.getBoundingClientRect();
      const label = button.getAttribute("aria-label");
      const hasDisclosure = elements<HTMLElement>(button, '[aria-hidden="true"]').length > 0;
      const structurallyPossible =
        rectVisible(composerRect) &&
        rectVisible(textboxRect) &&
        rectVisible(buttonRect) &&
        button.children.length >= 2 &&
        hasDisclosure &&
        buttonRect.width >= Math.min(composerRect.width * 0.5, 240) &&
        (buttonRect.top >= composerRect.top ||
          (managedAnchor instanceof HTMLElement && managedAnchor.contains(button))) &&
        buttonRect.bottom <= textboxRect.top &&
        (label === null || /goal|目标/iu.test(label));
      if (!structurallyPossible) {
        return [];
      }
      const row = findGoalRow(composerRoot, button);
      if (!row) {
        return [];
      }
      return [
        {
          ...row,
          goalButton: button,
        },
      ];
    },
  );

  if (candidates.length === 0) {
    return {
      located: null,
      probe: result(adapterId, false, matchedSignals, "goal-anchor-missing", 0),
    };
  }
  if (candidates.length !== 1) {
    return {
      located: null,
      probe: result(adapterId, false, matchedSignals, "goal-anchor-ambiguous", candidates.length),
    };
  }
  matchedSignals.push("goal-button-above-composer", "goal-control-area-present");
  const located = candidates[0] as LocatedGoalAnchor;
  matchedSignals.push(...textSignals(located.goalButton));
  return {
    located,
    probe: result(adapterId, true, matchedSignals, null, 1),
  };
}

function createMacosGoalRowAdapter(id: string, appVersion: string): CodexAnchorAdapter {
  return {
    id,
    platform: "macos",
    appVersionRange: appVersion,
    probe(document) {
      return locateCurrentMacosGoalAnchor(id, document).probe;
    },
    matchVisibleThread(document, expectedThreadId) {
      return matchCurrentMacosVisibleThread(id, document, expectedThreadId);
    },
    findGoalAnchor(document) {
      return locateCurrentMacosGoalAnchor(id, document).located?.anchor ?? null;
    },
    findGoalControlArea(document) {
      return locateCurrentMacosGoalAnchor(id, document).located?.controlArea ?? null;
    },
    findFloatingObstacles(document) {
      return findNativeStepSurfaces(document);
    },
    readGoalIdentity(document) {
      const goalButton = locateCurrentMacosGoalAnchor(id, document).located?.goalButton;
      return goalButton ? readGoalButtonIdentity(goalButton) : null;
    },
  };
}

export const macosCodex261821641GoalRowAdapter = createMacosGoalRowAdapter(
  "macos-26.818.21641-goal-row-v1",
  "26.818.21641",
);

export const macosCodex261831338GoalRowAdapter = createMacosGoalRowAdapter(
  "macos-26.818.31338-goal-row-v1",
  "26.818.31338",
);

export const macosCodex261841509GoalRowAdapter = createMacosGoalRowAdapter(
  "macos-26.818.41509-goal-row-v1",
  "26.818.41509",
);

export const macosCodex261861809GoalRowAdapter = createMacosGoalRowAdapter(
  "macos-26.818.61809-goal-row-v1",
  "26.818.61809",
);

export class CodexAnchorAdapterRegistry {
  readonly #adapters: readonly CodexAnchorAdapter[];

  constructor(adapters: readonly CodexAnchorAdapter[]) {
    const ids = new Set<string>();
    for (const adapter of adapters) {
      if (ids.has(adapter.id)) {
        throw new Error(`GOAL_PROGRESS_ANCHOR_ADAPTER_ID_DUPLICATE: ${adapter.id}`);
      }
      ids.add(adapter.id);
    }
    this.#adapters = [...adapters];
  }

  resolve(input: CodexAnchorRegistryInput): CodexAnchorRegistryResult {
    const platformAdapters = this.#adapters.filter(
      (adapter) => adapter.platform === input.platform,
    );
    if (platformAdapters.length === 0) {
      return {
        supported: false,
        adapter: null,
        probes: [],
        rejectionReason: "platform-unsupported",
      };
    }
    const versionAdapters = platformAdapters.filter(
      (adapter) => adapter.appVersionRange === input.appVersion,
    );
    if (versionAdapters.length === 0) {
      return {
        supported: false,
        adapter: null,
        probes: [],
        rejectionReason: "app-version-unsupported",
      };
    }
    const probed = versionAdapters.map((adapter) => ({
      adapter,
      probe: adapter.probe(input.document),
    }));
    const supported = probed.filter((candidate) => candidate.probe.supported);
    if (supported.length === 1) {
      const selected = supported[0] as {
        readonly adapter: CodexAnchorAdapter;
        readonly probe: CapabilityProbeResult;
      };
      return {
        supported: true,
        adapter: selected.adapter,
        probe: selected.probe,
        rejectionReason: null,
      };
    }
    return {
      supported: false,
      adapter: null,
      probes: probed.map((candidate) => candidate.probe),
      rejectionReason: supported.length > 1 ? "adapter-ambiguous" : "capability-unsupported",
    };
  }
}

export function createDefaultCodexAnchorAdapterRegistry(): CodexAnchorAdapterRegistry {
  return new CodexAnchorAdapterRegistry([
    macosCodex261821641GoalRowAdapter,
    macosCodex261831338GoalRowAdapter,
    macosCodex261841509GoalRowAdapter,
    macosCodex261861809GoalRowAdapter,
  ]);
}
