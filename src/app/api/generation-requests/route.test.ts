import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
}));

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/pets/generation-requests-repository", () => ({
  createGenerationRequest: vi.fn(),
}));

import { POST } from "@/app/api/generation-requests/route";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { createGenerationRequest } from "@/lib/pets/generation-requests-repository";
import { isYdbConfigured } from "@/lib/ydb/client";

describe("POST /api/generation-requests", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    vi.mocked(isYdbConfigured).mockReturnValue(true);
  });

  it("creates an anonymous generation request", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);
    vi.mocked(createGenerationRequest).mockResolvedValueOnce({
      id: "req_1",
      status: "pending",
      kind: "character",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      requesterUserId: null,
      linkedPetId: null,
      linkedPetSlug: null,
      referenceImage: null,
      adminNote: null,
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      fulfilledAt: null,
      rejectedAt: null,
    });

    const response = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      kind: "character",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      request: {
        id: "req_1",
        status: "pending",
        createdAt: "2026-05-16T10:00:00.000Z",
      },
    });
    expect(createGenerationRequest).toHaveBeenCalledWith({
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      kind: "character",
      requesterUserId: null,
      referenceImage: null,
    });
  });

  it("replays successful requests when Idempotency-Key and body match", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(createGenerationRequest).mockResolvedValue({
      id: "req_idempotent",
      status: "pending",
      kind: "character",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      requesterUserId: null,
      linkedPetId: null,
      linkedPetSlug: null,
      referenceImage: null,
      adminNote: null,
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      fulfilledAt: null,
      rejectedAt: null,
    });
    const body = {
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      kind: "character",
    };

    const first = await POST(jsonRequest(body, "request-replay-1"));
    const second = await POST(jsonRequest(body, "request-replay-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toEqual(await first.json());
    expect(createGenerationRequest).toHaveBeenCalledTimes(1);
  });

  it("replays semantically matching requests after validation normalization", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(createGenerationRequest).mockResolvedValue({
      id: "req_normalized",
      status: "pending",
      kind: "creature",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      requesterUserId: null,
      linkedPetId: null,
      linkedPetSlug: null,
      referenceImage: null,
      adminNote: null,
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      fulfilledAt: null,
      rejectedAt: null,
    });

    const first = await POST(jsonRequest({
      contactEmail: " ANON@EXAMPLE.COM ",
      requesterName: " Anon ",
      displayNameHint: " Patch Pilot ",
      prompt: " Make a careful code review companion. ",
      kind: "not-a-kind",
    }, "request-normalized-1"));
    const second = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      kind: "creature",
    }, "request-normalized-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toEqual(await first.json());
    expect(createGenerationRequest).toHaveBeenCalledTimes(1);
  });

  it("scopes idempotency keys to signed-in users", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce({
        userId: "user_1",
        email: "one@example.com",
        name: "One",
        role: "user",
      })
      .mockResolvedValueOnce({
        userId: "user_2",
        email: "two@example.com",
        name: "Two",
        role: "user",
      });
    vi.mocked(createGenerationRequest)
      .mockResolvedValueOnce(generationRequestRecord("req_user_1", "user_1"))
      .mockResolvedValueOnce(generationRequestRecord("req_user_2", "user_2"));

    const body = {
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      kind: "character",
    };

    const first = await POST(jsonRequest(body, "request-user-scope-1"));
    const second = await POST(jsonRequest(body, "request-user-scope-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({
      request: { id: "req_user_1" },
    });
    await expect(second.json()).resolves.toMatchObject({
      request: { id: "req_user_2" },
    });
    expect(createGenerationRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects reused Idempotency-Key values with a different body", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(createGenerationRequest).mockResolvedValue({
      id: "req_conflict",
      status: "pending",
      kind: "character",
      displayNameHint: "Patch Pilot",
      prompt: "Make a careful code review companion.",
      contactEmail: "anon@example.com",
      requesterName: "Anon",
      requesterUserId: null,
      linkedPetId: null,
      linkedPetSlug: null,
      referenceImage: null,
      adminNote: null,
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      fulfilledAt: null,
      rejectedAt: null,
    });

    const first = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      prompt: "Make a helper.",
    }, "request-conflict-1"));
    const second = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      prompt: "Make a different helper.",
    }, "request-conflict-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: "idempotency_key_conflict",
      code: "idempotency_key_conflict",
    });
    expect(createGenerationRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid Idempotency-Key values before creating a request", async () => {
    const response = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      prompt: "Make a helper.",
    }, "bad key"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_idempotency_key",
      code: "invalid_idempotency_key",
    });
    expect(createGenerationRequest).not.toHaveBeenCalled();
  });

  it("returns idempotency_unavailable when a key is supplied without storage", async () => {
    vi.mocked(isYdbConfigured).mockReturnValueOnce(false);
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "");

    const response = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      prompt: "Make a helper.",
    }, "request-no-storage-1"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotency_unavailable",
      code: "idempotency_unavailable",
    });
    expect(getCurrentPrincipal).not.toHaveBeenCalled();
    expect(createGenerationRequest).not.toHaveBeenCalled();
  });

  it("creates a request with a reference image from multipart form data", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user_1",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(createGenerationRequest).mockResolvedValueOnce({
      id: "req_2",
      status: "pending",
      kind: "creature",
      displayNameHint: "Pixel Desk",
      prompt: "Make a desk helper based on this reference.",
      contactEmail: "user@example.com",
      requesterName: "User",
      requesterUserId: "user_1",
      linkedPetId: null,
      linkedPetSlug: null,
      referenceImage: {
        url: "/api/generation-requests/req_2/image",
        fileName: "reference.png",
        contentType: "image/png",
        sizeBytes: 90,
      },
      adminNote: null,
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      fulfilledAt: null,
      rejectedAt: null,
    });
    const image = await makePng();
    const formData = new FormData();
    formData.set("contactEmail", "user@example.com");
    formData.set("requesterName", "User");
    formData.set("displayNameHint", "Pixel Desk");
    formData.set("prompt", "Make a desk helper based on this reference.");
    formData.set("kind", "creature");
    formData.set(
      "referenceImage",
      new File([new Uint8Array(image)], "reference.png", { type: "image/png" }),
    );

    const response = await POST(formRequest(formData));

    expect(response.status).toBe(201);
    expect(createGenerationRequest).toHaveBeenCalledWith({
      contactEmail: "user@example.com",
      requesterName: "User",
      displayNameHint: "Pixel Desk",
      prompt: "Make a desk helper based on this reference.",
      kind: "creature",
      requesterUserId: "user_1",
      referenceImage: expect.objectContaining({
        fileName: "reference.png",
        contentType: "image/png",
        sizeBytes: image.byteLength,
        buffer: expect.any(Buffer),
      }),
    });
  });

  it("rejects invalid reference images", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValue(null);

    const invalidType = baseFormData();
    invalidType.set(
      "referenceImage",
      new File(["hello"], "notes.txt", { type: "text/plain" }),
    );
    const invalidTypeResponse = await POST(formRequest(invalidType));
    expect(invalidTypeResponse.status).toBe(400);
    await expect(invalidTypeResponse.json()).resolves.toMatchObject({
      error: "invalid_reference_image_type",
      code: "invalid_reference_image_type",
      message: "Reference image must be PNG, JPEG, or WebP.",
      field: "referenceImage",
    });

    const unreadable = baseFormData();
    unreadable.set(
      "referenceImage",
      new File(["not an image"], "broken.png", { type: "image/png" }),
    );
    const unreadableResponse = await POST(formRequest(unreadable));
    expect(unreadableResponse.status).toBe(400);

    const oversized = baseFormData();
    oversized.set(
      "referenceImage",
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", {
        type: "image/png",
      }),
    );
    const oversizedResponse = await POST(formRequest(oversized));
    expect(oversizedResponse.status).toBe(400);
    expect(createGenerationRequest).not.toHaveBeenCalled();
  });

  it("rejects invalid request JSON", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);

    const response = await POST(jsonRequest({ prompt: "Missing email" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "missing_field",
      code: "missing_field",
      message: "contactEmail is required.",
      field: "contactEmail",
    });
    expect(createGenerationRequest).not.toHaveBeenCalled();
  });

  it("returns 503 when YDB is not configured", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);
    vi.mocked(isYdbConfigured).mockReturnValueOnce(false);
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "");

    const response = await POST(jsonRequest({
      contactEmail: "anon@example.com",
      prompt: "Make a helper.",
    }));

    expect(response.status).toBe(503);
    expect(createGenerationRequest).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown, idempotencyKey?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request("http://localhost/api/generation-requests", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function formRequest(formData: FormData): Request {
  return new Request("http://localhost/api/generation-requests", {
    method: "POST",
    body: formData,
  });
}

function generationRequestRecord(id: string, requesterUserId: string | null) {
  return {
    id,
    status: "pending" as const,
    kind: "character" as const,
    displayNameHint: "Patch Pilot",
    prompt: "Make a careful code review companion.",
    contactEmail: "anon@example.com",
    requesterName: "Anon",
    requesterUserId,
    linkedPetId: null,
    linkedPetSlug: null,
    referenceImage: null,
    adminNote: null,
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T10:00:00.000Z",
    fulfilledAt: null,
    rejectedAt: null,
  };
}

function baseFormData(): FormData {
  const formData = new FormData();
  formData.set("contactEmail", "anon@example.com");
  formData.set("prompt", "Make a helper.");
  return formData;
}

async function makePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: "#ffffff",
    },
  }).png().toBuffer();
}
