// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { HomePage } from "@/components/HomePage/HomePage";

describe("HomePage visible content", () => {
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
});

function renderHomePage(): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    HomePage({
      pets: [],
      filteredPets: [],
      filteredTotal: 0,
      query: "",
      kind: "all",
      selectedTags: [],
      suggestedTags: [],
    }),
  );
  return container;
}
