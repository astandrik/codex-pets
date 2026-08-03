# Hybrid Related Pets via YDB Snapshots — Implementation Plan

Design: `docs/superpowers/specs/2026-08-03-related-pets-snapshots-design.md`

## Global Constraints

- Work only in `/Users/astandrik/workspace/codex-pets/.worktrees/related-pets-snapshots`
  on `codex/related-pets-snapshots`; preserve the primary checkout and unrelated
  untracked files.
- Follow root `AGENTS.md` and `src/AGENTS.md`.
- Use strict TDD for production behavior: write a focused test, run it and
  observe the expected failure, add the minimum implementation, then rerun.
- Do not add dependencies, change public routes/DTOs, or call embedding
  providers during related snapshot reads or rebuilds.
- Keep schema creation manual: additive idempotent migrations plus matching
  `ydb/schema.yql`; no runtime auto-bootstrap.
- Business mutations stay successful when derived rebuilds fail.
- Snapshot reads serve only a matching `ready` active generation and otherwise
  use the existing deterministic metadata heuristic.
- RRF weights are text `1`, metadata `0.15`, and calibrated visual
  `0.25|0.5|0.75`; snapshots contain at most four unique non-self slugs.
- Rebuild publication is token-conditional; superseded work cannot activate.
- Each task must include focused verification and a self-review before commit.

### Task 1: Add related snapshot schema and idempotent migration

Files:

- Add `ydb/migrations/20260803_001_add_pet_related_snapshots.mjs`
- Add `ydb/migrations/20260803_001_add_pet_related_snapshots.test.mts`
- Modify `ydb/schema.yql`
- Modify `src/lib/ydb/schema.ts`

Implement one migration that independently checks and creates
`codex_pet_related_state` and `codex_pet_related_snapshots`, so rerunning after
either table already exists is safe. Use the exact columns and primary keys from
the approved design. Test first with fake SDK/session objects: both missing,
both present, and one-table-present cases. Verify with the focused migration
test and typecheck where applicable. Commit the task.

### Task 2: Implement pure hybrid ranking, vector validation, and calibration

Files:

- Add `src/lib/pets/related-pets-ranking.ts`
- Add `src/lib/pets/related-pets-ranking.test.ts`
- Add `src/lib/pets/related-pets-calibration.ts`
- Add `src/lib/pets/related-pets-calibration.test.ts`
- Add a revision-bound related ranking profile module or extend the closest
  existing search config module without changing its public search contract
- Reuse `src/lib/pets/search-eval-fixtures.json`

Build pure functions for decoding YDB FloatVector bytes, rejecting wrong
revision/dimensions/source hash/byte length/non-finite values, cosine similarity,
metadata ranking, weighted RRF, deterministic tie-breaking, uniqueness,
self-exclusion, and fill to four. Keep metadata ordering identical to
`selectRelatedPets`.

Derive related calibration fixtures deterministically by converting each slug
in the frozen positive groups into a source whose relevant peers are the other
slugs: calibration groups `gothic anime` (3), `cute` (3), and `sexy` (4), for
10 cases; holdout group `badass` (4), for 4 cases. Implement nDCG@4, text
threshold selection with higher-threshold tie-break, and visual
threshold/weight selection with lower-weight then higher-threshold tie-break.
Holdout evaluation must report that full hybrid is no worse than metadata and
text-plus-metadata. Test every required edge case before implementation.
Commit the task.

### Task 3: Implement snapshot repository, rebuild lifecycle, and CLI

Files:

- Add `src/lib/pets/related-pets-repository.ts`
- Add `src/lib/pets/related-pets-repository.test.ts`
- Add `src/lib/pets/related-pets-rebuild.ts`
- Add `src/lib/pets/related-pets-rebuild.test.ts`
- Extend `src/lib/pets/search-embeddings-repository.ts` and tests with a
  revision-scoped raw-vector listing operation
- Reuse caption repository/visual contract validation as needed
- Add `scripts/rebuild-related-pets.mjs`
- Add focused script tests if the CLI parser/orchestration is non-trivial
- Modify `package.json`

Implement typed repository operations for state, generation snapshot writes,
conditional activation, failure marking, active snapshot reads, previous
generation republish/recovery, and cleanup retaining only active/previous.
Keep YQL in the repository. Conditional activate/fail operations must only
change the singleton when `requested_generation_id` equals the caller token.

The full rebuild loads current approved pets and raw stored text/visual vectors,
validates them with Task 2 functions and current source hashes/captions, computes
all source rankings in memory, writes every approved source row under the
inactive generation, conditionally activates, then cleans older generations.
No provider client is imported or called. Expose injected dependencies for
unit testing concurrency, supersession, failure, and logging.

Add `npm run related:rebuild -- --dry-run|--apply`. Dry-run reads and ranks but
does not mutate state/snapshots; apply uses the lifecycle. Recovery supports
republishing the retained previous generation without inventing a new ranking.
Use an unambiguous explicit flag for recovery and document it in `--help`.
Commit the task.

### Task 4: Implement the shared snapshot reader and wire HTML/markdown

Files:

- Modify `src/lib/pets/related-pets-server.ts`
- Add or modify focused server tests
- Modify `src/app/pets/[slug]/page.tsx`
- Modify `src/app/pets/[slug]/page.test.tsx`
- Modify `src/app/pets/[slug]/markdown/route.ts`
- Modify `src/app/pets/[slug]/markdown/route.test.ts`

Add one shared resolver that reads `PET_RELATED_HYBRID_ENABLED`: unset/`true`
enables; `false` disables; invalid values log structured diagnostics and use
heuristic. Serve snapshots only for matching `ready` state/revision. Treat
building/failed/missing/malformed/read errors as heuristic fallback. Rehydrate
snapshot slugs only from approved candidates, remove self/duplicates/missing
entries, and fill to four in heuristic order.

Both HTML and markdown must call this resolver and receive identical order.
Keep current private markdown caching semantics. Add tests for ready,
building, failed, disabled, invalid env, incompatible/malformed/read error,
approved-only hydration, fill, and HTML/markdown ordering. Commit the task.

### Task 5: Trigger best-effort rebuilds from catalog mutations

Files:

- Modify approve, reject, admin-delete, and owner-delete routes under
  `src/app/api/**`
- Modify their focused route tests
- Modify `src/lib/pets/search-vision-runtime.ts` and focused tests only if
  needed to expose a successful-completion hook without changing public
  behavior

Approve must await text indexing and then await a text-first full rebuild.
The existing asynchronous visual indexing remains asynchronous; after a
successful visual refresh it starts a second best-effort rebuild. Reject,
admin delete, and owner delete await a full rebuild. Every rebuild failure is
logged with bounded structured data and does not alter the successful business
response. Preserve cache and sitemap invalidation. Test fail-before/pass-after
for every route and the visual-success trigger. Commit the task.

### Task 6: Calibrate, run integration checks, and document rollout evidence

Files:

- Modify the revision-bound related ranking profile with measured selected
  values if calibration data is available
- Add a concise operator section to the approved design or deployment docs only
  if the implemented flags differ from the design

Run the related calibration against available frozen catalog vectors. Record
calibration and holdout nDCG@4 results; the holdout gate is full hybrid no worse
than both baselines. Run the migration twice, rebuild dry-run/apply, snapshot
read, failure/recovery, and retained-previous rollback against a disposable
local YDB. If representative vectors are unavailable, do not fabricate metrics:
leave hybrid disabled for rollout, report the exact blocker, and still verify
the deterministic calibration code with fixtures.

Run focused Vitest suites, full `npm test`,
`npx tsc --noEmit --incremental false`, `npm run lint`, and `npm run build`.
Review the complete diff for scope and secret leakage. Commit only intended
files.
