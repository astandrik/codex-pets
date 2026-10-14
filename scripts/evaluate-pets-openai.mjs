import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { register } from "node:module";
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
  parentURL: import.meta.url, data: { sourceRootUrl: new URL("../src/", import.meta.url).href },
});
const source = (name) => import(new URL(`../src/lib/pets/${name}.ts`, import.meta.url));
const { destroyYdbDriver } = await import("../src/lib/ydb/client.ts");
const { createPetSearchSourceHash } = await source("search/search-embeddings");
const { LEGACY_RELATED_PETS_V24_PROFILE: legacyProfile } = await source("related/related-pets-profile");
const { listApprovedPetsForSearch } = await source("repository");
const { listRawPetSearchEmbeddings, findSimilarPetEmbeddings } = await source("search/search-embeddings-repository");
const { listPetSearchCaptions } = await source("search/search-captions-repository");
const { listRelatedPetAnnotations } = await source("related/related-pets-annotations-repository");
const { getRelatedPetsState, listRelatedPetsSnapshots } = await source("related/related-pets-repository");
const { prepareRelatedPetsRankingInputs } = await source("related/related-pets-rebuild");
const { OPENAI_RELATED_PETS_PROFILE: base } = await source("related/related-pets-profile");
const { PET_VISION_CAPTION_REVISION } = await source("search/search-vision-contract");
const { OPENAI_PETS_REVISIONS: revisions } = await source("openai-embedding-profile");
const { cosineSimilarityV24, decodeRelatedPetV24Vector, rankRelatedPetsV24WithDiagnostics, rankRelatedPetV24VectorMatches } = await source("related/related-pets-ranking");
const { normalizeSearchQuery, rankPetsLexically, fuseRankedPets } = await source("search/search-ranking");
const { assertPositivePairIdentities } = await source("openai-eval-contract");
const { selectSemanticThreshold } = await source("search/search-eval");
const [split, fixturePath, outputPath, calibrationPath] = process.argv.slice(2);
if (!["calibration", "holdout"].includes(split) || !fixturePath || !outputPath || (split === "holdout" && !calibrationPath)) throw new Error("Explicit split, fixture and output paths required");
const fixtureBytes = readFileSync(fixturePath); const fixtures = JSON.parse(fixtureBytes);
const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
if (existsSync(outputPath)) throw new Error("Evaluation output exists; read it instead of repeating paid queries");
const token = readFileSync(process.env.PET_EMBEDDING_SERVICE_TOKEN_FILE, "utf8").trim();
const endpoint = process.env.PET_EMBEDDING_SERVICE_URL;
if (endpoint !== "http://pets-embeddings:8090/embeddings") throw new Error("Invalid embedding service");
const quantile = (a, n) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * n) - 1)];
const mean = (values) => values.length ? values.reduce((x, y) => x + y, 0) / values.length : 0;
function ndcg(ranked, relevant) {
  const dcg = ranked.slice(0, 5).reduce((n, slug, i) => n + (relevant.includes(slug) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = relevant.slice(0, 5).reduce((n, _, i) => n + 1 / Math.log2(i + 2), 0);
  return ideal ? dcg / ideal : 0;
}
try {
  const pets = await listApprovedPetsForSearch(); const bySlug = new Map(pets.map((p) => [p.slug, p]));
  const rows = {};
  for (const [key, revision] of Object.entries(revisions)) rows[key] = await listRawPetSearchEmbeddings(revision);
  const captions = await listPetSearchCaptions(PET_VISION_CAPTION_REVISION);
  const annotations = await listRelatedPetAnnotations(base.annotationRevision);
  const modelUri = `gpt://${process.env.YANDEX_AI_STUDIO_FOLDER_ID}/qwen3.6-35b-a3b`;
  const inputs = prepareRelatedPetsRankingInputs({ pets, textRows: rows.descriptionDocument, textQueryRows: rows.descriptionQuery,
    annotationRows: rows.annotationDocument, annotationQueryRows: rows.annotationQuery, annotations, annotationModelUri: modelUri,
    visualRows: rows.visual, captions, profile: base, visualContext: { captionRevision: PET_VISION_CAPTION_REVISION, modelUri } });
  for (const key of ["textQueryVectors", "textDocumentVectors", "annotationQueryVectors", "annotationDocumentVectors", "annotations", "visualVectors"]) {
    if (inputs[key].size !== pets.length) throw new Error(`incomplete_${key}`);
  }
  const searchVectors = new Map(rows.search.map((r) => [r.slug, decodeRelatedPetV24Vector(r, { modelRevision: revisions.search, dimensions: 3072, sourceHash: bySlug.has(r.slug) ? createPetSearchSourceHash(bySlug.get(r.slug), revisions.search) : "invalid_non_catalog_slug" })]));
  if (searchVectors.size !== pets.length || pets.some((p) => !searchVectors.has(p.slug)) || [...searchVectors.values()].some((v) => !v)) throw new Error("search_incomplete");
  const state = await getRelatedPetsState();
  if (!state || state.status !== "ready" || !state.activeGenerationId || state.rankingRevision !== legacyProfile.rankingRevision) throw new Error("baseline_state_invalid");
  const snapshotRows = await listRelatedPetsSnapshots(state.activeGenerationId);
  const oldSnapshots = new Map(snapshotRows.map((r) => [r.sourceSlug, r.relatedSlugs]));
  if (snapshotRows.length !== pets.length || oldSnapshots.size !== pets.length || pets.some((p) => !oldSnapshots.has(p.slug)) ||
      snapshotRows.some((r) => r.generationId !== state.activeGenerationId || r.rankingRevision !== state.rankingRevision ||
        r.relatedSlugs.some((slug) => !bySlug.has(slug) || slug === r.sourceSlug) || new Set(r.relatedSlugs).size !== r.relatedSlugs.length)) throw new Error("baseline_snapshots_incomplete");
  const corpusFingerprint = createHash("sha256").update(JSON.stringify(pets.toSorted((a,b) => a.slug.localeCompare(b.slug))
    .map((p) => [p.slug, createPetSearchSourceHash(p, revisions.search)]))).digest("hex");
  const baselineFingerprint = createHash("sha256").update(JSON.stringify(snapshotRows.toSorted((a,b) => a.sourceSlug.localeCompare(b.sourceSlug)))).digest("hex");
  const queries = fixtures.queries.filter((q) => q.split === split); const pairs = fixtures.pairs.filter((q) => q.split === split);
  for (const q of queries) if (q.relevantSlugs.some((s) => !bySlug.has(s))) throw new Error("unknown_fixture_pet");
  for (const p of pairs) {
    if (!bySlug.has(p.left) || !bySlug.has(p.right)) throw new Error("unknown_fixture_pair");
  }
  assertPositivePairIdentities(inputs.annotations, pairs, base.relationPolicyRevision);

  const observations = [];
  for (const q of queries) {
    const started = performance.now();
    const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: [normalizeSearchQuery(q.query).text], mode: "migration" }), signal: AbortSignal.timeout(75_000) });
    if (!response.ok) throw new Error("embedding_evaluation_failed");
    const vector = (await response.json()).data[0].embedding;
    const matches = (map) => [...map].map(([slug, stored]) => ({ slug, score: cosineSimilarityV24(vector, stored) })).sort((a, b) => b.score - a.score);
    observations.push({ ...q, text: matches(searchVectors), visual: matches(inputs.visualVectors),
      lexical: rankPetsLexically(pets, q.query), durationMs: performance.now() - started });
  }
  const pairScores = pairs.map((p) => ({ ...p,
    text: cosineSimilarityV24(inputs.textQueryVectors.get(p.left), inputs.textDocumentVectors.get(p.right)),
    annotation: cosineSimilarityV24(inputs.annotationQueryVectors.get(p.left), inputs.annotationDocumentVectors.get(p.right)),
    visual: cosineSimilarityV24(inputs.visualVectors.get(p.left), inputs.visualVectors.get(p.right)) }));
  const precomputed = new Map([...new Set(pairs.map((p) => p.left))].map((slug) => [slug, {
    text: rankRelatedPetV24VectorMatches(slug, inputs.textQueryVectors, inputs.textDocumentVectors),
    annotation: rankRelatedPetV24VectorMatches(slug, inputs.annotationQueryVectors, inputs.annotationDocumentVectors),
    visual: rankRelatedPetV24VectorMatches(slug, inputs.visualVectors) }]));
  function searchReport(profile) {
    const details = observations.map((o) => {
      const results = fuseRankedPets({ pets, lexical: o.lexical, semanticRanks: [
        { matches: o.text, minScore: profile.searchMinSimilarity, weight: 1 },
        { matches: o.visual, minScore: profile.searchVisualMinSimilarity, weight: profile.searchVisualWeight }] }).map((p) => p.slug);
      return { query: o.query, category: o.category, results: results.slice(0, 5),
        lexicalNdcg: ndcg(o.lexical.map((r) => r.pet.slug), o.relevantSlugs), ndcg: ndcg(results, o.relevantSlugs),
        exactPass: o.category !== "exact" || results[0] === o.relevantSlugs[0],
        negativePass: o.relevantSlugs.length > 0 || results.length === 0 };
    });
    return { ndcgAt5: mean(details.filter((o) => o.category !== "negative").map((o) => o.ndcg)),
      lexicalNdcgAt5: mean(details.filter((o) => o.category !== "negative").map((o) => o.lexicalNdcg)),
      exactNameMrrAt5: mean(details.filter((o) => o.category === "exact").map((o) => o.exactPass ? 1 : 0)),
      negativeSafe: details.every((o) => o.negativePass), details };
  }
  function relatedReport(profile) {
    const results = new Map([...precomputed].map(([slug, matches]) => [slug, rankRelatedPetsV24WithDiagnostics({
      source: bySlug.get(slug), candidates: pets, annotations: inputs.annotations, precomputedMatches: matches,
      ...inputs, profile: { ...base, ...profile } })]));
    const details = pairs.map((p) => ({ ...p, rank: results.get(p.left).slugs.indexOf(p.right) + 1,
      baselineRank: (oldSnapshots.get(p.left) ?? []).indexOf(p.right) + 1,
      top4: results.get(p.left).slugs.slice(0, 4) }));
    return { positiveRecallAt4: mean(details.filter((p) => p.relevant).map((p) => p.rank > 0 && p.rank <= 4 ? 1 : 0)),
      baselinePositiveRecallAt4: mean(details.filter((p) => p.relevant).map((p) => p.baselineRank > 0 && p.baselineRank <= 4 ? 1 : 0)),
      negativeSafe: details.filter((p) => !p.relevant).every((p) => !p.rank || p.rank > 4), details };
  }
  let profile;
  if (split === "calibration") {
    profile = { searchMinSimilarity: selectSemanticThreshold(observations.map((o) => ({ relevantSlugs: o.relevantSlugs, negative: !o.relevantSlugs.length, matches: o.text }))),
      searchVisualMinSimilarity: selectSemanticThreshold(observations.map((o) => ({ relevantSlugs: o.relevantSlugs, negative: !o.relevantSlugs.length, matches: o.visual }))) };
    for (const [key, field] of [["text", "textMinSimilarity"], ["annotation", "annotationMinSimilarity"], ["visual", "visualMinSimilarity"]]) {
      profile[field] = selectSemanticThreshold(pairScores.map((p) => ({ relevantSlugs: p.relevant ? [p.right] : [], negative: !p.relevant, matches: [{ slug: p.right, score: p[key] }] })));
    }
    let best = null;
    for (const searchVisualWeight of [0.25, 0.5, 1, 2]) {
      const candidate = { ...profile, searchVisualWeight }; const score = searchReport(candidate);
      if (score.negativeSafe && score.exactNameMrrAt5 === 1 && (!best || score.ndcgAt5 > best.score.ndcgAt5)) best = { candidate, score };
    }
    if (!best) throw new Error("search_calibration_failed"); profile = best.candidate;
    best = null;
    for (const annotationWeight of [0.5, 1, 2]) for (const visualWeight of [0.25, 0.5, 1]) {
      const candidate = { ...profile, annotationWeight, visualWeight }; const score = relatedReport(candidate);
      if (score.negativeSafe && (!best || score.positiveRecallAt4 > best.score.positiveRecallAt4)) best = { candidate, score };
    }
    if (!best) throw new Error("related_calibration_failed"); profile = best.candidate;
  } else {
    const calibration = JSON.parse(readFileSync(calibrationPath));
    if (calibration.fixtureHash !== fixtureHash || calibration.split !== "calibration" || !calibration.passed ||
        calibration.corpusFingerprint !== corpusFingerprint || calibration.baselineFingerprint !== baselineFingerprint ||
        calibration.oldActiveGeneration !== state.activeGenerationId) throw new Error("calibration_not_frozen");
    profile = calibration.profile;
  }
  const search = searchReport(profile), related = relatedReport(profile);
  const passed = search.exactNameMrrAt5 === 1 && search.negativeSafe && search.ndcgAt5 >= search.lexicalNdcgAt5 &&
    related.negativeSafe && related.positiveRecallAt4 >= related.baselinePositiveRecallAt4;
  const latency = [];
  for (const vector of [...searchVectors.values()].slice(0, 3)) {
    const start = performance.now(); await findSimilarPetEmbeddings({ modelRevision: revisions.search, dimensions: 3072, embedding: vector }); latency.push(performance.now() - start);
  }
  const report = { split, fixtureHash, corpusFingerprint, baselineFingerprint, oldActiveGeneration: state.activeGenerationId, profile, passed, search, related, pairScores,
    coverage: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])),
    providerLatencyMs: { p50: quantile(observations.map((o) => o.durationMs), 0.5), p95: quantile(observations.map((o) => o.durationMs), 0.95) },
    nativeSearchLatencyMs: { p50: quantile(latency, 0.5), p95: quantile(latency, 0.95) } };
  writeFileSync(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
  if (!passed) process.exitCode = 2;
} finally { await destroyYdbDriver(); }
