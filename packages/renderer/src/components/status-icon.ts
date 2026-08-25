import { html } from "lit";
import type { GoalProgressViewModel } from "../../../contracts/src/index.js";
import type { GoalProgressMessages } from "../locale.js";
import { type GoalProgressObjectiveView, statusLabel } from "../view-labels.js";

export function renderStatusIcon(
  objective: GoalProgressObjectiveView,
  index: number,
  trackingPhase: GoalProgressViewModel["trackingPhase"],
  messages: GoalProgressMessages,
) {
  const label = statusLabel(objective, messages);
  const phaseStatus =
    objective.status !== "active"
      ? null
      : trackingPhase === "paused"
        ? messages.visiblePaused
        : trackingPhase === "blocked"
          ? messages.visibleBlocked
          : null;
  const accessibleLabel = phaseStatus ?? label;
  const visible =
    phaseStatus ??
    {
      completed: messages.visibleSuccess,
      active: messages.visibleWorking,
      pending: messages.visiblePending,
      blocked: messages.visibleBlocked,
    }[objective.status];
  return html`
    <span class="status-index" aria-hidden="true">${index + 1}.</span>
    <span class="status ${objective.status}" aria-hidden="true">${visible}</span>
    <span class="sr-only">${accessibleLabel}</span>
  `;
}
