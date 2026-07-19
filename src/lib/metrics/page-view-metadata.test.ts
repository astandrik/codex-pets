import { describe, expect, it } from "vitest";

import {
  parsePageViewMetadata,
  serializePageViewMetadata,
} from "@/lib/metrics/page-view-metadata";

describe("page-view metadata", () => {
  it("round-trips a local URL and its exact title", () => {
    const metadata = {
      title: 'Codex pets matching "red fox"',
      url: "/?q=red+fox",
    };

    expect(parsePageViewMetadata(serializePageViewMetadata(metadata))).toEqual(
      metadata,
    );
  });

  it.each([
    null,
    "not-json",
    JSON.stringify({ title: "Missing URL" }),
    JSON.stringify({ title: "External", url: "https://example.test/" }),
    JSON.stringify({ title: "Protocol relative", url: "//example.test/" }),
    JSON.stringify({ title: "", url: "/about" }),
  ])("rejects an invalid marker value", (value) => {
    expect(parsePageViewMetadata(value)).toBeNull();
  });
});
