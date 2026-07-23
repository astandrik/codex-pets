import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type {
  PetSearchEvalSuite,
  PetSearchJudgment,
} from "@/lib/pets/search-eval-fixtures";

export const PET_SEARCH_LABEL_POOL_VERSION =
  "codex-pets-blinded-label-pool-v2";
export const PET_SEARCH_LABEL_POOL_RANK_LIMIT = 10;
export const PET_SEARCH_LABEL_POOL_SAMPLE_SIZE = 10;

type V2EvalSuite = Exclude<PetSearchEvalSuite, "diagnostic-v1">;

export type PetSearchLabelPoolCandidate = {
  slug: string;
  displayName: string;
  spritesheetSha256: string;
  frameDataUrls: readonly [string, string, string, string];
};

export type PetSearchLabelPool = {
  poolVersion: typeof PET_SEARCH_LABEL_POOL_VERSION;
  queryId: string;
  suite: V2EvalSuite;
  query: string;
  candidatePoolHash: string;
  candidates: PetSearchLabelPoolCandidate[];
};

export type PetSearchLabelPoolJudgmentRecord = {
  poolVersion: typeof PET_SEARCH_LABEL_POOL_VERSION;
  queryId: string;
  suite: V2EvalSuite;
  query: string;
  candidatePoolHash: string;
  candidateRecords: Array<{
    slug: string;
    spritesheetSha256: string;
  }>;
  reviewer: string;
  reviewedAt: string;
  judgments: Array<{
    slug: string;
    judgment: PetSearchJudgment;
  }>;
};

export function buildPetSearchLabelPool(input: {
  queryId: string;
  suite: V2EvalSuite;
  query: string;
  catalog: readonly PetSearchLabelPoolCandidate[];
  rankings: {
    lexical: readonly string[];
    text: readonly string[];
    visualV1: readonly string[];
    visualV2: readonly string[];
  };
  evaluatedTopSlugs?: readonly string[];
}): PetSearchLabelPool {
  if (!input.queryId || !input.query.trim()) {
    throw new Error("Label pool query identity is missing.");
  }

  const catalogBySlug = new Map<string, PetSearchLabelPoolCandidate>();
  for (const candidate of input.catalog) {
    validateCandidate(candidate);
    if (catalogBySlug.has(candidate.slug)) {
      throw new Error(`Label pool catalog contains duplicate slug: ${candidate.slug}`);
    }
    catalogBySlug.set(candidate.slug, candidate);
  }

  const selectedSlugs = new Set<string>();
  for (const rankedSlugs of Object.values(input.rankings)) {
    for (const slug of rankedSlugs.slice(0, PET_SEARCH_LABEL_POOL_RANK_LIMIT)) {
      if (catalogBySlug.has(slug)) selectedSlugs.add(slug);
    }
  }
  for (const slug of input.evaluatedTopSlugs ?? []) {
    if (!catalogBySlug.has(slug)) {
      throw new Error(
        `Evaluated label pool candidate is absent from catalog: ${slug}`,
      );
    }
    selectedSlugs.add(slug);
  }

  const sample = [...input.catalog]
    .sort((left, right) =>
      compareHashes(
        createSampleOrderHash(input.suite, input.query, left.slug),
        createSampleOrderHash(input.suite, input.query, right.slug),
        left.slug,
        right.slug,
      ),
    )
    .slice(0, PET_SEARCH_LABEL_POOL_SAMPLE_SIZE);
  for (const candidate of sample) selectedSlugs.add(candidate.slug);

  const selected = [...selectedSlugs].map((slug) => {
    const candidate = catalogBySlug.get(slug);
    if (!candidate) {
      throw new Error(`Label pool candidate is absent from catalog: ${slug}`);
    }
    return candidate;
  });
  const candidatePoolHash = createPetSearchLabelPoolHash({
    poolVersion: PET_SEARCH_LABEL_POOL_VERSION,
    suite: input.suite,
    query: input.query,
    candidateRecords: selected.map((candidate) => ({
      slug: candidate.slug,
      spritesheetSha256: candidate.spritesheetSha256,
    })),
  });
  const candidates = selected.sort((left, right) =>
    compareHashes(
      createDisplayOrderHash(candidatePoolHash, left.slug),
      createDisplayOrderHash(candidatePoolHash, right.slug),
      left.slug,
      right.slug,
    ),
  );

  return {
    poolVersion: PET_SEARCH_LABEL_POOL_VERSION,
    queryId: input.queryId,
    suite: input.suite,
    query: input.query,
    candidatePoolHash,
    candidates,
  };
}

export function createPetSearchLabelPoolHash(input: {
  poolVersion: string;
  suite: string;
  query: string;
  candidateRecords: readonly {
    slug: string;
    spritesheetSha256: string;
  }[];
}): string {
  const records = [...input.candidateRecords].sort((left, right) =>
    left.slug.localeCompare(right.slug) ||
    left.spritesheetSha256.localeCompare(right.spritesheetSha256),
  );
  return hashLengthPrefixed([
    input.poolVersion,
    input.suite,
    input.query,
    ...records.flatMap((record) => [
      record.slug,
      record.spritesheetSha256,
    ]),
  ]);
}

export function validatePetSearchLabelPoolJudgments(
  pools: readonly PetSearchLabelPool[],
  records: readonly PetSearchLabelPoolJudgmentRecord[],
): void {
  if (records.length !== pools.length) {
    throw new Error("Label pool judgment export is incomplete.");
  }

  const recordsByQuery = new Map<string, PetSearchLabelPoolJudgmentRecord>();
  for (const record of records) {
    if (recordsByQuery.has(record.queryId)) {
      throw new Error(`Label pool judgments duplicate query: ${record.queryId}`);
    }
    recordsByQuery.set(record.queryId, record);
  }

  for (const pool of pools) {
    const record = recordsByQuery.get(pool.queryId);
    if (!record) {
      throw new Error(`Label pool judgment export is incomplete: ${pool.queryId}`);
    }
    if (
      record.poolVersion !== pool.poolVersion ||
      record.suite !== pool.suite ||
      record.query !== pool.query
    ) {
      throw new Error(`Label pool contract mismatch: ${pool.queryId}`);
    }
    if (!record.reviewer.trim()) {
      throw new Error(`Label pool reviewer is missing: ${pool.queryId}`);
    }
    if (!isIsoTimestamp(record.reviewedAt)) {
      throw new Error(`Label pool review timestamp is invalid: ${pool.queryId}`);
    }

    const expectedCandidates = pool.candidates
      .map((candidate) => ({
        slug: candidate.slug,
        spritesheetSha256: candidate.spritesheetSha256,
      }))
      .sort(compareCandidateRecords);
    const exportedCandidates = [...record.candidateRecords]
      .sort(compareCandidateRecords);
    if (!sameCandidateRecords(expectedCandidates, exportedCandidates)) {
      throw new Error(`Label pool candidate records mismatch: ${pool.queryId}`);
    }
    const recomputedHash = createPetSearchLabelPoolHash({
      poolVersion: record.poolVersion,
      suite: record.suite,
      query: record.query,
      candidateRecords: record.candidateRecords,
    });
    if (
      record.candidatePoolHash !== pool.candidatePoolHash ||
      recomputedHash !== pool.candidatePoolHash
    ) {
      throw new Error(`Label pool hash mismatch: ${pool.queryId}`);
    }

    const expectedSlugs = new Set(
      pool.candidates.map((candidate) => candidate.slug),
    );
    const judgedSlugs = new Set<string>();
    for (const judgment of record.judgments) {
      if (
        !expectedSlugs.has(judgment.slug) ||
        judgedSlugs.has(judgment.slug) ||
        !isJudgment(judgment.judgment)
      ) {
        throw new Error(`Label pool judgments are invalid: ${pool.queryId}`);
      }
      judgedSlugs.add(judgment.slug);
    }
    if (
      judgedSlugs.size !== expectedSlugs.size ||
      [...expectedSlugs].some((slug) => !judgedSlugs.has(slug))
    ) {
      throw new Error(`Label pool judgment export is incomplete: ${pool.queryId}`);
    }
  }
}

export function renderPetSearchLabelPoolHtml(
  pools: readonly PetSearchLabelPool[],
): string {
  const reviewData = pools.map((pool) => ({
    poolVersion: pool.poolVersion,
    queryId: pool.queryId,
    suite: pool.suite,
    query: pool.query,
    candidatePoolHash: pool.candidatePoolHash,
    candidates: pool.candidates.map((candidate) => ({
      slug: candidate.slug,
      displayName: candidate.displayName,
      frameDataUrls: [...candidate.frameDataUrls],
    })),
  }));
  const exportMetadata = pools.map((pool) => ({
    queryId: pool.queryId,
    candidateRecords: pool.candidates.map((candidate) => ({
      slug: candidate.slug,
      spritesheetSha256: candidate.spritesheetSha256,
    })),
  }));
  const serializedReviewData = safeJson(reviewData);
  const encodedExportMetadata = Buffer.from(
    JSON.stringify(exportMetadata),
    "utf8",
  ).toString("base64");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Pets blinded relevance review</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #101216; color: #f3f5f7; }
    main { width: min(1180px, calc(100% - 32px)); margin: 32px auto 80px; }
    header { position: sticky; top: 0; z-index: 2; padding: 16px 0; background: #101216f2; }
    input[type="text"] { width: min(420px, 100%); padding: 10px 12px; }
    section { margin: 36px 0 64px; }
    .query { font-size: 24px; margin-bottom: 18px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
    .card { border: 1px solid #343944; border-radius: 14px; padding: 14px; background: #191c22; }
    .identity { min-height: 52px; }
    .identity strong, .identity code { display: block; overflow-wrap: anywhere; }
    .frames { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 12px 0; }
    .frames img { width: 100%; aspect-ratio: 12 / 13; object-fit: contain; image-rendering: pixelated; background: #0b0d10; }
    fieldset { display: flex; gap: 12px; border: 0; padding: 0; }
    label { cursor: pointer; }
    button { padding: 12px 18px; font-weight: 700; }
    #status { margin-left: 12px; color: #f1bd55; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex Pets blinded relevance review</h1>
      <p>Judge visible relevance to each query. Every candidate requires one label.</p>
      <label>Reviewer <input id="reviewer" type="text" autocomplete="name"></label>
      <button id="export" type="button">Export judgments</button>
      <span id="status" role="status"></span>
    </header>
    <div id="review"></div>
  </main>
  <script id="review-data" type="application/json">${serializedReviewData}</script>
  <script>
    (() => {
      const pools = JSON.parse(document.getElementById("review-data").textContent);
      const metadata = JSON.parse(atob("${encodedExportMetadata}"));
      const metadataByQuery = new Map(metadata.map((entry) => [entry.queryId, entry]));
      const review = document.getElementById("review");
      const status = document.getElementById("status");

      for (const pool of pools) {
        const section = document.createElement("section");
        const heading = document.createElement("h2");
        heading.className = "query";
        heading.textContent = pool.query;
        section.append(heading);
        const grid = document.createElement("div");
        grid.className = "grid";
        for (const candidate of pool.candidates) {
          const card = document.createElement("article");
          card.className = "card";
          const identity = document.createElement("div");
          identity.className = "identity";
          const name = document.createElement("strong");
          name.textContent = candidate.displayName;
          const slug = document.createElement("code");
          slug.textContent = candidate.slug;
          identity.append(name, slug);
          const frames = document.createElement("div");
          frames.className = "frames";
          candidate.frameDataUrls.forEach((source, index) => {
            const image = document.createElement("img");
            image.src = source;
            image.alt = "Frame " + (index + 1);
            frames.append(image);
          });
          const choices = document.createElement("fieldset");
          for (const judgment of ["relevant", "irrelevant", "uncertain"]) {
            const choice = document.createElement("label");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = pool.queryId + ":" + candidate.slug;
            input.value = judgment;
            choice.append(input, " " + judgment);
            choices.append(choice);
          }
          card.append(identity, frames, choices);
          grid.append(card);
        }
        section.append(grid);
        review.append(section);
      }

      document.getElementById("export").addEventListener("click", () => {
        const reviewer = document.getElementById("reviewer").value.trim();
        if (!reviewer) {
          status.textContent = "Reviewer is required.";
          return;
        }
        const reviewedAt = new Date().toISOString();
        const records = [];
        for (const pool of pools) {
          const judgments = [];
          for (const candidate of pool.candidates) {
            const name = pool.queryId + ":" + candidate.slug;
            const selected = document.querySelector('input[name="' + CSS.escape(name) + '"]:checked');
            if (!selected) {
              status.textContent = "Every candidate must be labeled.";
              return;
            }
            judgments.push({ slug: candidate.slug, judgment: selected.value });
          }
          const exportEntry = metadataByQuery.get(pool.queryId);
          records.push({
            poolVersion: pool.poolVersion,
            queryId: pool.queryId,
            suite: pool.suite,
            query: pool.query,
            candidatePoolHash: pool.candidatePoolHash,
            candidateRecords: exportEntry.candidateRecords,
            reviewer,
            reviewedAt,
            judgments,
          });
        }
        const blob = new Blob([JSON.stringify(records, null, 2) + "\\n"], {
          type: "application/json",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "codex-pets-v2-judgments.json";
        link.click();
        URL.revokeObjectURL(link.href);
        status.textContent = "Judgments exported.";
      });
    })();
  </script>
</body>
</html>
`;
}

export async function writePetSearchLabelPoolBundle(input: {
  outputDirectory: string;
  pools: readonly PetSearchLabelPool[];
}): Promise<{ indexPath: string }> {
  if (!isAbsolute(input.outputDirectory)) {
    throw new Error("Label pool output directory must be absolute.");
  }
  await mkdir(input.outputDirectory, { recursive: true });
  const entries = await readdir(input.outputDirectory);
  if (entries.length > 0) {
    throw new Error("Label pool output requires an empty directory.");
  }

  const indexPath = join(input.outputDirectory, "index.html");
  await writeFile(
    indexPath,
    renderPetSearchLabelPoolHtml(input.pools),
    "utf8",
  );
  return { indexPath };
}

function validateCandidate(candidate: PetSearchLabelPoolCandidate): void {
  if (!candidate.slug || !candidate.displayName) {
    throw new Error("Label pool candidate identity is missing.");
  }
  if (!/^[a-f0-9]{64}$/.test(candidate.spritesheetSha256)) {
    throw new Error(`Label pool spritesheet hash is invalid: ${candidate.slug}`);
  }
  if (
    candidate.frameDataUrls.length !== 4 ||
    candidate.frameDataUrls.some(
      (frame) => !frame.startsWith("data:image/png;base64,"),
    )
  ) {
    throw new Error(`Label pool requires four PNG frames: ${candidate.slug}`);
  }
}

function createSampleOrderHash(
  suite: string,
  query: string,
  slug: string,
): string {
  return hashLengthPrefixed([
    PET_SEARCH_LABEL_POOL_VERSION,
    suite,
    query,
    slug,
  ]);
}

function createDisplayOrderHash(poolHash: string, slug: string): string {
  return hashLengthPrefixed([poolHash, slug]);
}

function hashLengthPrefixed(fields: readonly string[]): string {
  const hash = createHash("sha256");
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function compareHashes(
  leftHash: string,
  rightHash: string,
  leftSlug: string,
  rightSlug: string,
): number {
  return leftHash.localeCompare(rightHash) ||
    leftSlug.localeCompare(rightSlug);
}

function compareCandidateRecords(
  left: { slug: string; spritesheetSha256: string },
  right: { slug: string; spritesheetSha256: string },
): number {
  return left.slug.localeCompare(right.slug) ||
    left.spritesheetSha256.localeCompare(right.spritesheetSha256);
}

function sameCandidateRecords(
  left: readonly { slug: string; spritesheetSha256: string }[],
  right: readonly { slug: string; spritesheetSha256: string }[],
): boolean {
  return left.length === right.length &&
    left.every(
      (record, index) =>
        record.slug === right[index]?.slug &&
        record.spritesheetSha256 === right[index]?.spritesheetSha256,
    );
}

function isJudgment(value: string): value is PetSearchJudgment {
  return value === "relevant" ||
    value === "irrelevant" ||
    value === "uncertain";
}

function isIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
