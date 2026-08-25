export interface GoalProgressActivationInput {
  readonly objectiveBody: string | null;
  readonly nativeGoal: { readonly objective: string } | null;
  readonly contractExists: boolean;
  readonly replacementRequested?: boolean;
}

export type GoalProgressActivationPlan =
  | {
      readonly branch: "A";
      readonly nativeGoalAction: "create";
      readonly progressAction: "initialize";
      readonly preparing: true;
      readonly code: "ACTIVATION_CREATE_NATIVE_GOAL";
    }
  | {
      readonly branch: "B";
      readonly nativeGoalAction: "attach";
      readonly progressAction: "initialize" | "get";
      readonly preparing: boolean;
      readonly code: "ACTIVATION_ATTACH_EXISTING_GOAL";
    }
  | {
      readonly branch: "C";
      readonly nativeGoalAction: "attach";
      readonly progressAction: "initialize" | "get";
      readonly preparing: boolean;
      readonly code: "ACTIVATION_ATTACH_SAME_OBJECTIVE";
    }
  | {
      readonly branch: "D";
      readonly nativeGoalAction: "report-conflict" | "wait-for-verified-replacement";
      readonly progressAction: "none";
      readonly preparing: false;
      readonly code: "NATIVE_GOAL_OBJECTIVE_CONFLICT" | "NATIVE_GOAL_REPLACE_UNAVAILABLE";
    }
  | {
      readonly branch: "E";
      readonly nativeGoalAction: "request-objective";
      readonly progressAction: "none";
      readonly preparing: false;
      readonly code: "ACTIVATION_OBJECTIVE_REQUIRED";
    };

export const GOAL_PROGRESS_SKILL_MARKER = "$codex-goal-progress:goal-progress";

export function normalizeGoalProgressObjectiveBody(
  input: string | null | undefined,
): string | null {
  if (input === null || input === undefined) {
    return null;
  }
  const objectiveBody = input
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== GOAL_PROGRESS_SKILL_MARKER)
    .join("\n")
    .trim();
  return objectiveBody.length > 0 ? objectiveBody : null;
}

export function planGoalProgressActivation(
  input: GoalProgressActivationInput,
): GoalProgressActivationPlan {
  const objectiveBody = normalizeGoalProgressObjectiveBody(input.objectiveBody);
  if (!input.nativeGoal) {
    return objectiveBody
      ? {
          branch: "A",
          nativeGoalAction: "create",
          progressAction: "initialize",
          preparing: true,
          code: "ACTIVATION_CREATE_NATIVE_GOAL",
        }
      : {
          branch: "E",
          nativeGoalAction: "request-objective",
          progressAction: "none",
          preparing: false,
          code: "ACTIVATION_OBJECTIVE_REQUIRED",
        };
  }

  const progressAction = input.contractExists ? "get" : "initialize";
  const preparing = !input.contractExists;
  if (!objectiveBody) {
    return {
      branch: "B",
      nativeGoalAction: "attach",
      progressAction,
      preparing,
      code: "ACTIVATION_ATTACH_EXISTING_GOAL",
    };
  }
  if (objectiveBody === input.nativeGoal.objective) {
    return {
      branch: "C",
      nativeGoalAction: "attach",
      progressAction,
      preparing,
      code: "ACTIVATION_ATTACH_SAME_OBJECTIVE",
    };
  }
  return input.replacementRequested
    ? {
        branch: "D",
        nativeGoalAction: "wait-for-verified-replacement",
        progressAction: "none",
        preparing: false,
        code: "NATIVE_GOAL_REPLACE_UNAVAILABLE",
      }
    : {
        branch: "D",
        nativeGoalAction: "report-conflict",
        progressAction: "none",
        preparing: false,
        code: "NATIVE_GOAL_OBJECTIVE_CONFLICT",
      };
}
