import { describe, expect, it } from "vitest";

import {
  getMarkdownTwinPath,
  isMarkdownTwinSourcePath,
} from "@/lib/markdown-twins";

describe("markdown twins", () => {
  it("maps HTML pages to their markdown twins", () => {
    expect(getMarkdownTwinPath("/")).toBe("/index.md");
    expect(getMarkdownTwinPath("/about")).toBe("/about.md");
    expect(getMarkdownTwinPath("/agents")).toBe("/agents.md");
    expect(getMarkdownTwinPath("/developers")).toBe("/developers.md");
    expect(getMarkdownTwinPath("/docs/api")).toBe("/docs/api.md");
    expect(getMarkdownTwinPath("/guides/example")).toBeNull();
  });

  it("identifies pages that support markdown negotiation", () => {
    expect(isMarkdownTwinSourcePath("/about")).toBe(true);
    expect(isMarkdownTwinSourcePath("/about/")).toBe(true);
    expect(isMarkdownTwinSourcePath("/guides/example")).toBe(false);
  });
});
