# Codex Pets

Community gallery for Codex-compatible animated pets with local accounts,
manual moderation, YDB-backed asset storage, and public detail pages for
approved and pending pets.

## Stack

- Next.js 16 App Router, React 19, TypeScript strict
- Gravity UI + SCSS/BEM
- local-ydb / YDB native gRPC via `ydb-sdk`
- App-owned email+password auth with YDB-backed users and sessions
- Pet assets stored in YDB as binary blobs
- Dynamic `robots.txt` and `sitemap.xml`
- Yandex Metrika using the same counter as `ydb-qdrant-ui` (`104844437`)
- JSZip + Sharp for package validation

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

If you deploy under a subpath such as `/codex-pets`, set:

```bash
NEXT_PUBLIC_BASE_PATH=/codex-pets
NEXT_PUBLIC_APP_URL=https://example.com/codex-pets
```

The public gallery renders without secrets. For account login, submit, moderation,
and metrics you need `YDB_PETS_ENDPOINT`, `YDB_PETS_DATABASE`, and auth env.

For a local-ydb-backed deployment, point the app at a reachable tenant endpoint,
for example:

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

## SEO and analytics

- `robots.txt` is served from `src/app/robots.ts`.
- `sitemap.xml` is dynamic and includes all currently approved pets.
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
- `/api/manifest` — public slim manifest
- `/robots.txt`, `/sitemap.xml` — SEO outputs

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
