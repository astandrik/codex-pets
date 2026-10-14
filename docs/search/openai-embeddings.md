# Pets OpenAI embeddings

The `openai-large-v1` profile uses `text-embedding-3-large` with 3072 dimensions for search, description query/document, annotation query/document and visual-caption vectors. All six revisions are additive. Existing Yandex vectors and the previous recommendation generations are retained. Image generation stays disabled and is unrelated to this rollout.

The web process uses an authenticated, fixed private endpoint `http://pets-embeddings:8090/embeddings`. Only the embedding worker mounts the OpenAI key. Its HTTPS requests require the existing AMS CONNECT proxy `http://172.17.0.1:18089`; there is no direct fallback or configurable remote destination. No host port is published. Run exactly one worker with `flock -n /state/ledger/worker.lock node scripts/pet-embedding-worker.mjs` and a persistent private ledger directory.

Web configuration:

- `PET_EMBEDDING_PROFILE=openai-large-v1` (unset or `yandex-v24` preserves the old provider)
- `PET_EMBEDDING_SERVICE_URL=http://pets-embeddings:8090/embeddings`
- `PET_EMBEDDING_SERVICE_TOKEN_FILE=/run/secrets/embedding.key` (an internal service token, not the OpenAI key)
- `PET_SEARCH_EMBEDDING_TIMEOUT_MS=5000`
- `PET_RELATED_PRESERVE_GENERATIONS=true`
- `PET_MODERATION_PAUSE_FILE=/run/pets-moderation/paused` (`false` enables normal moderation; unreadable/other content pauses it)

The original Yandex caption/annotation credentials remain necessary when approving a new pet. This change does not replace those models. A preparation created with an old ranking profile stops before paid signal generation and requires a new normal Approve request under the current profile.

`node scripts/reindex-pets-openai.mjs --dry-run` validates the explicit `YDB_PETS_ENDPOINT`/`YDB_PETS_DATABASE`, table shape, approved corpus, annotation provenance and actual spritesheet hashes. Set `PET_REINDEX_REPORT_FILE` to a private report path. `--apply` requires that exact dry-run fingerprint, embeds unique inputs in batches of at most32 and writes only the new revisions. The private worker persists an intent before a provider call, then its response before derivative YDB writes. A rerun reads both YDB and saved responses. An unresolved outcome blocks further paid migration calls; never delete a receipt to force a retry.

`PET_EMBEDDING_MIGRATION_BUDGET_USD=1` limits committed migration/evaluation expenses, including unresolved reservations. It is not an account-wide OpenAI spending limit. The online path is separately bounded to two active provider requests and60 requests/minute, with a500-entry ten-minute cache and no automatic retries. Online search text stays in process memory; it is not written into the migration ledger or logs.

Calibration and holdout use the frozen source-reviewed fixture in `openai-pets-eval-20261011.json`. Run `scripts/evaluate-pets-openai.mjs calibration FIXTURE REPORT` first, then `holdout FIXTURE REPORT CALIBRATION_REPORT`. Existing reports are not overwritten. The holdout requires identical corpus and baseline fingerprints. The committed acceptance report records thresholds, usage, measured results and limitations; it is not proof of a subsequent live release.

Cutover stages a complete recommendation generation, briefly pauses the four catalog moderation/deletion routes, drains old app/approval activity, deploys a version that reads both profiles, and changes the active generation and query profile together under CAS guards. Retain the previous image, configuration, vectors and snapshots. Never restore catalog data or generation quotas to roll back search. After a new pet is approved, returning to the old provider requires verified old-model coverage or an explicitly degraded lexical/heuristic fallback; old and new vector spaces cannot be mixed or truncated.
