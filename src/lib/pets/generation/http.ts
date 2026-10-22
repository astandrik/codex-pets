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
  const status = generationHttpStatus(code, admission);
  const detail = publicGenerationError(code, error instanceof GenerationError ? error.providerFailure : undefined, error instanceof GenerationError ? error.limitScope : undefined);
  return Response.json({ ...buildApiErrorBody(detail.code, { message: detail.message, hint: detail.hint }),
    ...(detail.limitScope ? { limitScope: detail.limitScope } : {}),
    ...(error instanceof GenerationError && error.retryAt ? { retryAt: error.retryAt } : {}),
  }, { status, headers: GENERATION_HEADERS });
}

function generationHttpStatus(code: string, admission: boolean): number {
  switch (code) {
    case "invalid_origin": return admission ? 403 : 503;
    case "body_too_large": return admission ? 413 : 503;
    case "invalid_argument": return admission ? 400 : 404;
    case "continuation_busy":
    case "continuation_source_conflict":
    case "continuation_selection_conflict":
    case "request_id_conflict":
    case "generation_not_completed":
    case "metadata_conflict":
    case "metadata_locked":
    case "animation_revision_not_accepted": return 409;
    case "animation_corrections_limit": return 400;
    case "base_not_ready": return 409;
    case "invalid_reference_image": return 400;
    case "reference_image_too_large": return 413;
    case "invalid_generated_package": return 422;
    case "continuation_limit":
    case "continuation_cooldown":
    case "rate_limited":
    case "budget_exhausted":
    case "queue_full": return 429;
    case "generation_expired": return 410;
    case "not_found": return 404;
    default: return 503;
  }
}

export async function readGenerationJson(request:Request,maxBytes:number,allowEmpty=false):Promise<unknown>{
  const isJson = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
  if (!isJson && !allowEmpty) throw new GenerationError("invalid_argument");
  const bytes = allowEmpty && !request.body ? Buffer.alloc(0) : await readGenerationBody(request, maxBytes);
  if (allowEmpty && bytes.length === 0) return {};
  if (!isJson) throw new GenerationError("invalid_argument");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new GenerationError("invalid_argument"); }
}

export async function readGenerationBody(request: Request, maxBytes: number): Promise<Buffer> {
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
  return Buffer.concat(chunks);
}
