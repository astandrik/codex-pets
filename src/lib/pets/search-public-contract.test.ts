import { describe, expect, it } from "vitest";

import {
  findInternalSearchFieldPaths,
} from "@/lib/pets/search-public-contract";

describe("public pet search contract guard", () => {
  it("finds internal search fields recursively across objects and arrays", () => {
    expect(
      findInternalSearchFieldPaths({
        pets: [
          {
            slug: "safe",
            nested: {
              caption: { accessories: "hidden" },
              source_hash: "hidden",
              providerProvenance: "hidden",
              semanticScores: [0.9],
              systemPrompt: "hidden",
            },
          },
        ],
        visualMode: "hybrid",
      }),
    ).toEqual([
      "pets[0].nested.caption",
      "pets[0].nested.caption.accessories",
      "pets[0].nested.source_hash",
      "pets[0].nested.providerProvenance",
      "pets[0].nested.semanticScores",
      "pets[0].nested.systemPrompt",
      "visualMode",
    ]);
  });

  it("does not mistake public values for internal field names", () => {
    expect(
      findInternalSearchFieldPaths({
        description: "A prompt-looking caption about an accessory.",
        tags: ["scored", "hash"],
        downloadCount: 4,
      }),
    ).toEqual([]);
  });
});
