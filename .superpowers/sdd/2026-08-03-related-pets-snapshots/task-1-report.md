# Task 1 — Related Snapshot Schema and Migration

## Implementation

- Added `ydb/migrations/20260803_001_add_pet_related_snapshots.mjs`.
  - It independently checks `codex_pet_related_state` and
    `codex_pet_related_snapshots` before creating each missing table.
  - The state table uses its singleton `state_id` primary key and nullable
    generation/failure columns. The snapshots table uses the composite
    `(generation_id, source_slug)` primary key and `Json` related-slug payload.
- Added both table names to `src/lib/ydb/schema.ts`.
- Mirrored both exact table contracts in the manual source of truth,
  `ydb/schema.yql`.

## Files

- `ydb/migrations/20260803_001_add_pet_related_snapshots.mjs`
- `ydb/migrations/20260803_001_add_pet_related_snapshots.test.mts`
- `ydb/schema.yql`
- `src/lib/ydb/schema.ts`
- `docs/superpowers/specs/2026-08-03-related-pets-snapshots-design.md`
- `docs/superpowers/plans/2026-08-03-related-pets-snapshots.md`

## TDD evidence

Before writing the migration test, the production break identified was a
partially applied migration: an early return after finding one table would
leave the other table absent. The test matrix therefore covers both missing,
both present, state-only present, and snapshots-only present. A separate
contract assertion catches wrong columns, optionality, types, or primary keys;
the schema assertion catches manual-schema drift.

RED command:

```text
npx vitest run ydb/migrations/20260803_001_add_pet_related_snapshots.test.mts
```

RED result: exit 1, 6 failed. The migration cases failed with `Cannot find
module .../20260803_001_add_pet_related_snapshots.mjs`; the schema case failed
because `CREATE TABLE codex_pet_related_state` was absent.

GREEN command:

```text
npx vitest run ydb/migrations/20260803_001_add_pet_related_snapshots.test.mts
```

GREEN result: exit 0; 1 test file passed, 6 tests passed.

## Verification

```text
npx vitest run ydb/migrations/20260803_001_add_pet_related_snapshots.test.mts
# exit 0 — 1 file, 6 tests passed

npx tsc --noEmit --incremental false
# exit 0

git diff --check
# exit 0
```

## Self-review

- The two existence checks are deliberately independent, so every partial
  table state creates only the absent table.
- Migration and manual schema agree on all column names, YDB types,
  nullability, and primary-key order.
- No runtime schema bootstrap, dependencies, route/DTO changes, or unrelated
  source edits were introduced.
- The migration uses the repository's existing not-found classification and
  `withSession` / `TableDescription` conventions.

## Concerns

None. The focused suite uses fake SDK/session objects as requested; disposable
local-YDB execution is deferred to Task 6's integration verification.
