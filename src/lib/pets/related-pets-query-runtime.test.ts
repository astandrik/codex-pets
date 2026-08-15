import { describe, expect, it, vi } from "vitest";

import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
} from "@/lib/pets/search-embeddings";
import { createRelatedPetQueryRuntime } from "@/lib/pets/related-pets-query-runtime";
import type { PublicPet } from "@/lib/pets/types";

const profile = {
  embeddingRevision: "embedding-v1",
  textRevision: "document-v1",
  textQueryRevision: "related-query-v1",
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
      dimensions: 3,
      embedPreparedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
      embedDocument: vi.fn(async () => [0.3, 0.2, 0.1]),
    },
    getMetadata: vi.fn(async () => null),
    upsert: vi.fn(async () => undefined),
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  };
}

describe("related pet query runtime", () => {
  it("stores the canonical related query with the pinned query revision", async () => {
    const input = pet();
    const deps = dependencies();
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedQueryEmbedding(input)).resolves.toBe(
      "updated",
    );
    expect(deps.embeddingClient.embedPreparedQuery).toHaveBeenCalledWith(
      buildRelatedPetQuery(input, profile.textQueryRevision),
    );
    expect(deps.upsert).toHaveBeenCalledWith({
      modelRevision: profile.textQueryRevision,
      slug: input.slug,
      sourceHash: createRelatedPetQuerySourceHash(
        input,
        profile.textQueryRevision,
      ),
      dimensions: profile.textDimensions,
      embedding: [0.1, 0.2, 0.3],
      updatedAt: "2026-08-04T12:00:00.000Z",
    });
  });

  it("stores the canonical related document under its own revision", async () => {
    const input = pet();
    const deps = dependencies();
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedDocumentEmbedding(input))
      .resolves.toBe("updated");
    expect(deps.embeddingClient.embedDocument).toHaveBeenCalledWith(
      buildRelatedPetDocument(input, profile.textRevision),
    );
    expect(deps.upsert).toHaveBeenCalledWith(expect.objectContaining({
      modelRevision: profile.textRevision,
      sourceHash: createRelatedPetDocumentSourceHash(input, profile.textRevision),
      embedding: [0.3, 0.2, 0.1],
    }));
  });

  it("uses the description fallback without search truncation", async () => {
    const input = pet({
      tags: [],
      description: "Mixed CASE " + "description ".repeat(20),
    });
    const deps = dependencies();
    const runtime = createRelatedPetQueryRuntime(deps);

    await runtime.refreshApprovedPetRelatedQueryEmbedding(input);

    expect(deps.embeddingClient.embedPreparedQuery).toHaveBeenCalledWith(
      buildRelatedPetQuery(input, profile.textQueryRevision),
    );
  });

  it("does not rewrite a current query vector", async () => {
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

    await expect(runtime.refreshApprovedPetRelatedQueryEmbedding(input)).resolves.toBe(
      "unchanged",
    );
    expect(deps.embeddingClient.embedPreparedQuery).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
  });

  it("skips rejected pets and unavailable or incompatible clients", async () => {
    const rejected = pet({ status: "rejected" });

    await expect(
      createRelatedPetQueryRuntime(dependencies())
        .refreshApprovedPetRelatedQueryEmbedding(rejected),
    ).resolves.toBe("skipped");
    await expect(
      createRelatedPetQueryRuntime(
        dependencies({ embeddingClient: null }),
      ).refreshApprovedPetRelatedQueryEmbedding(pet()),
    ).resolves.toBe("skipped");
    await expect(
      createRelatedPetQueryRuntime(
        dependencies({
          embeddingClient: {
            revision: profile.embeddingRevision,
            dimensions: 2,
            embedPreparedQuery: vi.fn(async () => [0.1, 0.2]),
            embedDocument: vi.fn(async () => [0.1, 0.2]),
          },
        }),
      ).refreshApprovedPetRelatedQueryEmbedding(pet()),
    ).resolves.toBe("skipped");
    await expect(
      createRelatedPetQueryRuntime(
        dependencies({
          embeddingClient: {
            revision: "document-v2",
            dimensions: 3,
            embedPreparedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
            embedDocument: vi.fn(async () => [0.1, 0.2, 0.3]),
          },
        }),
      ).refreshApprovedPetRelatedQueryEmbedding(pet()),
    ).resolves.toBe("skipped");
  });

  it("propagates provider and storage failures to the sanitized route boundary", async () => {
    const providerRuntime = createRelatedPetQueryRuntime(
      dependencies({
        embeddingClient: {
          revision: profile.embeddingRevision,
          dimensions: 3,
          embedPreparedQuery: vi.fn(async () => {
            throw new Error("provider secret");
          }),
          embedDocument: vi.fn(async () => [0.1, 0.2, 0.3]),
        },
      }),
    );
    await expect(
      providerRuntime.refreshApprovedPetRelatedQueryEmbedding(pet()),
    ).rejects.toThrow("provider secret");

    const storageRuntime = createRelatedPetQueryRuntime(
      dependencies({
        upsert: vi.fn(async () => {
          throw new Error("storage secret");
        }),
      }),
    );
    await expect(
      storageRuntime.refreshApprovedPetRelatedQueryEmbedding(pet()),
    ).rejects.toThrow("storage secret");
  });
});
