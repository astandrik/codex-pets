# Codex Pets

Community gallery for Codex-compatible animated pets with local accounts,
manual moderation, YDB-backed asset storage, and public detail pages for
approved and pending pets.

Public site: https://pets.ydb-qdrant.tech/.

## Stack

- Next.js 16 App Router, React 19, TypeScript strict
- Gravity UI + SCSS/BEM
- local-ydb / YDB native gRPC via `ydb-sdk`
- App-owned email+password auth with YDB-backed users and sessions
- Pet assets stored in YDB as binary blobs
- Dynamic `robots.txt`, `sitemap.xml`, and `llms.txt`
- Agent-facing HTTP access through `llms.txt`, `/mcp`, `/api/manifest`, and
  `/api/pets`
- Optional read-only browser WebMCP tools in supported browser runtimes
- Yandex Metrika using the same counter as `ydb-qdrant-ui` (`104844437`)
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

Connect Codex:

```bash
codex mcp add codexPets --url https://pets.ydb-qdrant.tech/mcp
```

Available MCP tools:

- `search_pets` — search approved pets
- `get_pet` — fetch one public pet card
- `get_install_instructions` — get install commands without incrementing metrics
- `get_badge_code` — generate README badge snippets
- `get_embed_code` — generate iframe embed snippets

HTTP fallback routes are public too:

- `/api/manifest`
- `/api/pets`
- `/api/pets/<slug>`
- `/api/tags`
- `/api/pets/<slug>/share`
- `/badge/<slug>.svg`
- `/embed/<slug>`

If you deploy under a subpath such as `/codex-pets`, set:

```bash
NEXT_PUBLIC_BASE_PATH=/codex-pets
NEXT_PUBLIC_APP_URL=https://example.com/codex-pets
```

The public gallery renders without secrets. For account login, submit, moderation,
and metrics you need `YDB_PETS_ENDPOINT`, `YDB_PETS_DATABASE`, and auth env.

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

Seed local development data after the schema exists:

```bash
npm run seed:dev
```

Use `npm run seed:dev:reset` to replace only the fixed `dev_*` seed records.

## Current behavior

- Public users can browse the gallery and open `/pets/[slug]`.
- Public users can submit a pet without logging in by providing files and an
  optional contact email.
- Logged-in users can see only their own pets under `/my-pets`.
- Admins are determined by `INITIAL_ADMIN_EMAILS`.
- Admins can approve, reject, and delete pending pets from
  `/admin/submissions`.
- Owners can delete their own pets from `/my-pets`.
- Admins can delete any pet from the pet detail page.
- Deleted pets disappear from owner lists, public listings, and `sitemap.xml`.

## SEO, agents, and analytics

- `robots.txt` is served from `src/app/robots.ts`.
- `sitemap.xml` is dynamic and includes all currently approved pets.
- `llms.txt` is dynamic and provides a curated AI-readable map of the gallery,
  manifest, and approved pet pages.
- `/mcp` is a public read-only Streamable HTTP MCP server for coding agents.
  Codex can connect with:
  `codex mcp add codexPets --url https://pets.ydb-qdrant.tech/mcp`.
- HTTP agent access is the primary public machine contract:
  - `/mcp` — Streamable HTTP MCP endpoint with read-only tools:
    `search_pets`, `get_pet`, `get_install_instructions`, `get_badge_code`,
    and `get_embed_code`
  - `/api/manifest` — approved pet list with page URLs, install commands, and
    asset URLs
  - `/api/pets?q=<query>&kind=all|creature|object|character` — approved pet
    list/search JSON
  - `/api/pets/<slug>` — public detail JSON for one approved pet
  - `/api/tags` — current tag counts for approved pets
  - `/api/pets/<slug>/share` — sanitized install, badge, and embed snippets
  - `/api/pets/<slug>/install` — read-only install instructions with no metric
    mutation
  - `/badge/<slug>.svg` — README badge SVG
  - `/embed/<slug>` — minimal iframe embed page
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
  - moderation approve/reject/delete

## Main routes

- `/` — public gallery
- `/submit` — public submit flow
- `/login`, `/register`, `/logout` — local account flow
- `/my-pets` — owner view
- `/admin/submissions` — admin moderation queue
- `/pets/[slug]` — pet detail page
- `/agents` — agent and MCP connection guide
- `/mcp` — public read-only Streamable HTTP MCP endpoint
- `/api/manifest` — public agent/CLI manifest
- `/api/pets` — public approved pet list/search JSON
- `/api/pets/[slug]` — public approved pet detail JSON
- `/api/tags`, `/api/pets/[slug]/share`, `/api/pets/[slug]/install` —
  read-only agent/share JSON
- `/badge/[slug].svg`, `/embed/[slug]` — share surfaces
- `/robots.txt`, `/sitemap.xml`, `/llms.txt` — SEO and AI-readable outputs

## Agent-facing checks

Use `CODEX_PETS_DATA_SOURCE=mock npm run dev -- --port 3000` to smoke-check
agent-facing routes without local YDB. Expected public endpoints:

```bash
curl -I http://localhost:3000/
curl -I http://localhost:3000/api/pets
curl -I http://localhost:3000/api/manifest
curl -I http://localhost:3000/api/tags
curl -I http://localhost:3000/llms.txt
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

The v1 validator expects an 8x9 atlas at `1536x1872`, where each cell is
`192x208`.

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
