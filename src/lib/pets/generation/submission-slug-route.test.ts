import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationError } from "./model";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), principal: vi.fn() }));
vi.mock("@/lib/pets/generation/service", () => ({ petGeneration: { submit: mocks.submit, checkSubmissionSlug: mocks.check } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentPrincipal: mocks.principal }));
const id = "a".repeat(64);
const receipt = { petId: "pet_lumi", slug: "lumi", submittedAt: "2026-10-11T09:00:00Z" };
type Mode = "check" | "submit";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
  mocks.principal.mockResolvedValue(null); mocks.submit.mockResolvedValue(receipt);
  mocks.check.mockResolvedValue({ available: true, suggestedSlug: "lumi" });
});
afterEach(() => vi.unstubAllEnvs());
async function invoke(mode: Mode, request: Request) {
  if (mode === "check") {
    const { POST } = await import("@/app/api/pet-generations/[id]/submission/slug-check/route");
    return POST(request, { params: Promise.resolve({ id }) });
  }
  const { PUT } = await import("@/app/api/pet-generations/[id]/submission/route");
  return PUT(request, { params: Promise.resolve({ id }) });
}
function request(mode: Mode, body = '{"slug":"lumi"}', headers: Record<string, string> = {}) {
  return new Request(`https://pets.example/api/pet-generations/${id}/submission${mode === "check" ? "/slug-check" : ""}`, {
    method: mode === "check" ? "POST" : "PUT", body,
    headers: { origin: "https://pets.example", "content-type": "application/json", ...headers },
  });
}

describe.each(["check", "submit"] as const)("private generated-pet slug %s", (mode) => {
  it("uses the capability ID, preserves private headers and returns the exact service result", async () => {
    const response = await invoke(mode, request(mode));
    expect(response.status).toBe(mode === "check" ? 200 : 201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.json()).toEqual(mode === "check" ? { available: true, suggestedSlug: "lumi" } : { submission: receipt });
    if (mode === "check") { expect(mocks.check).toHaveBeenCalledWith(id, "lumi"); expect(mocks.submit).not.toHaveBeenCalled(); }
    else expect(mocks.submit).toHaveBeenCalledWith(id, null, "lumi");
  });
  it("rejects cross-site or missing origin before parsing or calling the service", async () => {
    const cases: Record<string, string>[] = [{ origin: "https://evil.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of cases) {
      expect((await invoke(mode, request(mode, '{"slug":"lumi"}', headers))).status).toBe(403);
    }
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects bad JSON/shape/content type without revealing its input", async () => {
    for (const body of ["{", "null", "[]", '{"slug":7}', '{"slug":"lumi","private":"secret"}']) {
      const response = await invoke(mode, request(mode, body));
      expect(response.status).toBe(400); expect(await response.text()).not.toContain("secret");
    }
    expect((await invoke(mode, request(mode, '{"slug":"lumi"}', { "content-type": "application/json-bogus" }))).status).toBe(400);
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("enforces the streamed 1KiB limit regardless of a forged Content-Length", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(800).fill(32)); controller.enqueue(new Uint8Array(225).fill(32));
    }, cancel() { cancelled = true; } });
    const init: RequestInit & { duplex: "half" } = { method: mode === "check" ? "POST" : "PUT", body: stream, duplex: "half",
      headers: { origin: "https://pets.example", "content-type": "application/json", "content-length": "1" } };
    const response = await invoke(mode, new Request("https://pets.example/", init));
    expect(response.status).toBe(413); expect(cancelled).toBe(true);
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
    const short = '{"slug":"lumi"}';
    expect((await invoke(mode, request(mode, short.padEnd(1024)))).status).toBe(mode === "check" ? 200 : 201);
  });
  it("preserves completed/expiry checks and sanitizes unknown service errors", async () => {
    const service = mode === "check" ? mocks.check : mocks.submit;
    for (const [code, status] of [["generation_not_completed", 409], ["generation_expired", 410], ["not_found", 404],
      ["invalid_public_slug", 400], ["public_slug_unavailable", 409]] as const) {
      service.mockRejectedValueOnce(new GenerationError(code));
      expect((await invoke(mode, request(mode))).status).toBe(status);
    }
    service.mockRejectedValueOnce(new Error("private YDB rows and prompt"));
    const response = await invoke(mode, request(mode));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("YDB rows");
  });
  it("allows the service to return the immutable receipt before validating a new draft", async () => {
    mocks.check.mockResolvedValueOnce({ available: true, suggestedSlug: "lumi", submission: receipt });
    const response = await invoke(mode, request(mode, '{"slug":"invalid/different-draft"}'));
    expect(response.status).toBe(mode === "check" ? 200 : 201);
    expect(await response.json()).toEqual(mode === "check" ? { available: true, suggestedSlug: "lumi", submission: receipt } : { submission: receipt });
  });
});

it("forwards the selected metadata revision on the new submission path",async()=>{
 const response=await invoke("submit",request("submit",'{"slug":"lumi","metadataRevision":2}'));
 expect(response.status).toBe(201);expect(mocks.submit).toHaveBeenCalledWith(id,null,"lumi",2);
});
