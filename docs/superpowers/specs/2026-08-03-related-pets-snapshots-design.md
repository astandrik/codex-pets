# Hybrid Related Pets via YDB Snapshots

Date: 2026-08-03

## Status

Approved for implementation.

## Context

Pet detail pages currently choose related pets with a deterministic metadata
heuristic: shared normalized tags, then matching kind, approval/creation date,
and slug. The catalog already stores text and visual search embeddings, but a
page request must not call an embedding provider or perform a live vector
search.

## Decision

Related-pet rankings are precomputed after catalog mutations and published as
versioned YDB snapshots. A page reads only a complete active generation. The
existing metadata heuristic remains the fallback whenever snapshots are
disabled, unavailable, incompatible, incomplete, or unreadable.

Public route and DTO shapes do not change.

## Persistence

Two additive tables are created by an idempotent migration and mirrored in
`ydb/schema.yql`.

### `codex_pet_related_state`

A singleton row keyed by `state_id = "active"`:

- `requested_generation_id: Utf8?`
- `active_generation_id: Utf8?`
- `previous_generation_id: Utf8?`
- `status: Utf8` (`building`, `ready`, or `failed`)
- `ranking_revision: Utf8`
- `failure_reason: Utf8?`
- `updated_at: Utf8`

### `codex_pet_related_snapshots`

One row per source pet and generation:

- `generation_id: Utf8`
- `source_slug: Utf8`
- `ranking_revision: Utf8`
- `related_slugs_json: Json`
- `created_at: Utf8`
- primary key `(generation_id, source_slug)`

Generation identifiers are unique opaque tokens. Timestamps use the repository's
existing ISO-8601 `Utf8` convention.

## Ranking

A full rebuild loads approved pets and the current text and visual embedding
rows. Stored vectors are accepted only when all of these match:

- expected model revision;
- expected dimensions;
- current source-document hash;
- valid byte length and decoding;
- every value is finite.

No embedding provider is called by the rebuild.

For each source pet, the rebuild computes pairwise cosine similarity in memory
and creates three deterministic rankings:

1. text-vector similarity above the calibrated text threshold;
2. visual-vector similarity above the calibrated visual threshold;
3. metadata rank using shared tag count, same kind, approval/creation date, and
   slug.

The rankings are fused with weighted Reciprocal Rank Fusion:

- text weight `1`;
- metadata weight `0.15`;
- visual weight selected by calibration from `0.25`, `0.5`, or `0.75`.

Ties are resolved deterministically by metadata order and then slug. The source
pet is excluded. Duplicate slugs are removed. Up to four slugs are stored,
filling from metadata candidates when vector modalities are sparse.

The ranking profile is revision-bound. A snapshot with a different ranking
revision is incompatible and cannot be served.

## Calibration

Frozen multi-result search groups produce source-to-peer fixtures:

- calibration: `gothic-anime` (3), `cute` (3), and `sexy` (4), for 10 source
  cases;
- holdout: `badass` (4), for 4 source cases.

Text threshold is selected by maximum calibration nDCG@4 for text plus metadata,
with ties resolved toward the higher threshold. With text fixed, visual
threshold and visual weight are selected by maximum full-hybrid nDCG@4, with
ties resolved toward the lower visual weight and then the higher threshold.

The untouched holdout must show full-hybrid nDCG@4 no worse than both the
metadata heuristic and text-plus-metadata.

## Generation Lifecycle

1. Allocate a unique generation token.
2. Conditionally set the singleton state to that token with `status = building`.
3. Build every approved source snapshot under the inactive generation.
4. Activate only when the singleton's requested token still equals this token.
5. Move the former active generation to `previous_generation_id`, set the new
   active generation, and mark the state `ready`.
6. Delete generations older than active and previous after successful
   activation.

A superseded rebuild cannot publish over a newer request. If the current token
fails, its state becomes `failed` with a bounded sanitized reason. Pet
moderation is not rolled back. Failed or superseded inactive rows are derived
data and may be removed by recovery.

## Mutation Triggers

- Approve waits for text indexing, then waits for a text-first full rebuild.
- Successful asynchronous visual indexing schedules a second best-effort full
  rebuild.
- Reject, admin delete, and owner delete wait for a full rebuild.
- Derived rebuild failures are logged but do not change an otherwise successful
  business mutation response.
- `npm run related:rebuild -- --dry-run|--apply` supports initial population,
  backfill, inspection, and recovery.

## Read Path

`PET_RELATED_HYBRID_ENABLED` controls snapshot reads:

- unset or `true`: enabled;
- `false`: disabled;
- any other value: fail safely to heuristic and emit structured diagnostics.

The reader serves a snapshot only when state is `ready`, the active generation
and ranking revision match, and the source row is valid. It rehydrates slugs
from the current approved-pet set, removes missing/unapproved/self/duplicate
entries, and fills to four with metadata candidates. Building, failed, missing,
incompatible, malformed, or unreadable state falls back to the existing
heuristic.

HTML and markdown consumers call the same resolver and therefore preserve the
same order. An already open page changes on its next request; no client push or
request-time vector computation is introduced.

## Observability and Rollout

Rebuild and snapshot-read durations, generation IDs, status, and bounded failure
classes are logged without vector contents or credentials.

Rollout order:

1. Apply additive migrations.
2. Deploy with `PET_RELATED_HYBRID_ENABLED=false`.
3. Calibrate and commit the revision-bound profile; pass holdout.
4. Run `related:rebuild -- --dry-run`, inspect coverage, then `--apply`.
5. Enable snapshots only after state is `ready`.

Rollback is immediate through the kill switch. Operational recovery may
republish the retained previous generation. No latency claim or hard
performance gate is made without comparable measurement.

## Verification

- Unit tests cover RRF, deterministic ties, modality absence, stale/corrupt
  vectors, self-exclusion, uniqueness, and four-card filling.
- Repository tests cover lifecycle, conditional activation, superseded
  rebuilds, failure state, retention, and idempotent migrations.
- Route tests prove business mutations stay successful when derived rebuilds
  fail.
- Page and markdown tests cover ready/building/failed/disabled behavior,
  approved-only hydration, fill, and identical ordering.
- Focused Vitest suites, full `npm test`, typecheck, lint, and build pass.
- Migrations and rebuild dry-run/apply/recovery are exercised against a
  disposable local YDB.
