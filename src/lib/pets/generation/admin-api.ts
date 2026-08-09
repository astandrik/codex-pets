import { jsonApiError } from "@/lib/api-error";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { getPetGenerationConfig } from "@/lib/pets/generation/config";
import type { GenerationRunMutationResult } from "@/lib/pets/generation/repository";

export async function requireGenerationAdmin(options: { requireEnabled?: boolean } = {}) {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return { ok: false as const, response: jsonApiError("forbidden", { status: 403, message: "Admin access is required." }) };
  }
  if (options.requireEnabled !== false && !getPetGenerationConfig().enabled) {
    return { ok: false as const, response: jsonApiError("generation_disabled", {
      status: 503,
      message: "Pet generation is disabled.",
      hint: "Use the existing manual request workflow or enable the worker pilot.",
    }) };
  }
  return { ok: true as const, principal };
}
export function generationMutationResponse(result: GenerationRunMutationResult, successStatus = 200): Response {
  if (result.ok) return Response.json({ ok: true, run: result.run }, { status: successStatus });
  return jsonApiError(result.error, { status: result.error === "not_found" ? 404 : 409, message: result.message });
}
export function readIdempotencyKey(req: Request):
  | { ok: true; value: string }
  | { ok: false; response: Response } {
  const value = req.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!value || value.length > 128 || /[^\x21-\x7e]/.test(value)) {
    return { ok: false, response: jsonApiError("invalid_idempotency_key", {
      status: 400,
      message: "Idempotency-Key is required and must contain at most 128 visible ASCII characters.",
    }) };
  }
  return { ok: true, value };
}
