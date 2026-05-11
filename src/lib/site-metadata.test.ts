import { describe, expect, it, vi } from "vitest";

describe("social metadata images", () => {
  it("prepends page-specific images before the default social image", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const {
      getOpenGraphImages,
      getPetSocialImagePath,
      getSiteSocialImagePath,
      getTwitterImages,
    } = await import("@/lib/site-metadata");
    const petImage = getPetSocialImagePath("boba");

    const openGraphImages = getOpenGraphImages([
      {
        url: petImage,
        secureUrl: petImage,
        width: 1200,
        height: 630,
        alt: "Boba Codex pet preview",
        type: "image/png",
      },
    ]) as Array<{ url: string; width: number; height: number; alt: string }>;

    expect(openGraphImages[0]).toEqual({
      url: "https://example.test/codex-pets/pets/boba/opengraph-image.png",
      secureUrl:
        "https://example.test/codex-pets/pets/boba/opengraph-image.png",
      width: 1200,
      height: 630,
      alt: "Boba Codex pet preview",
      type: "image/png",
    });
    expect(openGraphImages[1]).toMatchObject({
      url: "https://example.test/codex-pets/opengraph-image",
      width: 1200,
      height: 630,
    });
    expect(getTwitterImages([
      {
        url: petImage,
        secureUrl: petImage,
        width: 1200,
        height: 630,
        alt: "Boba Codex pet preview",
        type: "image/png",
      },
    ])).toEqual([
      {
        url: "https://example.test/codex-pets/pets/boba/opengraph-image.png",
        secureUrl:
          "https://example.test/codex-pets/pets/boba/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Boba Codex pet preview",
        type: "image/png",
      },
      {
        url: "https://example.test/codex-pets/opengraph-image",
        secureUrl: "https://example.test/codex-pets/opengraph-image",
        alt: "Companion Gallery for animated Codex companions",
        type: "image/png",
        width: 1200,
        height: 630,
      },
    ]);
    expect(getSiteSocialImagePath()).toBe("/opengraph-image");

    vi.unstubAllEnvs();
  });

  it("keeps absolute page-specific image URLs unchanged", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();

    const { getOpenGraphImages, getTwitterImages } = await import(
      "@/lib/site-metadata"
    );
    const petImage = "https://assets.example/pets/boba.webp";

    const openGraphImages = getOpenGraphImages([
      {
        url: petImage,
        secureUrl: petImage,
        width: 1536,
        height: 1872,
        alt: "Boba Codex pet spritesheet",
      },
    ]) as Array<{ url: string }>;

    expect(openGraphImages[0]?.url).toBe(petImage);
    expect(
      (
        getTwitterImages([
          {
            url: petImage,
            secureUrl: petImage,
            width: 1536,
            height: 1872,
            alt: "Boba Codex pet spritesheet",
          },
        ]) as Array<{ url: string }>
      )[0]?.url,
    ).toBe(petImage);
  });
});
