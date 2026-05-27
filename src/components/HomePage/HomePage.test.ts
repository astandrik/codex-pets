import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HomePage visible content", () => {
  it("keeps long agent-only index copy out of the visual homepage", () => {
    const source = readFileSync(new URL("HomePage.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("home-agent-summary");
    expect(source).not.toContain("Codex Pets agent index");
  });
});
