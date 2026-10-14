import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ claim: vi.fn(), getPreparation: vi.fn(), getPet: vi.fn(), metadata: vi.fn(),
  search: vi.fn(), related: vi.fn(), annotation: vi.fn(), vision: vi.fn(), build: vi.fn(),
  finalize: vi.fn(), failure: vi.fn(), paused: false }));
vi.mock("@/lib/pets/openai-embedding-profile", async (original) => ({
  ...await original<typeof import("@/lib/pets/openai-embedding-profile")>(), isOpenAIPetsProfile: () => true,
}));
vi.mock("@/lib/pets/moderation-pause", () => ({ petModerationPaused: () => mocks.paused }));
vi.mock("@/lib/pets/approval-preparations-repository", () => ({
  claimNextApprovalPreparation: mocks.claim, getApprovalPreparation: mocks.getPreparation,
  finalizeApprovalPreparation: mocks.finalize, markApprovalPreparationFailure: mocks.failure, createApprovalReviewId: () => "review-fixture",
}));
vi.mock("@/lib/pets/repository", () => ({ getPetForApprovalPreparationById: mocks.getPet }));
vi.mock("@/lib/pets/metadata-worker/approval", () => ({ prepareOpenAIApprovalMetadata: mocks.metadata }));
vi.mock("@/lib/pets/search-runtime", () => ({ refreshApprovedPetSearchEmbedding: mocks.search }));
vi.mock("@/lib/pets/related-pets-query-runtime", () => ({ refreshApprovedPetRelatedDescriptionEmbeddingsStrict: mocks.related }));
vi.mock("@/lib/pets/related-pets-annotation-runtime", () => ({ refreshPetRelatedAnnotation: mocks.annotation }));
vi.mock("@/lib/pets/search-vision-runtime", () => ({ refreshApprovedPetVisionSearch: mocks.vision }));
vi.mock("@/lib/pets/related-pets-rebuild", () => ({ prepareRelatedPetsGeneration: mocks.build }));
vi.mock("@/lib/pets/related-pets-repository", () => ({ cleanupRelatedPetsGenerations: async () => true, cleanupInactiveRelatedPetsGeneration: async () => true }));
vi.mock("@/lib/indexnow", () => ({ notifyIndexNowOfApprovedPet: async () => ({ status: "skipped" }) }));

import { runRelatedPetApprovalWorkerOnce } from "@/lib/pets/related-pets-approval-worker";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-profile";
const pet = { id: "pet_fixture", slug: "fixture", status: "pending", updatedAt: "2026-10-11T10:00:00Z" };
const preparation = { preparationId: "approval_fixture", petId: pet.id, petSlug: pet.slug, petUpdatedAt: pet.updatedAt,
  rankingRevision: RELATED_PETS_V24_PROFILE.rankingRevision, status: "preparing", leaseOwner: "worker-fixture",
  leaseUntil: new Date(Date.now() + 1_800_000).toISOString() };
beforeEach(() => {
  vi.clearAllMocks(); mocks.paused = false;
  mocks.claim.mockResolvedValue(preparation); mocks.getPreparation.mockResolvedValue(preparation); mocks.getPet.mockResolvedValue(pet);
  mocks.metadata.mockImplementation(async (_pet, check) => { await check(); });
  mocks.search.mockResolvedValue("updated"); mocks.related.mockResolvedValue({ query: "updated", document: "updated" });
  mocks.vision.mockResolvedValue("vector-only"); mocks.annotation.mockResolvedValue("vectors-only");
  mocks.build.mockResolvedValue({ inputScope: {}, inputRevision: "fixture", coverage: { snapshotCount: 1 } });
  mocks.finalize.mockResolvedValue("succeeded"); mocks.failure.mockResolvedValue({ status: "manual_review" });
});
describe("production approval wiring", () => {
  it("prepares OpenAI metadata before all signals and publication", async () => {
    expect(await runRelatedPetApprovalWorkerOnce("worker-fixture")).toBe("succeeded");
    const order = [mocks.metadata, mocks.search, mocks.related, mocks.annotation, mocks.vision, mocks.build, mocks.finalize]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it.each(["other-owner", "expired", "invalid-date", "paused", "changed-pet"])("blocks %s before metadata calls and publication", async (scenario) => {
    if (scenario === "other-owner") mocks.getPreparation.mockResolvedValue({ ...preparation, leaseOwner: "other" });
    if (scenario === "expired") mocks.getPreparation.mockResolvedValue({ ...preparation, leaseUntil: "2020-01-01T00:00:00Z" });
    if (scenario === "invalid-date") mocks.getPreparation.mockResolvedValue({ ...preparation, leaseUntil: "bad" });
    if (scenario === "paused") mocks.paused = true;
    if (scenario === "changed-pet") mocks.getPet.mockResolvedValueOnce(pet).mockResolvedValue({ ...pet, updatedAt: "changed" });
    expect(await runRelatedPetApprovalWorkerOnce("worker-fixture")).toBe("manual_review");
    expect(mocks.failure).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "metadata_lease_or_input_changed", retryable: false }));
    expect(mocks.search).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
});
