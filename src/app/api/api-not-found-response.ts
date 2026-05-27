import { jsonApiError } from "@/lib/api-error";

const NOT_FOUND_HINT =
  "Use /openapi.json or /docs/api to discover supported Codex Pets API routes.";

export function apiNotFoundResponse(): Response {
  return jsonApiError("not_found", {
    status: 404,
    message: "API route not found.",
    hint: NOT_FOUND_HINT,
  });
}
