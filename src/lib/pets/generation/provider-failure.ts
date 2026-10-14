import { z } from "zod";
import providerErrorCodes from "./provider-error-codes.json" with { type: "json" };

const codes = new Set(providerErrorCodes);
export const providerFailureSchema = z.object({
  httpStatus: z.number().int().min(400).max(599),
  code: z.string().refine(value => codes.has(value)).optional(),
  moderationStage: z.enum(["input", "output", "unknown"]).optional(),
}).strict();
export type ProviderFailure = z.infer<typeof providerFailureSchema>;

// Provider messages and arbitrary identifier-shaped strings can contain private input.
export function readProviderFailure(value: unknown): ProviderFailure | undefined {
  if (!value || typeof value !== "object" || !("httpStatus" in value)) return undefined;
  const candidate = {
    httpStatus: value.httpStatus,
    ...("code" in value && typeof value.code === "string" ? { code: codes.has(value.code) ? value.code : "unrecognized" } : {}),
    ...("moderationStage" in value && typeof value.moderationStage === "string" && ["input", "output", "unknown"].includes(value.moderationStage) ? { moderationStage: value.moderationStage } : {}),
  };
  const result = providerFailureSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}
