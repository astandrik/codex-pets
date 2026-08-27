import {
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationProposalHash,
  createRelatedPetAnnotationProposalInputHash,
  createRelatedPetAnnotationSourceHash,
  listUnresolvedStrongRelations,
  parseStoredRelatedPetAnnotationProposal,
  parseResolvedRelatedPetAnnotation,
  resolveRelatedPetAnnotation,
} from "./related-pets-annotation-contract.mjs";

export async function refreshRelatedPetAnnotationRecord({
  mode,
  force = false,
  pet,
  annotationRevision,
  proposalRevision = RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  modelUri,
  getAnnotation,
  findReusableProposal = async () => null,
  createProposal,
  upsertAnnotation,
  now = () => new Date(),
}) {
  const proposalInputHash = createRelatedPetAnnotationProposalInputHash({
    pet,
    modelUri,
    proposalRevision,
  });
  const stored = force
    ? null
    : await getAnnotation(annotationRevision, pet.slug);
  if (stored) {
    try {
      const current = validateCurrentRelatedPetAnnotation({
        pet,
        stored,
        annotationRevision,
        proposalRevision,
        modelUri,
      });
      return { outcome: "unchanged", proposalAction: "unchanged", ...current };
    } catch {
      // A stale effective row may still contain a reusable proposal.
    }
  }

  const reusable = force
    ? null
    : reusableProposal(stored, { proposalRevision, proposalInputHash }) ??
      reusableProposal(
        await findReusableProposal({
          slug: pet.slug,
          proposalRevision,
          proposalInputHash,
        }),
        { proposalRevision, proposalInputHash },
      );
  if (mode === "dry-run" && !reusable) {
    return {
      outcome: "planned",
      proposalAction: "generated",
      sourceHash: null,
      annotationText: null,
    };
  }

  const proposal = reusable?.proposal ?? await createProposal(pet);
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
  const proposalHash = reusable?.proposalHash ??
    createRelatedPetAnnotationProposalHash(proposal);
  const sourceHash = createRelatedPetAnnotationSourceHash({
    slug: pet.slug,
    annotationRevision,
    proposalRevision,
    proposalInputHash,
    proposalHash,
  });
  const annotationText = buildRelatedPetAnnotationText(annotation);
  if (mode === "dry-run") {
    return {
      outcome: "planned",
      proposalAction: "reused",
      sourceHash,
      annotationText,
    };
  }
  await upsertAnnotation({
    annotationRevision,
    slug: pet.slug,
    sourceHash,
    proposalRevision,
    proposalInputHash,
    proposalHash,
    proposalJson: JSON.stringify(proposal),
    annotationJson: JSON.stringify(annotation),
    annotationText,
    updatedAt: now().toISOString(),
  });
  return {
    outcome: "updated",
    proposalAction: reusable ? "reused" : "generated",
    sourceHash,
    annotationText,
  };
}

export function validateCurrentRelatedPetAnnotation({
  pet,
  stored,
  annotationRevision,
  proposalRevision = RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  modelUri,
}) {
  if (
    !stored.proposalJson ||
    !stored.proposalRevision ||
    !stored.proposalInputHash ||
    !stored.proposalHash
  ) {
    throw reasonError("annotation_provenance_missing");
  }
  const expectedProposalInputHash = createRelatedPetAnnotationProposalInputHash({
    pet,
    modelUri,
    proposalRevision,
  });
  if (
    stored.proposalRevision !== proposalRevision ||
    stored.proposalInputHash !== expectedProposalInputHash
  ) {
    throw reasonError("annotation_stale");
  }
  const proposal = parseStoredRelatedPetAnnotationProposal(
    JSON.parse(stored.proposalJson),
  );
  const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
  if (stored.proposalHash !== proposalHash) {
    throw reasonError("annotation_proposal_hash_mismatch");
  }
  const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
  const storedAnnotation = parseResolvedRelatedPetAnnotation(
    stored.annotationJson,
  );
  if (JSON.stringify(storedAnnotation) !== JSON.stringify(annotation)) {
    throw reasonError("annotation_resolution_mismatch");
  }
  const annotationText = buildRelatedPetAnnotationText(annotation);
  if (annotationText !== stored.annotationText) {
    throw reasonError("annotation_text_mismatch");
  }
  const expectedSourceHash = createRelatedPetAnnotationSourceHash({
    slug: pet.slug,
    annotationRevision,
    proposalRevision,
    proposalInputHash: expectedProposalInputHash,
    proposalHash,
  });
  if (stored.sourceHash !== expectedSourceHash) {
    throw reasonError("annotation_stale");
  }
  return {
    sourceHash: expectedSourceHash,
    proposalRevision,
    proposalInputHash: expectedProposalInputHash,
    proposalHash,
    annotation,
    annotationText,
  };
}

function reusableProposal(stored, expected) {
  if (
    !stored?.proposalJson ||
    stored.proposalRevision !== expected.proposalRevision ||
    stored.proposalInputHash !== expected.proposalInputHash
  ) {
    return null;
  }
  try {
    const proposal = parseStoredRelatedPetAnnotationProposal(
      JSON.parse(stored.proposalJson),
    );
    const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
    return stored.proposalHash === proposalHash ? { proposal, proposalHash } : null;
  } catch {
    return null;
  }
}

function reasonError(reason, details = {}) {
  return Object.assign(new Error(reason), { reason, ...details });
}
