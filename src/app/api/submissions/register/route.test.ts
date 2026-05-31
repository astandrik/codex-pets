import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
}));

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
  TypedValues: {
    utf8: vi.fn((value: string) => value),
    uint32: vi.fn((value: number) => value),
  },
  withSession: vi.fn(),
}));

vi.mock("@/lib/pets/assets-repository", () => ({
  storePetAssetsInYdb: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  createPendingPet: vi.fn(),
}));

vi.mock("@/lib/pets/package", () => ({
  validateUploadedPackage: vi.fn(),
}));

import { POST } from "@/app/api/submissions/register/route";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { storePetAssetsInYdb } from "@/lib/pets/assets-repository";
import { createPendingPet } from "@/lib/pets/repository";
import { validateUploadedPackage } from "@/lib/pets/package";
import { isYdbConfigured, withSession } from "@/lib/ydb/client";

describe("POST /api/submissions/register", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
  });

  it("allows anonymous submissions", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);
    vi.mocked(validateUploadedPackage).mockResolvedValueOnce({
      ok: true,
      value: {
        petJson: {
          id: "demo",
          displayName: "Demo",
          description: "Demo pet",
          spritesheetPath: "spritesheet.webp",
        },
        spritesheetBytes: 10,
        zipBytes: 10,
      },
    });
    vi.mocked(storePetAssetsInYdb).mockResolvedValueOnce({
      petJsonUrl: "/api/assets/a/pet.json",
      spritesheetUrl: "/api/assets/a/spritesheet.webp",
      zipUrl: "/api/assets/a/pet.zip",
    });
    vi.mocked(createPendingPet).mockResolvedValueOnce({
      id: "pet_1",
      slug: "demo",
      displayName: "Demo",
      description: "Demo pet",
      spritesheetUrl: "/api/assets/a/spritesheet.webp",
      petJsonUrl: "/api/assets/a/pet.json",
      zipUrl: "/api/assets/a/pet.zip",
      spritesheetExt: "webp",
      kind: "creature",
      tags: [],
      status: "pending",
      ownerName: null,
      contactEmail: "anon@example.com",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      downloadCount: 0,
      installCount: 0,
      likeCount: 0,
    });

    const formData = new FormData();
    formData.set("zip", new File(["zip"], "pet.zip", { type: "application/zip" }));
    formData.set(
      "petjson",
      new File(
        [
          JSON.stringify({
            id: "demo",
            displayName: "Demo",
            description: "Demo",
            spritesheetPath: "spritesheet.webp",
          }),
        ],
        "pet.json",
        { type: "application/json" },
      ),
    );
    formData.set(
      "sprite",
      new File(["sprite"], "spritesheet.webp", { type: "image/webp" }),
    );
    formData.set(
      "contactEmail",
      "anon@example.com",
    );
    formData.set("kind", "creature");
    formData.set("tags", "cozy,robot");

    const response = await POST(
      new Request("http://localhost:3000/api/submissions/register", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(createPendingPet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "",
        contactEmail: "anon@example.com",
      }),
    );
  });

  it("replays successful submissions when Idempotency-Key and files match", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockSuccessfulSubmission("pet_idempotent");

    const first = await POST(submissionRequest(validSubmissionForm(), "submit-replay-1"));
    const second = await POST(submissionRequest(validSubmissionForm(), "submit-replay-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toEqual(await first.json());
    expect(storePetAssetsInYdb).toHaveBeenCalledTimes(1);
    expect(createPendingPet).toHaveBeenCalledTimes(1);
  });

  it("replays semantically matching submissions after field normalization", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockSuccessfulSubmission("pet_normalized");

    const firstForm = validSubmissionForm();
    firstForm.set("contactEmail", " ANON@EXAMPLE.COM ");
    firstForm.set("tags", " Cozy ,ROBOT ");
    const secondForm = validSubmissionForm();
    secondForm.set("contactEmail", "anon@example.com");
    secondForm.set("tags", "cozy,robot");

    const first = await POST(submissionRequest(firstForm, "submit-normalized-1"));
    const second = await POST(submissionRequest(secondForm, "submit-normalized-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toEqual(await first.json());
    expect(storePetAssetsInYdb).toHaveBeenCalledTimes(1);
    expect(createPendingPet).toHaveBeenCalledTimes(1);
  });

  it("scopes submission idempotency keys to signed-in users", async () => {
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
    mockSuccessfulSubmission("pet_user_1");
    vi.mocked(createPendingPet).mockResolvedValueOnce(
      submissionPet("pet_user_1"),
    ).mockResolvedValueOnce(submissionPet("pet_user_2"));

    const first = await POST(
      submissionRequest(validSubmissionForm(), "submit-user-scope-1"),
    );
    const second = await POST(
      submissionRequest(validSubmissionForm(), "submit-user-scope-1"),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({
      pet: { id: "pet_user_1" },
    });
    await expect(second.json()).resolves.toMatchObject({
      pet: { id: "pet_user_2" },
    });
    expect(storePetAssetsInYdb).toHaveBeenCalledTimes(2);
    expect(createPendingPet).toHaveBeenCalledTimes(2);
  });

  it("rejects reused Idempotency-Key values with different submission bytes", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockSuccessfulSubmission("pet_conflict");

    const first = await POST(submissionRequest(validSubmissionForm(), "submit-conflict-1"));
    const changed = validSubmissionForm();
    changed.set("tags", "cozy,robot,space");
    const second = await POST(submissionRequest(changed, "submit-conflict-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: "idempotency_key_conflict",
      code: "idempotency_key_conflict",
    });
    expect(storePetAssetsInYdb).toHaveBeenCalledTimes(1);
    expect(createPendingPet).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid Idempotency-Key values before storing assets", async () => {
    const response = await POST(submissionRequest(validSubmissionForm(), "bad key"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_idempotency_key",
      code: "invalid_idempotency_key",
    });
    expect(storePetAssetsInYdb).not.toHaveBeenCalled();
    expect(createPendingPet).not.toHaveBeenCalled();
  });

  it("returns idempotency_unavailable when a key is supplied without storage", async () => {
    vi.mocked(isYdbConfigured).mockReturnValueOnce(false);
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "");

    const response = await POST(
      submissionRequest(validSubmissionForm(), "submit-no-storage-1"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotency_unavailable",
      code: "idempotency_unavailable",
    });
    expect(getCurrentPrincipal).not.toHaveBeenCalled();
    expect(storePetAssetsInYdb).not.toHaveBeenCalled();
    expect(createPendingPet).not.toHaveBeenCalled();
  });

  it("releases the idempotency claim when submission creation fails", async () => {
    vi.mocked(getCurrentPrincipal)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(validateUploadedPackage).mockResolvedValue({
      ok: true,
      value: {
        petJson: {
          id: "demo",
          displayName: "Demo",
          description: "Demo pet",
          spritesheetPath: "spritesheet.webp",
        },
        spritesheetBytes: 10,
        zipBytes: 10,
      },
    });
    vi.mocked(storePetAssetsInYdb).mockResolvedValue({
      petJsonUrl: "/api/assets/a/pet.json",
      spritesheetUrl: "/api/assets/a/spritesheet.webp",
      zipUrl: "/api/assets/a/pet.zip",
    });
    vi.mocked(createPendingPet)
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(submissionPet("pet_retry"));

    await expect(
      POST(submissionRequest(validSubmissionForm(), "submit-failed-mutation-1")),
    ).rejects.toThrow("create failed");
    const retry = await POST(
      submissionRequest(validSubmissionForm(), "submit-failed-mutation-1"),
    );

    expect(retry.status).toBe(201);
    await expect(retry.json()).resolves.toMatchObject({
      pet: { id: "pet_retry" },
    });
    expect(storePetAssetsInYdb).toHaveBeenCalledTimes(2);
    expect(createPendingPet).toHaveBeenCalledTimes(2);
  });

  it("returns the created submission when result idempotency storage fails", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "");
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);
    mockSuccessfulSubmission("pet_store_failure");
    const executeQuery = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("transient ydb unavailable"));
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const response = await POST(
      submissionRequest(validSubmissionForm(), "submit-result-store-failure-1"),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      pet: { id: "pet_store_failure" },
    });
    expect(storePetAssetsInYdb).toHaveBeenCalledTimes(1);
    expect(createPendingPet).toHaveBeenCalledTimes(1);
    expect(executeQuery).toHaveBeenCalledTimes(2);
  });

  it("binds submit to the logged-in owner when a session exists", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(validateUploadedPackage).mockResolvedValueOnce({
      ok: true,
      value: {
        petJson: {
          id: "demo",
          displayName: "Demo",
          description: "Demo pet",
          spritesheetPath: "spritesheet.webp",
        },
        spritesheetBytes: 10,
        zipBytes: 10,
      },
    });
    vi.mocked(storePetAssetsInYdb).mockResolvedValueOnce({
      petJsonUrl: "/api/assets/a/pet.json",
      spritesheetUrl: "/api/assets/a/spritesheet.webp",
      zipUrl: "/api/assets/a/pet.zip",
    });
    vi.mocked(createPendingPet).mockResolvedValueOnce({
      id: "pet_1",
      slug: "demo",
      displayName: "Demo",
      description: "Demo pet",
      spritesheetUrl: "/api/assets/a/spritesheet.webp",
      petJsonUrl: "/api/assets/a/pet.json",
      zipUrl: "/api/assets/a/pet.zip",
      spritesheetExt: "webp",
      kind: "creature",
      tags: [],
      status: "pending",
      ownerName: "User",
      contactEmail: "user@example.com",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      downloadCount: 0,
      installCount: 0,
      likeCount: 0,
    });

    const formData = new FormData();
    formData.set("zip", new File(["zip"], "pet.zip", { type: "application/zip" }));
    formData.set(
      "petjson",
      new File(
        [
          JSON.stringify({
            id: "demo",
            displayName: "Demo",
            description: "Demo",
            spritesheetPath: "spritesheet.webp",
          }),
        ],
        "pet.json",
        { type: "application/json" },
      ),
    );
    formData.set(
      "sprite",
      new File(["sprite"], "spritesheet.webp", { type: "image/webp" }),
    );
    formData.set("kind", "creature");

    const response = await POST(
      new Request("http://localhost:3000/api/submissions/register", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(createPendingPet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "user@example.com",
        ownerEmail: "user@example.com",
        contactEmail: "user@example.com",
      }),
    );
  });

  it("returns structured JSON for package validation failures", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);
    vi.mocked(validateUploadedPackage).mockResolvedValueOnce({
      ok: false,
      error: "invalid_zip_contents",
      message: "ZIP must contain pet.json and spritesheet.webp at the root.",
    });

    const formData = new FormData();
    formData.set("zip", new File(["zip"], "pet.zip", { type: "application/zip" }));
    formData.set("petjson", new File(["{}"], "pet.json", { type: "application/json" }));
    formData.set(
      "sprite",
      new File(["sprite"], "spritesheet.webp", { type: "image/webp" }),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/submissions/register", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_zip_contents",
      code: "invalid_zip_contents",
      message: "ZIP must contain pet.json and spritesheet.webp at the root.",
    });
    expect(storePetAssetsInYdb).not.toHaveBeenCalled();
    expect(createPendingPet).not.toHaveBeenCalled();
  });
});

function submissionRequest(formData: FormData, idempotencyKey?: string): Request {
  const headers = new Headers();
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request("http://localhost:3000/api/submissions/register", {
    method: "POST",
    headers,
    body: formData,
  });
}

function validSubmissionForm(): FormData {
  const formData = new FormData();
  formData.set("zip", new File(["zip"], "pet.zip", { type: "application/zip" }));
  formData.set(
    "petjson",
    new File(
      [
        JSON.stringify({
          id: "demo",
          displayName: "Demo",
          description: "Demo",
          spritesheetPath: "spritesheet.webp",
        }),
      ],
      "pet.json",
      { type: "application/json" },
    ),
  );
  formData.set(
    "sprite",
    new File(["sprite"], "spritesheet.webp", { type: "image/webp" }),
  );
  formData.set("contactEmail", "anon@example.com");
  formData.set("kind", "creature");
  formData.set("tags", "cozy,robot");
  return formData;
}

function mockSuccessfulSubmission(id: string): void {
  vi.mocked(validateUploadedPackage).mockResolvedValue({
    ok: true,
    value: {
      petJson: {
        id: "demo",
        displayName: "Demo",
        description: "Demo pet",
        spritesheetPath: "spritesheet.webp",
      },
      spritesheetBytes: 10,
      zipBytes: 10,
    },
  });
  vi.mocked(storePetAssetsInYdb).mockResolvedValue({
    petJsonUrl: "/api/assets/a/pet.json",
    spritesheetUrl: "/api/assets/a/spritesheet.webp",
    zipUrl: "/api/assets/a/pet.zip",
  });
  vi.mocked(createPendingPet).mockResolvedValue(submissionPet(id));
}

function submissionPet(id: string) {
  return {
    id,
    slug: "demo",
    displayName: "Demo",
    description: "Demo pet",
    spritesheetUrl: "/api/assets/a/spritesheet.webp",
    petJsonUrl: "/api/assets/a/pet.json",
    zipUrl: "/api/assets/a/pet.zip",
    spritesheetExt: "webp" as const,
    kind: "creature" as const,
    tags: [],
    status: "pending" as const,
    ownerName: null,
    contactEmail: "anon@example.com",
    createdAt: "2026-05-16T10:00:00.000Z",
    approvedAt: null,
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
  };
}
