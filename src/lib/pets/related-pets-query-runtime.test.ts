import { describe, expect, it, vi } from "vitest";

import { createRelatedPetQueryRuntime } from "@/lib/pets/related-pets-query-runtime";
import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
} from "@/lib/pets/related-pets-semantics.mjs";
import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
} from "@/lib/pets/search-embeddings";
import type { PublicPet } from "@/lib/pets/types";

const profile = {
  embeddingRevision: "document-v1",
  textRevision: RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  textQueryRevision: RELATED_PETS_DESCRIPTION_QUERY_REVISION,
  textDimensions: 3,
} as const;

function pet(overrides: Partial<PublicPet> = {}): PublicPet {
  return {
    id: "pet-1",
    slug: "velvet-byte",
    displayName: "Velvet Byte",
    description: "A gothic coding character",
    spritesheetUrl: "/api/assets/asset-1/spritesheet.webp",
    petJsonUrl: "/api/assets/asset-1/pet.json",
    zipUrl: "/api/assets/asset-1/pet.zip",
    spritesheetExt: "webp",
    kind: "character",
    tags: ["Night", "gothic", "night"],
    status: "approved",
    ownerName: null,
    contactEmail: null,
    createdAt: "2026-08-04T00:00:00.000Z",
    approvedAt: "2026-08-04T00:00:00.000Z",
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    profile,
    embeddingClient: {
      revision: profile.embeddingRevision,
      dimensions: profile.textDimensions,
      embedPreparedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
      embedDocument: vi.fn(async () => [0.3, 0.2, 0.1]),
    },
    getMetadata: vi.fn(async () => null),
    upsert: vi.fn(async () => undefined),
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  };
}

describe("current related pet embedding runtime", () => {
  it("stores independent description query and document vectors", async () => {
    const input = pet({ tags: ["anime", "source-github"] });
    const deps = dependencies();
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedQueryEmbedding(input))
      .resolves.toBe("updated");
    await expect(runtime.refreshApprovedPetRelatedDocumentEmbedding(input))
      .resolves.toBe("updated");

    const expectedText =
      "name: Velvet Byte\nkind: character\ndescription: A gothic coding character";
    expect(deps.embeddingClient.embedPreparedQuery).toHaveBeenCalledWith(
      expectedText,
    );
    expect(deps.embeddingClient.embedDocument).toHaveBeenCalledWith(
      expectedText,
    );
    expect(deps.upsert).toHaveBeenCalledWith({
      modelRevision: RELATED_PETS_DESCRIPTION_QUERY_REVISION,
      slug: input.slug,
      sourceHash: createRelatedPetQuerySourceHash(
        input,
        RELATED_PETS_DESCRIPTION_QUERY_REVISION,
      ),
      dimensions: profile.textDimensions,
      embedding: [0.1, 0.2, 0.3],
      updatedAt: "2026-08-04T12:00:00.000Z",
    });
    expect(deps.upsert).toHaveBeenCalledWith({
      modelRevision: RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
      slug: input.slug,
      sourceHash: createRelatedPetDocumentSourceHash(
        input,
        RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
      ),
      dimensions: profile.textDimensions,
      embedding: [0.3, 0.2, 0.1],
      updatedAt: "2026-08-04T12:00:00.000Z",
    });
    expect(buildRelatedPetDocument(
      input,
      RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    )).toBe(buildRelatedPetQuery(
      input,
      RELATED_PETS_DESCRIPTION_QUERY_REVISION,
    ));
  });

  it("does not rewrite a current vector", async () => {
    const input = pet();
    const deps = dependencies({
      getMetadata: vi.fn(async () => ({
        sourceHash: createRelatedPetQuerySourceHash(
          input,
          profile.textQueryRevision,
        ),
        dimensions: profile.textDimensions,
      })),
    });
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedQueryEmbedding(input))
      .resolves.toBe("unchanged");
    expect(deps.embeddingClient.embedPreparedQuery).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
  });

  it("skips non-approved pets and incompatible clients", async () => {
    await expect(createRelatedPetQueryRuntime(dependencies())
      .refreshApprovedPetRelatedQueryEmbedding(pet({ status: "rejected" })))
      .resolves.toBe("skipped");

    const unavailable = createRelatedPetQueryRuntime(
      dependencies({ embeddingClient: null }),
    );
    await expect(unavailable.refreshApprovedPetRelatedQueryEmbedding(pet()))
      .resolves.toBe("skipped");

    const incompatible = createRelatedPetQueryRuntime(dependencies({
      embeddingClient: {
        revision: "other",
        dimensions: 3,
        embedPreparedQuery: vi.fn(),
        embedDocument: vi.fn(),
      },
    }));
    await expect(incompatible.refreshApprovedPetRelatedQueryEmbedding(pet()))
      .resolves.toBe("skipped");
  });

  it("does not write when embedding fails", async () => {
    const deps = dependencies();
    deps.embeddingClient.embedDocument.mockRejectedValueOnce(
      new Error("provider failed"),
    );
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedDocumentEmbedding(pet()))
      .rejects.toThrow("provider failed");
    expect(deps.upsert).not.toHaveBeenCalled();
  });
});
