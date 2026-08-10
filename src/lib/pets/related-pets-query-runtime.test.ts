import { describe, expect, it, vi } from "vitest";

import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
} from "@/lib/pets/search-embeddings";
import { createRelatedPetQueryRuntime } from "@/lib/pets/related-pets-query-runtime";
import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
  RELATED_PETS_THEME_QUERY_REVISION,
  RELATED_PETS_TOPIC_DOCUMENT_REVISION,
  RELATED_PETS_TOPIC_QUERY_REVISION,
} from "@/lib/pets/related-pets-semantics.mjs";
import type { PublicPet } from "@/lib/pets/types";

const profile = {
  embeddingRevision: "document-v1",
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
      revision: profile.textRevision,
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
  it("refreshes approvals with the v8 theme query revision", async () => {
    const input = pet({ tags: ["Gothic", "cc0", "source-github"] });
    const v8Profile = {
      ...profile,
      textQueryRevision: RELATED_PETS_THEME_QUERY_REVISION,
    };
    const deps = dependencies({ profile: v8Profile });
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedQueryEmbedding(input)).resolves.toBe(
      "updated",
    );
    expect(deps.embeddingClient.embedPreparedQuery).toHaveBeenCalledWith(
      "name: Velvet Byte\nkind: character\ntopics: gothic",
    );
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: RELATED_PETS_THEME_QUERY_REVISION,
        sourceHash: createRelatedPetQuerySourceHash(
          input,
          RELATED_PETS_THEME_QUERY_REVISION,
        ),
      }),
    );
  });

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

  it("stores independent v9 query and document vectors from the same text", async () => {
    const input = pet({ tags: ["anime", "detailed", "source-github"] });
    const v9Profile = {
      ...profile,
      embeddingRevision: "document-v1",
      textQueryRevision: RELATED_PETS_DESCRIPTION_QUERY_REVISION,
      textRevision: RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    };
    const deps = dependencies({ profile: v9Profile });
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(runtime.refreshApprovedPetRelatedQueryEmbedding(input)).resolves.toBe(
      "updated",
    );
    await expect(runtime.refreshApprovedPetRelatedDocumentEmbedding(input)).resolves.toBe(
      "updated",
    );

    const expectedText =
      "name: Velvet Byte\nkind: character\ndescription: A gothic coding character";
    expect(deps.embeddingClient.embedPreparedQuery).toHaveBeenCalledWith(
      expectedText,
    );
    expect(deps.embeddingClient.embedDocument).toHaveBeenCalledWith(
      expectedText,
    );
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: RELATED_PETS_DESCRIPTION_QUERY_REVISION,
        sourceHash: createRelatedPetQuerySourceHash(
          input,
          RELATED_PETS_DESCRIPTION_QUERY_REVISION,
        ),
      }),
    );
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
        sourceHash: createRelatedPetDocumentSourceHash(
          input,
          RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
        ),
      }),
    );
    expect(
      buildRelatedPetDocument(
        input,
        RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
      ),
    ).toBe(
      buildRelatedPetQuery(input, RELATED_PETS_DESCRIPTION_QUERY_REVISION),
    );
  });

  it("stores independent V10 topic query and document vectors", async () => {
    const input = pet({
      tags: ["Vampire", "Gothic", "girl", "anime", "source-github"],
    });
    const v10Profile = {
      ...profile,
      topicQueryRevision: RELATED_PETS_TOPIC_QUERY_REVISION,
      topicRevision: RELATED_PETS_TOPIC_DOCUMENT_REVISION,
      topicDimensions: 3,
    };
    const deps = dependencies({ profile: v10Profile });
    const runtime = createRelatedPetQueryRuntime(deps);

    await expect(
      runtime.refreshApprovedPetRelatedTopicQueryEmbedding(input),
    ).resolves.toBe("updated");
    await expect(
      runtime.refreshApprovedPetRelatedTopicDocumentEmbedding(input),
    ).resolves.toBe("updated");

    const expectedText =
      "name: Velvet Byte\nkind: character\ntopics: gothic, vampire";
    expect(deps.embeddingClient.embedPreparedQuery).toHaveBeenCalledWith(
      expectedText,
    );
    expect(deps.embeddingClient.embedDocument).toHaveBeenCalledWith(
      expectedText,
    );
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: RELATED_PETS_TOPIC_QUERY_REVISION,
        sourceHash: createRelatedPetQuerySourceHash(
          input,
          RELATED_PETS_TOPIC_QUERY_REVISION,
        ),
      }),
    );
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: RELATED_PETS_TOPIC_DOCUMENT_REVISION,
        sourceHash: createRelatedPetDocumentSourceHash(
          input,
          RELATED_PETS_TOPIC_DOCUMENT_REVISION,
        ),
      }),
    );
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
            revision: profile.textRevision,
            dimensions: 2,
            embedPreparedQuery: vi.fn(async () => [0.1, 0.2]),
            embedDocument: vi.fn(async () => [0.2, 0.1]),
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
            embedDocument: vi.fn(async () => [0.3, 0.2, 0.1]),
          },
        }),
      ).refreshApprovedPetRelatedQueryEmbedding(pet()),
    ).resolves.toBe("skipped");
  });

  it("propagates provider and storage failures to the sanitized route boundary", async () => {
    const providerRuntime = createRelatedPetQueryRuntime(
      dependencies({
        embeddingClient: {
          revision: profile.textRevision,
          dimensions: 3,
          embedPreparedQuery: vi.fn(async () => {
            throw new Error("provider secret");
          }),
          embedDocument: vi.fn(async () => [0.3, 0.2, 0.1]),
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
