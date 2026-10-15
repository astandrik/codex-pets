import { describe, expect, it } from "vitest";

import { readJsonResponse } from "@/lib/read-json-response";

describe("readJsonResponse", () => {
  it("returns a JSON payload or an empty response object", async () => {
    await expect(readJsonResponse(Response.json({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(readJsonResponse(new Response(null, { status: 204 }))).resolves.toEqual({});
  });

  it.each([
    [{ message: "Friendly message", error: "error_code" }, "Friendly message"],
    [{ message: null, error: "error_code" }, "error_code"],
    [{}, "Request failed 503"],
    [null, "Request failed 503"],
  ])("selects the error message from %j", async (body, message) => {
    await expect(readJsonResponse(Response.json(body, { status: 503 }))).rejects.toThrow(message);
  });

  it("retains the caller's fallback wording", async () => {
    await expect(readJsonResponse(new Response(null, { status: 503 }), "Upload failed 503"))
      .rejects.toThrow("Upload failed 503");
  });

  it.each([undefined, "Upload failed 503"])("retains HTTP failure context for a non-JSON body (%s)", async (fallback) => {
    await expect(readJsonResponse(new Response("<html>Service unavailable</html>", { status: 503 }), fallback))
      .rejects.toThrow(fallback ?? "Request failed 503");
  });

  it("rejects malformed JSON instead of treating it as success", async () => {
    await expect(readJsonResponse(new Response("not-json"))).rejects.toBeInstanceOf(SyntaxError);
  });
});
