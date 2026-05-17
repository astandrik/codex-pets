import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/generation-requests-repository", () => ({
  fulfillGenerationRequest: vi.fn(),
  markGenerationRequestInProgress: vi.fn(),
  rejectGenerationRequest: vi.fn(),
  softDeleteGenerationRequest: vi.fn(),
}));

import { POST as deletePost } from "@/app/api/admin/generation-requests/[id]/delete/route";
import { POST as fulfillPost } from "@/app/api/admin/generation-requests/[id]/fulfill/route";
import { POST as rejectPost } from "@/app/api/admin/generation-requests/[id]/reject/route";
import { POST as startPost } from "@/app/api/admin/generation-requests/[id]/start/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import {
  fulfillGenerationRequest,
  markGenerationRequestInProgress,
  rejectGenerationRequest,
  softDeleteGenerationRequest,
} from "@/lib/pets/generation-requests-repository";
import type { PetGenerationRequest } from "@/lib/pets/types";

describe("admin generation request routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-admin requests", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user_1",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(false);

    const response = await startPost(jsonRequest({}), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(response.status).toBe(403);
  });

  it("marks a request in progress", async () => {
    mockAdmin();
    const request = makeRequest({ status: "in_progress" });
    vi.mocked(markGenerationRequestInProgress).mockResolvedValueOnce(request);

    const response = await startPost(jsonRequest({ adminNote: "Queued" }), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(response.status).toBe(200);
    expect(markGenerationRequestInProgress).toHaveBeenCalledWith({
      requestId: "req_1",
      adminNote: "Queued",
    });
  });

  it("rejects a request", async () => {
    mockAdmin();
    const request = makeRequest({ status: "rejected", adminNote: "Too broad" });
    vi.mocked(rejectGenerationRequest).mockResolvedValueOnce(request);

    const response = await rejectPost(jsonRequest({ adminNote: "Too broad" }), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(response.status).toBe(200);
    expect(rejectGenerationRequest).toHaveBeenCalledWith({
      requestId: "req_1",
      adminNote: "Too broad",
    });
  });

  it("soft-deletes a request", async () => {
    mockAdmin();
    vi.mocked(softDeleteGenerationRequest).mockResolvedValueOnce(true);

    const response = await deletePost(jsonRequest({}), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(response.status).toBe(200);
    expect(softDeleteGenerationRequest).toHaveBeenCalledWith("req_1");
  });

  it("fulfills a request with an existing pet lookup", async () => {
    mockAdmin();
    const request = makeRequest({
      status: "fulfilled",
      linkedPetId: "pet_1",
      linkedPetSlug: "orbit-otter",
    });
    vi.mocked(fulfillGenerationRequest).mockResolvedValueOnce({
      ok: true,
      request,
    });

    const response = await fulfillPost(
      jsonRequest({ petLookup: "orbit-otter", adminNote: "Done" }),
      { params: Promise.resolve({ id: "req_1" }) },
    );

    expect(response.status).toBe(200);
    expect(fulfillGenerationRequest).toHaveBeenCalledWith({
      requestId: "req_1",
      petLookup: "orbit-otter",
      adminNote: "Done",
    });
  });

  it("reports missing and deleted pet links", async () => {
    mockAdmin();
    vi.mocked(fulfillGenerationRequest).mockResolvedValueOnce({
      ok: false,
      error: "pet_not_found",
    });

    const missing = await fulfillPost(jsonRequest({ petLookup: "missing" }), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(missing.status).toBe(404);

    mockAdmin();
    vi.mocked(fulfillGenerationRequest).mockResolvedValueOnce({
      ok: false,
      error: "pet_deleted",
    });

    const deleted = await fulfillPost(jsonRequest({ petLookup: "old-pet" }), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(deleted.status).toBe(409);
  });
});

function mockAdmin() {
  vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
    userId: "admin_1",
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
  });
  vi.mocked(isAdminUser).mockReturnValueOnce(true);
}

function makeRequest(
  overrides: Partial<PetGenerationRequest> = {},
): PetGenerationRequest {
  return {
    id: "req_1",
    status: "pending",
    kind: "creature",
    displayNameHint: "Orbit Otter",
    prompt: "Make a small space helper.",
    contactEmail: "user@example.com",
    requesterName: "User",
    requesterUserId: null,
    linkedPetId: null,
    linkedPetSlug: null,
    referenceImage: null,
    adminNote: null,
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
    fulfilledAt: null,
    rejectedAt: null,
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
