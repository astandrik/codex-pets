// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getPublicUserProfileBySlug: vi.fn(),
}));
const petsMocks = vi.hoisted(() => ({
  listApprovedPetsForOwner: vi.fn(),
}));

vi.mock("@/lib/auth/repository", () => authMocks);
vi.mock("@/lib/pets/repository", () => petsMocks);
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const PROFILE = {
  userId: "user-1",
  displayName: "Test User",
  profileSlug: "tester",
  bio: "Builds pets.",
  websiteUrl: "https://example.com",
  githubUrl: "https://github.com/tester",
  linkedinUrl: "https://www.linkedin.com/in/tester",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const EXTERNAL_PROFILE_URLS = [
  PROFILE.websiteUrl,
  PROFILE.githubUrl,
  PROFILE.linkedinUrl,
];

describe("/users/[profileSlug] external links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    authMocks.getPublicUserProfileBySlug.mockResolvedValue(PROFILE);
    petsMocks.listApprovedPetsForOwner.mockResolvedValue([]);
  });

  async function renderUserPage() {
    const { default: UserPage } = await import(
      "@/app/users/[profileSlug]/page"
    );
    const markup = renderToStaticMarkup(
      await UserPage({ params: Promise.resolve({ profileSlug: "tester" }) }),
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    return container;
  }

  it("qualifies user-provided external links as nofollow ugc", async () => {
    const container = await renderUserPage();

    for (const href of EXTERNAL_PROFILE_URLS) {
      const anchor = container.querySelector(`a[href="${href}"]`);

      expect(anchor, href).not.toBeNull();
      expect(anchor?.getAttribute("rel")).toBe("nofollow ugc noreferrer");
    }
  }, 20_000);

  it("does not nofollow the internal gallery link", async () => {
    const container = await renderUserPage();

    const galleryLink = container.querySelector('a[href="/"]');

    expect(galleryLink).not.toBeNull();
    expect(galleryLink?.getAttribute("rel") ?? "").not.toContain("nofollow");
  }, 20_000);
});
