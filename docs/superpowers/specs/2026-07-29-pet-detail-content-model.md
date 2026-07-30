# Pet Detail Content Model — Spec

> Date: 2026-07-29 (drafted 2026-07-30 with production audit data; review fixes 2026-07-30).
> Plan reference: SEO prioritized worklist, RU plan item 8 (local untracked planning doc — this spec is self-contained).
> Status: **proposed** — the product decision recorded here gates implementation.

## Context

Google indexes nothing on the site: sitemap report 165 submitted / 0 indexed (baseline `docs/seo-indexation-baseline.md`). Every URL inspected in GSC so far — 4 pet detail pages and 7 other indexable URLs — sits at "Crawled — currently not indexed" or "URL is unknown to Google" (pet pages). These are cohort observations from the inspected sample, not a per-URL census. The bottleneck is selection, not crawlability. Pet detail pages are 146 of the 165 submitted URLs, so their content quality is the largest single lever.

Production audit of 10 deterministic detail pages (2026-07-30, raw HTML without JavaScript; local artifact `.scratch/seo-verify/pet-detail-audit-2026-07-30.md`, intentionally not committed — the essential data is inline below; reproduce with `curl -s https://pets.ydb-qdrant.tech/pets/<slug>` and count `href="/pets/` occurrences and the description length):

| slug | owner | kind | approved | description chars | /pets/ links |
|---|---|---|---|--:|--:|
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
- Non-approved pets render `noindex, nofollow` and omit the pet JSON-LD; the breadcrumb JSON-LD is still emitted for all statuses (`src/app/pets/[slug]/page.tsx:179-207`) — correct, unchanged.
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

- Per-pet: displayName, kind, tags, description (≤320 chars), owner name/profile slug, createdAt/approvedAt, download/install/like metrics, package asset URLs; `spriteVersionNumber` when present in that pet's `pet.json`.
- Global, not per-pet: the 9 animation states are the shared v1-atlas contract — identical for every pet on a v1 sheet. They differentiate nothing between pets and must not be treated as unique pet content.

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

1. **Improved descriptions on 10 pilot pets** (data operation, not code). Each rewritten description: ≤320 characters (hard ingestion bound), English (fixing the Spanish/mixed-language defects), first-hand facts only (visual identity, animation behavior, provenance where known), no keyword stuffing, no template. Approval rule: pets owned by a known user require that owner's sign-off; `Anonymous` pets fall back to maintainer approval, recorded per-pet. `kitsune-chibi-2` (owner `jrpg fan`) is rewritten only if the owner confirms.
   - **Owner-denial branch:** cohorts are disjoint by construction — the pilot set is exactly the pets actually rewritten. If the `kitsune-chibi-2` owner declines, it keeps its current text, leaves the pilot list (9 rewrites), and joins the control set (11 controls). No replacement pet is drafted: a substitute from another stratum would break the stratum matching, and the success metric is a per-cohort indexation *rate*, which tolerates unequal cohort sizes. The groups recorded in `docs/seo-indexation-baseline.md` must reflect the final lists.
   - **Storage scope:** the update rewrites only the `codex_pets.description` row. The stored `pet.json` asset and the downloadable ZIP keep the author-submitted bytes: they are the original artifact (provenance), while every SEO surface — HTML page, markdown twin, `/api/manifest` — reads the description from the row. Syncing packaged copies is a possible later step, not part of this pilot.
   - **Sitemap freshness:** pet `lastModified` in `src/app/sitemap.ts` is `updatedAt ?? approvedAt ?? createdAt`, and the description-update script sets `updated_at` on every row it rewrites, so rewritten pages advertise a fresh `lastModified`. The sitemap is served from a TTL cache tagged `SITEMAP_CACHE_TAG`; the data operation runs outside the Next.js runtime and does not call `revalidateTag`, so the new dates self-propagate when the cache expires within its TTL — acceptable on the multi-day recrawl horizon this pilot measures.
   - **Embeddings rollout step:** immediately after a successful `--apply`, refresh the rewritten pets' search embeddings by running `node scripts/backfill-pet-search-embeddings.mjs --apply --slug <slug>` once per updated slug (the backfill takes a single `--slug` value per run; the update script prints the exact commands after a successful apply). Rationale: hybrid search rejects embeddings whose stored source hash no longer matches the rewritten description, so skipping this step would silently drop the pilot pets from vector search results.
2. **SSR related-pets links on all approved detail pages** (code). Rationale for shipping globally instead of gating to the 10 pilot pages: related links are deterministic navigation, not new prose; they add no content-quality risk; they directly address discovery ("URL is unknown to Google" for all detail pages) by giving the crawler page-to-page paths; per-slug gating would add an allowlist mechanism with no benefit. The description experiment stays isolated because both pilot and control pages receive related links simultaneously.

### Path 2 — schema/format extension (separate approval required)

Adding any candidate field from the inventory to `pet.json`, YDB, submission validation, or the public manifest/API. Requires its own spec amendment, migration plan, and owner communication. Not implemented under Path 1.

## Related-pets deterministic rule

Inputs: the full approved catalog (slug, displayName, kind, tags, description, approvedAt, createdAt) and the current pet.

1. Exclude non-approved pets and the current slug.
2. Score each candidate: primary = size of the intersection of the normalized tag sets — trimmed, lowercased, de-duplicated — of candidate and current pet (descending); secondary = same kind as current pet (same kind first).
3. Tie-break: `approvedAt` descending (pets without `approvedAt` fall back to `createdAt`), then slug ascending — fully stable across requests.
4. Take at most **4** links.

Rendering: server-rendered "Related pets" section after the main body on `/pets/[slug]`, plain text links: displayName + kind label + one-line description (whitespace collapsed, hard-truncated at 120 characters with an ellipsis). No sprite previews (the 1200×630 og-image per pet is too heavy; bundle is already 996 KB identity). Non-approved pages (pending/rejected) render no section. The markdown twin gets a matching `## Related pets` section fed by the same selector.

Data source: new lightweight repository query selecting only `slug, display_name, kind, tags_json, description, approved_at, created_at` for `status='approved'` (no metrics/profile joins), cached via `unstable_cache` with 60 s revalidate plus explicit tag-based invalidation (`revalidateTag(RELATED_PETS_CANDIDATES_CACHE_TAG, "max")`) on moderation approve/reject/delete and owner delete, mirroring the existing sitemap-cache pattern.

Inbound-coverage scope: universal inbound discovery is already provided by gallery pagination and `sitemap.xml`, both unchanged. The related-pets section adds cluster-level internal links between similar pets and deliberately does **not** guarantee ≥1 inbound link per approved pet (whether a pet is selected by any other page depends on tag overlap and tie-breaks). Accepted as out of scope for this spec.

## Pilot and control groups

Pilot (descriptions rewritten; exact slugs from the 2026-07-30 audit):

- Cohort pets: `crawlstack-polished`, `kitsune-chibi-2` (owner-approval caveat above), `wild-boar`, `kesha`
- Maintainer-owned, evenly spaced (indices 0, 5, 9, 14 of 15): `johnny`, `bolshoy-tyll`, `blond-flexer-2`, `foggy-hedgehog`
- Anonymous, first character + first creature by approval date: `rose-katana`, `polin`

Control (descriptions untouched; both groups get related links): `cloud-flat-2`, `chibi-wolf`, `blue-rabbit-2`, `sakura`, `fire-skull`, `leon`, `curator`, `lain`, `maybe-baby-2-2`, `jinx`

Selection is deterministic from the production sitemap (approval dates) and `/api/manifest` (owners, kinds) as of 2026-07-30. The control list is disjoint from the pilot and spans the same strata — maintainer-owned, Anonymous, and other-owner pets of both kinds — drawn from the same snapshot; it is stratum-matched, not randomized. Residual confounders (approval-age distribution, pre-existing description quality) are recorded as a limitation: the comparison reads within-cohort verdict movement after recrawl, not absolute rates alone.

One further residual confounder is accepted without mitigation for the pilot: the related-pets section on a control page can render a rewritten pilot one-line description, and vice versa, because both cohorts receive the feature simultaneously. The bias direction is conservative — control pages receiving treatment prose can only shrink the measured pilot-minus-control difference, so this cross-contamination cannot manufacture a false positive.

## Measurement plan

- Record both groups in `docs/seo-indexation-baseline.md` before rollout.
- After Google recrawls the groups (newer `lastCrawlTime` than the rollout date per URL), rerun the GSC inspection cohort and compare verdicts pilot vs control. Follow the baseline rerun protocol: no attribution when several releases share a crawl window; missing evidence recorded as `unavailable`, never as zero.
- Manual "Request indexing" in the GSC UI is a separately confirmed user action, not part of the automated protocol. If performed, it must cover **both cohorts equally** (all pilot *and* control URLs, same day, dates recorded): requesting only pilot URLs would add a recrawl stimulus the control never gets and destroy attribution.
- Success metric (fixed decision rule): the primary metric is the share of cohort URLs whose GSC URL Inspection verdict is "indexed", measured at T+14 and T+28 days after rollout. Success = pilot indexed rate ≥ control indexed rate + 20 percentage points at T+28; T+14 is an early read, not a decision point. URLs whose inspection is unavailable are recorded as `unknown` and excluded from both cohort denominators. Unequal cohort sizes (9 vs 11 in the owner-denial branch) are acceptable because the metric is a rate, not a count.

## Test plan (fail-before / pass-after)

- Related-pets selector (pure function): shared-tags-first ordering on normalized unique tag sets, kind fallback, approvedAt/createdAt tie-break, stable slug ordering, self-exclusion, ≤4 results, no duplicates, approved-only.
- Detail page SSR: section present in raw HTML for approved pets; absent for pending/rejected; ≤4 links; current slug never listed; one-line description truncated at 120 characters.
- Repository: mock-data branch of the new lightweight query.
- Markdown twin: `## Related pets` section present for approved pets; hostile related pet — related displayName/description containing markdown metacharacters (`[]()*_`) and newlines — renders escaped in the `.md` output, pinning the existing escaping behavior.
- Unchanged contracts: canonical, robots, metadata composition, JSON-LD shape, non-approved `noindex` behavior.

## Rollback

- Code: revert the pilot PR.
- Descriptions: restore pre-rewrite texts from the JSON backup written by the update script before it touches production.
