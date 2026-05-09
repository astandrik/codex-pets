import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
}));

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
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

describe("POST /api/submissions/register", () => {
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
});
