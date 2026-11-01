import { createHash } from "node:crypto";
import { z } from "zod";
import type { StageName } from "./model";
import {REGENERATION_RETRIES} from "@/lib/pets/generation/continuation-model";

const REQUEST_ID_PATTERN = /^(?:req_[a-f0-9]{32}|[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const CF_RAY_PATTERN = /^[a-f0-9]{12,32}-[A-Z]{3}$/;
const DIAGNOSTIC_PREFIX = "PET_HTTP_DIAGNOSTIC ";
const MAX_DIAGNOSTIC_LINE_LENGTH = 4096;
const byteCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const httpDiagnosticSchema = z.object({
  status: z.number().int().min(100).max(599).nullable(),
  expectedBodyBytes: byteCount.nullable(),
  receivedBodyBytes: byteCount,
  receivedBodyBytesExact: z.boolean(),
  bodyComplete: z.boolean(),
  chunked: z.boolean(),
  phase: z.enum(["before_headers", "body", "complete"]),
  requestId: z.string().regex(REQUEST_ID_PATTERN).nullable(),
  cfRay: z.string().regex(CF_RAY_PATTERN).nullable(),
});
export type HttpDiagnostic = z.infer<typeof httpDiagnosticSchema>;

export function readHttpDiagnostic(value: unknown): HttpDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(httpDiagnosticSchema.shape)) {
    if (Object.hasOwn(value, key)) fields[key] = Reflect.get(value, key);
  }
  fields.requestId = readDiagnosticIdentifier(fields.requestId, REQUEST_ID_PATTERN);
  fields.cfRay = readDiagnosticIdentifier(fields.cfRay, CF_RAY_PATTERN);
  const parsed = httpDiagnosticSchema.safeParse(fields);
  return parsed.success ? parsed.data : undefined;
}

function readDiagnosticIdentifier(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

export function logSpriteHttpDiagnostic(
  stderr: string,
  context: { generationId: string; stage: StageName; attempt: number },
  write: (line: string) => void = console.log,
): void {
  try {
    if (!Number.isInteger(context.attempt) || context.attempt < 1 || context.attempt > REGENERATION_RETRIES.max + 1) return;
    for (const line of stderr.split("\n")) {
      if (!line.startsWith(DIAGNOSTIC_PREFIX) || line.length > MAX_DIAGNOSTIC_LINE_LENGTH) continue;
      let input: unknown;
      try {
        input = JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length));
      } catch {
        continue;
      }
      const diagnostic = readHttpDiagnostic(input);
      if (!diagnostic) continue;
      write(JSON.stringify({
        operation: "pet-generation-http",
        at: Date.now(),
        targetHash: createHash("sha256").update(context.generationId).digest("hex"),
        stage: context.stage,
        attempt: context.attempt,
        ...diagnostic,
      }));
      return;
    }
  } catch {
    // Diagnostics must never turn a provider result into another paid attempt.
  }
}
