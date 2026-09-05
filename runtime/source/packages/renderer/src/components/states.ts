import { html } from "lit";
import type { GoalProgressViewModel } from "../../../contracts/src/index.js";
import type { GoalProgressMessages } from "../locale.js";

export function renderPreparingView(
  viewModel: GoalProgressViewModel,
  messages: GoalProgressMessages,
) {
  const title =
    viewModel.preparingStep === "reading-goal"
      ? messages.preparingReadGoal
      : viewModel.preparingStep === "establishing-baseline"
        ? messages.preparingBaseline
        : messages.preparingObjectives;
  return html`
    <div class="state" role="status" aria-live="polite">
      <div>
        <div class="state-symbol preparing" aria-hidden="true"></div>
        <div class="state-title">${title}</div>
        <div class="state-copy">${messages.preparingCopy}</div>
      </div>
    </div>
  `;
}

export function renderErrorView(
  viewModel: GoalProgressViewModel | null,
  onRetry: () => void,
  onDetach: () => void,
  messages: GoalProgressMessages,
) {
  const errorCode = viewModel?.errorCode ?? "VIEW_MODEL_UNAVAILABLE";
  return html`
    <div class="state" role="alert">
      <div>
        <div class="state-symbol error" aria-hidden="true">!</div>
        <div class="state-title">${messages.unavailableTitle}</div>
        <div class="state-copy">${messages.unavailableCopy}</div>
        <code class="error-code">${errorCode}</code>
        <div class="state-actions">
          <button
            class="icon-button retry-button"
            type="button"
            aria-label=${messages.retryProgress}
            title=${messages.retry}
            @click=${onRetry}
          >
            ↻
          </button>
          <button
            class="icon-button detach-button"
            type="button"
            aria-label=${messages.closeProgress}
            title=${messages.closeProgress}
            @click=${onDetach}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  `;
}
