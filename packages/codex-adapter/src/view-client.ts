import {
  type GoalProgressUiIntent,
  type GoalProgressUiPreference,
  type GoalProgressViewModel,
  GoalProgressViewModelSchema,
  migrateGoalProgressUiPreference,
} from "../../contracts/src/index.js";
import { GoalProgressIpcClient } from "../../ipc/src/index.js";

export interface GoalProgressViewState {
  readonly viewModel: GoalProgressViewModel;
  readonly uiPreference: GoalProgressUiPreference;
  readonly dismissed?: boolean;
}

export interface GoalProgressUiIntentState {
  readonly viewModel: GoalProgressViewModel;
  readonly uiPreference: GoalProgressUiPreference;
  readonly dismissed?: boolean;
}

export function parseGoalProgressViewState(result: unknown): GoalProgressViewState {
  if (
    result === null ||
    typeof result !== "object" ||
    !("viewModel" in result) ||
    !("uiPreference" in result)
  ) {
    throw new Error("GOAL_PROGRESS_IPC_VIEW_RESPONSE_INVALID");
  }
  const uiPreference = migrateGoalProgressUiPreference(result.uiPreference);
  if (!uiPreference) {
    throw new Error("GOAL_PROGRESS_IPC_UI_PREFERENCE_INVALID");
  }
  return {
    viewModel: GoalProgressViewModelSchema.parse(result.viewModel),
    uiPreference,
    ...("dismissed" in result && result.dismissed === true ? { dismissed: true } : {}),
  };
}

export class GoalProgressCdpViewClient {
  readonly #client: GoalProgressIpcClient;

  constructor(socketPath: string) {
    this.#client = new GoalProgressIpcClient(socketPath, {
      clientKind: "cdp",
    });
  }

  async getView(sessionId: string): Promise<GoalProgressViewModel> {
    return (await this.getViewState(sessionId)).viewModel;
  }

  async getViewState(sessionId: string): Promise<GoalProgressViewState> {
    const response = await this.#client.request({
      method: "view.get",
      params: { sessionId },
    });
    return parseGoalProgressViewState(response.result);
  }

  async applyUiIntent(
    sessionId: string,
    intent: GoalProgressUiIntent,
  ): Promise<GoalProgressUiIntentState> {
    const response = await this.#client.request({
      method: "ui.intent",
      params: { sessionId, intent },
    });
    return parseGoalProgressViewState(response.result);
  }
}
