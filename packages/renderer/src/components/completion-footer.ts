import { html } from "lit";
import type { GoalProgressPlacement, GoalProgressViewModel } from "../../../contracts/src/index.js";
import type { GoalProgressMessages } from "../locale.js";
import { renderTokenUsage } from "./token-usage.js";

export interface CompletionFooterRenderOptions {
  readonly motionPaused: boolean;
  readonly onSelectPlacement: (placement: GoalProgressPlacement) => void;
  readonly onToggleMotionPaused: () => void;
  readonly onTogglePlacementSettings: (event: MouseEvent) => void;
  readonly placement: GoalProgressPlacement;
  readonly requestedPlacement: GoalProgressPlacement;
  readonly settingsOpen: boolean;
  readonly messages: GoalProgressMessages;
  readonly locale: string;
}

export function renderCompletionFooter(
  viewModel: GoalProgressViewModel,
  options: CompletionFooterRenderOptions,
) {
  const completedCount = viewModel.objectives.filter(
    (objective) => objective.status === "completed",
  ).length;
  return html`
    <footer class="completion-footer">
      <span class="completion-count">
        ${options.messages.completionCount(completedCount, viewModel.objectives.length)}
      </span>
      <span class="footer-actions">
        ${renderTokenUsage(viewModel.token, options.messages, options.locale)}
        <span class="placement-settings">
          <button
            class="placement-settings-trigger"
            type="button"
            aria-label=${options.messages.placementSettingsTriggerLabel}
            aria-haspopup="menu"
            aria-expanded=${String(options.settingsOpen)}
            title=${options.messages.displaySettings}
            @click=${options.onTogglePlacementSettings}
          >
            <svg class="more-icon" viewBox="0 0 1024 1024" aria-hidden="true">
              <path
                d="M750.3 128.8h.3-.3m-459.2 29.3C326.7 227 397.9 265.8 491 265.8c10.9 0 19-.5 25.1-1.1 4.8.6 10.7 1.1 24.6 1.1 91.8 0 162-38.7 197.2-107.5l218.9 189.5c.8 1.5 2.3 5.1 1.2 10.1-3 13.8-23.5 30.8-55 45.5-.9.4-1.8.8-2.6 1.3-4.4 2.2-40.5 20.4-58.4 28.9-3.5 1.7-7.5 3.3-11.8 5-12.1 4.9-23.8 9.9-33.7 16.8-20.5 14.2-31.2 38.7-27.6 63.4 13.2 90.7 29.2 287.8 30 298.2-.3 1.5-1.6 5.6-6.6 11.3-18.3 20.8-78.5 55.6-276.3 55.6-201.6 0-262.5-35.1-280.9-56-6-6.8-6.3-11.1-6.1-13.1.1-1.9 16.5-202.9 30.2-295.7 3.7-24.9-7.2-49.6-28-63.8-10-6.8-21.8-11.8-35.1-17.1-3.8-1.5-7.5-3-10.9-4.6-20-9.4-61.4-29.9-63.2-30.8-31.4-14.4-51.8-31.2-54.8-45-1-4.8.4-8.4 1.2-9.8l222.7-189.9m438.3-79.8c-3.9 0-7.7.5-11.5 1.6-14 3.9-25.2 14.5-29.8 28.2-26.7 80.2-103.8 92.1-147.4 92.1-11.4 0-15-.4-18.8-.9-1.9-.3-3.9-.4-5.9-.4-1.9 0-3.8.1-5.6.3-.1 0-7.6 1-19.4 1-44.5 0-123.1-12-150.2-92.3-4.6-13.7-15.7-24.2-29.7-28.1-3.8-1.1-7.7-1.6-11.6-1.6-10.3 0-20.3 3.6-28.3 10.5L23.9 299.9c-1.6 1.4-3.1 2.9-4.6 4.5C7.5 318-3 342.8 3.2 371.6c7.7 35.9 38.9 66.7 91.5 90.9 0 0 42.3 21 62.7 30.6 5 2.3 10 4.4 15.1 6.4 6.2 2.5 16.8 6.8 21.8 10.2-13.8 93.4-30.2 293.8-30.7 300.3-.9 7.4-2.1 33.6 22.3 61.3 46.3 52.6 154.3 78.2 330.1 78.2 172.9 0 279.3-25.4 325.5-77.8 24.6-27.9 23.5-54.3 22.7-59.7-.7-8.5-16.8-208.3-30.5-302.6 4.9-3.4 15.3-7.6 21.3-10.1 5.4-2.2 10.5-4.3 14.9-6.4 19.8-9.5 60.7-30 60.7-30 53-24.7 83.8-55.3 91.5-91.1 6.2-28.7-4.1-53.5-15.9-67.2-1.4-1.6-2.9-3.1-4.5-4.5L757.9 88.9c-8-6.9-18.1-10.6-28.5-10.6z"
              ></path>
            </svg>
          </button>
          ${
            options.settingsOpen
              ? html`
                <span
                  class="placement-menu"
                  role="menu"
                  aria-label=${options.messages.placementSettingsLabel}
                >
                  <span class="placement-menu-title">${options.messages.displaySettings}</span>
                  <span class="placement-menu-divider" aria-hidden="true"></span>
                  <button
                    class="motion-setting"
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked=${String(!options.motionPaused)}
                    @click=${options.onToggleMotionPaused}
                  >
                    <span>${options.messages.animationEffects}</span>
                    <span
                      class="motion-switch"
                      data-on=${String(!options.motionPaused)}
                      aria-hidden="true"
                    ><span class="motion-switch-knob"></span></span>
                  </button>
                  <span class="placement-menu-divider" aria-hidden="true"></span>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked=${String(options.requestedPlacement === "inline")}
                    @click=${() => options.onSelectPlacement("inline")}
                  >${options.messages.fixedDisplay}</button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked=${String(options.requestedPlacement === "floating")}
                    @click=${() => options.onSelectPlacement("floating")}
                  >${options.messages.floatingDisplay}</button>
                </span>
              `
              : null
          }
        </span>
      </span>
    </footer>
  `;
}
