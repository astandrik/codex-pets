import { createHash } from "node:crypto";

import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
  buildRelatedPetDescriptionText,
} from "../../src/lib/pets/related-pets-semantics.mjs";
import { createRelatedPetsRebuildRequiredLog } from "./related-pets-maintenance.mjs";
import {
  parseResumableBackfillArgs,
  runResumableBackfill,
  selectApprovedItems,
} from "./resumable-backfill.mjs";

export function parseBackfillArgs(argv) {
  return parseResumableBackfillArgs(argv);
}

export function buildPetSearchDocument(pet) {
  const tags = normalizedPetTags(pet.tags).toSorted();

  return [
    `name: ${pet.displayName.normalize("NFKC").trim()}`,
    `kind: ${pet.kind}`,
    `description: ${pet.description.normalize("NFKC").trim()}`,
    `tags: ${tags.join(", ")}`,
  ].join("\n");
}

export function buildRelatedPetQuery(pet, modelRevision) {
  if (modelRevision === RELATED_PETS_DESCRIPTION_QUERY_REVISION) {
    return buildRelatedPetDescriptionText(pet);
  }
  const tags = normalizedPetTags(pet.tags);
  return tags.length > 0
    ? tags.join(" ")
    : pet.description.normalize("NFKC").trim();
}

export function buildRelatedPetDocument(pet, modelRevision) {
  if (modelRevision === RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION) {
    return buildRelatedPetDescriptionText(pet);
  }
  return buildPetSearchDocument(pet);
}

export function createPetSearchSourceHash(pet, modelRevision) {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildPetSearchDocument(pet))
    .digest("hex");
}

export function createRelatedPetQuerySourceHash(pet, modelRevision) {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildRelatedPetQuery(pet, modelRevision))
    .digest("hex");
}

export function createRelatedPetDocumentSourceHash(pet, modelRevision) {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildRelatedPetDocument(pet, modelRevision))
    .digest("hex");
}

export function embeddingToBuffer(embedding) {
  const buffer = Buffer.allocUnsafe(
    embedding.length * Float32Array.BYTES_PER_ELEMENT + 1,
  );
  embedding.forEach((value, index) => {
    buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });
  // YDB's binary FloatVector format ends with the Float32 type marker.
  buffer[buffer.length - 1] = 0x01;
  return buffer;
}

export function createRequestStartLimiter({
  requestsPerMinute,
  now = Date.now,
  sleep,
}) {
  if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
    throw new Error("requestsPerMinute must be a positive integer.");
  }
  const minimumIntervalMs = Math.ceil(60_000 / requestsPerMinute);
  let nextStartAt = 0;

  return async function reserveRequestStart() {
    const waitMs = Math.max(0, nextStartAt - now());
    if (waitMs > 0) await sleep(waitMs);

    const startedAt = now();
    nextStartAt = Math.max(nextStartAt, startedAt) + minimumIntervalMs;
  };
}

export async function runPetSearchBackfill({
  options,
  revision,
  dimensions,
  pets,
  getMetadata,
  embedDocument,
  upsert,
  buildInput = buildPetSearchDocument,
  createSourceHash = createPetSearchSourceHash,
  now = () => new Date(),
  log = console.log,
}) {
  const selectedPets = selectApprovedItems(pets, options.slug);
  let updated = 0;
  try {
    return await runResumableBackfill({
      items: selectedPets,
      options,
      log,
      processItem: async (pet) => {
        const sourceHash = createSourceHash(pet, revision);
        const metadata = options.force
          ? null
          : await getMetadata(revision, pet.slug);
        if (
          metadata?.sourceHash === sourceHash &&
          metadata.dimensions === dimensions
        ) {
          return "unchanged";
        }

        if (options.mode === "dry-run") {
          return "planned";
        }

        const embedding = await embedDocument(buildInput(pet));
        if (
          !Array.isArray(embedding) ||
          embedding.length !== dimensions ||
          embedding.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(
            `Embedding provider returned ${embedding?.length ?? 0} values; expected ${dimensions}.`,
          );
        }
        await upsert({
          modelRevision: revision,
          slug: pet.slug,
          sourceHash,
          dimensions,
          embedding,
          updatedAt: now().toISOString(),
        });
        updated += 1;
        return "updated";
      },
    });
  } finally {
    if (options.mode === "apply" && updated > 0) {
      log(createRelatedPetsRebuildRequiredLog());
    }
  }
}

function normalizedPetTags(tags) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.normalize("NFKC").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}
