import { createHash } from "node:crypto";

export function createCatalogFingerprint(pets) {
  const catalog = pets.map((pet) => {
    if (
      typeof pet.createdAt !== "string" || !pet.createdAt ||
      typeof pet.approvedAt !== "string" || !pet.approvedAt
    ) {
      throw new Error("catalog_fingerprint_fields_missing");
    }
    return {
      slug: pet.slug,
      displayName: pet.displayName,
      description: pet.description,
      kind: pet.kind,
      tags: [...pet.tags].sort(compareCodePoints),
      createdAt: pet.createdAt,
      approvedAt: pet.approvedAt,
    };
  }).sort((left, right) => compareCodePoints(left.slug, right.slug));
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
