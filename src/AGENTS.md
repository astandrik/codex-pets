<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-05-09 -->

# AGENTS.md — src

## Overview
Source tree for the `codex-pets` Next.js app: App Router pages, API routes, client components, app-owned auth, YDB-binary asset storage, SEO routes, and analytics hooks.

## Key Files
| File | Purpose |
|------|---------|
| `app/layout.tsx` | root layout, providers, global metadata |
| `app/page.tsx` | gallery homepage |
| `app/robots.ts` / `app/sitemap.ts` | SEO outputs for crawlability and pet URLs |
| `app/api/submissions/register/route.ts` | final registration path for uploaded pets |
| `app/api/my-pets/[id]/delete/route.ts` | owner delete mutation |
| `app/api/admin/submissions/[id]/delete/route.ts` | admin delete mutation |
| `components/SubmitForm/SubmitForm.tsx` | client upload flow and package preparation |
| `components/PetDeleteAction/PetDeleteAction.tsx` | owner/admin delete action on pet detail |
| `components/StatePreview/StatePreview.tsx` | interactive atlas row/frame preview |
| `lib/pets/repository.ts` | YDB-backed persistence for pets, uploads, reviews, metrics |
| `lib/pets/assets-repository.ts` | YDB-backed binary asset storage and retrieval |
| `lib/auth/session.ts` | internal auth resolution and admin check |
| `lib/metrics/yandex.ts` | Yandex counter ID and goal tracking |

## Golden Samples (follow these patterns)
| Pattern | Reference |
|---------|-----------|
| Route handler composition | `app/api/submissions/register/route.ts` |
| Shared validation utilities | `lib/pets/validation.ts` |
| Shared repository/YQL layer | `lib/pets/repository.ts` |
| Client-side interactivity in isolated component | `components/SubmitForm/SubmitForm.tsx` |
| Account flow UI | `components/AuthForm/AuthForm.tsx` |
| Adjacent SCSS component styling | `components/PetCard/PetCard.tsx` + `components/PetCard/PetCard.scss` |

## Setup & environment
- Framework: Next.js 16 App Router on React 19
- Package manager: npm
- Path alias: `@/*` -> `src/*`
- Server integrations depend on `YDB_PETS_*`, `YDB_STATIC_CREDENTIALS_*`, auth env vars, and `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_PATH`

## Build & tests
- Install: `npm install`
- Typecheck: `npx tsc --noEmit --incremental false`
- Lint: `npm run lint`
- Test: `npm test`
- Build: `npm run build`
- Dev: `npm run dev -- --port 3000`

## Code style & conventions
- Default to server components; add `"use client"` only when hooks, DOM APIs, timers, `fetch` from browser, or direct interaction requires it.
- Keep request parsing and auth in route files; move reusable business logic into `lib/**`.
- Keep YQL in repository functions, not in components or page files.
- Normalize external input once at the boundary; return typed app objects from helpers.
- For pet pages, distinguish between `approved` visibility in public lists and direct owner/admin/status views on `/pets/[slug]`.
- Co-locate component SCSS next to the component and use the existing BEM-style naming.
- Prefer explicit small helpers over generic abstraction layers around YDB or auth.
- Use `@/` imports for internal modules rather than long relative chains.

## Security & safety
- Never import server secrets into client components.
- Keep YDB queries and internal auth header resolution server-side.
- Do not trust uploaded JSON or asset bytes; validate through `lib/pets`.
- Do not hardcode public URLs when `withBasePath()` or `toPublicUrl()` is the correct path builder.
- Keep moderation, delete, and sitemap behavior consistent around `status = approved|pending|rejected|deleted`.
- Do not add auto schema bootstrap logic; schema stays manual in `../ydb/schema.yql`.

## PR/commit checklist
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npx tsc --noEmit --incremental false` when touching shared types or route signatures
- [ ] `npm run build` for route, provider, config, or shared-library changes
- [ ] Browser verification for visible UI changes on the affected page

## Patterns to Follow
Prefer the files in the Golden Samples section over inventing new local styles. For route work, the preferred layering is route -> validation/helper -> repository -> YDB.

## When stuck
- Check root [AGENTS.md](../AGENTS.md) for repo-wide rules and deployment context.
- Use `README.md` for local setup and `DEPLOYMENT.md` for production assumptions.
- Inspect the nearest component/repository in the same folder before adding a new pattern.

## House Rules (project-specific)
- Do not move manual YDB schema concerns into runtime code.
- `lib/pets/repository.ts` is the canonical place for pet-related persistence.
- Keep `SubmitForm` and `StatePreview` interactive logic client-only; keep list/detail pages server-rendered when possible.
- Owner delete and admin delete are soft delete operations; do not introduce hard-delete semantics casually.
- Approved pets should automatically appear in dynamic sitemap output; no manual cron/rebuild path should be required.
- If a change affects both API and UI, update the route test and the relevant unit test in the same change.
