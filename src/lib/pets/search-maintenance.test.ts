import { describe, expect, it, vi } from "vitest";

import { deletePetSearchIndexBestEffort } from "@/lib/pets/search-maintenance";

describe("pet search index maintenance", () => {
  it("removes every vector revision and caption for a pet slug", async () => {
    const removeEmbeddings = vi.fn(async () => undefined);
    const removeCaptions = vi.fn(async () => undefined);

    await expect(
      deletePetSearchIndexBestEffort("velvet-byte", {
        removeEmbeddings,
        removeCaptions,
      }),
    ).resolves.toBe(true);
    expect(removeEmbeddings).toHaveBeenCalledWith("velvet-byte");
    expect(removeCaptions).toHaveBeenCalledWith("velvet-byte");
  });

  it("attempts both removals and does not propagate cleanup failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const removeCaptions = vi.fn(async () => undefined);

    await expect(
      deletePetSearchIndexBestEffort("velvet-byte", {
        removeEmbeddings: async () => {
          throw new Error("database unavailable");
        },
        removeCaptions,
      }),
    ).resolves.toBe(false);
    expect(removeCaptions).toHaveBeenCalledWith("velvet-byte");
    expect(warn).toHaveBeenCalledWith(
      "[codex-pets][pet-search-index]",
      { operation: "delete", status: "failed" },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("velvet-byte");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "database unavailable",
    );

    warn.mockRestore();
  });
});
