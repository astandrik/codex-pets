import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationError } from "./model";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), principal: vi.fn() }));
vi.mock("@/lib/pets/generation/service", () => ({ petGeneration: { submit: mocks.submit } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentPrincipal: mocks.principal }));
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example"); mocks.principal.mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());
const id = "a".repeat(64);
async function post(origin: string | null = "https://pets.example", headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/pet-generations/[id]/submission/route");
  return POST(new Request("https://pets.example/api/pet-generations/" + id + "/submission", { method: "POST", headers: { ...(origin ? { origin } : {}), ...headers } }), { params: Promise.resolve({ id }) });
}
describe("private generated-pet submission route", () => {
  it("returns only the receipt with private headers for anonymous or signed-in submission", async () => {
    const submission = { petId: "pet_demo", slug: "demo", submittedAt: "2026-10-11T09:00:00Z" };
    mocks.submit.mockResolvedValue(submission);
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ submission });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const principal = { userId: "user-1", email: "private@example.com", name: "Author", role: "user" };
    mocks.principal.mockResolvedValue(principal);
    expect((await post()).status).toBe(201);
  });
  it("rejects missing, cross-site or forged Origins before submission", async () => {
    for (const [origin, headers] of [[null, {}], ["https://evil.example", {}], ["https://pets.example", { "sec-fetch-site": "cross-site" }]] as const) {
      const response = await post(origin, headers);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("invalid_origin");
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("distinguishes unfinished, expired, missing and corrupt results without raw errors", async () => {
    for (const [code, status] of [["generation_not_completed", 409], ["generation_expired", 410], ["not_found", 404], ["invalid_generated_package", 422]] as const) {
      mocks.submit.mockRejectedValueOnce(new GenerationError(code));
      expect((await post()).status).toBe(status);
    }
    mocks.submit.mockRejectedValueOnce(new Error("private YDB details"));
    const failed = await post();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private YDB");
  });
});
