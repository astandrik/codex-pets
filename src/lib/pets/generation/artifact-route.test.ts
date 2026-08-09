import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/generation/admin-api", () => ({
  requireGenerationAdmin: vi.fn(),
}));
vi.mock("@/lib/pets/generation/repository", () => ({
  getGenerationRunById: vi.fn(),
  readGenerationArtifact: vi.fn(),
}));

import { GET } from "@/app/api/admin/generation-runs/[id]/artifacts/[key]/route";
import { requireGenerationAdmin } from "@/lib/pets/generation/admin-api";
import { getGenerationRunById, readGenerationArtifact } from "@/lib/pets/generation/repository";

describe("private generation artifact route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireGenerationAdmin).mockResolvedValue({
      ok: true,
      principal: { userId: "admin", email: null, name: null, role: "admin" },
    });
  });

  it("never exposes pre-moderation worker artifacts", async () => {
    const response = await GET(new Request("http://local"), {
      params: Promise.resolve({ id: "run_1", key: "work-base-r0-t0" }),
    });
    expect(response.status).toBe(404);
    expect(getGenerationRunById).not.toHaveBeenCalled();
    expect(readGenerationArtifact).not.toHaveBeenCalled();
  });

  it("serves a moderated artifact only through the admin boundary", async () => {
    vi.mocked(getGenerationRunById).mockResolvedValue({ id: "run_1" } as never);
    vi.mocked(readGenerationArtifact).mockResolvedValue({
      metadata: {
        runId: "run_1", key: "base", stage: "base", fileName: "unsafe\"name.png",
        contentType: "image/png", byteSize: 3, sha256: "0".repeat(64),
        createdAt: "now", expiresAt: "later", retained: false,
      },
      buffer: Buffer.from([1, 2, 3]),
    });
    const response = await GET(new Request("http://local"), {
      params: Promise.resolve({ id: "run_1", key: "base" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe("inline; filename=\"unsafe_name.png\"");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
