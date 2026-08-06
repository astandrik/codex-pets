// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AboutPage from "@/app/about/page";
import HowCodexPetsWorksPage from "@/app/guides/how-codex-pets-works/page";
import {
  HOW_CODEX_PETS_WORKS_DIAGRAMS,
  HOW_CODEX_PETS_WORKS_PATH,
  HOW_CODEX_PETS_WORKS_SCREENSHOTS,
  HOW_CODEX_PETS_WORKS_TITLE,
} from "@/lib/guides/how-codex-pets-works";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SCREENSHOT_DIMENSIONS = {
  "winnie-search": { width: 1160, height: 489 },
  "winnie-related": { width: 1160, height: 408 },
} as const;

function readPngDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

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
    expect(
      Array.from(
        container.querySelectorAll('[data-guide-figure="diagram"] img'),
      ).every((image) => !image.getAttribute("src")?.includes("/_next/image")),
    ).toBe(true);
    expect(
      Array.from(
        container.querySelectorAll('[data-guide-figure="screenshot"] img'),
      ).every((image) => image.getAttribute("src")?.includes("/_next/image")),
    ).toBe(true);

    const links = Array.from(container.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual(
      expect.arrayContaining(["/", "/submit", "/developers"]),
    );
    expect(container.textContent).toContain("while the card is pending");
    expect(container.textContent).toContain("uses the heuristic order");
    expect(container.textContent).not.toContain(
      "previous compatible generation stays active",
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

      if (diagram.id === "pet-pack-lifecycle") {
        expect(source).toContain("pending metadata");
      }
      if (diagram.id === "related-pets-generation") {
        expect(source).toContain("Heuristic fallback");
      }
    }
  });

  it("ships exactly two local screenshot assets", () => {
    expect(HOW_CODEX_PETS_WORKS_SCREENSHOTS).toHaveLength(2);
    for (const screenshot of HOW_CODEX_PETS_WORKS_SCREENSHOTS) {
      const bytes = readFileSync(
        join(process.cwd(), "public", screenshot.src.replace(/^\//, "")),
      );
      expect(readPngDimensions(bytes)).toEqual(
        SCREENSHOT_DIMENSIONS[screenshot.id],
      );
    }
  });

  it("links the About page to the illustrated guide", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(AboutPage());
    const guideLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.trim() === "See how the system works",
    );

    expect(guideLink?.getAttribute("href")).toBe(HOW_CODEX_PETS_WORKS_PATH);
  });
});
