import { describe, expect, it, vi } from "vitest";

import { createGenerationWorkerRepository } from "./pet-generation-worker-repository.mjs";

describe("generation worker repository", () => {
  it("filters cleanup candidates to terminal runs before the batch limit", async () => {
    const queries = [];
    const repository = createGenerationWorkerRepository({
      withSession: async (operation) => operation({
        executeQuery: vi.fn(async (query) => {
          queries.push(query);
          return { resultSets: [{ rows: [] }] };
        }),
      }),
      TypedValues: { utf8: (value) => value, bool: (value) => value },
      leaseSeconds: 120,
      maxImageCalls: 15,
    });

    expect(await repository.cleanupExpired()).toBe(0);
    expect(queries[0]).toContain("INNER JOIN codex_pet_generation_runs");
    expect(queries[0]).toContain("r.status=$completed");
    expect(queries[0].indexOf("r.status=$completed")).toBeLessThan(queries[0].indexOf("LIMIT 100"));
  });
});
