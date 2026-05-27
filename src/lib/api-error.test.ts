import { describe, expect, it } from "vitest";

import { buildApiErrorBody, jsonApiError } from "@/lib/api-error";

describe("API error responses", () => {
  it("keeps the legacy error field while adding code, message, and hint", async () => {
    const body = buildApiErrorBody("not_found", {
      message: "The requested pet was not found.",
      hint: "Use /api/pets to list approved pet slugs.",
      field: "slug",
    });

    expect(body).toEqual({
      error: "not_found",
      code: "not_found",
      message: "The requested pet was not found.",
      hint: "Use /api/pets to list approved pet slugs.",
      field: "slug",
    });
  });

  it("returns JSON responses with the structured error body", async () => {
    const response = jsonApiError("invalid_request", {
      status: 400,
      message: "Request is invalid.",
      hint: "Check the OpenAPI schema.",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "invalid_request",
      code: "invalid_request",
      message: "Request is invalid.",
      hint: "Check the OpenAPI schema.",
    });
  });

  it("preserves HeadersInit values from Headers objects", () => {
    const response = jsonApiError("rate_limited", {
      status: 429,
      message: "Too many requests.",
      headers: new Headers([
        ["Retry-After", "30"],
        ["X-Trace-Id", "trace_1"],
      ]),
    });

    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("X-Trace-Id")).toBe("trace_1");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("preserves HeadersInit values from header tuple arrays", () => {
    const response = jsonApiError("conflict", {
      status: 409,
      message: "Resource conflict.",
      headers: [
        ["Cache-Control", "no-store"],
        ["X-Trace-Id", "trace_2"],
      ],
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Trace-Id")).toBe("trace_2");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.has("0")).toBe(false);
  });
});
