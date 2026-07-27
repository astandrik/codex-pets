// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));
const recommendationMocks = vi.hoisted(() => ({
  buildHomeRecommendationEntryPoints: vi.fn(() => ({
    styleTags: [],
    popularPets: [],
    recentPets: [],
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock(
  "@/components/HomePage/recommendation-entry-points",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/HomePage/recommendation-entry-points")
      >();
    return {
      ...actual,
      buildHomeRecommendationEntryPoints:
        recommendationMocks.buildHomeRecommendationEntryPoints,
    };
  },
);

import { HomePage } from "@/components/HomePage/HomePage";
import type { PublicPetSummary } from "@/lib/pets/types";

describe("HomePage visible content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps long agent-only index copy out of the visual homepage", () => {
    const container = renderHomePage();

    expect(container.textContent).not.toContain("Codex Pets agent index");
  });

  it("renders a prominent link to the canonical best Codex pets guide", () => {
    const container = renderHomePage();

    const guideLink = container.querySelector(
      '.home-hero__actions a[href="/guides/best-codex-pets-for-ai-coding-agents"]',
    );

    expect(guideLink).not.toBeNull();
    expect(guideLink?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Best Codex pets guide",
    );
  });

  it("links the hero to the catalog rendered on the same page", () => {
    const container = renderHomePage();

    expect(
      container.querySelector('.home-hero__actions a[href="/#gallery"]'),
    ).not.toBeNull();
    expect(container.querySelector("#gallery")?.textContent).toContain(
      "catalog-slot",
    );
  });

  it("hides repeated landing content on numbered catalog pages", () => {
    const container = renderHomePage({ showLandingContent: false });

    expect(container.querySelector(".home-hero-card")).toBeNull();
    expect(container.querySelector(".home-ask-ai")).toBeNull();
    expect(container.querySelector("#gallery h1")?.textContent).toContain(
      "Codex Pets gallery",
    );
    expect(container.querySelector("#gallery")?.textContent).toContain(
      "catalog-slot",
    );
    expect(
      recommendationMocks.buildHomeRecommendationEntryPoints,
    ).not.toHaveBeenCalled();
  });

  it("lets the lucky picker choose pets beyond the first 12", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const pets = Array.from({ length: 13 }, (_, index) => createPet(index + 1));

    const container = renderHomePage({
      pets,
      totalPets: pets.length,
      catalogTotalPets: pets.length,
    });

    expect(container.querySelector(".home-hero-pet__name")?.textContent).toBe(
      "Pet 13",
    );
  });
});

function renderHomePage(
  overrides: Partial<Parameters<typeof HomePage>[0]> = {},
): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    HomePage({
      pets: [],
      totalPets: 0,
      catalogTotalPets: 0,
      showLandingContent: true,
      catalog: "catalog-slot",
      ...overrides,
    }),
  );
  return container;
}

function createPet(index: number): PublicPetSummary {
  const slug = `pet-${index}`;

  return {
    id: slug,
    slug,
    displayName: `Pet ${index}`,
    description: `Pet ${index} description`,
    spritesheetUrl: `/api/assets/${slug}/spritesheet.webp`,
    petJsonUrl: `/api/assets/${slug}/pet.json`,
    zipUrl: `/api/pets/${slug}/download`,
    spritesheetExt: "webp",
    kind: "creature",
    tags: [],
    status: "approved",
    ownerName: null,
    ownerProfileSlug: null,
    ownerAvatarUrl: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    likeCount: 0,
    downloadCount: 0,
    installCount: 0,
  };
}
