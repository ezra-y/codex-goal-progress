import { html } from "lit";
import type { GoalProgressPlacement, GoalProgressViewModel } from "../../../contracts/src/index.js";
import { renderCompletionFooter } from "./completion-footer.js";
import { renderCurrentSummary } from "./current-summary.js";
import { renderNotices } from "./notices.js";
import { type ObjectiveListRenderOptions, renderObjectiveLists } from "./objective-list.js";
import { renderOverallProgress } from "./overall-progress.js";

export interface TrackingRenderOptions extends ObjectiveListRenderOptions {
  readonly collapsed: boolean;
  readonly locale: string;
  readonly motionPaused: boolean;
  readonly placement: GoalProgressPlacement;
  readonly requestedPlacement: GoalProgressPlacement;
  readonly spaceConstrained: boolean;
  readonly floatingPanelConstrained: boolean;
  readonly settingsOpen: boolean;
  readonly onFloatingKeyDown: (event: KeyboardEvent) => void;
  readonly onFloatingPointerCancel: (event: PointerEvent) => void;
  readonly onFloatingPointerDown: (event: PointerEvent) => void;
  readonly onFloatingPointerMove: (event: PointerEvent) => void;
  readonly onFloatingPointerUp: (event: PointerEvent) => void;
  readonly onSelectPlacement: (placement: GoalProgressPlacement) => void;
  readonly onToggleMotionPaused: () => void;
  readonly onTogglePlacementSettings: (event: MouseEvent) => void;
  readonly onToggleCollapsed: () => void;
}

function renderDetails(viewModel: GoalProgressViewModel, options: TrackingRenderOptions) {
  return html`
    <div class="content">
      ${renderCurrentSummary(viewModel, options.messages)}
      ${renderObjectiveLists(viewModel, options)}
      ${renderNotices(viewModel, options.messages)}
      ${renderCompletionFooter(viewModel, options)}
    </div>
  `;
}

export function renderTrackingView(
  viewModel: GoalProgressViewModel,
  options: TrackingRenderOptions,
) {
  if (options.placement === "floating") {
    return html`
      <div
        class="floating-shell"
        @pointerdown=${options.onFloatingPointerDown}
        @pointermove=${options.onFloatingPointerMove}
        @pointerup=${options.onFloatingPointerUp}
        @pointercancel=${options.onFloatingPointerCancel}
      >
        ${
          options.collapsed || options.floatingPanelConstrained
            ? null
            : html`<div class="floating-panel">${renderDetails(viewModel, options)}</div>`
        }
        <div
          class="floating-chip"
          role="group"
          aria-label=${options.messages.floatingProgress}
          tabindex="0"
          @keydown=${options.onFloatingKeyDown}
        >
          ${renderOverallProgress(viewModel, {
            compact: true,
            collapsed: options.collapsed,
            toggleDisabled: options.floatingPanelConstrained && !options.collapsed,
            toggleDisabledLabel: options.messages.spaceRestoredAutoExpand,
            onToggleCollapsed: options.onToggleCollapsed,
            messages: options.messages,
          })}
        </div>
      </div>
    `;
  }
  const compact = options.collapsed || options.spaceConstrained;
  return html`
    ${
      compact
        ? renderOverallProgress(viewModel, {
            compact: true,
            collapsed: options.collapsed,
            toggleDisabled: options.spaceConstrained && !options.collapsed,
            onToggleCollapsed: options.onToggleCollapsed,
            messages: options.messages,
          })
        : html`
          ${renderDetails(viewModel, options)}
          ${renderOverallProgress(viewModel, {
            compact: false,
            collapsed: false,
            onToggleCollapsed: options.onToggleCollapsed,
            messages: options.messages,
          })}
        `
    }
  `;
}
