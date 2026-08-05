import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deletePetSearchIndexBestEffort: vi.fn(async () => true),
  executeQuery: vi.fn(),
  withSession: vi.fn(),
}));

vi.mock("@/lib/ydb/client", () => ({
  TypedValues: {
    utf8: (value: string) => ({ textValue: value }),
  },
  isYdbConfigured: () => true,
  withSession: mocks.withSession,
}));

vi.mock("@/lib/pets/search-maintenance", () => ({
  deletePetSearchIndexBestEffort: mocks.deletePetSearchIndexBestEffort,
}));

import { softDeletePetByIdWithPreviousStatus } from "@/lib/pets/repository";

type StoredPet = {
  status: "pending" | "approved" | "deleted";
  updatedAt: string;
};

function petResult(pet: StoredPet) {
  const values = [
    "race-pet",
    "pet_1",
    "Race Pet",
    "Description",
    "/spritesheet.webp",
    "/pet.json",
    "/pet.zip",
    "webp",
    "creature",
    "[]",
    pet.status,
    "owner_1",
    "owner@example.com",
    "Owner",
    "owner@example.com",
    "",
    "2026-08-03T09:00:00.000Z",
    pet.updatedAt,
    pet.status === "approved" ? "2026-08-03T10:01:00.000Z" : "",
    "",
  ];
  return {
    resultSets: [
      {
        rows: [
          {
            items: values.map((textValue) => ({ textValue })),
          },
        ],
      },
    ],
  };
}

describe("softDeletePetByIdWithPreviousStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.withSession.mockImplementation((callback) =>
      callback({ executeQuery: mocks.executeQuery }),
    );
  });

  it("retries a guarded delete when approval wins the first write race", async () => {
    let pet: StoredPet = {
      status: "pending",
      updatedAt: "2026-08-03T10:00:00.000Z",
    };
    let updateAttempts = 0;
    mocks.executeQuery.mockImplementation(async (statement, params) => {
      if (statement.includes("SELECT slug")) return petResult(pet);
      if (!statement.includes("UPDATE codex_pets")) {
        return { resultSets: [] };
      }

      updateAttempts += 1;
      if (updateAttempts === 1) {
        pet = {
          status: "approved",
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
      }
      const expectedStatus = (params.$expected_status as { textValue: string })
        .textValue;
      const expectedUpdatedAt = (
        params.$expected_updated_at as { textValue: string }
      ).textValue;
      if (
        pet.status === expectedStatus &&
        pet.updatedAt === expectedUpdatedAt
      ) {
        pet = {
          status: "deleted",
          updatedAt: (params.$updated_at as { textValue: string }).textValue,
        };
      }
      return { resultSets: [] };
    });

    await expect(
      softDeletePetByIdWithPreviousStatus({
        petId: "pet_1",
        actorUserId: "owner_1",
        actorRole: "user",
      }),
    ).resolves.toEqual({ previousStatus: "approved" });

    expect(updateAttempts).toBe(2);
    const updates = mocks.executeQuery.mock.calls.filter(([statement]) =>
      String(statement).includes("UPDATE codex_pets"),
    );
    expect(updates).toHaveLength(2);
    for (const [statement] of updates) {
      expect(statement).toContain("status = $expected_status");
      expect(statement).toContain("updated_at = $expected_updated_at");
    }
    expect(mocks.deletePetSearchIndexBestEffort).toHaveBeenCalledWith(
      "race-pet",
    );
  });
});
