// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Footer } from "@/components/Footer/Footer";

const EXPECTED_GUIDES = [
  { href: "/guides/ai-pet-generator", label: "AI pet generator" },
  {
    href: "/guides/how-codex-pets-works",
    label: "How Codex Pets works",
  },
  {
    href: "/guides/best-codex-pets-for-ai-coding-agents",
    label: "Best Codex pets for AI coding agents",
  },
  {
    href: "/guides/codex-pets-mcp-integration-guide",
    label: "Codex Pets MCP integration guide",
  },
  {
    href: "/guides/codex-pets-vs-vscode-pets",
    label: "Codex Pets vs VS Code Pets",
  },
  {
    href: "/guides/codex-pets-vs-openpets",
    label: "Codex Pets vs OpenPets",
  },
] as const;

describe("Footer Learn navigation", () => {
  it("renders every canonical HTML guide as a descriptive link", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(Footer());

    const learnNavigation = container.querySelector('nav[aria-label="Learn"]');
    const links = Array.from(learnNavigation?.querySelectorAll("a") ?? []).map(
      (link) => ({
        href: link.getAttribute("href"),
        label: link.textContent?.trim(),
      }),
    );

    expect(learnNavigation).not.toBeNull();
    expect(learnNavigation?.textContent).toContain("Learn");
    expect(links).toEqual(EXPECTED_GUIDES);
    expect(links.every(({ href }) => !href?.endsWith(".md"))).toBe(true);
  });
});

it("keeps resources inside a native disclosure in server HTML", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(Footer());
  const details = container.querySelector("details");
  expect(details?.hasAttribute("open")).toBe(false);
  expect(details?.querySelector("summary")?.textContent).toBe("Guides, developers & API");
  for (const href of ["/about", "/developers", "/docs/api", "/openapi.json", "/llms-full.txt", "/api/manifest", "https://github.com/gravity-ui/uikit", "https://ydb.tech/"]) {
    expect(details?.querySelector(`a[href="${href}"]`)).not.toBeNull();
  }
});
