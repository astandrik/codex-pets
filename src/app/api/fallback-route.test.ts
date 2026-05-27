import { describe, expect, it } from "vitest";

describe("unmatched public API routes", () => {
  it("returns structured JSON for unmatched nested API routes", async () => {
    const { GET } = await import("@/app/api/[...path]/route");

    const response = GET();

    await expectStructuredApiNotFound(response);
  });

  it("returns structured JSON for the API root route", async () => {
    const { GET } = await import("@/app/api/route");

    const response = GET();

    await expectStructuredApiNotFound(response);
  });
});

async function expectStructuredApiNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  await expect(response.json()).resolves.toEqual({
    error: "not_found",
    code: "not_found",
    message: "API route not found.",
    hint: "Use /openapi.json or /docs/api to discover supported Codex Pets API routes.",
  });
}
