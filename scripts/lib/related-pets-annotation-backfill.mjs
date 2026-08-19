import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  createRelatedPetAnnotationEmbeddingSourceHash,
} from "../../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  refreshRelatedPetAnnotationRecord,
  validateCurrentRelatedPetAnnotation,
} from "../../src/lib/pets/related-pets-annotation-refresh.mjs";
import { createRelatedPetsRebuildRequiredLog } from "./related-pets-maintenance.mjs";
import {
  parseResumableBackfillArgs,
  runResumableBackfill,
  selectApprovedItems,
} from "./resumable-backfill.mjs";

export function parseRelatedPetAnnotationBackfillArgs(argv) {
  return parseResumableBackfillArgs(argv);
}

export async function runRelatedPetAnnotationBackfill({
  options,
  annotationRevision,
  modelUri,
  pets,
  getAnnotation,
  createProposal,
  upsertAnnotation,
  createSourceHash,
  now = () => new Date(),
  log = console.log,
}) {
  return runResumableBackfill({
    items: selectApprovedItems([...pets], options.slug),
    options,
    log,
    failureDetails: unresolvedFields,
    processItem: async (pet) => {
      const result = await refreshRelatedPetAnnotationRecord({
        mode: options.mode,
        force: options.force,
        pet,
        modelUri,
        annotationRevision,
        getAnnotation,
        createProposal,
        upsertAnnotation,
        createSourceHash,
        now,
      });
      return result.outcome;
    },
  });
}

export async function runRelatedPetAnnotationEmbeddingBackfill({
  options,
  annotationRevision,
  modelRevision,
  role,
  dimensions,
  modelUri,
  pets,
  annotations,
  getMetadata,
  embed,
  upsert,
  now = () => new Date(),
  log = console.log,
}) {
  assertAnnotationEmbeddingRevision(modelRevision, role);
  const annotationsBySlug = new Map(
    annotations.map((annotation) => [annotation.slug, annotation]),
  );

  let updated = 0;
  try {
    return await runResumableBackfill({
      items: selectApprovedItems([...pets], options.slug),
      options,
      log,
      processItem: async (pet) => {
        const storedAnnotation = annotationsBySlug.get(pet.slug);
        if (!storedAnnotation) throw new Error("annotation_missing");
        if (!modelUri) throw new Error("annotation_model_uri_missing");
        const currentAnnotation = validateCurrentRelatedPetAnnotation({
          pet,
          stored: storedAnnotation,
          annotationRevision,
          modelUri,
        });
        const sourceHash = createRelatedPetAnnotationEmbeddingSourceHash({
          modelRevision,
          role,
          annotationRevision,
          annotationSourceHash: currentAnnotation.sourceHash,
          annotationText: currentAnnotation.annotationText,
        });
        const metadata = options.force
          ? null
          : await getMetadata(modelRevision, pet.slug);
        if (
          metadata?.sourceHash === sourceHash &&
          metadata.dimensions === dimensions
        ) {
          return "unchanged";
        }
        if (options.mode === "dry-run") return "planned";

        const embedding = await embed(currentAnnotation.annotationText, role);
        if (
          !Array.isArray(embedding) ||
          embedding.length !== dimensions ||
          embedding.some((value) => !Number.isFinite(value))
        ) {
          throw new Error("embedding_invalid");
        }
        await upsert({
          modelRevision,
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

function assertAnnotationEmbeddingRevision(revision, role) {
  const expected = role === "query"
    ? RELATED_PETS_ANNOTATION_QUERY_REVISION
    : RELATED_PETS_ANNOTATION_DOCUMENT_REVISION;
  if (revision !== expected) {
    throw new Error(`Expected ${role} annotation revision ${expected}.`);
  }
}

function unresolvedFields(error) {
  if (
    error?.reason !== "unresolved_strong_relation" ||
    !Array.isArray(error.unresolvedFields)
  ) {
    return {};
  }
  return {
    unresolvedFields: error.unresolvedFields.filter(
      (field) => typeof field === "string" && /^[a-zA-Z]+$/.test(field),
    ),
  };
}
