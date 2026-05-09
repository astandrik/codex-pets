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

## Runtime env

Use a runtime env file based on:

- [deploy/app-session.env.runtime.example](./deploy/app-session.env.runtime.example)

Minimum example:

```env
NODE_ENV=production
PORT=3000

NEXT_PUBLIC_APP_URL=https://example.com/codex-pets
NEXT_PUBLIC_BASE_PATH=/codex-pets

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

The schema currently includes:

- `codex_pets`
- `codex_pet_assets`
- `codex_users`
- `codex_sessions`
- `codex_email_verification_tokens`
- `codex_password_reset_tokens`
- `codex_pet_reviews`
- `codex_pet_metrics`

`codex_pet_upload_sessions` is legacy and may remain present if it already
exists.

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
  -p 127.0.0.1:3001:3000 \
  --env-file /path/to/.env.runtime \
  -v /path/to/app.password:/run/secrets/app.password:ro \
  codex-pets:latest
```

## Reverse proxy

If you deploy under a subpath, proxy both the exact path and the prefix:

```nginx
location = /codex-pets {
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

Do not use browser-level basic auth as the main user login UX. The app already
implements its own `app-session` account flow.

## Operational behavior

Current app behavior:

- public gallery and pet detail pages
- anonymous submit with optional contact email
- local account login/register/logout
- admin moderation queue
- owner delete and admin delete via soft delete (`status = deleted`)
- `robots.txt` served by the app
- dynamic `sitemap.xml`
- approved pets automatically appear in `sitemap.xml` without cron or rebuild
- Yandex Metrika loaded in production

## Smoke checks

After deploy, verify:

```bash
curl -I https://example.com/codex-pets/
curl -I https://example.com/codex-pets/api/manifest
curl -I https://example.com/codex-pets/login
curl -I https://example.com/codex-pets/register
curl -I https://example.com/codex-pets/robots.txt
curl -I https://example.com/codex-pets/sitemap.xml
```

Manual checks:

1. public pages open without browser-level auth prompt
2. login/register/logout work
3. submit works anonymously
4. `My pets` shows only owner-attached pets
5. admin queue is available to admin accounts only
6. approved pets show up in the gallery and sitemap
7. deleted pets disappear from owner lists, public lists, and detail pages

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
