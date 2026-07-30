import { afterEach, describe, expect, it, vi } from "vitest";

import { loadGuidePets } from "@/lib/guides/load-guide-pets";
import type { PublicPet } from "@/lib/pets/types";

describe("loadGuidePets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the loaded pets on success", async () => {
    const pets = [pet({ slug: "one" }), pet({ slug: "two" })];

    await expect(loadGuidePets(async () => pets)).resolves.toBe(pets);
  });

  it("falls back to an empty list and logs when the registry fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      loadGuidePets(async () => {
        throw new Error("ydb unavailable");
      }),
    ).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[guides] failed to load approved pets snapshot",
      expect.any(Error),
    );
  });
});

function pet(overrides: Partial<PublicPet>): PublicPet {
  const slug = overrides.slug ?? "demo";

  return {
    id: `pet_${slug}`,
    slug,
    displayName: overrides.displayName ?? "Demo Pet",
    description: overrides.description ?? "A demo Codex pet pack.",
    spritesheetUrl: overrides.spritesheetUrl ?? `/api/assets/${slug}/sheet.webp`,
    petJsonUrl: overrides.petJsonUrl ?? `/api/assets/${slug}/pet.json`,
    zipUrl: overrides.zipUrl ?? `/api/assets/${slug}/package.zip`,
    spritesheetExt: overrides.spritesheetExt ?? "webp",
    kind: overrides.kind ?? "creature",
    tags: overrides.tags ?? [],
    status: overrides.status ?? "approved",
    ownerName: overrides.ownerName ?? "Creator",
    ownerProfileSlug: overrides.ownerProfileSlug ?? "creator",
    ownerAvatarUrl: overrides.ownerAvatarUrl ?? null,
    contactEmail: overrides.contactEmail ?? null,
    createdAt: overrides.createdAt ?? "2026-05-01T00:00:00.000Z",
    approvedAt: overrides.approvedAt ?? "2026-05-02T00:00:00.000Z",
    downloadCount: overrides.downloadCount ?? 0,
    installCount: overrides.installCount ?? 0,
    likeCount: overrides.likeCount ?? 0,
  };
}
