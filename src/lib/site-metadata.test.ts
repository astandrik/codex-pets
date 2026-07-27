import { describe, expect, it, vi } from "vitest";
import { parseGalleryFilters } from "@/lib/pets/gallery-filters";

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
    }, true);

    expect(metadata.title).toBe("Codex pets tagged #space");
    expect(metadata.description).toContain("tagged #space");
    expect(metadata.alternates?.canonical).toBe("/codex-pets");
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
      url: "/codex-pets?tags=space",
    });
    expect(metadata.other).toEqual({
      "codex-pets-page-view": JSON.stringify({
        title: "Codex pets tagged #space",
        url: "/codex-pets?tags=space",
      }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });

    vi.unstubAllEnvs();
  });

  it("keeps combined gallery resources filtered while canonicalizing the homepage", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { buildGalleryPageMetadata } = await import("@/lib/site-metadata");
    const metadata = buildGalleryPageMetadata({
      query: "green",
      kind: "object",
      tags: ["terminal", "space"],
    }, true);

    expect(metadata.title).toBe(
      'Object Codex pets matching "green" tagged #space and #terminal',
    );
    expect(metadata.alternates?.canonical).toBe("/");
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
    expect(metadata.other).toEqual({
      "codex-pets-page-view": JSON.stringify({
        title:
          'Object Codex pets matching "green" tagged #space and #terminal',
        url: "/?q=green&kind=object&tags=space,terminal",
      }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });

    vi.unstubAllEnvs();
  });

  it.each([
    ["empty query", { q: "" }, "/?q=", "/codex-pets?q="],
    ["empty tags", { tags: "" }, "/?tags=", "/codex-pets?tags="],
    ["default kind", { kind: "all" }, "/?kind=all", "/codex-pets?kind=all"],
    [
      "invalid kind",
      { kind: "not-a-kind" },
      "/?kind=not-a-kind",
      "/codex-pets?kind=not-a-kind",
    ],
  ])(
    "marks the canonical homepage noindex when a raw %s filter key normalizes away",
    async (
      _caseName,
      rawSearchParams,
      pageViewPath,
      expectedPageViewPath,
    ) => {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test/codex-pets");
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

      const { buildGalleryPageMetadata } = await import("@/lib/site-metadata");

      expect(
        buildGalleryPageMetadata(
          parseGalleryFilters(rawSearchParams),
          true,
          pageViewPath,
        ),
      ).toEqual({
        other: {
          "codex-pets-page-view": JSON.stringify({
            title: "Codex Pets - Animated pet packs for AI coding agents",
            url: expectedPageViewPath,
          }),
        },
        alternates: { canonical: "/codex-pets" },
        robots: { index: false, follow: true },
      });

      vi.unstubAllEnvs();
    },
  );

  it("leaves the unfiltered homepage to layout metadata when no raw filter key exists", async () => {
    vi.resetModules();

    const { buildGalleryPageMetadata } = await import("@/lib/site-metadata");

    expect(
      buildGalleryPageMetadata({ query: "", kind: "all", tags: [] }, false),
    ).toEqual({});
  });

  it("correlates unrelated query changes without changing index metadata", async () => {
    vi.resetModules();

    const { buildGalleryPageMetadata } = await import("@/lib/site-metadata");

    expect(
      buildGalleryPageMetadata(
        { query: "", kind: "all", tags: [] },
        false,
        "/?utm_source=agent",
      ),
    ).toEqual({
      other: {
        "codex-pets-page-view": JSON.stringify({
          title: "Codex Pets - Animated pet packs for AI coding agents",
          url: "/?utm_source=agent",
        }),
      },
    });
  });
});

describe("catalog page metadata", () => {
  it("self-canonicalizes an unfiltered numbered catalog page", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { buildCatalogPageMetadata } = await import("@/lib/site-metadata");
    const metadata = buildCatalogPageMetadata(
      { query: "", kind: "all", tags: [] },
      2,
      false,
    );

    expect(metadata.title).toBe("Codex Pets gallery – Page 2");
    expect(metadata.alternates?.canonical).toBe(
      "/codex-pets?page=2",
    );
    expect(metadata.alternates?.types).toMatchObject({
      "application/json": [
        { url: "/codex-pets/api/pets?page=2&pageSize=24" },
      ],
      "text/toon": [
        { url: "/codex-pets/api/pets.toon?page=2&pageSize=24" },
      ],
    });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({
      url: "/codex-pets?page=2",
    });

    vi.unstubAllEnvs();
  });

  it("noindexes filtered pages while keeping links followable", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { buildCatalogPageMetadata } = await import("@/lib/site-metadata");
    const metadata = buildCatalogPageMetadata(
      { query: "space", kind: "creature", tags: ["friendly"] },
      2,
      true,
    );

    expect(metadata.alternates?.canonical).toBe("/codex-pets");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.types).toMatchObject({
      "application/json": [
        {
          url:
            "/codex-pets/api/pets?q=space&kind=creature&tags=friendly&page=2&pageSize=24",
        },
      ],
    });

    vi.unstubAllEnvs();
  });

  it("uses global item positions in catalog JSON-LD", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { getCatalogJsonLdGraph } = await import("@/lib/site-metadata");
    const graph = getCatalogJsonLdGraph(
      [
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
      ],
      2,
      24,
      49,
    );
    const nodes = graph["@graph"] as Array<Record<string, unknown>>;
    const itemList = nodes.find((node) => node["@type"] === "ItemList") as {
      numberOfItems: number;
      itemListElement: Array<{ position: number }>;
    };

    expect(nodes.map((node) => node["@type"])).toEqual([
      "CollectionPage",
      "ItemList",
    ]);
    expect(itemList.numberOfItems).toBe(49);
    expect(itemList.itemListElement[0]?.position).toBe(25);

    vi.unstubAllEnvs();
  });
});

describe("site identity metadata", () => {
  it("keeps global JSON-LD free of unsupported rich-result entities", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { getWebsiteJsonLd } = await import("@/lib/site-metadata");
    const graph = getWebsiteJsonLd();
    const nodes = graph["@graph"] as Array<Record<string, unknown>>;

    expect(nodes.map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
    expect(nodes.find((node) => node["@type"] === "WebSite")).toMatchObject({
      name: "Codex Pets",
      url: "https://pets.example/",
      potentialAction: {
        target:
          "https://pets.example/?q={search_term_string}",
      },
    });

    vi.unstubAllEnvs();
  });

  it("does not reference unsupported product or software rich-result entities", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { getHomepageJsonLdGraph } = await import("@/lib/site-metadata");
    const graph = getHomepageJsonLdGraph();
    const nodes = graph["@graph"] as Array<Record<string, unknown>>;
    const webPage = nodes.find((node) => node["@type"] === "WebPage");
    const aboutIds = Array.isArray(webPage?.about)
      ? webPage.about.map((item) =>
          typeof item === "object" && item !== null && "@id" in item
            ? item["@id"]
            : undefined,
        )
      : [];

    expect(aboutIds).not.toContain("https://pets.example/#product");
    expect(aboutIds).not.toContain("https://pets.example/#software");

    vi.unstubAllEnvs();
  });

  it("uses Codex Pets as the canonical site name and keeps homepage JSON-LD page-specific", async () => {
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
      "WebSite",
    ]);
    expect(homepageNodes.map((node) => node["@type"])).toEqual([
      "WebPage",
      "FAQPage",
      "ItemList",
    ]);
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
