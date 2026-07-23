import { createHash } from "node:crypto";

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function parseBackfillArgs(argv) {
  let mode = null;
  let slug = null;
  let force = false;

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

  if (!mode) {
    throw new Error("Pass exactly one of --dry-run or --apply.");
  }
  if (force && mode !== "apply") {
    throw new Error("--force requires --apply.");
  }

  return { mode, slug, force };
}

export function buildPetSearchDocument(pet) {
  const tags = Array.from(
    new Set(
      pet.tags
        .map((tag) => tag.normalize("NFKC").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

  return [
    `name: ${pet.displayName.normalize("NFKC").trim()}`,
    `kind: ${pet.kind}`,
    `description: ${pet.description.normalize("NFKC").trim()}`,
    `tags: ${tags.join(", ")}`,
  ].join("\n");
}

export function createPetSearchSourceHash(pet, modelRevision) {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildPetSearchDocument(pet))
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
  now = () => new Date(),
  log = console.log,
}) {
  const approvedPets = pets.filter(
    (candidate) => !candidate.status || candidate.status === "approved",
  );
  const selectedPets = options.slug
    ? approvedPets.filter((candidate) => candidate.slug === options.slug)
    : approvedPets;
  if (options.slug && selectedPets.length === 0) {
    throw new Error(`Approved pet slug not found: ${options.slug}`);
  }

  const summary = {
    scanned: selectedPets.length,
    unchanged: 0,
    planned: 0,
    updated: 0,
  };

  for (const pet of selectedPets) {
    const sourceHash = createPetSearchSourceHash(pet, revision);
    const metadata = options.force
      ? null
      : await getMetadata(revision, pet.slug);
    if (
      metadata?.sourceHash === sourceHash &&
      metadata.dimensions === dimensions
    ) {
      summary.unchanged += 1;
      continue;
    }

    summary.planned += 1;
    if (options.mode === "dry-run") {
      log({ action: "would-update", slug: pet.slug });
      continue;
    }

    const embedding = await embedDocument(buildPetSearchDocument(pet));
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
    summary.updated += 1;
    log({ action: "updated", slug: pet.slug });
  }

  log({ action: "summary", ...summary });
  return summary;
}
