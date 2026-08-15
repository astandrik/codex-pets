import { describe, expect, it } from "vitest";

import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
  buildRelatedPetDescriptionText,
} from "@/lib/pets/related-pets-semantics.mjs";

describe("current related-pet description semantics", () => {
  it("keeps persisted revisions immutable", () => {
    expect(RELATED_PETS_DESCRIPTION_QUERY_REVISION).toBe(
      "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3",
    );
    expect(RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION).toBe(
      "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1",
    );
  });

  it("builds the same normalized text for query and document roles", () => {
    expect(buildRelatedPetDescriptionText({
      displayName: "  Vi  ",
      kind: "character",
      description: "  An Arcane fighter.  ",
    })).toBe([
      "name: Vi",
      "kind: character",
      "description: An Arcane fighter.",
    ].join("\n"));
  });
});
