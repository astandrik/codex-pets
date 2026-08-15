import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationEmbeddingSourceHash,
  listUnresolvedStrongRelations,
  parseResolvedRelatedPetAnnotation,
  parseStoredRelatedPetAnnotationProposal,
  resolveRelatedPetAnnotation,
} from "../../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  parseResumableBackfillArgs,
  runResumableBackfill,
  selectApprovedItems,
} from "./resumable-backfill.mjs";

const SAFE_REVISION = /^[a-z0-9][a-z0-9.-]{0,191}$/;

export function parseRelatedPetAnnotationBackfillArgs(argv) {
  return parseResumableBackfillArgs(argv, { allowReuseProposals: true });
}

export function createStoredRelatedPetAnnotationProposalLoader({
  sourceRevision,
  getAnnotation,
}) {
  if (!SAFE_REVISION.test(sourceRevision)) {
    throw new Error("Source annotation revision is invalid.");
  }
  return async (pet) => {
    const stored = await getAnnotation(sourceRevision, pet.slug);
    if (!stored?.proposalJson) {
      throw Object.assign(new Error("source_annotation_missing"), {
        reason: "source_annotation_missing",
      });
    }
    try {
      return parseStoredRelatedPetAnnotationProposal(
        JSON.parse(stored.proposalJson),
      );
    } catch {
      throw Object.assign(new Error("source_annotation_invalid"), {
        reason: "source_annotation_invalid",
      });
    }
  };
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
      const sourceHash = createSourceHash({
        pet,
        modelUri,
        annotationRevision,
      });
      const stored = options.force
        ? null
        : await getAnnotation(annotationRevision, pet.slug);
      if (stored?.sourceHash === sourceHash) return "unchanged";
      if (options.mode === "dry-run") return "planned";

      const proposal = await createProposal(pet);
      const unresolved = listUnresolvedStrongRelations({
        slug: pet.slug,
        proposal,
      });
      if (unresolved.length > 0) {
        throw Object.assign(new Error("unresolved_strong_relation"), {
          reason: "unresolved_strong_relation",
          unresolvedFields: unresolved,
        });
      }
      const annotation = resolveRelatedPetAnnotation({
        slug: pet.slug,
        proposal,
      });
      await upsertAnnotation({
        annotationRevision,
        slug: pet.slug,
        sourceHash,
        proposalJson: JSON.stringify(proposal),
        annotationJson: JSON.stringify(annotation),
        annotationText: buildRelatedPetAnnotationText(annotation),
        updatedAt: now().toISOString(),
      });
      return "updated";
    },
  });
}

export async function runRelatedPetAnnotationEmbeddingBackfill({
  options,
  annotationRevision,
  modelRevision,
  role,
  dimensions,
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

  return runResumableBackfill({
    items: selectApprovedItems([...pets], options.slug),
    options,
    log,
    processItem: async (pet) => {
      const storedAnnotation = annotationsBySlug.get(pet.slug);
      if (!storedAnnotation) throw new Error("annotation_missing");
      const annotation = parseResolvedRelatedPetAnnotation(
        storedAnnotation.annotationJson,
      );
      const annotationText = buildRelatedPetAnnotationText(annotation);
      if (annotationText !== storedAnnotation.annotationText) {
        throw new Error("annotation_text_mismatch");
      }
      const sourceHash = createRelatedPetAnnotationEmbeddingSourceHash({
        modelRevision,
        role,
        annotationRevision,
        annotationSourceHash: storedAnnotation.sourceHash,
        annotationText,
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

      const embedding = await embed(annotationText, role);
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
      return "updated";
    },
  });
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
