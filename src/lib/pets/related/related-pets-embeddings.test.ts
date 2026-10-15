import { describe, expect, it } from "vitest";
import {
  buildRelatedPetQuery, buildRelatedPetDocument,
  createRelatedPetQuerySourceHash, createRelatedPetDocumentSourceHash,
} from "./related-pets-embeddings";

const pet = {
  slug: "velvet-byte", displayName: "Velvet Byte",
  description: "A gothic coding character", kind: "character" as const,
  tags: ["night", "gothic"],
};
const taggedInput = [" Night ", "gothic", "night", "ＰＩＸＥＬ"];
const description = "name: Velvet Byte\nkind: character\ndescription: A gothic coding character";
const golden = [
  {
    name: "legacy tags",
    tagVariants: [taggedInput],
    queryRevision: "query-v1",
    documentRevision: "doc-v1",
    query: "night gothic pixel",
    document: "name: Velvet Byte\nkind: character\ndescription: A gothic coding character\ntags: gothic, night, pixel",
    queryHash: "75542ab54c02aac187b0faf63cb7453e3e2d083bb7e3db5079387c64128a453a",
    documentHash: "ba3e7faa077c079e6fa3a4a6ccb55128c3f9642c7ead831bfab166bf6b9dd82b",
  },
  {
    name: "legacy fallback",
    tagVariants: [[]],
    queryRevision: "query-v1",
    documentRevision: "doc-v1",
    query: "A gothic coding character",
    document: "name: Velvet Byte\nkind: character\ndescription: A gothic coding character\ntags: ",
    queryHash: "4731031390b567b2a4a78db200162c521bf4b16d7295db426d8e674034737313",
    documentHash: "af18bc387b3b957f6113712b9f4397d9d8657a52afae0487f2590b86f5cd79fd",
  },
  {
    name: "Yandex description",
    tagVariants: [taggedInput, []],
    queryRevision: "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3",
    documentRevision: "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1",
    query: description,
    document: description,
    queryHash: "8e813b5b3278519dcca2d74f3bc4cff4a93d766aa2bacd0bdea7a17f6294f5c5",
    documentHash: "1266147a79a0675277eed0f654bc47676b08cc418356945d8b7e4a115e826a0a",
  },
  {
    name: "OpenAI description",
    tagVariants: [taggedInput, []],
    queryRevision: "openai-text-embedding-3-large-3072-pets-20261011-v1-description-query",
    documentRevision: "openai-text-embedding-3-large-3072-pets-20261011-v1-description-document",
    query: description,
    document: description,
    queryHash: "8ca1214c6f9818a31fe6beb23d683a5175b2888ca9170ff5537124ed7a489977",
    documentHash: "26d1b1984c1e9f707b15102d7a3da96e7d114bb78daca649807459c13a0927b1",
  },
];

describe("related embedding input contracts", () => {
  it("includes tag order and revision in the legacy query hash", () => {
    const hash = createRelatedPetQuerySourceHash(pet, "query-v1");
    expect(createRelatedPetQuerySourceHash({ ...pet, tags: ["gothic", "night"] }, "query-v1")).not.toBe(hash);
    expect(createRelatedPetQuerySourceHash(pet, "query-v2")).not.toBe(hash);
  });

  it.each(golden)("retains exact input and freshness hashes for $name", (fixture) => {
    for (const tags of fixture.tagVariants) {
      const input = { slug: "fixture", displayName: " Ｖelvet Byte ", description: " A gothic coding character ", kind: "character" as const, tags };
      expect(buildRelatedPetQuery(input, fixture.queryRevision)).toBe(fixture.query);
      expect(buildRelatedPetDocument(input, fixture.documentRevision)).toBe(fixture.document);
      expect(createRelatedPetQuerySourceHash(input, fixture.queryRevision)).toBe(fixture.queryHash);
      expect(createRelatedPetDocumentSourceHash(input, fixture.documentRevision)).toBe(fixture.documentHash);
    }
  });
});
