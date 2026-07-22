import { describe, expect, it, vi } from "vitest";

import { deletePetSearchEmbeddingsBestEffort } from "@/lib/pets/search-maintenance";

describe("pet search embedding maintenance", () => {
  it("removes every model revision for a pet slug", async () => {
    const remove = vi.fn(async () => undefined);

    await expect(
      deletePetSearchEmbeddingsBestEffort("velvet-byte", remove),
    ).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith("velvet-byte");
  });

  it("does not propagate vector cleanup failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      deletePetSearchEmbeddingsBestEffort("velvet-byte", async () => {
        throw new Error("database unavailable");
      }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[codex-pets][pet-search-embedding]",
      { operation: "delete", status: "failed" },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("velvet-byte");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "database unavailable",
    );

    warn.mockRestore();
  });
});
