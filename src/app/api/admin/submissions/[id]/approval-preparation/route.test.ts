import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/approval-preparations-repository", () => ({
  getApprovalPreparation: vi.fn(),
}));

import { GET } from "@/app/api/admin/submissions/[id]/approval-preparation/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { getApprovalPreparation } from "@/lib/pets/approval-preparations-repository";

describe("GET /api/admin/submissions/[id]/approval-preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentPrincipal).mockResolvedValue({
      userId: "admin-1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValue(true);
  });

  it("returns only the sanitized status for the matching pet", async () => {
    vi.mocked(getApprovalPreparation).mockResolvedValueOnce({
      preparationId: "approval-1",
      petId: "pet-1",
      petSlug: "tallulah",
      petUpdatedAt: "2026-08-11T00:00:00.000Z",
      reviewerId: "admin-1",
      rankingRevision: "current-revision",
      expectedActiveGenerationId: "generation-active",
      preparedGenerationId: "",
      status: "manual_review",
      attempts: 1,
      nextAttemptAt: "",
      leaseOwner: "",
      leaseUntil: "",
      failureCode: "unresolved_strong_relation",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:01:00.000Z",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/admin/submissions/pet-1/approval-preparation?preparationId=approval-1",
      ),
      { params: Promise.resolve({ id: "pet-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preparationId: "approval-1",
      status: "manual_review",
      failureCode: "unresolved_strong_relation",
    });
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        "http://localhost/api/admin/submissions/pet-1/approval-preparation?preparationId=approval-1",
      ),
      { params: Promise.resolve({ id: "pet-1" }) },
    );

    expect(response.status).toBe(403);
    expect(getApprovalPreparation).not.toHaveBeenCalled();
  });

  it("does not expose another pet preparation", async () => {
    vi.mocked(getApprovalPreparation).mockResolvedValueOnce({
      preparationId: "approval-1",
      petId: "pet-2",
    } as never);

    const response = await GET(
      new Request(
        "http://localhost/api/admin/submissions/pet-1/approval-preparation?preparationId=approval-1",
      ),
      { params: Promise.resolve({ id: "pet-1" }) },
    );

    expect(response.status).toBe(404);
  });
});
