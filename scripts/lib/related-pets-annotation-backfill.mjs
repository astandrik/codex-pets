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

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SAFE_REVISION = /^[a-z0-9][a-z0-9.-]{0,191}$/;
const MAX_CONCURRENCY = 10;

export function parseRelatedPetAnnotationBackfillArgs(argv) {
  let mode = null;
  let slug = null;
  let force = false;
  let continueOnError = false;
  let concurrency = 1;
  let reuseProposalsFrom = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run" || argument === "--apply") {
      const nextMode = argument === "--dry-run" ? "dry-run" : "apply";
      if (mode && mode !== nextMode) {
        throw new Error("Pass exactly one of --dry-run or --apply.");
      }
      mode = nextMode;
      continue;
    }
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--continue-on-error") {
      continueOnError = true;
      continue;
    }
    if (
      argument === "--reuse-proposals-from" ||
      argument?.startsWith("--reuse-proposals-from=")
    ) {
      const value = argument === "--reuse-proposals-from"
        ? argv[index += 1]
        : argument.slice("--reuse-proposals-from=".length);
      if (!value || !SAFE_REVISION.test(value)) {
        throw new Error("--reuse-proposals-from must be a valid revision.");
      }
      reuseProposalsFrom = value;
      continue;
    }
    if (argument === "--concurrency" || argument?.startsWith("--concurrency=")) {
      const value = argument === "--concurrency"
        ? argv[index += 1]
        : argument.slice("--concurrency=".length);
      if (!/^\d+$/.test(value ?? "")) {
        throw new Error("--concurrency must be an integer from 1 to 10.");
      }
      concurrency = Number(value);
      if (concurrency < 1 || concurrency > MAX_CONCURRENCY) {
        throw new Error("--concurrency must be an integer from 1 to 10.");
      }
      continue;
    }
    if (argument === "--slug" || argument?.startsWith("--slug=")) {
      const value = argument === "--slug"
        ? argv[index += 1]
        : argument.slice("--slug=".length);
      if (!value || !SAFE_SLUG.test(value)) {
        throw new Error("--slug must be a valid public pet slug.");
      }
      slug = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ""}`);
  }

  if (!mode) throw new Error("Pass exactly one of --dry-run or --apply.");
  if (force && mode !== "apply") throw new Error("--force requires --apply.");
  if (continueOnError && slug) {
    throw new Error("--continue-on-error cannot be combined with --slug.");
  }
  if (slug && concurrency !== 1) {
    throw new Error("--concurrency cannot be combined with --slug.");
  }
  if (mode === "apply" && concurrency > 1 && !continueOnError) {
    throw new Error("Parallel --apply requires --continue-on-error.");
  }
  return {
    mode,
    slug,
    force,
    continueOnError,
    concurrency,
    reuseProposalsFrom,
  };
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
  const selectedPets = selectApprovedPets(pets, options.slug);
  const summary = createSummary(selectedPets.length);

  await runWithConcurrency(selectedPets, options.concurrency, async (pet) => {
    try {
      const sourceHash = createSourceHash({ pet, modelUri, annotationRevision });
      const stored = options.force
        ? null
        : await getAnnotation(annotationRevision, pet.slug);
      if (stored?.sourceHash === sourceHash) {
        summary.unchanged += 1;
        return;
      }

      summary.planned += 1;
      if (options.mode === "dry-run") {
        log({ action: "would-update", slug: pet.slug });
        return;
      }

      const proposal = await createProposal(pet);
      const unresolvedFields = listUnresolvedStrongRelations({
        slug: pet.slug,
        proposal,
      });
      if (unresolvedFields.length > 0) {
        throw Object.assign(new Error("unresolved_strong_relation"), {
          reason: "unresolved_strong_relation",
          unresolvedFields,
        });
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
      summary.updated += 1;
      log({ action: "updated", slug: pet.slug });
    } catch (error) {
      summary.failed += 1;
      summary.failedSlugs.push(pet.slug);
      log({
        action: "failed",
        slug: pet.slug,
        reason: sanitizedReason(error),
        ...sanitizedUnresolvedFields(error),
      });
      if (!options.continueOnError) throw error;
    }
  });

  summary.failedSlugs.sort();
  log({ action: "summary", ...summary });
  return summary;
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
  const selectedPets = selectApprovedPets(pets, options.slug);
  const annotationsBySlug = new Map(
    annotations.map((annotation) => [annotation.slug, annotation]),
  );
  const summary = createSummary(selectedPets.length);

  await runWithConcurrency(selectedPets, options.concurrency, async (pet) => {
    try {
      const storedAnnotation = annotationsBySlug.get(pet.slug);
      if (!storedAnnotation) {
        throw new Error("annotation_missing");
      }
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
        summary.unchanged += 1;
        return;
      }

      summary.planned += 1;
      if (options.mode === "dry-run") {
        log({ action: "would-update", slug: pet.slug });
        return;
      }

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
      summary.updated += 1;
      log({ action: "updated", slug: pet.slug });
    } catch (error) {
      summary.failed += 1;
      summary.failedSlugs.push(pet.slug);
      log({ action: "failed", slug: pet.slug, reason: sanitizedReason(error) });
      if (!options.continueOnError) throw error;
    }
  });

  summary.failedSlugs.sort();
  log({ action: "summary", ...summary });
  return summary;
}

function assertAnnotationEmbeddingRevision(revision, role) {
  const expected = role === "query"
    ? RELATED_PETS_ANNOTATION_QUERY_REVISION
    : RELATED_PETS_ANNOTATION_DOCUMENT_REVISION;
  if (revision !== expected) {
    throw new Error(`Expected ${role} annotation revision ${expected}.`);
  }
}

function selectApprovedPets(pets, slug) {
  const approved = pets.filter(
    (pet) => !pet.status || pet.status === "approved",
  );
  const selected = slug
    ? approved.filter((pet) => pet.slug === slug)
    : approved;
  if (slug && selected.length === 0) {
    throw new Error(`Approved pet slug not found: ${slug}`);
  }
  return selected;
}

function createSummary(scanned) {
  return {
    scanned,
    unchanged: 0,
    planned: 0,
    updated: 0,
    failed: 0,
    failedSlugs: [],
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}

function sanitizedReason(error) {
  if (typeof error?.reason === "string") return error.reason;
  if (typeof error?.message === "string" && /^[a-z_]+$/.test(error.message)) {
    return error.message;
  }
  return "processing_failed";
}

function sanitizedUnresolvedFields(error) {
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
