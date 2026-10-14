import { GenerationError } from "@/lib/pets/generation/model";
import { buildApiErrorBody } from "@/lib/api-error";
import { publicGenerationError } from "@/lib/pets/generation/public-error";

export const GENERATION_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function assertGenerationOrigin(request: Request) {
  const expected = new URL(process.env.PET_GENERATION_FORM_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new GenerationError("invalid_origin");
}

export function generationHttpError(error: unknown, admission = false) {
  const code = error instanceof GenerationError ? error.code : "generation_unavailable";
  const status = admission && code === "invalid_origin" ? 403 : admission && code === "body_too_large" ? 413 : admission && code === "invalid_argument" ? 400 : ["request_id_conflict","generation_not_completed","metadata_conflict","metadata_locked"].includes(code) ? 409 : code === "invalid_generated_package" ? 422 : ["rate_limited", "budget_exhausted", "queue_full"].includes(code) ? 429 : code === "generation_expired" ? 410 : code === "not_found" || code === "invalid_argument" ? 404 : 503;
  const detail = publicGenerationError(code, error instanceof GenerationError ? error.providerFailure : undefined, error instanceof GenerationError ? error.limitScope : undefined);
  return Response.json({ ...buildApiErrorBody(detail.code, { message: detail.message, hint: detail.hint }),
    ...(detail.limitScope ? { limitScope: detail.limitScope } : {}),
    ...(error instanceof GenerationError && error.retryAt ? { retryAt: error.retryAt } : {}),
  }, { status, headers: GENERATION_HEADERS });
}

export async function readGenerationJson(request:Request,maxBytes:number):Promise<unknown>{
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new GenerationError("invalid_argument");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new GenerationError("invalid_argument");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GenerationError("body_too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown; }
  catch { throw new GenerationError("invalid_argument"); }
}
