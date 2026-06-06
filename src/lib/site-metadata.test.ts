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
        alt: "Codex Pets gallery for animated Codex companions",
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

describe("gallery page metadata", () => {
  it("builds filtered metadata for tag-only gallery pages", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { buildGalleryPageMetadata } = await import("@/lib/site-metadata");
    const metadata = buildGalleryPageMetadata({
      query: "",
      kind: "all",
      tags: ["space"],
    });

    expect(metadata.title).toBe("Codex pets tagged #space");
    expect(metadata.description).toContain("tagged #space");
    expect(metadata.alternates?.canonical).toBe("/codex-pets/?tags=space");
    expect(metadata.alternates?.types).toEqual({
      "application/json": [
        {
          title: "Filtered approved pet search JSON",
          url: "/codex-pets/api/pets?tags=space",
        },
      ],
      "text/toon": [
        {
          title: "Filtered approved pet search TOON",
          url: "/codex-pets/api/pets.toon?tags=space",
        },
      ],
    });
    expect(metadata.openGraph).toMatchObject({
      title: "Codex pets tagged #space - Codex Pets",
      url: "/codex-pets/?tags=space",
    });

    vi.unstubAllEnvs();
  });

  it("builds canonical metadata for combined gallery filters", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { buildGalleryPageMetadata } = await import("@/lib/site-metadata");
    const metadata = buildGalleryPageMetadata({
      query: "green",
      kind: "object",
      tags: ["terminal", "space"],
    });

    expect(metadata.title).toBe(
      'Object Codex pets matching "green" tagged #space and #terminal',
    );
    expect(metadata.alternates?.canonical).toBe(
      '/?q=green&kind=object&tags=space,terminal',
    );
    expect(metadata.alternates?.types).toMatchObject({
      "application/json": [
        {
          url: "/api/pets?q=green&kind=object&tags=space,terminal",
        },
      ],
      "text/toon": [
        {
          url: "/api/pets.toon?q=green&kind=object&tags=space,terminal",
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      title:
        'Object Codex pets matching "green" tagged #space and #terminal - Codex Pets',
    });

    vi.unstubAllEnvs();
  });
});

describe("site identity metadata", () => {
  it("keeps global JSON-LD free of homepage-only entities", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { getWebsiteJsonLd } = await import("@/lib/site-metadata");
    const graph = getWebsiteJsonLd();
    const nodes = graph["@graph"] as Array<Record<string, unknown>>;

    expect(nodes.map((node) => node["@type"])).toEqual([
      "Organization",
      "SoftwareApplication",
      "Product",
      "WebSite",
    ]);
    expect(nodes.find((node) => node["@type"] === "WebSite")).toMatchObject({
      name: "Codex Pets",
      url: "https://pets.example/",
    });

    vi.unstubAllEnvs();
  });

  it("uses Codex Pets as the canonical product name and keeps homepage JSON-LD page-specific", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const {
      SITE_NAME,
      SITE_TITLE,
      SITE_IMAGE_ALT,
      getWebsiteJsonLd,
      getHomepageJsonLdGraph,
    } = await import("@/lib/site-metadata");
    const websiteGraph = getWebsiteJsonLd();
    const websiteNodes = websiteGraph["@graph"] as Array<
      Record<string, unknown>
    >;
    const homepageGraph = getHomepageJsonLdGraph([
      {
        slug: "boba",
        displayName: "Boba",
        description: "Round coding companion.",
        kind: "creature",
        tags: ["round"],
        ownerName: "Creator",
        ownerProfileSlug: "creator",
        createdAt: "2026-05-01T00:00:00.000Z",
        approvedAt: "2026-05-02T00:00:00.000Z",
        zipUrl: "/api/assets/a/package.zip",
        spritesheetUrl: "/api/assets/a/spritesheet.webp",
        petJsonUrl: "/api/assets/a/pet.json",
      },
    ]);
    const homepageNodes = homepageGraph["@graph"] as Array<
      Record<string, unknown>
    >;

    expect(SITE_NAME).toBe("Codex Pets");
    expect(SITE_TITLE).toContain("Codex Pets");
    expect(SITE_IMAGE_ALT).toContain("Codex Pets");
    expect(websiteNodes.map((node) => node["@type"])).toEqual([
      "Organization",
      "SoftwareApplication",
      "Product",
      "WebSite",
    ]);
    expect(homepageNodes.map((node) => node["@type"])).toEqual([
      "WebPage",
      "FAQPage",
      "ItemList",
    ]);
    expect(
      websiteNodes.find((node) => node["@type"] === "SoftwareApplication"),
    ).toMatchObject({
      name: "Codex Pets",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
    });
    expect(
      websiteNodes.find((node) => node["@type"] === "Organization"),
    ).toMatchObject({
      name: "Codex Pets",
      sameAs: expect.arrayContaining([
        "https://github.com/astandrik/codex-pets",
        "https://www.npmjs.com/package/@astandrik/codex-pets",
        "https://glama.ai/mcp/connectors/tech.ydb-qdrant.pets/codex-pets-ydb-qdrant",
      ]),
    });
    expect(
      homepageNodes.find((node) => node["@type"] === "ItemList"),
    ).toMatchObject({
      name: "Featured Codex pet packs",
      numberOfItems: 1,
    });
    expect(
      homepageNodes.find((node) => node["@type"] === "WebPage"),
    ).toMatchObject({
      speakable: {
        cssSelector: [".home-hero__lead"],
      },
    });

    vi.unstubAllEnvs();
  });
});

describe("pet resource alternates", () => {
  it("advertises JSON, TOON, and markdown pet resources", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { getPetResourceAlternateTypes } = await import(
      "@/lib/site-metadata"
    );

    expect(getPetResourceAlternateTypes("kuroa", "Kuroa")).toEqual({
      "application/json": [
        {
          title: "Kuroa JSON",
          url: "/codex-pets/api/pets/kuroa",
        },
      ],
      "text/toon": [
        {
          title: "Kuroa TOON",
          url: "/codex-pets/api/pets/kuroa.toon",
        },
      ],
      "text/markdown": [
        {
          title: "Kuroa markdown",
          url: "/codex-pets/pets/kuroa/markdown",
        },
      ],
    });

    vi.unstubAllEnvs();
  });
});
