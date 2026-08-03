# Deployment Plan

Generic deployment notes for `codex-pets`.

Sensitive host-specific details, private paths, secrets, and one-off operational
commands should live outside git, for example under a gitignored `private/`
directory.

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
YANDEX_AI_STUDIO_FOLDER_ID=
YANDEX_AI_STUDIO_API_KEY_FILE=/run/secrets/yandex-ai-studio.key
PET_RELATED_HYBRID_ENABLED=false

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

The v2 text and Qwen visual revisions both use managed Yandex Text Embeddings
v2 at 768 dimensions. Keep the legacy 256-dimensional rows for rollback; the
backfills add revision-scoped rows and do not overwrite them.

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
the additive migrations and building the initial snapshots:

```bash
npm run related:rebuild -- --dry-run
npm run related:rebuild -- --apply
```

Inspect the structured output before enabling the feature. The apply result must
have `status: "ready"`, and `coverage.snapshotCount` must equal
`coverage.approvedPetCount`. Then set `PET_RELATED_HYBRID_ENABLED=true` and
restart the app. Unset and exact `true` enable snapshot reads; exact `false` is
the rollout and rollback kill switch. Invalid values fail safely to the
heuristic resolver.

To roll back ordering without discarding derived rows, first disable the
feature, then recover the retained generation:

```bash
npm run related:rebuild -- --recover-previous
```

The recovery command exits nonzero when no compatible previous generation is
available. Keep the feature disabled until the recovered state is confirmed
`ready`; re-enable it only after that check. Compatibility requires an exact
ranking-profile revision match, so deploy the application version for the
retained revision before recovery when rolling back across profile revisions.

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
