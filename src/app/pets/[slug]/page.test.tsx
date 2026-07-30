// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getPetBySlug: vi.fn(),
  getPetMetrics: vi.fn(),
  listRelatedPetCandidates: vi.fn(),
  listApprovedPetsBySlugs: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  listPublicUserProfilesByIds: vi.fn(async () => new Map()),
}));
const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
}));
vi.mock("@/lib/pets/repository", () => repositoryMocks);
vi.mock("@/lib/auth/repository", () => authMocks);
vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/components/AskAI/AskAIPanel", () => ({ AskAIPanel: () => null }));
vi.mock("@/components/PetDeleteAction/PetDeleteGate", () => ({
  PetDeleteGate: () => null,
}));
vi.mock("@/components/PetDetails/PetBreadcrumbs", () => ({
  PetBreadcrumbs: () => null,
}));
vi.mock("@/components/InstallCommand/InstallCommandButton", () => ({
  InstallCommandButton: () => null,
}));
vi.mock("@/components/PetCard/PetCard", () => ({
  PetCard: ({
    pet,
  }: {
    pet: { slug: string; displayName: string; description: string };
  }) =>
    createElement(
      "article",
      { className: "pet-card", "data-slug": pet.slug },
      createElement("a", { href: `/pets/${pet.slug}` }, pet.displayName),
      createElement("p", null, pet.description),
    ),
}));
vi.mock("@/components/PetDetails/PetMetaList", () => ({
  PetMetaList: () => null,
}));
vi.mock("@/components/PetLikeButton/PetLikeButton", () => ({
  PetLikeButton: () => null,
}));
vi.mock("@/components/PetSharePanel/PetSharePanel", () => ({
  PetSharePanel: () => null,
}));
vi.mock("@/components/StatePreview/StatePreview", () => ({
  StatePreview: () => null,
}));
vi.mock("@/components/WebMCP/CurrentPetWebMCPTool", () => ({
  CurrentPetWebMCPTool: () => null,
}));

const approvedPetRow = {
  slug: "orbit-otter",
  id: "pet_orbit_otter",
  displayName: "Orbit Otter",
  description: "A compact space helper.",
  spritesheetUrl: "/api/assets/orbit-otter/sheet.webp",
  petJsonUrl: "/api/assets/orbit-otter/pet.json",
  zipUrl: "/api/assets/orbit-otter/package.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["space", "friendly"],
  status: "approved" as const,
  ownerId: "user-1",
  ownerEmail: null,
  ownerName: "Local Admin",
  contactEmail: null,
  rejectionReason: null,
  createdAt: "2026-05-02T10:00:00.000Z",
  updatedAt: "2026-05-04T10:00:00.000Z",
  approvedAt: "2026-05-04T10:00:00.000Z",
  rejectedAt: null,
};

const relatedCandidates = [
  {
    slug: "orbit-otter",
    displayName: "Orbit Otter",
    kind: "creature" as const,
    tags: ["space", "friendly"],
    description: "A compact space helper.",
    approvedAt: "2026-05-04T10:00:00.000Z",
    createdAt: "2026-05-02T10:00:00.000Z",
  },
  {
    slug: "terminal-cube",
    displayName: "Terminal Cube",
    kind: "object" as const,
    tags: ["space"],
    description: `A cube that lives in your terminal.\n${"Blinks while you type. ".repeat(10)}`,
    approvedAt: "2026-05-06T10:00:00.000Z",
    createdAt: "2026-05-05T10:00:00.000Z",
  },
  {
    slug: "star-fox",
    displayName: "Star Fox",
    kind: "creature" as const,
    tags: ["space", "friendly"],
    description: "A fox from the stars.",
    approvedAt: "2026-05-05T10:00:00.000Z",
    createdAt: "2026-05-04T10:00:00.000Z",
  },
];

const relatedSummaries: Record<
  string,
  { slug: string; displayName: string; description: string }
> = {
  "star-fox": {
    slug: "star-fox",
    displayName: "Star Fox",
    description: "A fox from the stars.",
  },
  "terminal-cube": {
    slug: "terminal-cube",
    displayName: "Terminal Cube",
    description: "A cube that lives in your terminal.",
  },
};

describe("/pets/[slug] related pets section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    repositoryMocks.getPetBySlug.mockResolvedValue(approvedPetRow);
    repositoryMocks.getPetMetrics.mockResolvedValue({
      downloadCount: 1,
      installCount: 2,
      likeCount: 3,
    });
    repositoryMocks.listRelatedPetCandidates.mockResolvedValue(
      relatedCandidates,
    );
    repositoryMocks.listApprovedPetsBySlugs.mockImplementation(
      async (slugs: string[]) =>
        slugs.flatMap((slug) => {
          const summary = relatedSummaries[slug];
          return summary ? [summary] : [];
        }),
    );
  });

  async function renderPetPage(slug = approvedPetRow.slug) {
    const { default: PetPage } = await import("@/app/pets/[slug]/page");
    const markup = renderToStaticMarkup(
      await PetPage({ params: Promise.resolve({ slug }) }),
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    return container;
  }

  it("renders a card per related slug in selector order after the body", async () => {
    const container = await renderPetPage();

    const section = container.querySelector(".related-pets");
    expect(section).not.toBeNull();
    expect(
      container.querySelector(".pet-detail__body + .related-pets"),
    ).not.toBeNull();

    const cardSlugs = Array.from(
      section!.querySelectorAll(".pet-grid .pet-card"),
    ).map((card) => card.getAttribute("data-slug"));
    expect(cardSlugs).toEqual(["star-fox", "terminal-cube"]);
    expect(cardSlugs).not.toContain("orbit-otter");
    expect(section!.querySelector("h2")?.textContent).toBe("Related pets");
  }, 20_000);

  it("hydrates full card data for the selected slugs in selector order", async () => {
    await renderPetPage();

    expect(repositoryMocks.listApprovedPetsBySlugs).toHaveBeenCalledWith([
      "star-fox",
      "terminal-cube",
    ]);
  }, 20_000);

  it("renders the full description inside the card", async () => {
    const container = await renderPetPage();

    const cube = container.querySelector(
      '.pet-card[data-slug="terminal-cube"] p',
    );
    expect(cube?.textContent).toBe("A cube that lives in your terminal.");
  }, 20_000);

  it("omits the section when no related candidates exist", async () => {
    repositoryMocks.listRelatedPetCandidates.mockResolvedValue([]);
    const container = await renderPetPage();

    expect(container.querySelector(".related-pets")).toBeNull();
    expect(repositoryMocks.listApprovedPetsBySlugs).not.toHaveBeenCalled();
  }, 20_000);

  it("renders the page without the section when the candidates lookup fails", async () => {
    repositoryMocks.listRelatedPetCandidates.mockRejectedValue(
      new Error("YDB timeout"),
    );
    const container = await renderPetPage();

    expect(container.querySelector(".pet-detail__body")).not.toBeNull();
    expect(container.querySelector(".related-pets")).toBeNull();
  }, 20_000);

  it("renders the page without the section when summary hydration fails", async () => {
    repositoryMocks.listApprovedPetsBySlugs.mockRejectedValue(
      new Error("YDB timeout"),
    );
    const container = await renderPetPage();

    expect(container.querySelector(".pet-detail__body")).not.toBeNull();
    expect(container.querySelector(".related-pets")).toBeNull();
  }, 20_000);

  it("omits the section and skips the related queries for pending pets", async () => {
    repositoryMocks.getPetBySlug.mockResolvedValue({
      ...approvedPetRow,
      status: "pending",
      approvedAt: null,
    });
    const container = await renderPetPage();

    expect(container.querySelector(".related-pets")).toBeNull();
    expect(repositoryMocks.listRelatedPetCandidates).not.toHaveBeenCalled();
    expect(repositoryMocks.listApprovedPetsBySlugs).not.toHaveBeenCalled();
  }, 20_000);
});
