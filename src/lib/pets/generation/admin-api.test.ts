import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { readIdempotencyKey, requireGenerationAdmin } from "@/lib/pets/generation/admin-api";

describe("generation admin boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns 403 to non-admins before checking the feature flag", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValue(null);
    vi.mocked(isAdminUser).mockReturnValue(false);
    vi.stubEnv("PET_GENERATION_ENABLED", "false");

    const result = await requireGenerationAdmin();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns 503 to admins while the pilot is disabled", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValue({ userId: "admin", email: null, name: null, role: "admin" });
    vi.mocked(isAdminUser).mockReturnValue(true);
    vi.stubEnv("PET_GENERATION_ENABLED", "false");

    const result = await requireGenerationAdmin();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it("allows private artifact reads while generation is disabled", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValue({ userId: "admin", email: null, name: null, role: "admin" });
    vi.mocked(isAdminUser).mockReturnValue(true);
    vi.stubEnv("PET_GENERATION_ENABLED", "false");
    await expect(requireGenerationAdmin({ requireEnabled: false })).resolves.toMatchObject({ ok: true });
  });

  it("accepts bounded visible idempotency keys and rejects control characters", () => {
    expect(readIdempotencyKey(new Request("http://local", { headers: { "Idempotency-Key": "pilot-1" } })))
      .toEqual({ ok: true, value: "pilot-1" });
    const invalid = readIdempotencyKey(new Request("http://local", { headers: { "Idempotency-Key": "bad\tkey" } }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.response.status).toBe(400);
    const missing = readIdempotencyKey(new Request("http://local"));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.status).toBe(400);
  });
});
