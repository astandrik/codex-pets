import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { jsonApiError } from "@/lib/api-error";
import { GenerationError } from "./model";
import { assertGenerationOrigin, GENERATION_HEADERS } from "./http";

async function readQuotaBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new GenerationError("invalid_argument");
  const reader = request.body?.getReader();
  if (!reader) throw new GenerationError("invalid_argument");
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 1024) { await reader.cancel(); throw new GenerationError("body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GenerationError("invalid_argument"); }
}
const ERRORS: Record<string, { status: number; message: string }> = {
  invalid_origin: { status: 403, message: "Open this action from the Pets admin page." },
  invalid_argument: { status: 400, message: "Enter a valid IP address and a positive whole number of attempts." },
  body_too_large: { status: 413, message: "The request is too large." },
  quota_day_changed: { status: 409, message: "The Moscow day changed. Check the current quota before issuing another grant." },
  quota_grant_limit: { status: 409, message: "The total allowance is too large. Enter a smaller number of attempts." },
  request_id_conflict: { status: 409, message: "This grant ID already belongs to another request. Check the saved receipt before proceeding." },
};
export async function adminQuotaAction(request: Request, action: (body: unknown, actorId: string) => Promise<object>) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal || !isAdminUser(principal)) return jsonApiError("forbidden", { status:403, message:"Admin sign-in required.", headers:GENERATION_HEADERS });
    assertGenerationOrigin(request);
    const body = await readQuotaBody(request);
    return Response.json(await action(body, principal.userId), { headers: GENERATION_HEADERS });
  } catch (error) {
    const code = error instanceof GenerationError && Object.hasOwn(ERRORS, error.code) ? error.code : "quota_unavailable";
    const detail = ERRORS[code] ?? { status:503, message:"Could not confirm the quota operation. Retry the same request; do not create a second grant." };
    return jsonApiError(code, { ...detail, headers: GENERATION_HEADERS });
  }
}
