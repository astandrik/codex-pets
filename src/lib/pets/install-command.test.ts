import { describe, expect, it } from "vitest";

import { buildPetInstallCommand } from "@/lib/pets/install-command";

describe("pet install command", () => {
  it("builds the public npx install command for a slug", () => {
    expect(buildPetInstallCommand("zero-two-2")).toBe(
      "npx @astandrik/codex-pets install zero-two-2",
    );
  });
});
