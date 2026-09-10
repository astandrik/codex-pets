import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPetBySlug: vi.fn(),
  imageElement: null as unknown,
  readPetAssetFile: vi.fn(),
}));

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown) {
      mocks.imageElement = element;
    }
  },
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/pets/assets-repository", () => ({
  readPetAssetFile: mocks.readPetAssetFile,
}));
vi.mock("@/lib/pets/repository", () => ({
  getPetBySlug: mocks.getPetBySlug,
}));

import Image from "@/app/pets/[slug]/opengraph-image";

describe("pet Open Graph public author email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imageElement = null;
    mocks.readPetAssetFile.mockRejectedValue(new Error("synthetic missing asset"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("hides a retained legacy email for a rejected pet", async () => {
    mocks.getPetBySlug.mockResolvedValue({
      slug: "rejected-email",
      displayName: "Rejected Email",
      description: "Synthetic rejected pet.",
      spritesheetUrl: "/api/assets/asset_1/spritesheet.webp",
      kind: "creature",
      tags: ["triage"],
      status: "rejected",
      ownerName: "Reviewer",
      publicAuthorEmail: "legacy@example.com",
    });

    await Image({ params: Promise.resolve({ slug: "rejected-email" }) });
    const markup = renderToStaticMarkup(mocks.imageElement as ReactElement);

    expect(markup).toContain("Rejected");
    expect(markup).not.toContain("legacy@example.com");
  });
});
