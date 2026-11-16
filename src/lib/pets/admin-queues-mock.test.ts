import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("keeps pending submissions oldest-first, breaks timestamp ties by slug and excludes moderated rows", async () => {
  vi.resetModules();
  vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
  const { listMockPetRecords, createMockPetRecord, softDeleteMockPetById } = await import("./mock-data");
  const remove = (petId: string) => softDeleteMockPetById({ petId, actorRole: "admin", actorUserId: "test-admin" });
  for (const pet of listMockPetRecords().filter(p => p.status === "pending")) remove(pet.id);
  const { listPendingPets } = await import("./repository");
  const created = [];
  for (let index = 200; index >= 0; index--) {
    const pet = createMockPetRecord({
      requestedSlug: `queue-${String(index).padStart(3, "0")}`, displayName: "Queue pet",
      description: "Fixture", kind: "creature", tags: [], ownerId: "", ownerEmail: null,
      ownerName: null, contactEmail: null, spritesheetUrl: "/sprite.webp",
      petJsonUrl: "/pet.json", zipUrl: "/pet.zip", spritesheetExt: "webp",
    });
    pet.createdAt = "2026-01-01T00:00:00Z";
    created.push(pet);
  }
  try {
    const ids = [];
    for (let page = 1; page <= 5; page++) {
      const result = await listPendingPets(page);
      expect(result.pagination.totalItems).toBe(201);
      ids.push(...result.items.map(p => p.slug));
    }
    expect(ids).toEqual(Array.from({ length: 201 }, (_, i) => `queue-${String(i).padStart(3, "0")}`));
    remove(created[0].id);
    expect(await listPendingPets(5)).toMatchObject({ pagination: { page: 4, totalItems: 200 } });
  } finally {
    for (const pet of created) remove(pet.id);
  }
});

it("keeps active requests first with deterministic ties and excludes deleted requests across 201+ records", async () => {
  vi.resetModules();
  vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
  vi.useFakeTimers();
  vi.setSystemTime("2026-01-01T00:00:00Z");
  const { createGenerationRequest, listGenerationRequests } = await import("./generation-requests-repository");
  const records = [];
  for (let i = 0; i < 203; i++) {
    records.push(await createGenerationRequest({
      kind: "creature", displayNameHint: `Request ${i}`, prompt: "Fixture",
      contactEmail: "private@example.test", requesterName: null, requesterUserId: null,
    }));
  }
  records[0].status = "deleted";
  records[1].status = "fulfilled";
  records[1].createdAt = "2026-03-01T00:00:00Z";
  records[2].status = "in_progress";
  records[2].createdAt = "2026-02-01T00:00:00Z";
  const ids = [];
  for (let page = 1; page <= 5; page++) {
    const result = await listGenerationRequests(page);
    expect(result.pagination.totalItems).toBe(202);
    ids.push(...result.items.map(r => r.id));
  }
  expect(ids).toHaveLength(202);
  expect(new Set(ids).size).toBe(202);
  expect(ids[0]).toBe(records[2].id);
  expect(ids.at(-1)).toBe(records[1].id);
  expect(ids).not.toContain(records[0].id);
  expect(ids.slice(1, -1)).toEqual(records.slice(3).map(r => r.id).sort());
});
