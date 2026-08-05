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

import { moderatePetWithPreviousStatus } from "@/lib/pets/repository";

type StoredPet = {
  status: "pending" | "approved" | "rejected";
  updatedAt: string;
  approvedAt: string;
  rejectedAt: string;
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
    "",
    "owner@example.com",
    "Owner",
    "owner@example.com",
    "",
    "2026-08-03T09:00:00.000Z",
    pet.updatedAt,
    pet.approvedAt,
    pet.rejectedAt,
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

function textParam(params: unknown, name: string): string {
  return (params as Record<string, { textValue: string }>)[name].textValue;
}

describe("moderatePetWithPreviousStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.withSession.mockImplementation((callback) =>
      callback({ executeQuery: mocks.executeQuery }),
    );
  });

  it("retries a guarded rejection when approval wins the first write race", async () => {
    let pet: StoredPet = {
      status: "pending",
      updatedAt: "2026-08-03T10:00:00.000Z",
      approvedAt: "",
      rejectedAt: "",
    };
    let updateAttempts = 0;
    mocks.executeQuery.mockImplementation(async (statement, params) => {
      const query = String(statement);
      if (query.includes("SELECT slug")) return petResult(pet);
      if (!query.includes("UPDATE codex_pets")) {
        return { resultSets: [] };
      }

      updateAttempts += 1;
      if (updateAttempts === 1) {
        pet = {
          status: "approved",
          updatedAt: "2026-08-03T10:01:00.000Z",
          approvedAt: "2026-08-03T10:01:00.000Z",
          rejectedAt: "",
        };
      }

      const hasGuard = query.includes("status = $expected_status");
      const guardMatches =
        hasGuard &&
        pet.status === textParam(params, "$expected_status") &&
        pet.updatedAt === textParam(params, "$expected_updated_at");
      if (!hasGuard || guardMatches) {
        pet = {
          status: textParam(params, "$status") as StoredPet["status"],
          updatedAt: textParam(params, "$updated_at"),
          approvedAt: textParam(params, "$approved_at"),
          rejectedAt: textParam(params, "$rejected_at"),
        };
      }
      return { resultSets: [] };
    });

    await expect(
      moderatePetWithPreviousStatus({
        petId: "pet_1",
        reviewerId: "admin_1",
        decision: "rejected",
        reason: "not ready",
      }),
    ).resolves.toMatchObject({
      previousStatus: "approved",
      pet: { slug: "race-pet", status: "rejected" },
    });

    expect(updateAttempts).toBe(2);
    const updates = mocks.executeQuery.mock.calls.filter(([statement]) =>
      String(statement).includes("UPDATE codex_pets"),
    );
    expect(updates).toHaveLength(2);
    for (const [statement] of updates) {
      expect(statement).toContain("status = $expected_status");
      expect(statement).toContain("updated_at = $expected_updated_at");
    }
    const reviews = mocks.executeQuery.mock.calls.filter(([statement]) =>
      String(statement).includes("UPSERT INTO codex_pet_reviews"),
    );
    expect(reviews).toHaveLength(1);
    expect(mocks.deletePetSearchIndexBestEffort).toHaveBeenCalledOnce();
    expect(mocks.deletePetSearchIndexBestEffort).toHaveBeenCalledWith(
      "race-pet",
    );
  });
});
