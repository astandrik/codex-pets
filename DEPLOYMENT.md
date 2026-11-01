# Deployment Plan

Generic deployment notes for `codex-pets`.

Sensitive host-specific details, private paths, secrets, and one-off operational
commands should live outside git, for example under a gitignored `private/`
directory.

## Current production runbook (local)

Start with `private/codex-pets-production-runbook.md` for the current production
SSH route, service inventory, immutable image rollout, verification, and rollback.
The runbook and its pinned SSH host keys are intentionally gitignored. The old
`private/111.88.152.4-codex-pets-runbook.md` and its deployment script describe
a historical host and must not be used for the current production deployment.

## Topology

The current application is designed to run with:

- `Next.js` as a long-running server process or container
- `YDB` for:
  - user accounts and sessions
  - pet metadata
  - pet binary assets
- a reverse proxy in front of the app
- optional subpath deployment via `NEXT_PUBLIC_BASE_PATH`

Two production patterns are supported:

- direct app host: nginx and the `codex-pets` container run on the same machine
- split edge/app host: a public edge host terminates TLS, runs certbot, and
  proxies to a private app host over HTTPS while preserving `Host`

## Runtime env

Use a runtime env file based on:

- [deploy/app-session.env.runtime.example](./deploy/app-session.env.runtime.example)

Minimum example:

```env
NODE_ENV=production
PORT=3000

NEXT_PUBLIC_APP_URL=https://example.com/codex-pets
NEXT_PUBLIC_BASE_PATH=/codex-pets

# Optional aggregate MCP tool-call metrics through Yandex Metrika Measurement
# Protocol. Use a dedicated technical Metrika ClientID, not a user identifier.
YANDEX_METRIKA_MP_TOKEN=
YANDEX_METRIKA_MP_CLIENT_ID=

# Optional IndexNow notifications for deploys and approved pets.
INDEXNOW_KEY=
INDEXNOW_ENDPOINT=

PET_SEARCH_MODE=lexical
PET_SEARCH_MODEL_REVISION=yandex-text-embeddings-v2-768-2026-07
PET_SEARCH_EMBEDDING_TIMEOUT_MS=800
PET_SEARCH_VISUAL_MODE=off
PET_SEARCH_VISUAL_MODEL_REVISION=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1
PET_SEARCH_VISION_TIMEOUT_MS=180000
YANDEX_AI_STUDIO_FOLDER_ID=
YANDEX_AI_STUDIO_API_KEY_FILE=/run/secrets/yandex-ai-studio.key
PET_RELATED_HYBRID_ENABLED=false
PET_RELATED_PREAPPROVAL_ENABLED=false

AUTH_MODE=app-session
SESSION_COOKIE_SECRET=replace-with-random-secret
PASSWORD_PEPPER=replace-with-another-random-secret
INITIAL_ADMIN_EMAILS=admin@example.com

YDB_PETS_ENDPOINT=grpc://ydb-host:2137
YDB_PETS_DATABASE=/local/your-tenant
YDB_STATIC_CREDENTIALS_USER=appuser
YDB_STATIC_CREDENTIALS_PASSWORD_FILE=/run/secrets/app.password
YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT=grpc://ydb-host:2136
```

## Schema apply

### Public author email rollout

Before deploying the attribution app or approval worker, apply and read back
`20260826_001_add_pet_public_author_email` and
`20260827_001_add_approval_email_confirmation`. Existing tables receive optional
columns; old pets default to no requested/public email and old approval jobs
default to no moderator confirmation. Check the migration ledger before using
the migration runner so unrelated pending migrations are not applied by accident.

Deploy the app and approval worker from the same revision. The worker publishes
the requested address only with the job's stored moderator confirmation, while
the pending pet revision and consent still match, in the approval transaction.
A retry with a different confirmation returns a conflict for an already queued
job; manual-review requeue can record a new explicit decision.

Production migration, deploy, and the bounded `kesha`/`microwave-cat` alias
backfill require separate approval. Do not publish historical contact emails.
Rolling back the app/worker does not require removing the additive columns;
the older worker will not publish emails from newly confirmed jobs.

### General schema setup

Apply the current schema from:

- [ydb/schema.yql](./ydb/schema.yql)

For an existing database, apply migrations after deploying schema changes:

```bash
npm run db:migrate
```

The schema currently includes:

- `codex_pets`
- `codex_pet_assets`
- `codex_pet_search_embeddings`
- `codex_pet_search_captions`
- `codex_pet_related_state`
- `codex_pet_related_snapshots`
- `codex_users`
- `codex_sessions`
- `codex_email_verification_tokens`
- `codex_password_reset_tokens`
- `codex_pet_reviews`
- `codex_pet_metrics`
- `codex_pet_generation_requests`
- `codex_pet_generation_request_images`
- `codex_schema_migrations`

`codex_pet_upload_sessions` is legacy and may remain present if it already
exists.

For hybrid search, deploy with `PET_SEARCH_MODE=lexical` and
`PET_SEARCH_VISUAL_MODE=off`, apply both additive migrations, and run:

```bash
npm run search:backfill -- --dry-run
npm run search:backfill -- --apply
npm run search:backfill-vision -- --dry-run
npm run search:backfill-vision -- --apply --slug PET_SLUG
npm run search:backfill-vision -- --apply
```

The approval refresh and maintenance CLI use the same AI Studio Responses API
request: the four V1 frames, strict JSON Schema output, Qwen auto-reasoning,
and `store: false`. The first request allows 8,000 output tokens; an explicit
`max_output_tokens` incomplete response is retried once with 16,000. Network,
timeout, 429, 5xx, and malformed structured-output failures use at most three
attempts. Safe diagnostics contain only request/trace identifiers, status,
stage, attempt, and token counts; prompts, images, responses, embeddings, and
credentials are never logged.

Visual requests default to a 180-second timeout and accept an explicit value
up to 300 seconds. This transport and token-policy change does not alter the V1
prompt, schema, frame policy, revision identifiers, or source hashes, so
already-current V1 captions and vectors do not require a full backfill.

The v2 text and Qwen visual revisions both use managed Yandex Text Embeddings
v2 at 768 dimensions. Keep the legacy 256-dimensional rows for rollback; the
backfills add revision-scoped rows and do not overwrite them.

Whenever an applied text or visual maintenance backfill reports changed
vectors, it also prints the required related-pet snapshot follow-up. After all
embedding updates finish, run the printed dry-run and apply commands and
confirm the apply result is `ready`; otherwise hybrid related cards keep the
previous snapshot ordering.

The visual dry-run reads and hashes spritesheets but does not call providers or
write YDB. After the full paced backfill, enable visual `shadow`, inspect only
aggregate latency/fallback metrics, and run:

```bash
npm run search:eval:calibrate
```

Pin the selected threshold and weight to the exact visual revision in code,
repeat the full verification chain and candidate build, then run the untouched
holdout exactly once:

```bash
npm run search:eval:holdout
```

Do not tune on holdout results. Stop if any gate fails, and require explicit
human review of the printed combined `sexy` top five before enabling both base
and visual `hybrid`. The first rollback is `PET_SEARCH_VISUAL_MODE=off`; switch
`PET_SEARCH_MODE=lexical` only if the text contour must also be disabled.
Caption and embedding tables can remain. The AI Studio API key must be mounted
as a read-only file and referenced by `YANDEX_AI_STUDIO_API_KEY_FILE`; do not
place it directly in the environment file. Captions, images, prompts, and
embeddings must not be copied into deployment logs.

For hybrid related pets, keep `PET_RELATED_HYBRID_ENABLED=false` while applying
additive migrations or preparing a replacement generation. V24 uses persisted
description, controlled-annotation, and visual inputs. Backfill every role
sequentially so the jobs share the AI Studio rate budget:

```bash
npm run related:backfill-description-query -- --dry-run
npm run related:backfill-description-query -- --apply
npm run related:backfill-description-document -- --dry-run
npm run related:backfill-description-document -- --apply
npm run related:backfill-annotations -- --dry-run
npm run related:backfill-annotations -- --apply
npm run related:backfill-annotation-query -- --dry-run
npm run related:backfill-annotation-query -- --apply
npm run related:backfill-annotation-document -- --dry-run
npm run related:backfill-annotation-document -- --apply
```

Annotation proposals use AI Studio Chat Completions with strict JSON Schema,
explicit `reasoning_effort=none` and a 4,000-token budget, raised once to 8,000
on an output limit. The SDK parses and validates the proposal before persistence.
Visual captions retain their independent Responses API contract described above.
Provider/API policy changes invalidate proposal-input hashes; old revision rows
remain available and are never silently reclassified as current.

World-knowledge-only themes and media origins are omitted from effective
annotations and their embedding documents. Card-supported weak values and
verified field overrides remain usable; unresolved high-confidence strong
relations still block preparation until reviewed.

Description query and document inputs contain normalized name, kind, and
description; tags are excluded. Controlled annotations provide canonical
entity, franchise, family, collection, and archetype facets. The relation policy
adds verified parent families and known numbered-series roots at ranking time,
preserving original identifiers and explicit family-field overrides. Registry
changes require a new relation-policy revision and generation; unchanged
annotation documents/vectors do not need backfill. Visual similarity
contributes to ordering inside the qualified tier and also orders shared-topic
sparse-fallback candidates after topic count and kind. Visual evidence alone
cannot qualify or rescue a match. Only after every backfill reports complete
current coverage, build the replacement snapshots:

```bash
npm run related:rebuild -- --dry-run
npm run related:rebuild -- --apply
```

Inspect the structured output before enabling the feature. The apply result must
have `status: "ready"`, and `coverage.snapshotCount` must equal
`coverage.approvedPetCount`; `coverage.textVectorCount` counts only pets with
both current query and document vectors and must also equal the approved count.
Annotation, annotation-vector, and visual counts must match it too. The rebuild
validates all required coverage and computes every ranking before it requests a
new generation. Any incomplete-input failure therefore leaves the last ready
generation unchanged and does not create or clean up a failed generation.
Then set `PET_RELATED_HYBRID_ENABLED=true` and restart the app. Unset and exact
`true` enable snapshot reads; exact `false` is the rollout and rollback kill
switch. Invalid values fail safely to the heuristic resolver.

After apply, run the read-only parity check:

```bash
npm run related:verify:v24
```

It fails unless the active generation uses a supported V24 ranking revision,
every snapshot has the same revision as that active generation, all required
inputs cover the approved catalog, and every snapshot has
eight unique approved non-self slugs where possible, and every ordered snapshot
matches a fresh V24 recomputation. The command does not call AI Studio or write
YDB.

Create exact-match JavaScript goals named `related_pet_impression` and
`related_pet_click` in Yandex Metrika counter `104844437` only as a separately
approved external step. Existing `pet_install_command_copy` and
`pet_download_click` goals receive the related attribution fields and do not
need replacement goals. Compare positions 1-4 with 5-8 after 7 and 14 days,
separating direct card conversions from conversions after detail navigation.

Start `npm run related:approval-worker` as a separate process before setting
`PET_RELATED_PREAPPROVAL_ENABLED=true`. Until the flag is exact `true`, admin
approval returns `503 approval_preparation_required` and leaves the pet pending.
With the flag enabled, approval queues a preparation instead of publishing
immediately. The worker refreshes the ordinary search document, description
query/document vectors, controlled annotation and both annotation-vector roles,
and visual input. It builds an inactive generation, then atomically publishes
the pet, review, and generation only if the card, catalog, source hashes, and
active generation are unchanged. The new generation also rotates the
related-candidate and sitemap cache keys across app and worker processes.
Failures leave the pet pending and preserve
the current generation. Keep the worker disabled during a V24 rollback.

Deploy the app and approval worker from the same release. Wait for queued,
preparing, and retrying approval jobs to finish before replacing the worker.
New annotation requests use proposal R3; existing valid R2 annotations keep
their original provenance, hashes, and vectors. This upgrade requires no table
migration or bulk annotation/vector backfill. Readers accept the legacy ranking
revision and its `:annotation-proposal-compat=r2+r3-v1` successor; new generations
use the successor, and a snapshot must match its active state's revision.

Prepare and test a compatible rollback image before enabling the R3 writer.
That image must retain the R2/R3 readers and both ranking revisions, with
`RELATED_PETS_ANNOTATION_WRITE_PROPOSAL_REVISION` selecting R2. Once any R3
annotation has been written, do not restart an older R2-only app or worker:
roll back both services to the compatible image instead. Run
`npm run related:verify:v24` before and after the change. An image rollback does
not undo a pet's approval or restore an earlier ranking generation.

To roll back ordering without discarding derived rows, first disable the
feature and read the exact `active_generation_id` and
`previous_generation_id` pair from `codex_pet_related_state`. Pass both
values explicitly:

```bash
npm run related:rebuild -- --recover-previous PREVIOUS_GENERATION_ID --expected-active ACTIVE_GENERATION_ID
```

The recovery command exits nonzero when no compatible previous generation is
available, the requested generation is not the retained one, or the expected
active generation does not match. Retrying with the same generation pair is
idempotent. Keep the feature disabled until the
recovered state is confirmed `ready`; re-enable it only after that check.
Compatibility requires an exact ranking-profile revision match, so deploy the
application version for the retained revision before recovery when rolling
back across profile revisions.
The additive related query-vector rows may remain after rollback.

## Build and run

Build:

```bash
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://example.com/codex-pets \
  --build-arg NEXT_PUBLIC_BASE_PATH=/codex-pets \
  -t codex-pets:latest .
```

Run:

```bash
docker run -d --name codex-pets \
  --restart unless-stopped \
  --network ydb-net \
  -p 127.0.0.1:3001:3000 \
  --env-file /path/to/.env.runtime \
  -v /path/to/app.password:/run/secrets/app.password:ro \
  -v /path/to/yandex-ai-studio.key:/run/secrets/yandex-ai-studio.key:ro \
  codex-pets:latest
```

If `YDB_PETS_ENDPOINT` or `YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT` points to a
Docker hostname such as `ydb-local`, the app container must join the same Docker
network as the YDB containers so that name resolution works.

When `INDEXNOW_KEY` is configured, the app serves the verification file at
`/<INDEXNOW_KEY>.txt`, notifies IndexNow after admin approval publishes a pet,
and the deploy helper sends a best-effort notification for static public routes
after smoke checks.

When using a split edge/app host pattern, the app host can stay private. Only
the edge host needs public DNS, TLS certificates, and `/.well-known/acme-challenge/`
handling.

## Reverse proxy

For a dedicated subdomain on the same host as the app container, use:

- [deploy/nginx-pets-subdomain.conf.example](./deploy/nginx-pets-subdomain.conf.example)

For a public edge proxy host that forwards to a separate private app host, use:

- [deploy/nginx-pets-edge-proxy.conf.example](./deploy/nginx-pets-edge-proxy.conf.example)

If you deploy under a subpath, proxy both the exact path and the prefix:

```nginx
map $http_user_agent $codex_preview_bot_ua {
    default 0;
    ~*(TelegramBot|WebpageBot|Twitterbot|Slackbot|LinkedInBot|facebookexternalhit|Discordbot|WhatsApp|SkypeUriPreview) 1;
}

map $http_user_agent $codex_preview_browserish_ua {
    default 0;
    ~*(Firefox/(75|77)\.0|Chrome/(72|96)\.0\.) 1;
}

map $remote_addr $codex_preview_ip {
    default 0;
    ~^149\.154\.161\. 1;
    ~^95\.161\.76\. 1;
    ~^93\.158\.188\. 1;
}

map "$codex_preview_bot_ua:$codex_preview_browserish_ua:$codex_preview_ip" $codex_preview_request {
    default 0;
    ~^1: 1;
    0:1:1 1;
}

location = /opengraph-image {
    proxy_pass http://127.0.0.1:3001/codex-pets/api/og/site;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /codex-pets;
}

location = /codex-pets {
    if ($codex_preview_request) {
        rewrite ^ /codex-pets/api/preview/site break;
    }

    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /codex-pets;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location ~ ^/codex-pets/pets/([^/]+)$ {
    set $codex_pet_slug $1;

    if ($codex_preview_request) {
        rewrite ^ /codex-pets/api/preview/pets/$codex_pet_slug break;
    }

    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /codex-pets;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location /codex-pets/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /codex-pets;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

The root-level `/opengraph-image` alias is required for subpath deployments.
Next.js bot-oriented metadata responses can emit `https://host/opengraph-image`
for preview crawlers even when the app itself lives under `/codex-pets`.
Without that alias, Telegram link previews for the gallery root can stay stuck
on `Loading...` while normal browser requests still look correct.

For Telegram/Webpage-style preview fetches, route `/codex-pets` and
`/codex-pets/pets/<slug>` to dedicated lightweight HTML preview endpoints
before proxying to the main App Router page. This avoids relying on Telegram to
parse a full Next.js document under the `/codex-pets` base path.

Preview HTML should echo the exact requested public URL, including any query
string cache-busters, in both `canonical` and `og:url`. This makes repeated
Telegram/WebpageBot retries easier to reason about in logs.

Do not use browser-level basic auth as the main user login UX. The app already
implements its own `app-session` account flow.

## Operational behavior

Current app behavior:

- public gallery and pet detail pages
- anonymous submit with optional contact email
- anonymous pet generation requests with required contact email and optional
  reference image
- local account login/register/logout
- logged-in user generation request history
- admin moderation queue
- admin pet generation request queue
- owner delete and admin delete via soft delete (`status = deleted`)
- `robots.txt` served by the app
- dynamic `sitemap.xml`
- dynamic `llms.txt` with `/llm.txt` alias
- dynamic `llms-full.txt`
- OpenAPI JSON at `/openapi.json` and `/api/openapi.json`
- indexed developer resources at `/developers`, `/docs/api`, and selected
  guide pages
- MCP Registry metadata at `/server.json` and `/.well-known/mcp/server.json`
- MCP Registry HTTP domain auth at `/.well-known/mcp-registry-auth`
- approved pets automatically appear in `sitemap.xml` without cron or rebuild
- Yandex Metrika loaded in production
- optional server-side MCP aggregate metrics through Yandex Metrika Measurement
  Protocol when `YANDEX_METRIKA_MP_TOKEN` and `YANDEX_METRIKA_MP_CLIENT_ID` are
  configured

MCP metrics use a dedicated technical Metrika ClientID and a synthetic `/mcp`
pageview before the `mcp_tool_call` goal event. They do not send raw MCP search
text, IP address, user-agent, origin header, contact email, owner email, or owner
identifiers.

## Smoke checks

After deploy, verify:

```bash
curl -I https://example.com/codex-pets/
curl -I https://example.com/codex-pets/api/manifest
curl -I https://example.com/codex-pets/login
curl -I https://example.com/codex-pets/register
curl -I https://example.com/codex-pets/robots.txt
curl -I https://example.com/codex-pets/sitemap.xml
curl -I https://example.com/codex-pets/llms.txt
curl -I https://example.com/codex-pets/llm.txt
curl -I https://example.com/codex-pets/llms-full.txt
curl -I https://example.com/codex-pets/openapi.json
curl -I https://example.com/codex-pets/api/openapi.json
curl -I https://example.com/codex-pets/developers
curl -I https://example.com/codex-pets/docs/api
curl -I https://example.com/codex-pets/guides/best-codex-pets-for-ai-coding-agents
curl -I https://example.com/codex-pets/guides/codex-pets-vs-vscode-pets
curl -I https://example.com/codex-pets/server.json
curl -I https://example.com/codex-pets/.well-known/mcp/server.json
curl -I https://example.com/codex-pets/.well-known/mcp-registry-auth
curl -I https://example.com/opengraph-image
curl -A 'TelegramBot (like TwitterBot)' -sS https://example.com/codex-pets/ | rg 'og:image'
curl -A 'TelegramBot (like TwitterBot)' -sS 'https://example.com/codex-pets/pets/tigran?v=preview-1' | rg 'og:image|og:url|canonical'
curl -I https://example.com/codex-pets/pets/tigran/opengraph-image.png
```

Manual checks:

1. public pages open without browser-level auth prompt
2. login/register/logout work
3. submit works anonymously
4. pet generation requests work anonymously with and without a reference image
5. `My pets` shows only owner-attached pets
6. `My requests` shows only requests created while signed in
7. admin queues are available to admin accounts only
8. approved pets show up in the gallery, sitemap, and llms.txt / llm.txt
9. deleted pets disappear from owner lists, public lists, and detail pages

## Updates

Typical update loop:

```bash
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .playwright-mcp \
  --exclude .env.runtime \
  /local/path/to/codex-pets/ \
  deploy-user@host:/deploy/path/codex-pets/
```

Then rebuild and restart the container on the target host using that host's
private runbook.

For split edge/app host deployments, keep a small edge-host runbook outside git
with:

- DNS ownership
- certbot installation and renewal ownership
- the upstream app host IP/DNS
- nginx reload and rollback commands

## Remote MCP pet generation

The feature is disabled by default. Preserve the previous application image and
runtime configuration. Publish/enable only after the closed candidate report and
an explicit manual enable step.

1. Build the existing `runner` target and the new `generation-worker` target from
   the same Git commit with `VCS_REF` and the production `NEXT_PUBLIC_APP_URL`.
   The worker contains pinned Node24 and Python3.12, sprite-gen2.44.0, Pillow12.3.0
   and NumPy2.5.3, installed with required wheel hashes; see vendor/sprite-gen/NOTICE.md.
   The web image contains no Python runtime or OpenAI credential. No new npm dependency is needed.
2. Explicitly apply only `node scripts/apply-pet-generation-schema.mjs`, with the
   existing YDB connection/credentials. This creates the three feature tables
   with TTL and records the migration. It never runs unrelated migrations.
   Confirm table shape/TTL and effective read/write access before starting work.
3. Create a random secret file (at least 32 characters, mode 0600) for
   `PET_GENERATION_SECRET_FILE`, mounted read-only into the web container. This
   key protects request hashes and daily IP hashes; preserve it across restarts.
   The web container does not receive an OpenAI key.
4. Run one worker on the existing private Docker networks, with the same YDB
   access as Pets and `PET_GENERATION_OPENAI_KEY_FILE` pointing at a protected
   read-only OpenAI key file. Set `PET_GENERATION_PROXY_URL=http://172.17.0.1:18090` to the dedicated
   per-request SSH CONNECT adapter described below. The shared 18089 adapter remains
   available only for legacy configurations and compatible rollback. The Python child receives only this explicit proxy
   and cannot fall back to a direct connection. Verify an unauthenticated OpenAI request
   returns401 from inside the built worker before any paid call. Limit the worker to 2 CPU / 4 GiB and use
   `--tmpfs /tmp:rw,nosuid,nodev,noexec,size=768m,mode=1777`.
   The workspace sweep removes dead-process leftovers and all expired scratch files,
   including while intake is disabled.
   `node scripts/pet-generation-worker.mjs --once` processes at most one task.
5. Set `PET_GENERATION_BUDGET_USD=6` only for the bounded three-task candidate;
   production defaults to50USD/day. For a closed candidate, bind its HTTP port to loopback and use a separate
   loopback nginx listener that overwrites `X-Pets-Client-IP` with `$remote_addr`.
   Enable `PET_GENERATION_ENABLED=true` only in the candidate and its worker.
   Exercise three synthetic prompts, using one test IP and fresh UUID request
   IDs. All three accepted tasks consume the real day quota. Do not reset quota
   rows or retry a paid request after an uncertain outcome.
6. Inspect actual stored provider usage and cost, all nine animations and all
   sixteen gaze frames in the browser. Validate ZIP contents, expiry, private
   headers, no analytics, and the seven existing read tools. Stop public launch
   if quality, recovery or privacy checks fail.
7. For the manual public enable, add only the origin nginx settings documented in
   `deploy/pet-generation-nginx.conf.example`; syntax-check, reload and wait for
   readback. Preserve `127.0.0.1:3001` and verify spoofed forwarded headers cannot
   change the quota IP. Switch to the verified web image/config and start one
   verified worker. Set `PET_GENERATION_ENABLED=true` explicitly in both.
8. Verify nine remote MCP tools, preview and downloads via origin, AMS and SGP.
   The npm CLI and browser WebMCP retain their existing catalog-only tools.

To disable intake and the next paid stage, use a shared read-only
`PET_GENERATION_ENABLE_FILE` with value false in both containers, then drain the worker with SIGTERM
(allow at least 240 seconds for the current request). Existing status/files stay
readable in the new web image until expiry. A disabled worker can remain running
for cleanup; it takes no new jobs. Never clear deduplication or quota records to
recover a failed job. An abandoned provider call becomes `outcome_unknown` after
its lease; processing a persisted image can resume without another provider call.

Jobs and image artifacts expire 24 hours after acceptance. HTTP checks enforce
expiry immediately, even before asynchronous YDB TTL cleanup; the worker also
cleans expired rows at most once per minute. Deduplication hashes remain seven
days. The global scheduler row holds only a bounded queue and one lease, without
prompts or credentials. Do not send task IDs, private URLs or prompt text to
analytics or ordinary diagnostic output.

### Row-stage recovery and rollback

The three existing tables retain their shapes. Pipeline version2 stores12ordered
stages in job JSON and `stage-<name>.png` artifacts; legacy records default to version1.
An owner-fenced intent is committed before each paid call. The worker renews the
lease every30seconds and confirms image+SHA/usage in one transaction afterward.
A lost acknowledgement is reconciled by readback; completed stages are never paid again.
An abandoned call, uncertain checkpoint/retry acknowledgement or lost lease fails
with outcome_unknown and sets scheduler.pauseReason.
Captured RemoteDisconnected, IncompleteRead, HTTP500 and HTTP520 image failures allow one
durable retry of that stage after five seconds. Successful stages are never replayed.
Once all unresolved stages have matching persisted provider-failure records and the
failed job, budget and scheduler commit atomically, that terminal job does not pause
unrelated jobs. Unknown-charge markers remain, and the failed job is never requeued.
Unclassified failures and mixed provider/storage failures still pause the scheduler.
This does not fix upstream failures: subsequent jobs may fail and incur unknown costs.
Deploying this policy and clearing an existing pause require explicit operator approval.
The permanent budget ledger retains unresolved reservations independent of artifact TTL.
Do not clear scheduler pauses or reservations until the exact request outcome has been reviewed.

Rollback first disables intake/new paid stages while retaining read routes and TTL cleanup.
Before a public release, retain the exact closed candidate image as a compatibility reader:
run it with generation disabled on an unused loopback port and route only `/generated/`
and `/api/pet-generations/` GET/HEAD through it when reverting the main gallery image.
Block POST in this rollback location. Reuse the same YDB and HMAC configuration; do not reset
quotas or copy result data. Test a completed ZIP and status through this configuration first.
No public enable or new recurring monitor is implied by building/testing the candidate.

Disable access logs for generation routes or mask capability IDs on every serving proxy.
The prompt form and preview use noindex/no-referrer/no-store; never log provider stderr,
prompt bodies, image bytes, private links, credentials, or raw environment output.

### Dedicated image SSH transport

`deploy/pets_image_ssh_proxy.py` is a host-side CONNECT proxy for the generation
worker. It accepts only `api.openai.com:443` and starts one `ssh -W` process per
TCP connection; it never reconnects or replays application bytes. TLS still ends
at OpenAI. Keep the existing SSH private key and pinned known-hosts file on the
host; do not mount the SSH key into the worker.

Install the versioned script under `/opt/codex-pets/ssh-proxy/`, with the selected
version exposed by `current`. The root-managed `/etc/codex-pets/ssh-proxy.json`
contains `ssh_command` (an argv array, not a shell command). Preserve the existing
restricted AMS account, identity path and pinned host-key options, replace the
old `-L` forwarding with `-W api.openai.com:443`, and explicitly set
`BatchMode=yes`, `StrictHostKeyChecking=yes`, `ControlMaster=no`, and
`ControlPath=none`. The configuration contains paths only, never a key value.
Allow the `nobody` service to read this configuration and the existing identity.

Defaults are `listen_host=172.17.0.1`, `listen_port=18090`, 16 connections,
4 simultaneous SSH/TLS handshakes, a 15-second handshake limit and a 240-second
connection lifetime. The application provider timeout is unchanged. The unit
in `deploy/pets-image-ssh-proxy.service` preserves the existing service isolation.
Permit the new port only from the private Docker bridge. Leave the shared
18089 proxy and its persistent tunnel unchanged for other applications.

Set only the generation worker's `PET_GENERATION_PROXY_URL` to
`http://172.17.0.1:18090`. Both the image renderer and card metadata transport
accept this dedicated endpoint; the legacy 18089 endpoint remains supported for
rollback. No provider retries are added by this transport.

Before rollout, run `python3 -m unittest discover -s deploy -p 'test_*.py'`, the
normal application checks, and native tests of the proxy under the same service
user. Confirm eleven concurrent cold connections, fresh SSH PIDs, fixed-destination
rejection, bounded handshakes and process cleanup, using requests without an API
key. Verify the built worker and proxy together before a paid generation.

Retain the previous worker/container configuration and shared proxy for rollback.
Drain the worker before replacing it. After acceptance, resume the scheduler only
under the rollout's explicit authorization, preserving quotas, budget history and
old failed jobs. A failed paid generation is not automatically submitted again.

### Private HTTP diagnostics for generated images

The generation worker emits one JSON record with operation `pet-generation-http`
per renderer attempt. It includes a SHA256 task identifier, stage, attempt and
observation time; HTTP status, expected and received body bytes, byte-count
exactness, completion, chunked framing and phase; and validated `X-Request-ID`
and `CF-Ray` values. These records stay in server logs, outside public task/MCP
responses and job data. Existing Docker log rotation remains in effect.

`expectedBodyBytes: null` means no usable Content-Length (including chunked
responses). `receivedBodyBytesExact: false` means the count is only a lower bound,
for example after an I/O failure or an interrupted chunked read. `before_headers`
means complete response headers were not observed; it does not prove the provider
received a request. A full 520 body is distinct from an incomplete 200 or 520 body.

Capture is scoped to each pinned CLI subprocess and restores the HTTP methods.
Private, atomic metadata checkpoints retain headers if the CLI exits during a
read. Diagnostics never copy response bodies, prompts, credentials, arbitrary
headers, URLs or raw exception messages. Invalid trace identifiers are omitted
as null, and diagnostic write/log failures do not trigger another provider call.
The request, timeout, retry, budget and lease policies are unchanged.

### Optional website base-review flow

`PET_GENERATION_REVIEW_FLOW_ENABLED` defaults to false. See
[the review and reference contract](docs/pet-generation-parallel-rows.md#website-character-review-and-image-references).
Deploy web and worker readers that preserve the new job fields before enabling
new admission. Drain every old worker; never force-kill a paid in-flight stage.
Verify upload body limits permit the 6 MiB application boundary. Check a bounded,
separately authorized pilot: base waits without holding the scheduler, confirmation
queues exactly once, and base/attempt counters are not repeated. Keep the flag off
until these gates pass. Do not claim image likeness from mock-provider tests.

Rollback disables new review admission but keeps compatible web/worker versions
serving existing private review links. Do not restore an older parser/worker while
review jobs remain. Deployment, flag activation and paid pilots require their own
explicit authorization; local implementation or test completion does not enable it.

### Animation revision rollout and rollback

`PET_GENERATION_ANIMATION_REVISIONS_ENABLED` is a server flag, off by default. Update both web and generation-worker with support for pipeline3 jobs, saved anatomy policy and acceptance before enabling it. Drain or stop all older workers first; they must not claim revision jobs. Existing jobs retain their saved policy. Verify the same compatible source revision on both services and preserve current budget/unknown-cost records.

Rollback the feature by disabling this flag while retaining compatible web/worker readers and writers. Already admitted revisions must still run, recover, compare and be accepted. Do not return to versions that discard revision fields or ignore the stage subset. No YQL migration, gallery rewrite, automatic deployment or paid pilot is included in local implementation. Paid quality examples require separately agreed references and budget.

### Generation continuation compatibility

`PET_GENERATION_CONTINUATION_ENABLED` defaults to false. Before enabling new continuations, update both web and generation-worker to versions supporting pipeline 4, persisted continuation plans, staged snapshot receipts and extraction diagnostics. Drain or stop all older workers before activation. Accepted operations continue with their saved plans when the flag is disabled.

Rollback is to disable new continuation admission while retaining compatible web and worker versions. Do not restore versions that ignore continuation plans or discard new job fields after any operation is accepted. Preserve budget and unknown-cost records. No schema migration is needed.

## Automatic animation repair rollout

`PET_GENERATION_ANIMATION_AUTO_REPAIR_ENABLED` defaults to false. Deploy compatible web and generation-worker readers/writers with the flag off before enabling it for new admissions. It permits at most four provider calls per animation row (including transport retries), under the existing shared recorded-spend limit; quota and expiry do not reset. Old failed jobs are not activated retroactively, and free rebuilds do not request images.

Keep compatible maintenance commands (including diagnose-generation) after activation: older job parsers can discard the new journal when rewriting payloads. To disable, turn this flag off and retain the compatible images. Already started calls must settle; do not roll back to old readers/writers while policy-bearing jobs remain. Paid acceptance requires separate approval.

Output-moderation support adds the optional safe `providerFailure` diagnostic to attempt failures and the `moderation` attempt reason. Deploy readers/writers together before allowing this reason: older strict schemas cannot parse it. Only explicit HTTP400 `moderation_blocked` output refusals qualify; input/unknown refusals and old failures without provenance do not. Requests and provider safety settings are unchanged, and all retry reasons share the four-call limit and current budget. Do not resume terminal jobs automatically. After moderation attempts exist, a rollback must keep compatible readers; a refused output with no usage is retained as unknown spending rather than assumed free.
