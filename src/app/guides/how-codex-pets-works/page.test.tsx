// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HowCodexPetsWorksPage from "@/app/guides/how-codex-pets-works/page";
import {
  HOW_CODEX_PETS_WORKS_DIAGRAMS,
  HOW_CODEX_PETS_WORKS_SCREENSHOTS,
  HOW_CODEX_PETS_WORKS_TITLE,
} from "@/lib/guides/how-codex-pets-works";

describe("How Codex Pets works page", () => {
  it("renders the illustrated static guide and internal CTAs", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(HowCodexPetsWorksPage());

    expect(container.querySelector("h1")?.textContent).toBe(
      HOW_CODEX_PETS_WORKS_TITLE,
    );
    expect(
      container.querySelectorAll('[data-guide-figure="diagram"]'),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll('[data-guide-figure="screenshot"]'),
    ).toHaveLength(2);
    expect(container.querySelectorAll("figcaption")).toHaveLength(6);
    expect(
      Array.from(container.querySelectorAll("img")).every(
        (image) => (image.getAttribute("alt")?.trim().length ?? 0) > 0,
      ),
    ).toBe(true);

    const links = Array.from(container.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual(
      expect.arrayContaining(["/", "/submit", "/developers"]),
    );
    expect(container.innerHTML).not.toContain("habr.com");
  });

  it("keeps every diagram self-contained and script-free", () => {
    for (const diagram of HOW_CODEX_PETS_WORKS_DIAGRAMS) {
      const source = readFileSync(
        join(process.cwd(), "public", diagram.src.replace(/^\//, "")),
        "utf8",
      );

      expect(source).toMatch(/<svg[^>]+viewBox=/);
      expect(source).not.toContain("<script");
      expect(source).not.toContain("@import");
      expect(source).not.toContain("fonts.googleapis.com");
    }
  });

  it("ships exactly two local screenshot assets", () => {
    expect(HOW_CODEX_PETS_WORKS_SCREENSHOTS).toHaveLength(2);
    for (const screenshot of HOW_CODEX_PETS_WORKS_SCREENSHOTS) {
      const bytes = readFileSync(
        join(process.cwd(), "public", screenshot.src.replace(/^\//, "")),
      );
      expect(bytes.byteLength).toBeGreaterThan(10_000);
    }
  });

  it("links the About page to the illustrated guide", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/about/page.tsx"),
      "utf8",
    );

    expect(source).toContain("See how the system works");
    expect(source).toContain("HOW_CODEX_PETS_WORKS_PATH");
  });
});
