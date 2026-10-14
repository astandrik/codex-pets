# OpenAI approval worker

The web application enqueues an administrator's approval. A single private worker
prepares metadata, six OpenAI embedding channels and a complete recommendation
snapshot before atomically publishing the pet and the snapshot.

Build `Dockerfile.approval` with `BASE_IMAGE` set to the verified application image's
immutable local image ID and `VCS_REF` set to the source commit. It inherits the
application's pinned Node dependencies and `flock`; its web bundle is not served.
Do not add public ports.

Required configuration:

- Existing `YDB_PETS_*` / `YDB_STATIC_CREDENTIALS_*` and read-only password file.
- `PET_EMBEDDING_PROFILE=openai-large-v1`, existing `PET_SEARCH_*` configuration,
  `PET_EMBEDDING_SERVICE_URL=http://pets-embeddings:8090/embeddings` and read-only
  `PET_EMBEDDING_SERVICE_TOKEN_FILE`.
- `YANDEX_AI_STUDIO_FOLDER_ID` preserves identities of historical metadata.
  No Yandex API key is required or read in this profile; no Qwen fallback exists.
- `OPENAI_API_KEY_FILE` is the existing private key; `HTTPS_PROXY` must be the
  existing AMS proxy `http://172.17.0.1:18089`. Direct egress fallback is forbidden.
- `PET_APPROVAL_METADATA_DIR` is a protected durable writable directory shared
  by all instances. The entrypoint holds its OS `flock` throughout its lifetime.
- Mount the existing `PET_MODERATION_PAUSE_FILE` read-only. A paused/invalid gate
  stops intake and stops new paid metadata stages.

Run with `--restart unless-stopped`, resource limits, read-only root filesystem,
temporary `/tmp`, no published ports, and existing bridge/YDB networks. Only this
worker receives the OpenAI key. `--once` is intended for controlled checks; it may
process a real queued approval, so do not use it as a production health probe.

Each pet receives at most two metadata calls to `gpt-6.1-sol`, low reasoning,
default service tier, no response storage. The per-pet ledger reserves at most
$0.50 using conservative rates. This budget covers metadata only; embeddings use
the existing embedding service. Admin approval is the chargeable-operation gate.
No image generation is performed here.

Intent is fsynced before a call, its response is saved before database writes, and
lost write acknowledgements are reconciled by readback. Completed stages are
reused. Unknown outcomes, changed inputs or conflicting receipts require manual
review; never delete the ledger, reset attempts or create a fresh approval to
retry an unknown paid call. State contains private responses: do not print it or
include it in support logs. Retain it with the existing recovery data until an
explicit retention decision.

Rollback: stop the worker and retain its image, ledger and database records. The
existing website can read both historical Yandex and new OpenAI metadata. Do not
roll back published catalog data or the active snapshot. Restart only after
checking queue identity, receipts and expected model/profile.
