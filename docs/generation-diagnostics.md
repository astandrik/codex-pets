# Diagnosing saved generation images

Run from the repository root in an environment with the pinned Python dependencies
from `scripts/pet-spritegen/requirements.txt` and explicit `YDB_PETS_ENDPOINT` and
`YDB_PETS_DATABASE`. `PET_GENERATION_PYTHON` may select that Python interpreter.

```sh
node scripts/diagnose-generation.mjs --job-id FIRST_ID --job-id SECOND_ID
```

The default is a dry-run for exactly two distinct IDs. It reads the saved base,
raw rows and optional atlas, verifies hashes and expiry, and runs local composition
without provider credentials or image generation. Output contains bounded issues,
the source revision and whether diagnostics would change; it omits private URLs,
prompts, image bytes and raw subprocess errors.

For `kind: invalid` with `actual` and `expected`, the counts describe the extracted
frame area and the median frame area respectively. Frame indexes are zero-based
in the stored contract and displayed one-based in the interface. A successful
extraction can still be rejected by the application's strict warning check.
Newly composed atlases also pass the application's `validateGeneratedSheet`
checks before the result can be `valid`. A rejected atlas without a trustworthy
state/frame diagnosis returns `unknown` and a safe artifact diagnostic; dry-run
exits nonzero and apply is refused. Neither acceptance thresholds nor stored
images are changed.

Only after separate operator approval, use both revisions from the dry-run in the
same order as the IDs:

```sh
node scripts/diagnose-generation.mjs --job-id FIRST_ID --job-id SECOND_ID \
  --apply --expected-revision FIRST_REVISION --expected-revision SECOND_REVISION
```

Apply verifies both snapshots before updating either job. It refuses expired or
changed jobs, changed artifacts, live leases, preparing continuation receipts and
accepted continuations that still have an active child. Unknown diagnostics are
not applied. Valid images do not clear an earlier diagnosis automatically.

Only `assemblyIssues` and `failureDiagnostic` may change. TTL, image bytes, receipts,
UUIDs, quota and scheduler records are untouched. Identical diagnostics with current
revisions are a no-op. A successful update changes `sourceRevision`; rerun dry-run
before another apply. Existing accepted receipts remain usable with their original
UUID. An unsent request based on an older revision must refresh its options.

This command does not fix images, deploy software, run migrations or submit a new
generation. It is not exposed through HTTP or WebMCP.
