import { z } from "zod";
import {
  GoalContractInitializationSchema,
  GoalProgressCommandSchema,
  GoalProgressUpdateIntentSchema,
  GoalProgressUpdateRestartResultSchema,
  GoalProgressUpdateWorkerResultSchema,
  GoalProgressViewModelSchema,
  RuntimeContextSchema,
  RuntimeProofSchema,
} from "../../contracts/src/index.js";

export const GOAL_PROGRESS_IPC_PROTOCOL_VERSION = 4 as const;
export const GOAL_PROGRESS_IPC_MAX_MESSAGE_BYTES = 1_048_576;
export const GoalProgressRendererTargetIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);

export const GoalProgressActivationResumeResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("active"),
      contractId: z.string().trim().min(1).max(128),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("inactive"),
    })
    .strict(),
  z
    .object({
      status: z.literal("temporarily_unavailable"),
      reasonCode: z.string().trim().min(1).max(128),
    })
    .strict(),
]);

const RequestEnvelopeFields = {
  protocolVersion: z.literal(GOAL_PROGRESS_IPC_PROTOCOL_VERSION),
  requestId: z.string().trim().min(1).max(128),
};

export const GoalProgressIpcRequestSchema = z.discriminatedUnion("method", [
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("hello"),
      params: z
        .object({
          clientKind: z.enum(["hook", "mcp", "cdp", "doctor", "updater"]),
          clientVersion: z.string().trim().min(1).max(64),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("ping"),
      params: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("runtime-proof.issue"),
      params: z
        .object({
          runtimeContext: RuntimeContextSchema,
          toolUseId: z.string().trim().min(1).max(256),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("runtime-proof.consume"),
      params: z
        .object({
          runtimeContext: RuntimeContextSchema,
          runtimeProof: RuntimeProofSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("hook.audit"),
      params: z.discriminatedUnion("event", [
        z
          .object({
            event: z.literal("NativeGoalCompleted"),
            hookSessionId: z.string().trim().min(1).max(256),
            turnId: z.string().trim().min(1).max(256),
            model: z.string().trim().min(1).max(256),
            cwd: z.string().trim().min(1).max(4096),
            toolUseId: z.string().trim().min(1).max(256),
          })
          .strict(),
        z
          .object({
            event: z.literal("ResumeTemporarilyUnavailable"),
            hookSessionId: z.string().trim().min(1).max(256),
            reasonCode: z.string().trim().min(1).max(128),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("activation.resume"),
      params: z
        .object({
          hookSessionId: z.string().trim().min(1).max(256),
          model: z.string().trim().min(1).max(256),
          cwd: z.string().trim().min(1).max(4096),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("activation.plan"),
      params: z
        .object({
          runtimeContext: RuntimeContextSchema,
          runtimeProof: RuntimeProofSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("store.load"),
      params: z
        .object({
          sessionId: z.string().trim().min(1).max(256),
          runtimeContext: RuntimeContextSchema,
          runtimeProof: RuntimeProofSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("store.initialize"),
      params: z
        .object({
          initialization: GoalContractInitializationSchema,
          metadata: z
            .object({
              eventId: z.string().trim().min(1).max(128),
              requestId: z.string().trim().min(1).max(128),
              turnId: z.string().trim().min(1).max(256),
              occurredAt: z.string().datetime({ offset: true }),
              source: z.enum(["model", "user", "local-validator", "system"]),
            })
            .strict(),
          runtimeContext: RuntimeContextSchema,
          runtimeProof: RuntimeProofSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("store.apply"),
      params: z
        .object({
          command: GoalProgressCommandSchema,
          runtimeContext: RuntimeContextSchema,
          runtimeProof: RuntimeProofSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("view.get"),
      params: z.object({ sessionId: z.string().trim().min(1).max(256) }).strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("renderer.visible-thread"),
      params: z
        .object({
          targetId: GoalProgressRendererTargetIdSchema,
          threadId: z
            .string()
            .trim()
            .min(1)
            .max(256)
            .refine((value) => !value.startsWith("client-new-thread:"))
            .nullable(),
          sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
          lifecycleId: z
            .string()
            .regex(/^[A-Za-z0-9_-]{32}$/u)
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("renderer.disconnected"),
      params: z
        .object({
          targetId: GoalProgressRendererTargetIdSchema,
          code: z
            .string()
            .trim()
            .regex(/^[A-Z][A-Z0-9_]{2,127}$/u),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("ui.intent"),
      params: z
        .object({
          sessionId: z.string().trim().min(1).max(256),
          intent: z.unknown(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("update.intent"),
      params: z
        .object({
          sessionId: z.string().trim().min(1).max(256),
          intent: GoalProgressUpdateIntentSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("update.worker-result"),
      params: GoalProgressUpdateWorkerResultSchema,
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("update.restart-result"),
      params: GoalProgressUpdateRestartResultSchema,
    })
    .strict(),
  z
    .object({
      ...RequestEnvelopeFields,
      method: z.literal("doctor"),
      params: z
        .object({
          sessionId: z.string().trim().min(1).max(256).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const GoalProgressIpcSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    protocolVersion: z.literal(GOAL_PROGRESS_IPC_PROTOCOL_VERSION),
    requestId: z.string().trim().min(1).max(128),
    revision: z.number().int().nonnegative().nullable(),
    result: z.unknown(),
  })
  .strict();

export const GoalProgressIpcErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    protocolVersion: z.literal(GOAL_PROGRESS_IPC_PROTOCOL_VERSION),
    requestId: z.string().trim().min(1).max(128),
    revision: z.number().int().nonnegative().nullable(),
    code: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(500),
    currentViewModel: GoalProgressViewModelSchema.optional(),
  })
  .strict();

export const GoalProgressIpcProtocolMismatchResponseSchema = z
  .object({
    ok: z.literal(false),
    protocolVersion: z.number().int().nonnegative(),
    requestId: z.string().trim().min(1).max(128),
    revision: z.number().int().nonnegative().nullable(),
    code: z.literal("PROTOCOL_VERSION_MISMATCH"),
    message: z.string().trim().min(1).max(500),
  })
  .passthrough();

export const GoalProgressIpcResponseSchema = z.discriminatedUnion("ok", [
  GoalProgressIpcSuccessResponseSchema,
  GoalProgressIpcErrorResponseSchema,
]);

export type GoalProgressIpcRequest = z.infer<typeof GoalProgressIpcRequestSchema>;
export type GoalProgressActivationResumeResult = z.infer<
  typeof GoalProgressActivationResumeResultSchema
>;
type WithoutRequestEnvelope<T> = T extends unknown
  ? Omit<T, "protocolVersion" | "requestId">
  : never;
export type GoalProgressIpcRequestInput = WithoutRequestEnvelope<GoalProgressIpcRequest>;
export type GoalProgressIpcResponse = z.infer<typeof GoalProgressIpcResponseSchema>;
export type GoalProgressIpcSuccessResponse = z.infer<typeof GoalProgressIpcSuccessResponseSchema>;
export type GoalProgressIpcMethod = GoalProgressIpcRequest["method"];
export type GoalProgressIpcClientKind = Extract<
  GoalProgressIpcRequest,
  { method: "hello" }
>["params"]["clientKind"];
