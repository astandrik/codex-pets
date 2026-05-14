<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-05-14 | Last verified: 2026-05-14 -->

# AGENTS.md

**Precedence:** the closest `AGENTS.md` to the files you edit wins. Root defines repo-wide defaults.

## Commands (verified)
> Source: `package.json`, `tsconfig.json`, local verification on 2026-05-09

| Task | Command | ~Time |
|------|---------|-------|
| Install deps | `npm install` | ~1m |
| Typecheck | `npx tsc --noEmit --incremental false` | ~1s |
| Lint | `npm run lint` | ~1s |
| Test (all) | `npm test` | ~1s |
| Build | `npm run build` | ~10s |
| Dev server | `npm run dev -- --port 3000` | ~1s startup |

## Workflow
1. Read nearest `AGENTS.md` before editing.
2. For `src/**`, check `./src/AGENTS.md`.
3. Run the smallest relevant check after each change.
4. Before claiming completion, provide evidence from `lint`, `test`, `build`, or browser verification.

## File Map
```text
src/app/          -> Next App Router pages, layouts, API routes
src/components/   -> UI components with adjacent SCSS
src/components/WebMCP/ -> client-only read-only WebMCP tool registration
src/lib/auth/     -> internal auth helpers and admin checks
src/lib/metrics/  -> Yandex Metrika counter and goal helpers
src/lib/pets/     -> pet types, validation, package parsing, repository logic
src/lib/ydb/      -> YDB driver wrapper, query result parsing, table names
src/styles/       -> global SCSS variables, mixins, utilities, overrides
public/           -> static assets such as favicon
ydb/schema.yql    -> manual YDB schema; apply outside the app
README.md         -> local setup and stack overview
DEPLOYMENT.md     -> production deployment runbook
```

## Golden Samples (follow these patterns)
| For | Reference | Key patterns |
|-----|-----------|--------------|
| API route flow | [src/app/api/submissions/register/route.ts](/Users/astandrik/workspace/codex-pets/src/app/api/submissions/register/route.ts:1) | auth -> config guard -> request parse -> validation -> repository |
| YDB repository | [src/lib/pets/repository.ts](/Users/astandrik/workspace/codex-pets/src/lib/pets/repository.ts:1) | keep YQL close to feature logic; return normalized app types |
| Client upload flow | [src/components/SubmitForm/SubmitForm.tsx](/Users/astandrik/workspace/codex-pets/src/components/SubmitForm/SubmitForm.tsx:1) | ZIP/file normalization, client-side atlas checks, explicit server calls |
| Validation helpers | [src/lib/pets/validation.ts](/Users/astandrik/workspace/codex-pets/src/lib/pets/validation.ts:1) | typed result unions, boundary checks, no ad hoc parsing in routes |
| WebMCP tool layer | [src/components/WebMCP/WebMCPRegistrar.tsx](/Users/astandrik/workspace/codex-pets/src/components/WebMCP/WebMCPRegistrar.tsx:1) | feature-detect `navigator.modelContext`; read-only tools; sanitize public pet data |

## Utilities (check before creating new)
| Need | Use | Location |
|------|-----|----------|
| Current user / admin gate | `getCurrentPrincipal`, `isAdminUser` | `src/lib/auth/session.ts` |
| Password/session auth | `hashPassword`, `verifyPassword`, `applySessionCookie` | `src/lib/auth/password.ts`, `src/lib/auth/session-cookie.ts` |
| Pet metadata validation | `validatePetJson`, `validateSpriteBuffer` | `src/lib/pets/validation.ts` |
| ZIP package validation | `validateUploadedPackage` | `src/lib/pets/package.ts` |
| Binary asset storage | `storePetAssetsInYdb`, `readPetAssetFile` | `src/lib/pets/assets-repository.ts` |
| Agent/WebMCP output shaping | `createAgentPet`, `normalizeSearchCodexPetsInput` | `src/components/WebMCP/webmcp-utils.ts` |
| Analytics goals | `trackGoal` | `src/lib/metrics/yandex.ts` |
| YDB session access | `withSession`, `readyOrThrow` | `src/lib/ydb/client.ts` |
| YDB result decoding | `rowsFromResult`, `textAt`, `uintAt`, `bytesAt` | `src/lib/ydb/result.ts` |

## Heuristics (quick decisions)
| When | Do |
|------|-----|
| Touching `src/**` | Follow `./src/AGENTS.md` |
| Adding API behavior | Keep auth/validation in route; persistence in repository |
| Parsing external input | Add or extend helpers in `src/lib/pets` |
| Changing persistence | Update YQL in repository and, if needed, `ydb/schema.yql` manually |
| Changing WebMCP behavior | Keep tools read-only and backed by existing public routes |
| Adding account/session behavior | Prefer `src/lib/auth/repository.ts` and cookie helpers over ad hoc logic in routes |
| Choosing server vs client | Default to server components; add `"use client"` only for interactivity/browser APIs |
| Considering a new dependency | Ask first unless it is required to unblock the current task |

## Boundaries

### Always Do
- Keep diffs small and local to the affected subsystem.
- Reuse existing helpers before adding a new abstraction.
- Verify commands against the real repo state before documenting them.
- Treat `ydb/schema.yql` as the source of truth for table shape.
- Keep WebMCP outputs limited to approved public data unless the user explicitly changes the public agent contract.

### Ask First
- Adding or replacing dependencies in `package.json`
- Changing auth or YDB environment contract
- Changing public route shapes or moderation workflow
- Exposing any mutating, auth, admin, moderation, or delete behavior through WebMCP
- Changing manual schema format in `ydb/schema.yql`

### Never Do
- Do not auto-create YDB tables from app startup or request handlers.
- Do not expose `YDB_STATIC_CREDENTIALS_*` or proxy-auth trust assumptions to client code.
- Do not edit `.next/`, `node_modules/`, or `.playwright-mcp/`.
- Do not assume `local-ydb` topology; use env vars and documented schema only.

## Codebase State
- YDB tables are created manually from `ydb/schema.yql`; the app assumes they already exist.
- Persistence is native `ydb-sdk`, not Postgres, not Drizzle.
- Timestamps in YDB are currently stored as `Utf8`, not native `Timestamp`.
- Asset binaries are stored in YDB, not on local disk or external object storage.
- There is no dedicated `/api/health` endpoint yet.
- `robots.txt` is static; `sitemap.xml` and `llms.txt` are dynamic.
- Browser WebMCP support is read-only: search approved pets, fetch one approved pet, fetch public manifest, and inspect the current approved pet page.
- Yandex Metrika uses the same counter as `ydb-qdrant-ui`: `104844437`.
- Soft delete is implemented via pet `status = deleted`.

## Terminology
| Term | Means |
|------|-------|
| pet pack | `pet.json` + `spritesheet.webp|png` + downloadable ZIP |
| auth mode | `app-session`, `single-user`, or `proxy-basic` from env |
| pending submission | pet stored in `codex_pets` with `status = pending` |
| deleted pet | pet with `status = deleted`; hidden from owner/public lists and detail route |
| atlas | required 8x9 spritesheet at `1536x1872` |
| tenant | YDB database path from `YDB_PETS_DATABASE`, e.g. `/local/qdrant` |
| WebMCP | experimental browser `navigator.modelContext` tools for read-only agent access |

## Index of scoped AGENTS.md
- [src/AGENTS.md](./src/AGENTS.md) — source-tree rules for App Router, components, routes, and shared libraries

## When instructions conflict
The nearest `AGENTS.md` wins. Explicit user instructions override file-based guidance.
