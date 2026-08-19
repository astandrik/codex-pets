import {
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationSourceHash,
  listUnresolvedStrongRelations,
  parseResolvedRelatedPetAnnotation,
  resolveRelatedPetAnnotation,
} from "./related-pets-annotation-contract.mjs";

export async function refreshRelatedPetAnnotationRecord({
  mode,
  force = false,
  pet,
  annotationRevision,
  modelUri,
  getAnnotation,
  createProposal,
  upsertAnnotation,
  createSourceHash = createRelatedPetAnnotationSourceHash,
  now = () => new Date(),
}) {
  const sourceHash = createSourceHash({
    pet,
    modelUri,
    annotationRevision,
  });
  const stored = force
    ? null
    : await getAnnotation(annotationRevision, pet.slug);
  if (stored?.sourceHash === sourceHash) {
    const current = validateCurrentRelatedPetAnnotation({
      pet,
      stored,
      annotationRevision,
      modelUri,
      createSourceHash,
      expectedSourceHash: sourceHash,
    });
    return { outcome: "unchanged", ...current };
  }
  if (mode === "dry-run") {
    return { outcome: "planned", sourceHash, annotationText: null };
  }

  const proposal = await createProposal(pet);
  const unresolvedFields = listUnresolvedStrongRelations({
    slug: pet.slug,
    proposal,
  });
  if (unresolvedFields.length > 0) {
    throw reasonError("unresolved_strong_relation", { unresolvedFields });
  }
  const annotation = resolveRelatedPetAnnotation({
    slug: pet.slug,
    proposal,
  });
  const annotationText = buildRelatedPetAnnotationText(annotation);
  await upsertAnnotation({
    annotationRevision,
    slug: pet.slug,
    sourceHash,
    proposalJson: JSON.stringify(proposal),
    annotationJson: JSON.stringify(annotation),
    annotationText,
    updatedAt: now().toISOString(),
  });
  return { outcome: "updated", sourceHash, annotationText };
}

export function validateCurrentRelatedPetAnnotation({
  pet,
  stored,
  annotationRevision,
  modelUri,
  createSourceHash = createRelatedPetAnnotationSourceHash,
  expectedSourceHash = createSourceHash({
    pet,
    modelUri,
    annotationRevision,
  }),
}) {
  if (stored.sourceHash !== expectedSourceHash) {
    throw reasonError("annotation_stale");
  }
  const annotation = parseResolvedRelatedPetAnnotation(stored.annotationJson);
  const annotationText = buildRelatedPetAnnotationText(annotation);
  if (annotationText !== stored.annotationText) {
    throw reasonError("annotation_text_mismatch");
  }
  return { sourceHash: expectedSourceHash, annotationText };
}

function reasonError(reason, details = {}) {
  return Object.assign(new Error(reason), { reason, ...details });
}
