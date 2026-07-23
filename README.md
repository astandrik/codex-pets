# Codex Pets

[![codex-pets MCP server](https://glama.ai/mcp/servers/astandrik/codex-pets/badges/score.svg)](https://glama.ai/mcp/servers/astandrik/codex-pets)

Community gallery for Codex-compatible animated pets with local accounts,
manual moderation, public generation requests, YDB-backed asset storage, and
public detail pages for approved and pending pets.

Public site: https://pets.ydb-qdrant.tech/.

## Stack

- Next.js 16 App Router, React 19, TypeScript strict
- Gravity UI + SCSS/BEM
- local-ydb / YDB native gRPC via `ydb-sdk`
- App-owned email+password auth with YDB-backed users and sessions
- Pet assets stored in YDB as binary blobs
- Dynamic `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, and
  OpenAPI JSON
- Agent-facing HTTP access through `llms.txt` / `llm.txt`, `/llms-full.txt`,
  `/mcp`, JSON routes, and TOON mirrors for core registry data
- Optional read-only browser WebMCP tools in supported browser runtimes
- Yandex Metrika using the same counter as `ydb-qdrant-ui` (`104844437`),
  with optional server-side aggregate MCP metrics
- JSZip + Sharp for package validation

## Development

```bash
nvm use 24
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Agent access

Codex Pets exposes a public read-only MCP server so coding agents can search,
inspect, install, and share approved pet packs.

Primary public surfaces:

- Best guide: https://pets.ydb-qdrant.tech/guides/best-codex-pets-for-ai-coding-agents
- LLM discovery: https://pets.ydb-qdrant.tech/llms.txt
- MCP endpoint: https://pets.ydb-qdrant.tech/mcp
- Public manifest: https://pets.ydb-qdrant.tech/api/manifest
- CLI install: `npx @astandrik/codex-pets install <slug>`

Connect Codex:

```bash
codex mcp add codexPets --url https://pets.ydb-qdrant.tech/mcp
```

Run a local stdio MCP server that proxies the public gallery:

```bash
npx @astandrik/codex-pets mcp
```

Available MCP tools:

- `search_pets` — discover approved pets when you need candidates or lack an
  exact slug
- `get_pet` — fetch one public pet card when you already have an approved slug
- `get_install_instructions` — get install commands without incrementing metrics
- `get_badge_code` — generate README badge snippets for a known slug
- `get_embed_code` — generate iframe embed snippets for a known slug
- `get_card_code` — generate animated GIF snippets for a known slug, defaulting
  to sprite-only mode
- `get_pet_request_info` — discover the public new-pet request workflow; it does
  not submit or inspect private requests

HTTP fallback routes are public too:

- `/openapi.json`
- `/api/openapi.json`
- `/llms-full.txt`
- `/guides/best-codex-pets-for-ai-coding-agents`
- `/guides/best-codex-pets-for-ai-coding-agents.md`
- `/api/manifest`
- `/api/manifest.toon`
- `/api/pets`
- `/api/pets.toon`
- `/api/pets/<slug>`
- `/api/pets/<slug>.toon`
- `/pets/<slug>/markdown`
- `/api/tags`
- `/api/tags.toon`
- `/api/pets/<slug>/share`
- `/badge/<slug>.svg`
- `/card/<slug>.gif`
- `/embed/<slug>`

If you deploy under a subpath such as `/codex-pets`, set:

```bash
NEXT_PUBLIC_BASE_PATH=/codex-pets
NEXT_PUBLIC_APP_URL=https://example.com/codex-pets
```

The public gallery renders without secrets. For account login, submit, moderation,
and metrics you need `YDB_PETS_ENDPOINT`, `YDB_PETS_DATABASE`, and auth env.
Optional server-side MCP metrics also need `YANDEX_METRIKA_MP_TOKEN` and
`YANDEX_METRIKA_MP_CLIENT_ID`.
Optional IndexNow notifications are enabled by `INDEXNOW_KEY`; the app serves
`/<key>.txt` and pings IndexNow after an admin approves a pet.

Optional semantic search uses Yandex AI Studio text embeddings and exact cosine
ranking in YDB. Query mode defaults to `PET_SEARCH_MODE=lexical`; `shadow`
computes semantic ranking without changing public order, and `hybrid` combines
lexical and text-semantic ranks. An independent
`PET_SEARCH_VISUAL_MODE=off|shadow|hybrid` adds an offline visual-caption rank
from four fixed sprite frames. Captions and their provenance remain internal;
public JSON, TOON, homepage, MCP, and WebMCP shapes do not change. Configure
`YANDEX_AI_STUDIO_FOLDER_ID`,
`YANDEX_AI_STUDIO_API_KEY_FILE`, and
`PET_SEARCH_MODEL_REVISION=yandex-text-search-2026-07`. The current bounded
vision canary pair is
`PET_SEARCH_VISION_CAPTION_REVISION=yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v3`
with
`PET_SEARCH_VISUAL_MODEL_REVISION=yandex-text-search-2026-07-pet-vision-v3`.
It has 256 dimensions and `profile: null`; keep
`PET_SEARCH_VISUAL_MODE=off`. V3 retains the same four frames and adds six
internal structured `{present,en,ru}` slots. Captions and provenance remain
private: public homepage, JSON, TOON, MCP, and WebMCP DTOs do not change. The
v1 pair remains the calibrated matching search rollback. The API key is
accepted only through the secret-file setting. Provider failures and timeouts
fall back to lexical results; visual-only failures preserve the text-hybrid
order.

To run without YDB on generated sample data:

```bash
CODEX_PETS_DATA_SOURCE=mock AUTH_MODE=single-user \
  AUTH_SINGLE_USER_EMAIL=local-admin@example.com \
  NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  npm run dev -- --port 3000
```

## Production notes

For a dedicated public subdomain such as `https://pets.example.com`, prefer:

```bash
NEXT_PUBLIC_APP_URL=https://pets.example.com
NEXT_PUBLIC_BASE_PATH=
```

If the app container talks to YDB by Docker hostname, for example
`grpc://ydb-local:2136`, run the app on the same Docker network as the YDB
containers:

```bash
docker run --network ydb-net ...
```

Telegram and similar preview crawlers are handled by lightweight preview routes:

- `/api/preview/site`
- `/api/preview/pets/[slug]`

The reverse proxy should rewrite preview-bot requests for `/` and `/pets/<slug>`
to those endpoints before proxying to the normal App Router pages. See:

- [deploy/nginx-pets-subdomain.conf.example](./deploy/nginx-pets-subdomain.conf.example)
- [deploy/nginx-pets-edge-proxy.conf.example](./deploy/nginx-pets-edge-proxy.conf.example)

### Local YDB quickstart

For local app development, a plain local-ydb root database at `/local` is enough;
you do not need a CMS tenant or dynamic node. The app runs on the host, so the
local-ydb container must publish gRPC on `127.0.0.1:2136`.

If you use the `local-ydb` MCP, start from a clean root database with
`local_ydb_destroy_stack(confirm=true)` and
`local_ydb_bootstrap_root_database(confirm=true)`. If the resulting container
does not publish `127.0.0.1:2136`, recreate only the container on the same
volume with a host gRPC port:

```bash
docker rm -f ydb-local
docker run -d --name ydb-local --no-healthcheck --network ydb-net \
  --restart unless-stopped \
  -p 127.0.0.1:2136:2136 \
  -p 127.0.0.1:8765:8765 \
  -v ydb-local-data:/ydb_data \
  -e GRPC_PORT=2136 \
  -e MON_PORT=8765 \
  -e GRPC_TLS_PORT= \
  -e YDB_GRPC_ENABLE_TLS=0 \
  -e YDB_ANONYMOUS_CREDENTIALS=1 \
  -e YDB_LOCAL_SURVIVE_RESTART=1 \
  ghcr.io/ydb-platform/local-ydb:26.1.1.6
```

Use these local app env vars:

```bash
AUTH_MODE=single-user
AUTH_SINGLE_USER_ID=local-admin
AUTH_SINGLE_USER_EMAIL=local-admin@example.com
AUTH_SINGLE_USER_NAME="Local Admin"
SESSION_COOKIE_SECRET=dev-cookie-secret
PASSWORD_PEPPER=dev-password-pepper
INITIAL_ADMIN_EMAILS=local-admin@example.com

YDB_ANONYMOUS_CREDENTIALS=1
YDB_ENDPOINT=grpc://127.0.0.1:2136
YDB_PETS_ENDPOINT=grpc://127.0.0.1:2136
YDB_PETS_DATABASE=/local
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`YDB_ENDPOINT` is needed for local host-to-Docker runs because `ydb-sdk`
otherwise follows discovery endpoints that may contain the Docker container
hostname.

Apply schema, seed data, and start the app:

```bash
docker cp ydb/schema.yql ydb-local:/tmp/codex-pets-schema.yql
docker exec ydb-local /ydb -e grpc://localhost:2136 -d /local scripting yql -f /tmp/codex-pets-schema.yql
npm run db:migrate
npm run seed:dev:reset
npm run dev -- --port 3000
```

Open `http://localhost:3000`. The local YDB monitoring UI is
`http://127.0.0.1:8765`.

For a remote or tenant-backed deployment, point the app at a reachable tenant
endpoint, for example:

```bash
YDB_PETS_ENDPOINT=grpc://ydb-host:2137
YDB_PETS_DATABASE=/local/your-tenant
YDB_STATIC_CREDENTIALS_USER=appuser
YDB_STATIC_CREDENTIALS_PASSWORD_FILE=/run/secrets/app.password
YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT=grpc://ydb-host:2136
```

For local development without a full account flow:

```bash
AUTH_MODE=single-user
AUTH_SINGLE_USER_ID=local-admin
SESSION_COOKIE_SECRET=dev-cookie-secret
PASSWORD_PEPPER=dev-password-pepper
INITIAL_ADMIN_EMAILS=local-admin@example.com
```

For the normal built-in account flow:

```bash
AUTH_MODE=app-session
SESSION_COOKIE_SECRET=change-me
PASSWORD_PEPPER=change-me-too
INITIAL_ADMIN_EMAILS=admin@example.com
```

Create tables manually on the existing local-ydb tenant:

```bash
ydb -e "$YDB_PETS_ENDPOINT" -d "$YDB_PETS_DATABASE" scripting yql -f ydb/schema.yql
```

Apply migrations to an existing database:

```bash
npm run db:migrate
```

The approved-pet text backfill is independent of the v3 visual stage:

```bash
npm run search:backfill -- --dry-run
npm run search:backfill -- --apply
npm run search:backfill -- --apply --slug orbit-otter --force
```

The current visual work is a bounded v3 canary only:

```bash
npm run search:backfill-vision -- --dry-run --canaries
npm run search:backfill-vision -- --apply --force --canaries
```

Both backfills require an explicit `--dry-run` or `--apply`; visual `--force`
is valid only with `--apply`. The v3 `--canaries` selector is exactly
`fischl-detailed`, `2b-2`, `master-of-terra`, and `vi`; individual v3 canary
`--slug` execution is forbidden. Dry-run still reads and hashes spritesheets
but never calls either AI provider and never writes YDB.

The v3 apply batch prepares all four captions, slot-aware canary checks, and
embeddings before its first write. This is an all-or-nothing pre-persistence
guarantee, not a YDB transaction: persistence is not transactional, and the
readback/durable gate remains closed after a partial YDB write. This stage ends
after exactly four fresh v3 caption/vector rows and source-hash readback.
Ordinary/full v3 backfill and v3 approval refresh remain blocked until all four
current v3 caption rows and their associated visual vector metadata are fresh,
with matching source hashes and 256 dimensions. A missing, stale, or mismatched
vector keeps the durable gate closed.

A canary miss freezes v3: do not weaken terms or retry/tune the same revision.
The next design is v4 with a deterministic detail crop. New
`visual-calibration-v3` and `visual-holdout-v3` work is deferred to a separate
approved plan; never reuse v2 visual suites for v3. Do not run a full v3
backfill, label pool, calibration, holdout, shadow/hybrid enablement, or
production cutover in this implementation stage.

Backfill logs must not contain document text, captions, frames, prompts,
hashes, embeddings, or secrets. Keep the AI Studio key in the configured
secret file rather than an environment value.

V1/v2 rows are immutable and additive. The first rollback is
`PET_SEARCH_VISUAL_MODE=off`; use `PET_SEARCH_MODE=lexical` to disable the
text-semantic contour too. The caption and embedding rows may remain. To
restore the already calibrated v1 ranker, select the matching pair
`yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1` and
`yandex-text-search-2026-07-pet-vision-v1`; never mix revision pairs.
Historical v2 material is rollback/diagnostic state only.

Seed local development data after the schema exists:

```bash
npm run seed:dev
```

Use `npm run seed:dev:reset` to replace only the fixed `dev_*` seed records.

## Current behavior

- Public users can browse the gallery and open `/pets/[slug]`.
- Public users can submit a pet without logging in by providing files and an
  optional contact email.
- Public users can request a generated pet without logging in by providing a
  contact email, text brief, and optional reference image.
- Logged-in users can see only their own pets under `/my-pets`.
- Logged-in users can see their own pet generation requests under
  `/my-requests`.
- Admins are determined by `INITIAL_ADMIN_EMAILS`.
- Admins can approve, reject, and delete pending pets from
  `/admin/submissions`.
- Admins can review generation requests and link them to existing pets from
  `/admin/requests`.
- Owners can delete their own pets from `/my-pets`.
- Admins can delete any pet from the pet detail page.
- Deleted pets disappear from owner lists, public listings, and `sitemap.xml`.

## SEO, agents, and analytics

- `robots.txt` is served from `src/app/robots.ts`.
- `sitemap.xml` is dynamic and includes all currently approved pets.
- `llms.txt` is dynamic and provides a curated AI-readable map of the gallery,
  manifest, and approved pet pages. `/llm.txt` is a direct plain-text alias for
  fetchers that request the singular filename.
- `llms-full.txt` is dynamic and provides expanded AI-readable docs with API
  reference links, auth notes, examples, and webhooks status.
- `/openapi.json` is the canonical OpenAPI 3.1 specification for the public
  agent/developer contract subset. It intentionally omits public metric
  mutation and download redirect routes. `/api/openapi.json` is an alias for
  scanners that probe predictable API paths.
- `/developers` and `/docs/api` are indexed developer-resource pages for API,
  OpenAPI, MCP, auth, and webhooks discoverability.
- `/mcp` is a public read-only Streamable HTTP MCP server for coding agents.
  Codex can connect with:
  `codex mcp add codexPets --url https://pets.ydb-qdrant.tech/mcp`.
- Official MCP Registry name:
  `tech.ydb-qdrant.pets/codex-pets-ydb-qdrant`.
- `server.json` and `/.well-known/mcp/server.json` expose MCP Registry
  metadata for the public remote server.
- `/.well-known/mcp-registry-auth` exposes the public HTTP domain auth record
  used by `mcp-publisher`.
- HTTP agent access is the primary public machine contract:
  - `/mcp` — Streamable HTTP MCP endpoint with read-only tools:
    `search_pets`, `get_pet`, `get_install_instructions`, `get_badge_code`,
    `get_embed_code`, `get_card_code`, and `get_pet_request_info`
  - `/openapi.json` and `/api/openapi.json` — OpenAPI 3.1 public
    agent/developer contract subset
  - `/llms-full.txt` — expanded LLM-readable API, auth, MCP, package, and
    webhooks documentation
  - `/developers` and `/docs/api` — developer portal and API docs pages
  - `/server.json` and `/.well-known/mcp/server.json` — MCP Registry metadata
    pointing to the public Streamable HTTP remote
  - `/.well-known/mcp-registry-auth` — public MCP Registry HTTP auth record
  - `/api/manifest` — approved pet list with page URLs, install commands, and
    asset URLs
  - `/api/manifest.toon` — TOON mirror of the public manifest for LLM-friendly
    retrieval
  - `/api/pets?q=<query>&kind=all|creature|object|character` — approved pet
    list/search JSON without private contact emails
  - `/api/pets.toon?q=<query>&kind=all|creature|object|character` — TOON
    mirror of approved pet list/search without private contact emails
  - `/api/pets/<slug>` — public detail JSON for one approved pet without
    private contact emails
  - `/api/pets/<slug>.toon` — TOON mirror of public detail data without private
    contact emails
  - `/api/tags` — current tag counts for approved pets
  - `/api/tags.toon` — TOON mirror of current tag counts
  - `/api/pets/<slug>/share` — sanitized install, badge, and embed snippets
  - `/api/pets/<slug>/install` — read-only install instructions with no metric
    mutation
  - `/badge/<slug>.svg` — README badge SVG
  - `/card/<slug>.gif` — animated GIF share surface. Supports `mode=sprite|card`, `state`, and `scale`; default sharable output is sprite-only.
  - `/embed/<slug>` — iframe embed page. Supports `mode=sprite|card`, `state`, `scale`, `theme`, `compact`, and visibility toggles.
  - `npx @astandrik/codex-pets install <slug>` — CLI install command format
- Browser WebMCP is a read-only progressive enhancement. It only works in
  browser runtimes that expose `navigator.modelContext`; ordinary HTTP
  crawlers and ChatGPT browsing sessions should use the endpoints above.
  Supported browser WebMCP tools:
  - `search_codex_pets` — search approved pets through `/api/pets`
  - `get_codex_pet` — fetch one approved pet through `/api/pets/[slug]`
  - `get_codex_pets_manifest` — fetch `/api/manifest`
  - `get_current_codex_pet` — inspect the approved pet open in the current tab
- WebMCP intentionally does not expose submit, like, download/install counters,
  auth, admin, moderation, or delete actions.
- The sitemap updates automatically after moderation changes; no cron or manual
  rebuild is needed for new approved pets to appear there.
- Yandex Metrika is loaded in production only and tracks:
  - account register/login success and error
  - pet submit success and error
  - pet generation request success and error
  - moderation approve/reject/delete
- Server-side MCP aggregate metrics are optional. They are enabled only when
  `YANDEX_METRIKA_MP_TOKEN` and `YANDEX_METRIKA_MP_CLIENT_ID` are configured.
  MCP metrics use a dedicated technical Metrika ClientID and send a synthetic
  `/mcp` pageview before the `mcp_tool_call` goal event. The payload includes
  only aggregate tool dimensions such as tool name, status, safe slug, kind,
  result count, and limit; it does not include raw MCP search text, IP address,
  user-agent, origin header, contact email, owner email, or owner identifiers.
- IndexNow is optional. Set `INDEXNOW_KEY` in the runtime env to enable the
  public key file and approval-time notifications for the gallery, the new pet
  detail page, `sitemap.xml`, `llms.txt`, and `/api/manifest`.

## Main routes

- `/` — public gallery
- `/request` — public pet generation request flow
- `/submit` — public submit flow
- `/login`, `/register`, `/logout` — local account flow
- `/my-pets` — owner view
- `/my-requests` — logged-in user generation request view
- `/admin/submissions` — admin moderation queue
- `/admin/requests` — admin pet generation request queue
- `/pets/[slug]` — pet detail page
- `/agents` — agent and MCP connection guide
- `/developers` — Codex Pets Developer Portal
- `/docs/api` — Codex Pets API docs
- `/guides/best-codex-pets-for-ai-coding-agents` — category guide for Codex
  pet selection
- `/guides/codex-pets-vs-vscode-pets` — comparison guide for editor pet use
  cases
- `/mcp` — public read-only Streamable HTTP MCP endpoint
- `/openapi.json`, `/api/openapi.json` — public OpenAPI specification
- `/server.json`, `/.well-known/mcp/server.json` — MCP Registry metadata
- `/api/manifest` — public agent/CLI manifest
- `/api/manifest.toon` — TOON mirror of the public manifest
- `/api/pets` — public approved pet list/search JSON
- `/api/pets.toon` — TOON mirror of approved pet list/search
- `/api/pets/[slug]` — public approved pet detail JSON
- `/api/pets/[slug].toon` — TOON mirror of public pet detail data
- `/api/tags`, `/api/pets/[slug]/share`, `/api/pets/[slug]/install` —
  read-only agent/share JSON
- `/api/tags.toon` — TOON mirror of approved tag counts
- `/badge/[slug].svg`, `/card/[slug].gif`, `/embed/[slug]` — share surfaces
- `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llm.txt`, `/llms-full.txt` —
  SEO and AI-readable outputs

## Agent-facing checks

Use `CODEX_PETS_DATA_SOURCE=mock npm run dev -- --port 3000` to smoke-check
agent-facing routes without local YDB. Expected public endpoints:

```bash
curl -I http://localhost:3000/
curl -I http://localhost:3000/api/pets
curl -I http://localhost:3000/api/pets.toon
curl -I http://localhost:3000/api/manifest
curl -I http://localhost:3000/api/manifest.toon
curl -I http://localhost:3000/openapi.json
curl -I http://localhost:3000/api/openapi.json
curl -I http://localhost:3000/api/tags
curl -I http://localhost:3000/api/tags.toon
curl -I http://localhost:3000/llms.txt
curl -I http://localhost:3000/llm.txt
curl -I http://localhost:3000/llms-full.txt
curl -I http://localhost:3000/developers
curl -I http://localhost:3000/docs/api
curl -I http://localhost:3000/guides/best-codex-pets-for-ai-coding-agents
curl -I http://localhost:3000/guides/codex-pets-vs-vscode-pets
curl -i http://localhost:3000/mcp
```

For a JSON-response MCP smoke test:

```bash
curl -s http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

For WebMCP itself, use a WebMCP-capable Chrome or lab browser and check that
`navigator.modelContext` exposes the read-only tools listed above. In normal
browsers without WebMCP, the client registrar is a no-op; this is expected and
does not affect the HTTP agent contract.

## Private deployment notes

Concrete per-host instructions, local paths, and operational notes should live
under a gitignored `private/` directory. The public docs in this repo should stay
generic and safe to commit.

## Pet Package

Each pet is distributed as:

- `pet.json`
- `spritesheet.webp` or `spritesheet.png`
- downloadable ZIP containing both files at the root

The registry accepts both Codex atlas versions, each using `192x208` cells:

- v1: omit `spriteVersionNumber` or set it to `1`; use an 8x9 atlas at
  `1536x1872`.
- v2: set `spriteVersionNumber` to `2`; use an 8x11 atlas at `1536x2288`,
  including the 16 clockwise look directions in rows 9 and 10.

## CLI install

Approved gallery pets can be installed into Codex from npm:

```bash
npx @astandrik/codex-pets install zero-two-2
```

The CLI reads `/api/manifest` from `https://pets.ydb-qdrant.tech` by default
and writes to `${CODEX_HOME:-~/.codex}/pets/<slug>/`. Use `--force` to replace
an existing local pet folder, or `CODEX_PETS_URL` / `--url` to point at another
deployment. If Codex is already running, restart it before selecting the new pet
in Settings -> Appearance -> Pets.
