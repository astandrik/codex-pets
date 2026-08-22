#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(repositoryRoot, "src");

export async function runRelatedPetsV24Verification({
  argv = process.argv.slice(2),
  loadService = loadProductionService,
  write = (line) => console.log(line),
} = {}) {
  if (argv.length > 0) {
    throw new Error("related:verify:v24 does not accept arguments.");
  }

  const service = await loadService();
  try {
    const [state, dryRun, candidates] = await Promise.all([
      service.getState(),
      service.rebuild({ mode: "dry-run", includeVisual: true }),
      service.listCandidates(),
    ]);
    if (
      !state ||
      state.status !== "ready" ||
      !state.activeGenerationId ||
      state.rankingRevision !== service.rankingRevision
    ) {
      throw new Error("active_generation_incompatible");
    }

    const snapshots = await service.listSnapshots(state.activeGenerationId);
    const approvedSlugs = new Set(
      dryRun.rankings.map(({ sourceSlug }) => sourceSlug),
    );
    const expectedBySource = new Map(
      dryRun.rankings.map(({ sourceSlug, relatedSlugs }) => [
        sourceSlug,
        relatedSlugs,
      ]),
    );
    const actualBySource = new Map(
      snapshots.map(({ sourceSlug, relatedSlugs }) => [sourceSlug, relatedSlugs]),
    );
    const mismatchedSources = Array.from(new Set([
      ...expectedBySource.keys(),
      ...actualBySource.keys(),
    ])).toSorted(compareCodePoints).filter((sourceSlug) => {
      const expected = expectedBySource.get(sourceSlug);
      const actual = actualBySource.get(sourceSlug);
      return !expected || !actual || !sameOrderedSlugs(expected, actual);
    });
    const integrityFailures = snapshots.filter((snapshot) =>
      snapshot.rankingRevision !== service.rankingRevision ||
      !approvedSlugs.has(snapshot.sourceSlug) ||
      snapshot.relatedSlugs.length !== Math.min(8, approvedSlugs.size - 1) ||
      new Set(snapshot.relatedSlugs).size !== snapshot.relatedSlugs.length ||
      snapshot.relatedSlugs.includes(snapshot.sourceSlug) ||
      snapshot.relatedSlugs.some((slug) => !approvedSlugs.has(slug))
    ).map(({ sourceSlug }) => sourceSlug);

    const status =
      snapshots.length === dryRun.coverage.approvedPetCount &&
        actualBySource.size === expectedBySource.size &&
        mismatchedSources.length === 0 &&
        integrityFailures.length === 0
        ? "verified"
        : "failed";
    write(JSON.stringify({
      operation: "related-pets-v24-verify",
      status,
      activeGenerationId: state.activeGenerationId,
      catalogFingerprint: createCatalogFingerprint(candidates),
      rankingRevision: state.rankingRevision,
      coverage: dryRun.coverage,
      snapshotCount: snapshots.length,
      mismatchedSources,
      integrityFailures,
    }));
    return status === "verified" ? 0 : 1;
  } finally {
    await service.dispose?.();
  }
}

function sameOrderedSlugs(left, right) {
  return left.length === right.length &&
    left.every((slug, index) => slug === right[index]);
}

function createCatalogFingerprint(pets) {
  const catalog = pets.map((pet) => ({
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    tags: [...pet.tags].toSorted(compareCodePoints),
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
  })).toSorted((left, right) => compareCodePoints(left.slug, right.slug));
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function loadProductionService() {
  const { register } = await import("node:module");
  register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
    parentURL: import.meta.url,
    data: { sourceRootUrl: pathToFileURL(sourceRoot).href },
  });

  const [rebuildRuntime, relatedRepository, petRepository, profile, ydb] =
    await Promise.all([
      import(pathToFileURL(
        path.join(sourceRoot, "lib/pets/related-pets-rebuild.ts"),
      ).href),
      import(pathToFileURL(
        path.join(sourceRoot, "lib/pets/related-pets-repository.ts"),
      ).href),
      import(pathToFileURL(
        path.join(sourceRoot, "lib/pets/repository.ts"),
      ).href),
      import(pathToFileURL(
        path.join(sourceRoot, "lib/pets/related-pets-profile.ts"),
      ).href),
      import(pathToFileURL(path.join(sourceRoot, "lib/ydb/client.ts")).href),
    ]);
  return {
    rebuild: rebuildRuntime.rebuildRelatedPets,
    getState: relatedRepository.getRelatedPetsState,
    listSnapshots: relatedRepository.listRelatedPetsSnapshots,
    listCandidates: petRepository.listRelatedPetCandidates,
    rankingRevision: profile.RELATED_PETS_V24_RANKING_REVISION,
    dispose: ydb.destroyYdbDriver,
  };
}

function isEntrypoint() {
  const entry = process.argv[1];
  return Boolean(entry) &&
    pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) {
  runRelatedPetsV24Verification()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error(JSON.stringify({
        operation: "related-pets-v24-verify",
        status: "failed",
        failureReason: "verification_failed",
      }));
      process.exitCode = 1;
    });
}
