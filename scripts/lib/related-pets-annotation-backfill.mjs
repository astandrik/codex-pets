import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  createRelatedPetAnnotationProposalHash,
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
import { createCatalogFingerprint } from "./related-pets-catalog-fingerprint.mjs";

export function parseRelatedPetAnnotationBackfillArgs(argv) {
  const legacyOption = extractStringOption(
    argv,
    "reuse-proposals-from",
  );
  const fingerprintOption = extractStringOption(
    legacyOption.remainingArgs,
    "expected-catalog-fingerprint",
  );
  const reuseProposalsFrom = legacyOption.value;
  const expectedCatalogFingerprint = fingerprintOption.value;
  if (
    expectedCatalogFingerprint &&
    !/^[a-f0-9]{64}$/.test(expectedCatalogFingerprint)
  ) {
    throw new Error(
      "--expected-catalog-fingerprint requires a lowercase 64-character SHA-256 hex value.",
    );
  }
  if (reuseProposalsFrom && !expectedCatalogFingerprint) {
    throw new Error(
      "--reuse-proposals-from requires --expected-catalog-fingerprint.",
    );
  }
  if (expectedCatalogFingerprint && !reuseProposalsFrom) {
    throw new Error(
      "--expected-catalog-fingerprint requires --reuse-proposals-from.",
    );
  }
  const options = parseResumableBackfillArgs(fingerprintOption.remainingArgs);
  if (reuseProposalsFrom && options.force) {
    throw new Error("--reuse-proposals-from cannot be combined with --force.");
  }
  return { ...options, reuseProposalsFrom, expectedCatalogFingerprint };
}

export function createRelatedPetAnnotationCatalogFingerprint(pets) {
  return createCatalogFingerprint(selectApprovedItems([...pets], null));
}

export function assertRelatedPetAnnotationCatalogFingerprint(options, pets) {
  if (!options.reuseProposalsFrom) return null;
  const actual = createRelatedPetAnnotationCatalogFingerprint(pets);
  if (actual !== options.expectedCatalogFingerprint) {
    throw new Error("annotation_catalog_fingerprint_mismatch");
  }
  return actual;
}

export async function runRelatedPetAnnotationBackfill({
  options,
  annotationRevision,
  modelUri,
  pets,
  getAnnotation,
  findReusableProposal,
  createProposal,
  upsertAnnotation,
  now = () => new Date(),
  log = console.log,
}) {
  assertRelatedPetAnnotationCatalogFingerprint(options, pets);
  let proposalReused = 0;
  let proposalGenerated = 0;
  const summary = await runResumableBackfill({
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
        findReusableProposal,
        createProposal,
        upsertAnnotation,
        now,
      });
      if (result.outcome !== "unchanged") {
        if (result.proposalAction === "reused") proposalReused += 1;
        if (result.proposalAction === "generated") proposalGenerated += 1;
      }
      return result.outcome;
    },
  });
  return { ...summary, proposalReused, proposalGenerated };
}

function extractStringOption(argv, name) {
  const prefix = `--${name}=`;
  const flag = `--${name}`;
  let value = null;
  const remainingArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === flag || argument.startsWith(prefix)) {
      if (value !== null) throw new Error(`${flag} may be passed only once.`);
      const candidate = argument === flag ? argv[++index] : argument.slice(prefix.length);
      if (!candidate || !/^[a-z0-9][a-z0-9._:-]{0,199}$/.test(candidate)) {
        throw new Error(`${flag} requires a valid immutable revision.`);
      }
      value = candidate;
      continue;
    }
    remainingArgs.push(argument);
  }
  return { remainingArgs, value };
}

export function adoptLegacyRelatedPetAnnotationProposal(
  stored,
  proposalInputHash,
) {
  if (!stored?.proposalJson) return null;
  const existingProvenance = [
    stored.proposalRevision,
    stored.proposalInputHash,
    stored.proposalHash,
  ];
  if (existingProvenance.some(Boolean)) {
    if (!existingProvenance.every(Boolean)) {
      throw new Error("legacy_proposal_provenance_invalid");
    }
    return stored;
  }
  return {
    ...stored,
    proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
    proposalInputHash,
    proposalHash: createRelatedPetAnnotationProposalHash(
      JSON.parse(stored.proposalJson),
    ),
  };
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
  const items = selectApprovedItems([...pets], options.slug);
  if (!modelUri && items.some((pet) => annotationsBySlug.has(pet.slug))) {
    throw new Error("annotation_model_uri_missing");
  }

  let updated = 0;
  try {
    return await runResumableBackfill({
      items,
      options,
      log,
      processItem: async (pet) => {
        const storedAnnotation = annotationsBySlug.get(pet.slug);
        if (!storedAnnotation) throw new Error("annotation_missing");
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
