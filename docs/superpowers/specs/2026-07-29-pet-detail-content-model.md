# Pet Detail Content Model — Spec

> Date: 2026-07-29 (drafted 2026-07-30 with production audit data).
> Plan reference: `docs/superpowers/plans/2026-07-29-seo-indexation-prioritized-worklist.md` Task 5; RU plan item 8.
> Status: **proposed** — the product decision recorded here gates implementation.

## Context

Google indexes nothing on the site: sitemap report 165 submitted / 0 indexed (baseline `docs/seo-indexation-baseline.md`), all crawled URLs sit at "Crawled — currently not indexed", and pet detail pages are "URL is unknown to Google". The bottleneck is selection, not crawlability. Pet detail pages are 146 of the 165 submitted URLs, so their content quality is the largest single lever.

Production audit of 10 deterministic detail pages (2026-07-30, raw HTML without JavaScript; full artifact `.scratch/seo-verify/pet-detail-audit-2026-07-30.md`):

| slug | owner | kind | approved | description chars | /pets/ links |
|---|---|---|---|--:|
| crawlstack-polished | astandrik | creature | 2026-05-09 | 107 | 0 |
| kitsune-chibi-2 | jrpg fan | creature | 2026-05-17 | 83 | 0 |
| wild-boar | Anonymous | creature | 2026-07-26 | 105 | 0 |
| kesha | Anonymous | creature | 2026-07-26 | 208 | 0 |
| johnny | astandrik | character | 2026-05-12 | 72 | 0 |
| bolshoy-tyll | astandrik | character | 2026-05-21 | 116 | 0 |
| blond-flexer-2 | astandrik | character | 2026-05-22 | 116 | 0 |
| foggy-hedgehog | astandrik | character | 2026-05-25 | 63 | 0 |
| rose-katana | Anonymous | character | 2026-07-16 | 89 | 0 |
| polin | Anonymous | creature | 2026-07-25 | 108 | 0 |

Audit observations:

- Every audited page renders **zero internal links to other pets**. The only navigation is breadcrumbs and "Back to gallery". Tags in the meta card are plain text, not links (`?tags=` appears nowhere in detail-page HTML).
- Visible unique text per page is a single description of 63–208 characters plus boilerplate metrics/dates.
- Quality defects visible in the sample: `polin` description is entirely in Spanish on an English-language site; `bolshoy-tyll` mixes a Russian name with English prose.
- Authors already smuggle structured facts into free-form tags: `polin` carries `source-github`, `license-cc0`, `v2` — evidence that provenance/license/license-version facts exist but have no proper home.
- `gothic-flying-demon` is present in `/api/manifest` (147 approved) but absent from `sitemap.xml` (146 pet URLs) on 2026-07-30 — recorded as an observation, not analyzed here.

Current constraints verified in code:

- Description is truncated to **320 characters** at ingestion (`src/lib/pets/validation.ts:90`). Any no-schema description work must fit this bound.
- Non-approved pets render `noindex, nofollow` and no JSON-LD (`src/app/pets/[slug]/page.tsx`) — correct, unchanged.
- The detail page has a markdown twin (`src/lib/pets/markdown.ts` served by `src/app/pets/[slug]/markdown/route.ts`). Every visible-content change must land in both surfaces to avoid drift (lesson from the guides rewrite, PRs #28–#30).

## Goals

- Give detail pages real, indexable unique value: better descriptions where approval is obtainable, plus deterministic internal navigation everywhere.
- Define the content model decision **before** any persistence or public-contract change.
- Make the pilot measurable: fixed pilot/control groups comparable after Google recrawls them.

## Non-goals

- No automatic prose generated from tags, kind, or display name. Template text at scale is exactly the "scaled content abuse" pattern; every rewritten description must add facts a human verified (visual identity, behavior, provenance).
- No `pet.json` format change, YDB schema change, submission-validation change, or public API change under this spec. Path 2 below only defines candidates; implementing any of them requires a separate explicit approval.
- No owner-facing edit UI in this iteration.

## Fact inventory

Already available in the current model (`PublicPet`, rendered today):

- displayName, kind, tags, description (≤320 chars), owner name/profile slug, createdAt/approvedAt, download/install/like metrics, package asset URLs, sprite version and animation states (from `pet.json`, 9 fixed states on v1 sheets).

Candidate author-supplied fields (not in the model; only when genuinely known):

| Field | Why it is real information | Owner | Validation | Moderation | API compat | Migration | Rollback |
|---|---|---|---|---|---|---|---|
| `personality` (short text) | How the pet "behaves" across states; not derivable from tags | Pet author on submit/edit | ≤160 chars, plain text, no URLs | Same queue as description | Additive optional field in pet.json; absent = omitted | Existing pets: empty, opt-in backfill by authors | Drop field usage; data stays dormant |
| `bestFor` (use-case list) | "Focus timer companion", "PR review mascot" — selection guidance | Pet author | ≤3 items × ≤60 chars, controlled vocabulary discouraged but linted | Review with submission | Optional array; absent = omitted | Empty for existing | Hide section |
| `notableStates` | Which of the 9 states are unusually good and why | Pet author | subset of known state keys + ≤80-char note each | Review | Optional map | Empty | Hide |
| `source` / `license` | Provenance (`source-github`, `license-cc0` are already in tags) | Pet author, verified vs declared repo where possible | URL allowlist hosts; license from SPDX-like enum + `other` | Maintainer verifies link target | Optional strings | Parse from tags where unambiguous, author-confirmed | Remove from rendering |
| `language` of description | `polin` is Spanish; `bolshoy-tyll` is mixed | Maintainer flag | BCP-47 | Maintainer | Optional | Detect on read for display hint | Omit |

None of the candidate fields is approved by this spec alone.

## Hard rule: no templated prose

Reject any implementation that synthesizes descriptions or "SEO text" from existing structured fields (tags, kind, displayName, state names). Recombining known facts produces no new information and creates near-duplicate pages at scale — the pattern classifiers associate with scaled templated content. Human-verified facts only.

## Implementation paths

### Path 1 — no-schema pilot (this spec approves, pending product sign-off)

Two independent deliverables:

1. **Improved descriptions on 10 pilot pets** (data operation, not code). Each rewritten description: ≤320 characters (hard ingestion bound), English (fixing the Spanish/mixed-language defects), first-hand facts only (visual identity, animation behavior, provenance where known), no keyword stuffing, no template. Approval rule: pets owned by a known user require that owner's sign-off; `Anonymous` pets fall back to maintainer approval, recorded per-pet. `kitsune-chibi-2` (owner `jrpg fan`) is rewritten only if the owner confirms; otherwise it keeps its current text and is analyzed as part of the control set.
2. **SSR related-pets links on all approved detail pages** (code). Rationale for shipping globally instead of gating to the 10 pilot pages: related links are deterministic navigation, not new prose; they add no content-quality risk; they directly address discovery ("URL is unknown to Google" for all detail pages) by giving the crawler page-to-page paths; per-slug gating would add an allowlist mechanism with no benefit. The description experiment stays isolated because both pilot and control pages receive related links simultaneously.

### Path 2 — schema/format extension (separate approval required)

Adding any candidate field from the inventory to `pet.json`, YDB, submission validation, or the public manifest/API. Requires its own spec amendment, migration plan, and owner communication. Not implemented under Path 1.

## Related-pets deterministic rule

Inputs: the full approved catalog (slug, displayName, kind, tags, approvedAt) and the current pet.

1. Exclude non-approved pets and the current slug.
2. Score each candidate: primary = number of shared tags (descending); secondary = same kind as current pet (same kind first).
3. Tie-break: approvedAt descending (fallback createdAt), then slug ascending — fully stable across requests.
4. Take at most **4** links.

Rendering: server-rendered "Related pets" section after the main body on `/pets/[slug]`, plain text links (displayName + kind label + one-line description). No sprite previews (the 1200×630 og-image per pet is too heavy; bundle is already 996 KB identity). Non-approved pages (pending/rejected) render no section. The markdown twin gets a matching `## Related pets` section fed by the same selector.

Data source: new lightweight repository query selecting only `slug, display_name, kind, tags, approved_at` for `status='approved'` (no metrics/profile joins), cached via `unstable_cache` with 60 s revalidate, mirroring the existing metrics cache pattern on the same page.

## Pilot and control groups

Pilot (descriptions rewritten; exact slugs from the 2026-07-30 audit):

- Cohort pets: `crawlstack-polished`, `kitsune-chibi-2` (owner-approval caveat above), `wild-boar`, `kesha`
- Maintainer-owned, evenly spaced (indices 0, 5, 9, 14 of 15): `johnny`, `bolshoy-tyll`, `blond-flexer-2`, `foggy-hedgehog`
- Anonymous, first character + first creature by approval date: `rose-katana`, `polin`

Control (descriptions untouched; both groups get related links): `cloud-flat-2`, `chibi-wolf`, `blue-rabbit-2`, `sakura`, `fire-skull`, `leon`, `curator`, `lain`, `maybe-baby-2-2`, `jinx`

Selection is deterministic from the production sitemap (approval dates) and `/api/manifest` (owners, kinds) as of 2026-07-30.

## Measurement plan

- Record both groups in `docs/seo-indexation-baseline.md` before rollout.
- After Google recrawls the groups (newer `lastCrawlTime` than the rollout date per URL), rerun the GSC inspection cohort and compare verdicts pilot vs control. Follow the baseline rerun protocol: no attribution when several releases share a crawl window; missing evidence recorded as `unavailable`, never as zero.
- Manual "Request indexing" on the 10 pilot URLs in the GSC UI is a separately confirmed user action, not part of the automated protocol.
- Success signal: pilot pages move from "URL is unknown to Google" / "Crawled — currently not indexed" toward indexed at a visibly higher rate than control pages after recrawl.

## Test plan (fail-before / pass-after)

- Related-pets selector (pure function): shared-tags-first ordering, kind fallback, stable tie-break, self-exclusion, ≤4 results, no duplicates, approved-only.
- Detail page SSR: section present in raw HTML for approved pets; absent for pending/rejected; ≤4 links; current slug never listed.
- Repository: mock-data branch of the new lightweight query.
- Markdown twin: `## Related pets` section present for approved pets.
- Unchanged contracts: canonical, robots, metadata composition, JSON-LD shape, non-approved `noindex` behavior.

## Rollback

- Code: revert the pilot PR.
- Descriptions: restore pre-rewrite texts from the JSON backup written by the update script before it touches production.
