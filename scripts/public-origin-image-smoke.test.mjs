import { describe, expect, it } from "vitest";

import { verifyHtmlMetadata } from "./public-origin-image-smoke.mjs";

const expectedUrl = "https://pets.example/codex-pets/pets/orbit-otter";

function metadata({ canonical = expectedUrl, openGraph = expectedUrl, omit } = {}) {
  const tags = {
    canonical: `<link rel="canonical" href="${canonical}">`,
    openGraph: `<meta property="og:url" content="${openGraph}">`,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({ url: expectedUrl })}</script>`,
  };
  return Object.entries(tags)
    .filter(([field]) => field !== omit)
    .map(([, tag]) => tag)
    .join("\n");
}

describe("production smoke HTML metadata", () => {
  it("accepts the expected canonical and OpenGraph URLs", () => {
    expect(() => verifyHtmlMetadata(metadata(), expectedUrl)).not.toThrow();
  });

  it.each([
    ["canonical", "https://wrong.example/codex-pets/pets/orbit-otter"],
    ["openGraph", "https://wrong.example/codex-pets/pets/orbit-otter"],
    ["canonical", "https://pets.example/pets/orbit-otter"],
    ["openGraph", "https://pets.example/pets/orbit-otter"],
  ])("rejects a wrong %s URL even with correct JSON-LD: %s", (field, url) => {
    expect(() =>
      verifyHtmlMetadata(metadata({ [field]: url }), expectedUrl),
    ).toThrow();
  });

  it("rejects both metadata URLs when only JSON-LD has the expected URL", () => {
    expect(() =>
      verifyHtmlMetadata(metadata({
        canonical: "https://wrong.example/codex-pets/pets/orbit-otter",
        openGraph: "https://wrong.example/codex-pets/pets/orbit-otter",
      }), expectedUrl),
    ).toThrow();
  });

  it.each(["canonical", "openGraph", "jsonLd"])("rejects missing metadata %s", (omit) => {
    expect(() =>
      verifyHtmlMetadata(metadata({ omit }), expectedUrl),
    ).toThrow();
  });
});
