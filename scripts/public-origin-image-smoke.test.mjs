import { describe, expect, it } from "vitest";

import { verifyHtmlMetadata } from "./public-origin-image-smoke.mjs";

const expectedUrl = "https://pets.example/codex-pets/pets/orbit-otter";

function metadata({
  canonical = expectedUrl,
  openGraph = expectedUrl,
  jsonLd = { "@context": "https://schema.org", "@type": "CreativeWork", url: expectedUrl },
  omit,
} = {}) {
  const tags = {
    canonical: `<link rel="canonical" href="${canonical}">`,
    openGraph: `<meta property="og:url" content="${openGraph}">`,
    jsonLd: `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  };
  return Object.entries(tags)
    .filter(([field]) => field !== omit)
    .map(([, tag]) => tag)
    .join("\n");
}

describe("production smoke HTML metadata", () => {
  it("accepts the expected canonical, OpenGraph and pet JSON-LD URLs", () => {
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

  it.each([
    "https://wrong.example/codex-pets/pets/orbit-otter",
    "https://pets.example/pets/orbit-otter",
  ])("rejects a wrong pet JSON-LD URL despite correct HTML metadata: %s", (url) => {
    expect(() => verifyHtmlMetadata(metadata({
      jsonLd: { "@type": "CreativeWork", url },
    }), expectedUrl)).toThrow(/JSON-LD/);
  });

  it.each([
    { "@type": "CreativeWork" },
    { "@type": "WebSite", url: expectedUrl },
  ])("requires the pet JSON-LD object and its URL: %j", (jsonLd) => {
    expect(() => verifyHtmlMetadata(metadata({ jsonLd }), expectedUrl)).toThrow(/JSON-LD/);
  });

  const unrelatedJsonLd = `<script type="application/ld+json">${JSON.stringify({
    "@type": "WebSite", url: expectedUrl,
  })}</script>`;

  it("finds the pet after unrelated JSON-LD scripts", () => {
    expect(() => verifyHtmlMetadata(unrelatedJsonLd + metadata(), expectedUrl)).not.toThrow();
  });

  it("does not let an unrelated JSON-LD URL mask a wrong pet URL", () => {
    expect(() => verifyHtmlMetadata(unrelatedJsonLd + metadata({
      jsonLd: { "@type": "CreativeWork", url: "https://wrong.example/codex-pets/pets/orbit-otter" },
    }), expectedUrl)).toThrow(/JSON-LD/);
  });
});
